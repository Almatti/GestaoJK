import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { CheckCircle2, Copy, Plus, Trash2, XCircle, Save, ArrowRight } from 'lucide-react';
import { useList, useRecord, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card, KeyValue } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { SelectInput, TextArea, TextInput } from '@/components/ui/Form';
import { Alert, Badge, LoadingBlock, friendlyError, ErrorState } from '@/components/ui/Feedback';
import { ConfirmDialog, Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { ORDER_KIND, ORDER_STATUS, canTransitionOrder, type OrderStatus } from '@/domain/orders';
import { calculatePricing, checkMargin, PRICE_SOURCE_LABEL, type PriceSource } from '@/domain/pricing';
import { formatReais, formatNumber, toCents, formatPercent } from '@/domain/money';
import { formatDateTimeBR, todaySP } from '@/domain/dates';
import { ORDER_TONE } from './OrdersPage';
import { WhatsAppButton } from '@/features/finance/WhatsAppButton';
import { Attachments } from '@/components/ui/Attachments';

interface Item { id?: string; product_id: string; keg_size_id: string; quantity: number; liters_per_unit: number; unit_price: number; price_per_liter: number | null; price_source: string; unit_cost: number; discount: number }
interface Header { kind: string; customer_id: string; partner_id: string; campaign_id: string; order_date: string; delivery_date: string; delivery_time: string; pickup_date: string; delivery_address: string; payment_method: string; installments: number; first_due_date: string; discount: number; freight: number; equipment_needed: string; notes: string }

const PAYMENT = [['pix', 'Pix'], ['boleto', 'Boleto'], ['dinheiro', 'Dinheiro'], ['cartao_credito', 'Cartão de crédito'], ['cartao_debito', 'Cartão de débito'], ['transferencia', 'Transferência']].map(([value, label]) => ({ value: value!, label: label! }));
const NEXT: OrderStatus[] = ['aguardando_confirmacao', 'em_preparacao', 'aguardando_entrega', 'em_rota', 'entregue', 'aguardando_recolhimento', 'finalizado'];

export function OrderEditorPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const { can } = useAuth();
  const order = useRecord<Row>('orders', id);
  const existingItems = useList<Row>('order_items', { filters: [{ column: 'order_id', op: 'eq', value: id }] }, { enabled: !!id });
  const history = useList<Row>('order_status_history', { filters: [{ column: 'order_id', op: 'eq', value: id }], order: [{ column: 'changed_at' }] }, { enabled: !!id });
  const customers = useList<Row>('customers', { select: 'id,name,trade_name,segment,whatsapp,phone,street,number,district,city', filters: [{ column: 'status', op: 'eq', value: 'ativo' }], order: [{ column: 'name' }], range: [0, 1999] });
  const products = useList<Row>('products', { filters: [{ column: 'status', op: 'eq', value: 'ativo' }], order: [{ column: 'name' }], range: [0, 999] });
  const kegs = useList<Row>('keg_sizes', { filters: [{ column: 'active', op: 'eq', value: true }], order: [{ column: 'liters' }] });
  const variants = useList<Row>('product_variants', { range: [0, 9999] });
  const partners = useList<Row>('partners', { filters: [{ column: 'status', op: 'eq', value: 'ativo' }] });
  const campaigns = useList<Row>('marketing_campaigns', { select: 'id,name', range: [0, 499] });
  const settings = useList<Row>('settings', { filters: [{ column: 'key', op: 'in', value: ['commercial.min_margin_percent', 'commercial.sales_tax_percent', 'commercial.margin_indicator'] }] });
  const [items, setItems] = useState<Item[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const form = useForm<Header>({ defaultValues: { kind: 'ponto_fixo', customer_id: params.get('cliente') ?? '', partner_id: '', campaign_id: '', order_date: todaySP(), delivery_date: '', delivery_time: '', pickup_date: '', delivery_address: '', payment_method: 'boleto', installments: 1, first_due_date: '', discount: 0, freight: 0, equipment_needed: '', notes: '' } });
  const { register, watch, reset, handleSubmit, formState } = form;
  const customerId = watch('customer_id');

  const editable = !id || ['orcamento', 'aguardando_confirmacao'].includes(String(order.data?.status));
  const setting = (k: string, d: number | string) => settings.data?.rows.find((s) => s.key === k)?.value ?? d;
  const minMargin = Number(setting('commercial.min_margin_percent', 20));
  const taxPct = Number(setting('commercial.sales_tax_percent', 0));
  const indicator = String(setting('commercial.margin_indicator', 'contribution')) as 'contribution' | 'gross';

  useEffect(() => {
    if (!order.data) return;
    const o = order.data;
    reset(Object.fromEntries(Object.keys(form.getValues()).map((k) => [k, o[k] ?? ''])) as unknown as Header);
  }, [order.data, reset, form]);
  useEffect(() => {
    if (existingItems.data) setItems(existingItems.data.rows.map((r) => ({ id: String(r.id), product_id: String(r.product_id), keg_size_id: String(r.keg_size_id ?? ''), quantity: Number(r.quantity), liters_per_unit: Number(r.liters_per_unit), unit_price: Number(r.unit_price), price_per_liter: r.price_per_liter == null ? null : Number(r.price_per_liter), price_source: String(r.price_source ?? ''), unit_cost: Number(r.unit_cost), discount: Number(r.discount) })));
  }, [existingItems.data]);

  const costFor = (productId: string, kegId: string, liters: number) => {
    const v = variants.data?.rows.find((x) => x.product_id === productId && x.keg_size_id === kegId);
    if (v?.cost != null) return Number(v.cost);
    const p = products.data?.rows.find((x) => x.id === productId);
    return Math.round(Number(p?.cost_per_unit ?? 0) * liters * 100) / 100;
  };

  const reprice = async (idx: number, patch: Partial<Item>) => {
    const next = { ...items[idx]!, ...patch };
    const product = products.data?.rows.find((p) => p.id === next.product_id);
    const keg = kegs.data?.rows.find((k) => k.id === next.keg_size_id);
    next.liters_per_unit = product?.is_draft_beer && keg ? Number(keg.liters) : 1;
    if (next.product_id && customerId) {
      try {
        const [r] = await db().rpc<{ source: string; unit_price: number; price_per_liter: number; liters: number }[]>('resolve_price', { p_customer: customerId, p_product: next.product_id, p_keg_size: next.keg_size_id || null });
        if (r) Object.assign(next, { unit_price: Number(r.unit_price), price_per_liter: Number(r.price_per_liter), price_source: r.source });
      } catch (e) {
        toast(friendlyError(e), 'danger');
      }
    }
    next.unit_cost = costFor(next.product_id, next.keg_size_id, next.liters_per_unit);
    setItems((s) => s.map((x, i) => (i === idx ? next : x)));
  };

  const totals = useMemo(() => {
    const gross = items.reduce((s, i) => s + toCents(i.quantity * i.unit_price) - toCents(i.discount), 0);
    const cost = items.reduce((s, i) => s + toCents(i.quantity * i.unit_cost), 0);
    const liters = items.reduce((s, i) => s + i.quantity * i.liters_per_unit, 0);
    const discount = toCents(Number(watch('discount') || 0));
    const freight = toCents(Number(watch('freight') || 0));
    const pricing = calculatePricing({ costPerLiterCents: liters ? cost / liters : 0, liters: liters || 1, pricePerLiterCents: liters ? gross / liters : gross, discountCents: discount, salesTaxPercent: taxPct });
    return { gross, cost, liters, total: gross - discount + freight, pricing, check: checkMargin(pricing, minMargin, indicator) };
  }, [items, watch, taxPct, minMargin, indicator]);

  const save = handleSubmit(async (h) => {
    if (!h.customer_id) return toast('Selecione o cliente.', 'warning');
    if (!items.length || items.some((i) => !i.product_id || i.quantity <= 0)) return toast('Inclua ao menos um item válido.', 'warning');
    setBusy(true);
    try {
      const header: Row = { ...h, installments: Number(h.installments) || 1, discount: Number(h.discount) || 0, freight: Number(h.freight) || 0 };
      for (const k of ['partner_id', 'campaign_id', 'delivery_date', 'delivery_time', 'pickup_date', 'first_due_date']) if (!header[k]) header[k] = null;
      let orderId = id;
      if (!orderId) orderId = String((await db().insert<Row>('orders', header)).id);
      else await db().update('orders', orderId, header);
      const keep = new Set(items.filter((i) => i.id).map((i) => i.id));
      for (const old of existingItems.data?.rows ?? []) if (!keep.has(String(old.id))) await db().remove('order_items', String(old.id));
      for (const i of items) {
        const row: Row = { order_id: orderId, product_id: i.product_id, keg_size_id: i.keg_size_id || null, quantity: i.quantity, liters_per_unit: i.liters_per_unit, unit_price: i.unit_price, price_per_liter: i.price_per_liter, price_source: i.price_source || 'manual', unit_cost: i.unit_cost, discount: i.discount || 0 };
        if (i.id) await db().update('order_items', i.id, row);
        else await db().insert('order_items', row);
      }
      invalidate();
      toast('Pedido salvo.');
      if (!id) navigate(`/pedidos/${orderId}`, { replace: true });
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
    setBusy(false);
  });

  const setStatus = async (status: OrderStatus) => {
    try {
      await db().rpc('set_order_status', { p_order: id, p_status: status });
      invalidate();
      toast(`Status: ${ORDER_STATUS[status]}.`);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  const duplicate = async () => {
    try {
      const newId = await db().rpc<string>('duplicate_order', { p_order: id });
      invalidate();
      toast('Pedido duplicado com as condições comerciais vigentes.');
      navigate(`/pedidos/${newId}`);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  if (id && order.isLoading) return <Card opaque><LoadingBlock rows={8} /></Card>;
  if (id && order.isError) return <ErrorState error={order.error} />;
  const o = order.data;
  const status = (o?.status as OrderStatus) ?? 'orcamento';
  const customer = customers.data?.rows.find((c) => c.id === customerId);
  const nextStatuses = NEXT.filter((s) => canTransitionOrder(status, s) && (o?.confirmed_at || NEXT.indexOf(s) < 1));

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={[{ label: 'Pedidos', to: '/pedidos' }, { label: id ? `Nº ${o?.number ?? ''}` : 'Novo' }]}
        title={id ? `Pedido nº ${o?.number}` : 'Novo pedido'}
        subtitle={id ? <span className="flex items-center gap-2"><Badge tone={ORDER_TONE[status]}>{ORDER_STATUS[status]}</Badge>{o?.confirmed_at ? `Confirmado em ${formatDateTimeBR(o.confirmed_at as string)}` : null}</span> : 'Preços sugeridos automaticamente pelas condições comerciais do cliente.'}
        actions={<>
          {id && customer && (customer.whatsapp || customer.phone) && o?.confirmed_at ? <WhatsAppButton phone={String(customer.whatsapp ?? customer.phone)} templateKey="confirmacao_pedido" values={{ NOME_CLIENTE: String(customer.trade_name ?? customer.name), NUMERO_PEDIDO: String(o.number), VALOR_ORIGINAL: formatReais(o.total as number) }} customerId={String(customer.id)} refType="order" refId={id} /> : null}
          {id && can('pedidos', 'create') && <Button variant="secondary" icon={<Copy className="size-4" />} onClick={duplicate}>Duplicar</Button>}
          {editable && can('pedidos', id ? 'edit' : 'create') && <Button variant="secondary" icon={<Save className="size-4" />} loading={busy} onClick={save}>Salvar</Button>}
          {id && editable && can('pedidos', 'edit') && <Button icon={<CheckCircle2 className="size-4" />} disabled={formState.isDirty} title={formState.isDirty ? 'Salve as alterações antes' : undefined} onClick={() => setConfirmOpen(true)}>Confirmar pedido</Button>}
        </>}
      />

      {id && !editable && status !== 'cancelado' && status !== 'finalizado' && can('pedidos', 'edit') && (
        <Card className="mb-4" title="Avançar operação">
          <div className="flex flex-wrap gap-2">
            {nextStatuses.map((s) => <Button key={s} variant="soft" size="sm" icon={<ArrowRight className="size-4" />} onClick={() => setStatus(s)}>{ORDER_STATUS[s]}</Button>)}
            {can('pedidos', 'cancel') && !['entregue', 'aguardando_recolhimento'].includes(status) && <Button variant="ghost" size="sm" icon={<XCircle className="size-4" />} onClick={() => setCancelOpen(true)}>Cancelar pedido</Button>}
          </div>
          <p className="mt-2 text-xs text-cocoa-700">Ao marcar como entregue, a reserva vira saída de estoque (FEFO) e os equipamentos passam à custódia do cliente.</p>
        </Card>
      )}
      {id && editable && can('pedidos', 'cancel') && <div className="mb-4 flex justify-end gap-2"><Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} onClick={() => setDeleteOpen(true)}>Excluir orçamento</Button></div>}
      {id && editable && <ConfirmDialog open={deleteOpen} onCancel={() => setDeleteOpen(false)} title="Excluir orçamento?" message="O orçamento e seus itens serão apagados. Como ainda não foi confirmado, não há títulos, pagamentos nem estoque envolvidos." confirmLabel="Excluir" danger
        onConfirm={async () => { try { await db().rpc('delete_order_draft', { p_order: id, p_reason: 'Excluído pelo usuário' }); invalidate(); toast('Orçamento excluído.'); navigate('/pedidos'); } catch (e) { toast(friendlyError(e), 'danger'); } setDeleteOpen(false); }} />}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card opaque title="Dados do pedido">
            <fieldset disabled={!editable} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectInput label="Cliente" required options={(customers.data?.rows ?? []).map((c) => ({ value: String(c.id), label: String(c.trade_name ?? c.name) }))} placeholder="Selecione…" {...register('customer_id', { onChange: (e) => { const c = customers.data?.rows.find((x) => x.id === e.target.value); if (c) { form.setValue('kind', c.segment === 'evento' ? 'evento' : 'ponto_fixo'); form.setValue('delivery_address', [c.street, c.number, c.district, c.city].filter(Boolean).join(', ')); } } })} />
              <SelectInput label="Tipo" options={Object.entries(ORDER_KIND).map(([value, label]) => ({ value, label }))} {...register('kind')} />
              <TextInput label="Data do pedido" type="date" {...register('order_date')} />
              <SelectInput label="Parceiro responsável" options={(partners.data?.rows ?? []).map((p) => ({ value: String(p.id), label: String(p.name) }))} placeholder="Nenhum" {...register('partner_id')} />
              <TextInput label="Data de entrega" type="date" {...register('delivery_date')} />
              <TextInput label="Horário" type="time" {...register('delivery_time')} />
              <TextInput label="Data de recolhimento" type="date" {...register('pickup_date')} />
              <SelectInput label="Campanha de origem" options={(campaigns.data?.rows ?? []).map((p) => ({ value: String(p.id), label: String(p.name) }))} placeholder="Nenhuma" {...register('campaign_id')} />
              <TextInput wrapperClassName="sm:col-span-2" label="Endereço de entrega" {...register('delivery_address')} />
              <TextInput wrapperClassName="sm:col-span-2" label="Equipamentos necessários" placeholder="Ex.: 1 chopeira 2 vias, 1 cilindro" {...register('equipment_needed')} />
            </fieldset>
          </Card>

          <Card opaque title="Itens" action={editable && <Button size="sm" variant="soft" icon={<Plus className="size-4" />} disabled={!customerId} onClick={() => setItems((s) => [...s, { product_id: '', keg_size_id: '', quantity: 1, liters_per_unit: 1, unit_price: 0, price_per_liter: null, price_source: '', unit_cost: 0, discount: 0 }])}>Adicionar item</Button>}>
            {!customerId && <Alert tone="info">Selecione o cliente para calcular os preços personalizados.</Alert>}
            <div className="space-y-3">
              {items.map((it, i) => {
                const product = products.data?.rows.find((p) => p.id === it.product_id);
                const lineTotal = it.quantity * it.unit_price - it.discount;
                return (
                  <div key={it.id ?? i} className="rounded-2xl border border-tangerine-100 p-3">
                    <fieldset disabled={!editable} className="grid grid-cols-2 gap-3 sm:grid-cols-12">
                      <SelectInput wrapperClassName="col-span-2 sm:col-span-4" label="Produto" value={it.product_id} onChange={(e) => reprice(i, { product_id: e.target.value })} options={(products.data?.rows ?? []).map((p) => ({ value: String(p.id), label: String(p.name) }))} placeholder="Selecione…" />
                      <SelectInput wrapperClassName="sm:col-span-2" label="Barril" value={it.keg_size_id} onChange={(e) => reprice(i, { keg_size_id: e.target.value })} options={(kegs.data?.rows ?? []).map((k) => ({ value: String(k.id), label: String(k.label) }))} placeholder={product?.is_draft_beer ? 'Selecione…' : 'N/A'} />
                      <TextInput wrapperClassName="sm:col-span-2" label="Qtd." type="number" min={0} step="any" className="num" value={it.quantity} onChange={(e) => setItems((s) => s.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} />
                      <TextInput wrapperClassName="sm:col-span-2" label="Preço unit. (R$)" type="number" step="0.01" className="num" value={it.unit_price} onChange={(e) => setItems((s) => s.map((x, j) => (j === i ? { ...x, unit_price: Number(e.target.value), price_source: 'manual' } : x)))} />
                      <TextInput wrapperClassName="sm:col-span-2" label="Desconto (R$)" type="number" step="0.01" className="num" value={it.discount} onChange={(e) => setItems((s) => s.map((x, j) => (j === i ? { ...x, discount: Number(e.target.value) } : x)))} />
                    </fieldset>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-cocoa-700">
                      {it.price_source && <Badge tone={it.price_source === 'manual' ? 'warning' : 'info'}>{PRICE_SOURCE_LABEL[it.price_source as PriceSource] ?? 'Preço manual'}</Badge>}
                      <span className="num">{formatNumber(it.quantity * it.liters_per_unit)} L · {it.price_per_liter != null ? `${formatReais(it.unit_price / (it.liters_per_unit || 1))}/L` : ''} · custo {formatReais(it.quantity * it.unit_cost)}</span>
                      <span className="num ml-auto text-sm font-semibold text-cocoa-900">{formatReais(lineTotal)}</span>
                      {editable && <Button variant="ghost" size="icon" aria-label="Remover item" onClick={() => setItems((s) => s.filter((_, j) => j !== i))} icon={<Trash2 className="size-4" />} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
          {id && <Attachments entityType="order" entityId={id} title="Comprovantes e anexos" />}
        </div>

        <div className="space-y-4">
          <Card opaque title="Pagamento">
            <fieldset disabled={!editable} className="grid grid-cols-2 gap-3">
              <SelectInput wrapperClassName="col-span-2" label="Forma de pagamento" options={PAYMENT} {...register('payment_method')} />
              <TextInput label="Parcelas" type="number" min={1} max={24} {...register('installments')} />
              <TextInput label="1º vencimento" type="date" hint="Vazio = prazo do cliente" {...register('first_due_date')} />
              <TextInput label="Desconto geral (R$)" type="number" step="0.01" className="num" {...register('discount')} />
              <TextInput label="Frete (R$)" type="number" step="0.01" className="num" {...register('freight')} />
            </fieldset>
          </Card>
          <Card title="Resumo e margem">
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between"><span>Litros</span><span className="num">{formatNumber(totals.liters)} L</span></li>
              <li className="flex justify-between"><span>Subtotal</span><span className="num">{formatReais(totals.gross / 100)}</span></li>
              <li className="flex justify-between"><span>Custo dos produtos</span><span className="num">{formatReais(totals.cost / 100)}</span></li>
              <li className="flex justify-between border-t border-tangerine-200 pt-2 text-base font-bold"><span>Total</span><span className="num">{formatReais(totals.total / 100)}</span></li>
              <li className="flex justify-between"><span>Margem bruta</span><span className="num">{formatPercent(totals.pricing.grossMarginPercent)}</span></li>
              <li className="flex justify-between"><span>Margem de contribuição</span><span className="num">{formatPercent(totals.pricing.contributionMarginPercent)}</span></li>
            </ul>
            {items.length > 0 && <div className="mt-3"><Alert tone={totals.check.ok ? 'success' : 'warning'}>{totals.check.message}</Alert></div>}
            <p className="mt-2 text-xs text-cocoa-700">Tributos estimados: {taxPct}% (configurável). Margem ≠ markup.</p>
          </Card>
          <Card opaque title="Observações"><TextArea label="Observações" disabled={!editable} {...register('notes')} /></Card>
          {id && (history.data?.rows ?? []).length > 0 && (
            <Card opaque title="Histórico de status">
              <ol className="space-y-1.5 text-sm">{history.data!.rows.map((h) => <li key={String(h.id)} className="flex justify-between gap-2"><span>{ORDER_STATUS[h.to_status as OrderStatus]}</span><span className="text-xs text-cocoa-700">{formatDateTimeBR(h.changed_at as string)}</span></li>)}</ol>
            </Card>
          )}
          {o && <Card opaque title="Referências"><KeyValue items={[['Cliente', customer ? <Link className="underline" to={`/clientes/${customer.id}`}>{String(customer.trade_name ?? customer.name)}</Link> : '—'], ['Pedido de origem', o.source_order_id ? <Link className="underline" to={`/pedidos/${o.source_order_id}`}>abrir</Link> : '—']]} /></Card>}
        </div>
      </div>

      {id && <ConfirmOrderDialog open={confirmOpen} onClose={() => setConfirmOpen(false)} orderId={id} marginOk={totals.check.ok} marginMsg={totals.check.message} canApprove={can('pedidos', 'approve')} />}
      <CancelDialog open={cancelOpen} onClose={() => setCancelOpen(false)} orderId={id} />
    </div>
  );
}

function ConfirmOrderDialog({ open, onClose, orderId, marginOk, marginMsg, canApprove }: { open: boolean; onClose: () => void; orderId: string; marginOk: boolean; marginMsg: string; canApprove: boolean }) {
  const equipment = useList<Row>('equipment', { select: 'id,asset_code,brand,model', filters: [{ column: 'status', op: 'eq', value: 'disponivel' }], order: [{ column: 'asset_code' }] }, { enabled: open });
  const [selected, setSelected] = useState<string[]>([]);
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const confirm = async () => {
    setBusy(true);
    try {
      const r = await db().rpc<{ receivables_created?: number }>('confirm_order', { p_order: orderId, p_equipment: selected, p_margin_justification: justification || null });
      invalidate();
      toast(`Pedido confirmado: estoque reservado, ${r?.receivables_created ?? 'os'} recebível(is) gerado(s), entrega agendada.`);
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
    setBusy(false);
  };
  return (
    <Modal open={open} onClose={onClose} title="Confirmar pedido" size="md" footer={<><Button variant="secondary" onClick={onClose}>Voltar</Button><Button loading={busy} disabled={!marginOk && (!canApprove || !justification.trim())} onClick={confirm}>Confirmar</Button></>}>
      <div className="space-y-4 text-sm">
        <p>Ao confirmar, o sistema executará em uma única transação: reserva de estoque, reserva dos equipamentos selecionados, geração das contas a receber, agendamento da entrega/recolhimento e criação da tarefa operacional. Confirmar novamente não duplica receitas.</p>
        {!marginOk && (
          <Alert tone="warning" title="Margem abaixo do mínimo">
            {marginMsg} {canApprove ? 'Informe a justificativa (ficará registrada na auditoria).' : 'Somente usuários com permissão de aprovação podem confirmar.'}
          </Alert>
        )}
        {!marginOk && canApprove && <TextArea label="Justificativa da exceção" value={justification} onChange={(e) => setJustification(e.target.value)} required />}
        <div>
          <p className="label">Reservar equipamentos disponíveis (opcional)</p>
          {(equipment.data?.rows ?? []).length === 0 ? <p className="text-cocoa-700">Nenhum equipamento disponível.</p> : (
            <ul className="max-h-48 space-y-1 overflow-y-auto">{equipment.data!.rows.map((e) => (
              <li key={String(e.id)}><label className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-cream-100"><input type="checkbox" className="accent-[var(--color-tangerine-800)]" checked={selected.includes(String(e.id))} onChange={(ev) => setSelected((s) => (ev.target.checked ? [...s, String(e.id)] : s.filter((x) => x !== e.id)))} />{String(e.asset_code)} <span className="text-cocoa-700">{[e.brand, e.model].filter(Boolean).join(' ')}</span></label></li>))}</ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CancelDialog({ open, onClose, orderId }: { open: boolean; onClose: () => void; orderId?: string }) {
  const [reason, setReason] = useState('');
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  return (
    <ConfirmDialog open={open} danger title="Cancelar pedido" confirmLabel="Cancelar pedido" onCancel={onClose}
      message="Reservas de estoque e equipamentos serão liberadas e recebíveis em aberto serão cancelados. O histórico é preservado."
      onConfirm={async () => {
        if (!reason.trim()) return toast('Informe o motivo.', 'warning');
        try {
          await db().rpc('cancel_order', { p_order: orderId, p_reason: reason });
          invalidate();
          toast('Pedido cancelado.');
          onClose();
          navigate('/pedidos');
        } catch (e) {
          toast(friendlyError(e), 'danger');
        }
      }}>
      <TextArea label="Motivo do cancelamento" value={reason} onChange={(e) => setReason(e.target.value)} required />
    </ConfirmDialog>
  );
}

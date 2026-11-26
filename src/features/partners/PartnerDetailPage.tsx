import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { CalendarCheck, Lock, Plus, Undo2 } from 'lucide-react';
import { useList, useRecord, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card, Stat, KeyValue } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, LoadingBlock, friendlyError, ErrorState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Overlay';
import { SelectInput, TextInput } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { formatReais } from '@/domain/money';
import { formatDateBR, todaySP } from '@/domain/dates';
import { computeNewCredits, isEligible, type PartnerOrder, type PartnerRule } from '@/domain/partners';

const ENTRY = { saldo_inicial: 'Saldo inicial', obrigacao: 'Nova obrigação', credito: 'Crédito', comissao: 'Comissão', abatimento: 'Abatimento', pagamento: 'Pagamento', ajuste: 'Ajuste', estorno: 'Estorno' };

export function PartnerDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const p = useRecord<Row>('partners', id);
  const ledger = useList<Row>('partner_ledger', { filters: [{ column: 'partner_id', op: 'eq', value: id }], order: [{ column: 'occurred_on' }, { column: 'created_at' }], range: [0, 1999] });
  const settlements = useList<Row>('partner_settlements', { filters: [{ column: 'partner_id', op: 'eq', value: id }], order: [{ column: 'period', ascending: false }] });
  const orders = useList<Row>('orders', { select: '*,customer:customers(name,trade_name)', filters: [{ column: 'partner_id', op: 'eq', value: id }], order: [{ column: 'order_date', ascending: false }], range: [0, 999] });
  const recv = useList<Row>('receivables', { select: 'order_id,status', filters: [{ column: 'order_id', op: 'in', value: (orders.data?.rows ?? []).map((o) => o.id) }], range: [0, 4999] }, { enabled: (orders.data?.rows.length ?? 0) > 0 });
  const [entry, setEntry] = useState(false);
  const [closing, setClosing] = useState(false);
  const [period, setPeriod] = useState(todaySP().slice(0, 7));

  const rule: PartnerRule | null = useMemo(() => (p.data ? { percentEvent: Number(p.data.percent_event), percentFixed: Number(p.data.percent_fixed), fixedPerOrderCents: Math.round(Number(p.data.fixed_per_order) * 100), eligibility: p.data.eligibility as PartnerRule['eligibility'], offsetDebt: Boolean(p.data.offset_debt) } : null), [p.data]);
  const preview = useMemo(() => {
    if (!rule) return [];
    const credited = new Set((ledger.data?.rows ?? []).filter((l) => l.entry_type === 'credito').map((l) => String(l.order_id)));
    const paid = new Map<string, boolean>();
    for (const r of recv.data?.rows ?? []) paid.set(String(r.order_id), (paid.get(String(r.order_id)) ?? true) && r.status === 'pago');
    const po: PartnerOrder[] = (orders.data?.rows ?? []).map((o) => ({ id: String(o.id), kind: o.kind as PartnerOrder['kind'], totalCents: Math.round(Number(o.total) * 100), confirmed: !!o.confirmed_at, delivered: ['entregue', 'aguardando_recolhimento', 'finalizado'].includes(String(o.status)), fullyPaid: paid.get(String(o.id)) ?? false, cancelled: o.status === 'cancelado' }));
    return computeNewCredits(po, rule, credited);
  }, [rule, ledger.data, orders.data, recv.data]);

  if (p.isLoading) return <Card opaque><LoadingBlock /></Card>;
  if (p.isError) return <ErrorState error={p.error} />;
  if (!p.data) return <Card><EmptyState title="Parceiro não encontrado" /></Card>;
  const pa = p.data;
  const balance = Number(pa.opening_debt) + (ledger.data?.rows ?? []).reduce((s, l) => s + Number(l.amount), 0);

  const close = async () => {
    try {
      const r = await db().rpc<{ credits: number; offset: number; closing_debt: number; credit_payable: number }>('close_partner_month', { p_partner: pa.id, p_period: `${period}-01` });
      invalidate();
      toast(`Fechamento concluído: créditos ${formatReais(r?.credits ?? 0)}, abatido ${formatReais(r?.offset ?? 0)}.`);
      setClosing(false);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  const reverse = async (l: Row) => {
    const reason = prompt('Justificativa do estorno (obrigatória):');
    if (!reason) return;
    try {
      await db().rpc('reverse_partner_entry', { p_entry: l.id, p_reason: reason });
      invalidate();
      toast('Estorno registrado e auditado.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  let running = Number(pa.opening_debt);
  return (
    <div className="animate-fade-in">
      <PageHeader breadcrumbs={[{ label: 'Parceiros', to: '/parceiros' }, { label: String(pa.name) }]} title={String(pa.name)} subtitle={`Crédito: ${String(pa.percent_event)}% eventos · ${String(pa.percent_fixed)}% pontos fixos · elegível quando ${String(pa.eligibility)}`}
        actions={<>
          <Link to={`/reunioes?novo=1`}><Button variant="secondary" icon={<CalendarCheck className="size-4" />}>Reunião quinzenal</Button></Link>
          {can('parceiros', 'create') && <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setEntry(true)}>Lançamento</Button>}
          {can('parceiros', 'approve') && <Button icon={<Lock className="size-4" />} onClick={() => setClosing(true)}>Fechamento mensal</Button>}
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Saldo devedor atual" value={formatReais(balance)} hint={balance < 0 ? 'Empresa deve ao parceiro' : 'Parceiro deve à empresa'} />
        <Stat label="Saldo inicial" value={formatReais(pa.opening_debt as number)} />
        <Stat label="Pedidos vinculados" value={String(orders.data?.rows.length ?? 0)} />
        <Stat label="Créditos elegíveis a apurar" value={formatReais(preview.reduce((s, c) => s + c.cents, 0) / 100)} hint={`${preview.length} pedido(s) — serão lançados no fechamento`} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card opaque className="xl:col-span-2" title="Extrato">
          {(ledger.data?.rows ?? []).length === 0 ? <EmptyState title="Sem lançamentos" /> : (
            <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-cocoa-700"><tr><th className="py-2">Data</th><th>Tipo</th><th>Descrição</th><th className="text-right">Valor</th><th className="text-right">Saldo</th><th /></tr></thead>
              <tbody>
                <tr className="border-t border-tangerine-100"><td className="py-2">—</td><td>Saldo inicial</td><td /><td /><td className="num text-right">{formatReais(Number(pa.opening_debt))}</td><td /></tr>
                {ledger.data!.rows.map((l) => { running += Number(l.amount); return (
                  <tr key={String(l.id)} className="border-t border-tangerine-100"><td className="py-2">{formatDateBR(l.occurred_on as string)}</td><td><Badge tone={Number(l.amount) < 0 ? 'success' : 'warning'}>{ENTRY[l.entry_type as keyof typeof ENTRY]}</Badge></td><td>{String(l.description ?? '')}</td>
                    <td className="num text-right">{formatReais(l.amount as number)}</td><td className="num text-right">{formatReais(running)}</td>
                    <td>{can('parceiros', 'approve') && l.entry_type !== 'estorno' && <Button size="icon" variant="ghost" aria-label="Estornar" title="Estornar" icon={<Undo2 className="size-4" />} onClick={() => reverse(l)} />}</td></tr>); })}
              </tbody></table>
          )}
        </Card>
        <div className="space-y-4">
          <Card opaque title="Fechamentos">
            {(settlements.data?.rows ?? []).length === 0 ? <p className="text-sm text-cocoa-700">Nenhum fechamento.</p> : (
              <ul className="space-y-2 text-sm">{settlements.data!.rows.map((s) => <li key={String(s.id)} className="rounded-xl bg-cream-100 p-2"><p className="font-semibold">{formatDateBR(s.period as string).slice(3)}</p><KeyValue items={[['Créditos', formatReais(s.total_credits as number)], ['Abatido', formatReais(s.offset_amount as number)], ['Dívida final', formatReais(s.closing_debt as number)], ['A pagar ao parceiro', formatReais(s.credit_payable as number)]]} /></li>)}</ul>
            )}
          </Card>
          <Card opaque title="Pedidos do parceiro">
            <ul className="space-y-1 text-sm">{(orders.data?.rows ?? []).slice(0, 20).map((o) => <li key={String(o.id)} className="flex justify-between gap-2"><Link className="hover:underline" to={`/pedidos/${o.id}`}>Nº {String(o.number)} · {String((o.customer as Row | null)?.trade_name ?? (o.customer as Row | null)?.name ?? '')}</Link><span className="num">{formatReais(o.total as number)}</span></li>)}</ul>
          </Card>
        </div>
      </div>
      {entry && <EntryDialog partnerId={String(pa.id)} onClose={() => setEntry(false)} />}
      <Modal open={closing} onClose={() => setClosing(false)} title="Fechamento mensal" size="sm" footer={<Button onClick={close}>Fechar período</Button>}>
        <div className="space-y-3">
          <TextInput label="Mês de referência" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          <Alert tone="info">Créditos de pedidos elegíveis ainda não creditados serão lançados uma única vez (o banco impede duplicidade) e abaterão a dívida conforme a regra do parceiro. O mesmo período não pode ser fechado duas vezes.</Alert>
          {rule && <p className="text-xs text-cocoa-700">Elegibilidade: {(orders.data?.rows ?? []).filter((o) => isEligible({ id: '', kind: o.kind as PartnerOrder['kind'], totalCents: 0, confirmed: !!o.confirmed_at, delivered: ['entregue', 'aguardando_recolhimento', 'finalizado'].includes(String(o.status)), fullyPaid: false, cancelled: o.status === 'cancelado' }, rule)).length} pedido(s) elegíveis no total.</p>}
        </div>
      </Modal>
    </div>
  );
}

function EntryDialog({ partnerId, onClose }: { partnerId: string; onClose: () => void }) {
  const [v, setV] = useState({ type: 'pagamento', amount: '', date: todaySP(), description: '' });
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const submit = async () => {
    const a = Math.abs(Number(v.amount));
    if (!a) return toast('Informe o valor.', 'warning');
    const signed = ['pagamento', 'abatimento', 'comissao'].includes(v.type) ? -a : a;
    try {
      await db().insert('partner_ledger', { partner_id: partnerId, entry_type: v.type, amount: v.type === 'ajuste' ? Number(v.amount) : signed, occurred_on: v.date, description: v.description || null });
      invalidate();
      toast('Lançamento registrado.');
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  return (
    <Modal open onClose={onClose} title="Lançamento no extrato" size="sm" footer={<Button onClick={submit}>Salvar</Button>}>
      <div className="space-y-3">
        <SelectInput label="Tipo" value={v.type} onChange={(e) => setV((s) => ({ ...s, type: e.target.value }))} options={[['obrigacao', 'Nova obrigação (aumenta dívida)'], ['pagamento', 'Pagamento recebido do parceiro'], ['comissao', 'Comissão (reduz dívida)'], ['abatimento', 'Abatimento'], ['ajuste', 'Ajuste (+/−)']].map(([value, label]) => ({ value: value!, label: label! }))} />
        <TextInput label="Valor (R$)" type="number" step="0.01" value={v.amount} onChange={(e) => setV((s) => ({ ...s, amount: e.target.value }))} />
        <TextInput label="Data" type="date" value={v.date} onChange={(e) => setV((s) => ({ ...s, date: e.target.value }))} />
        <TextInput label="Descrição" value={v.description} onChange={(e) => setV((s) => ({ ...s, description: e.target.value }))} />
      </div>
    </Modal>
  );
}

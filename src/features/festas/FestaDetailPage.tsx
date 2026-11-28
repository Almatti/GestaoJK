import { useEffect, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CheckCircle2, Edit3, Printer, Undo2, XCircle, Plus, Ban } from 'lucide-react';
import { db, useInvalidateAll, useList, useRecord } from '@/data/hooks';
import type { Row } from '@/data/types';
import { PageHeader, Card, Stat, KeyValue } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, ErrorState, LoadingBlock, Badge, friendlyError } from '@/components/ui/Feedback';
import { Modal, ConfirmDialog } from '@/components/ui/Overlay';
import { Attachments } from '@/components/ui/Attachments';
import { Checkbox, SelectInput, TextInput } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthContext';
import { formatReais } from '@/domain/money';
import { formatDateBR, formatDateTimeBR, todaySP } from '@/domain/dates';
import { FESTA_METHODS, FESTA_OPS_STATUS, FESTA_PAYMENT_KINDS, FESTA_UNITS } from '@/domain/festas';
import { whatsappLink } from '@/domain/messages';
import { printEventChecklist } from './festaPdf';
import { FestasDataNotice, num } from './shared';
import { FinanceBadge, OpsBadge } from './FestasPage';

const PAY_STATUS: Record<string, { label: string; tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral' }> = {
  previsto: { label: 'Previsto', tone: 'info' },
  confirmado: { label: 'Recebido (confirmado)', tone: 'success' },
  estornado: { label: 'Estornado', tone: 'warning' },
  cancelado: { label: 'Cancelado', tone: 'neutral' }
};

export function FestaDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const { can } = useAuth();
  const festa = useRecord<Row>('festa_events_view', id);
  const items = useList<Row>('festa_items', { filters: [{ column: 'event_id', op: 'eq', value: id }, { column: 'archived_at', op: 'is', value: null }], order: [{ column: 'position' }], range: [0, 499] });
  const pays = useList<Row>('festa_payments', { filters: [{ column: 'event_id', op: 'eq', value: id }], order: [{ column: 'due_date' }, { column: 'created_at' }], range: [0, 499] });
  const accounts = useList<Row>('financial_accounts', { select: 'id,name', filters: [{ column: 'active', op: 'eq', value: true }], range: [0, 99] });
  const [payDialog, setPayDialog] = useState<{ mode: 'confirmar' | 'corrigir' | 'estornar' | 'editar'; pay: Row } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (festa.isLoading || items.isLoading || pays.isLoading) return <LoadingBlock rows={8} />;
  if (festa.error || items.error || pays.error) return <ErrorState error={festa.error ?? items.error ?? pays.error} />;
  const f = festa.data;
  if (!f) return <EmptyState title="Festa não encontrada" action={<Link className="font-semibold text-tangerine-900" to="/festas">Voltar às festas</Link>} />;

  const cancelled = f.ops_status === 'cancelado';
  const itemRows = items.data?.rows ?? [];
  const payRows = pays.data?.rows ?? [];
  const confirmedCount = payRows.filter((p) => p.status === 'confirmado').length;
  const title = String(f.event_name || f.code);
  const phoneLink = f.client_phone ? whatsappLink(String(f.client_phone), `Olá ${String(f.client_name ?? '')}! Sobre a sua festa${f.event_date ? ` do dia ${formatDateBR(String(f.event_date))}` : ''}.`) : null;

  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      await db().rpc(fn, args);
      invalidate();
      toast(ok);
      return true;
    } catch (e) {
      toast(friendlyError(e), 'danger');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (item: Row, field: 'separated_at' | 'checked_at' | 'purchased_at') => {
    try {
      await db().update('festa_items', String(item.id), { [field]: item[field] ? null : new Date().toISOString() });
      invalidate();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  const savePurchased = async (item: Row, value: string) => {
    const qty = num(value);
    if (qty === Number(item.purchased_qty ?? 0)) return;
    try {
      await db().update('festa_items', String(item.id), { purchased_qty: qty });
      invalidate();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  return (
    <>
      <PageHeader title={title} subtitle={`${String(f.code)} · ${String(f.client_name || 'cliente não informado')}`}
        breadcrumbs={[{ label: 'Festas', to: '/festas' }, { label: title }]}
        actions={<>
          <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => printEventChecklist({
            code: String(f.code), name: String(f.event_name ?? ''), client: String(f.client_name ?? ''), phone: String(f.client_phone ?? ''),
            date: String(f.event_date ?? ''), time: String(f.event_time ?? '').slice(0, 5), address: String(f.address ?? ''), notes: String(f.notes ?? '')
          }, itemRows.map((i) => ({ product: String(i.product_name ?? ''), unit: String(i.unit ?? ''), keg_liters: i.keg_liters == null ? null : Number(i.keg_liters), quantity: Number(i.quantity ?? 0), notes: String(i.notes ?? '') })))}>Checklist (PDF)</Button>
          {phoneLink && <a href={phoneLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-control border border-tangerine-200 bg-white px-4 py-2.5 text-sm font-semibold text-tangerine-900 hover:bg-cream-100">Abrir WhatsApp</a>}
          {can('festas', 'edit') && !cancelled && <Button variant="secondary" icon={<Edit3 className="size-4" />} onClick={() => navigate(`/festas/${id}/editar`)}>Editar</Button>}
          {can('festas', 'cancel') && !cancelled && <Button variant="danger" icon={<Ban className="size-4" />} onClick={() => setCancelOpen(true)}>Cancelar festa</Button>}
        </>} />
      <FestasDataNotice />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total da festa" value={formatReais(Number(f.total ?? 0))} hint={`${Number(f.items_count ?? 0)} item(ns)`} />
        <Stat label="Recebido" value={formatReais(Number(f.received ?? 0))} hint="Somente confirmado" tone="up" />
        <Stat label="Saldo devedor" value={formatReais(Number(f.outstanding ?? 0))} hint={`Vencimento do saldo: ${formatDateBR(String(f.due_balance_date ?? ''))}`} tone={Number(f.outstanding ?? 0) > 0 ? 'down' : 'neutral'} />
        <Card title="Situação">
          <div className="flex flex-wrap gap-2"><FinanceBadge status={f.financial_status} /><OpsBadge status={f.ops_status} /></div>
          {Number(f.days_overdue ?? 0) > 0 && f.financial_status === 'vencido' && <p className="mt-2 text-xs text-danger-700">{Number(f.days_overdue)} dia(s) de atraso</p>}
        </Card>
      </div>

      {cancelled && <Alert tone="danger" title="Festa cancelada">Motivo: {String(f.cancelled_reason ?? '—')}. Pagamentos previstos foram cancelados e o título financeiro foi cancelado. O histórico foi preservado.</Alert>}

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card title="Dados do evento">
            <KeyValue items={[
              ['Cliente', String(f.client_name || '—')], ['Telefone', String(f.client_phone || '—')],
              ['Evento', String(f.event_name || '—')], ['Data e horário', `${f.event_date ? formatDateBR(String(f.event_date)) : 'sem data'}${f.event_time ? ` · ${String(f.event_time).slice(0, 5)}` : ''}`],
              ['Endereço', String(f.address || '—')], ['Observações', String(f.notes || '—')],
              ['Origem', f.source_file_name ? `PDF: ${String(f.source_file_name)}` : 'Cadastro manual']
            ]} />
            {!cancelled && <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-tangerine-100 pt-4">
              <div className="min-w-56 flex-1"><SelectInput label="Situação operacional" value={String(f.ops_status)} disabled={!can('festas', 'edit')}
                onChange={(e) => run('festa_set_ops_status', { p_event: id, p_status: e.target.value }, 'Situação atualizada.')}
                options={FESTA_OPS_STATUS.filter((o) => o.value !== 'cancelado').map((o) => ({ value: o.value, label: o.label }))} /></div>
            </div>}
          </Card>

          <Card title="Produtos e conferência" action={<span className="text-xs text-cocoa-700">Marque cada item ao separar, carregar e conferir</span>}>
            {itemRows.length === 0 ? <p className="text-sm text-cocoa-700">Nenhum produto cadastrado. Use Editar para incluir.</p> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
                <thead><tr className="border-b border-tangerine-100 text-left text-xs uppercase tracking-wide text-cocoa-700">
                  <th className="py-2 pr-2">Produto</th><th className="py-2 pr-2 text-right">Qtd.</th><th className="py-2 pr-2 text-right">Valor</th>
                  <th className="py-2 pr-2 text-right">Comprado</th><th className="py-2 pr-2 text-center">Comprado</th><th className="py-2 pr-2 text-center">Separado</th><th className="py-2 text-center">Conferido</th>
                </tr></thead>
                <tbody>{itemRows.map((i) => (
                  <tr key={String(i.id)} className="border-b border-tangerine-100/60">
                    <td className="py-2 pr-2"><div className="font-semibold text-cocoa-900">{String(i.product_name || 'Sem nome')}</div>
                      <div className="text-xs text-cocoa-700">{FESTA_UNITS.find((u) => u.value === i.unit)?.label ?? String(i.unit)}{i.keg_liters ? ` · ${Number(i.keg_liters)} L` : ''}</div></td>
                    <td className="py-2 pr-2 text-right">{Number(i.quantity ?? 0).toLocaleString('pt-BR')}</td>
                    <td className="py-2 pr-2 text-right">{formatReais(Number(i.line_total ?? 0))}</td>
                    <td className="py-2 pr-2 text-right"><input type="number" min={0} step="0.5" defaultValue={Number(i.purchased_qty ?? 0)} disabled={!can('festas', 'edit') || cancelled}
                      onBlur={(e) => savePurchased(i, e.target.value)} className="w-20 rounded-control border border-tangerine-200 bg-white px-2 py-1 text-right" aria-label={`Quantidade comprada de ${String(i.product_name)}`} /></td>
                    <td className="py-2 pr-2 text-center"><Checkbox aria-label="Comprado" label="" checked={!!i.purchased_at} disabled={!can('festas', 'edit') || cancelled} onChange={() => toggle(i, 'purchased_at')} /></td>
                    <td className="py-2 pr-2 text-center"><Checkbox aria-label="Separado" label="" checked={!!i.separated_at} disabled={!can('festas', 'edit') || cancelled} onChange={() => toggle(i, 'separated_at')} /></td>
                    <td className="py-2 text-center"><Checkbox aria-label="Conferido" label="" checked={!!i.checked_at} disabled={!can('festas', 'edit') || cancelled} onChange={() => toggle(i, 'checked_at')} /></td>
                  </tr>))}</tbody>
              </table></div>)}
          </Card>

          <Card title="Pagamentos" action={can('festas', 'edit') && !cancelled ? <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setAddOpen(true)}>Previsto</Button> : undefined}>
            <p className="mb-3 text-xs text-cocoa-700">Recebido só entra depois da confirmação. Pagamentos confirmados são corrigidos por estorno (o histórico fica preservado), sem lançamentos duplicados.</p>
            {payRows.length === 0 ? <p className="text-sm text-cocoa-700">Nenhum pagamento previsto.</p> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
                <thead><tr className="border-b border-tangerine-100 text-left text-xs uppercase tracking-wide text-cocoa-700">
                  <th className="py-2 pr-2">Tipo</th><th className="py-2 pr-2">Descrição</th><th className="py-2 pr-2 text-right">Valor</th><th className="py-2 pr-2">Vencimento</th><th className="py-2 pr-2">Forma</th><th className="py-2 pr-2">Situação</th><th className="py-2 text-right">Ações</th>
                </tr></thead>
                <tbody>{payRows.map((p) => {
                  const st = PAY_STATUS[String(p.status)] ?? { label: String(p.status), tone: 'neutral' as const };
                  const editable = can('festas', 'edit') && !cancelled;
                  return (
                    <tr key={String(p.id)} className="border-b border-tangerine-100/60 align-top">
                      <td className="py-2 pr-2">{FESTA_PAYMENT_KINDS.find((k) => k.value === p.kind)?.label ?? String(p.kind)}</td>
                      <td className="py-2 pr-2">{String(p.description || '—')}{p.confirmed_at ? <div className="text-xs text-cocoa-700">recebido em {formatDateBR(String(p.confirmed_at))}</div> : null}</td>
                      <td className="py-2 pr-2 text-right font-semibold">{formatReais(Number(p.amount ?? 0))}</td>
                      <td className="py-2 pr-2 whitespace-nowrap">{p.due_date ? formatDateBR(String(p.due_date)) : '—'}</td>
                      <td className="py-2 pr-2">{FESTA_METHODS.find((m) => m.value === p.method)?.label ?? String(p.method ?? '—')}</td>
                      <td className="py-2 pr-2"><Badge tone={st.tone} icon={false}>{st.label}</Badge>{p.cancel_reason ? <div className="text-xs text-cocoa-700">{String(p.cancel_reason)}</div> : null}</td>
                      <td className="py-2 text-right"><div className="flex flex-wrap justify-end gap-1">
                        {editable && p.status === 'previsto' && <>
                          <Button size="sm" icon={<CheckCircle2 className="size-4" />} onClick={() => setPayDialog({ mode: 'confirmar', pay: p })}>Confirmar</Button>
                          <Button size="sm" variant="secondary" onClick={() => setPayDialog({ mode: 'editar', pay: p })}>Editar</Button>
                          <Button size="sm" variant="ghost" icon={<XCircle className="size-4" />} onClick={() => setPayDialog({ mode: 'estornar', pay: p })}>Cancelar</Button>
                        </>}
                        {editable && p.status === 'confirmado' && <>
                          <Button size="sm" variant="secondary" icon={<Edit3 className="size-4" />} onClick={() => setPayDialog({ mode: 'corrigir', pay: p })}>Corrigir</Button>
                          {can('financeiro', 'cancel') && <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => setPayDialog({ mode: 'estornar', pay: p })}>Estornar</Button>}
                        </>}
                      </div></td>
                    </tr>);
                })}</tbody>
              </table></div>)}
            {confirmedCount > 0 && <p className="mt-3 text-xs text-cocoa-700">{confirmedCount} pagamento(s) confirmado(s) aparecem também em Contas a receber e no Fluxo de caixa (origem Festas).</p>}
          </Card>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          {id && <Attachments entityType="festa" entityId={id} title="PDF original e anexos" canRemove={can('festas', 'edit')} />}
          <Card title="Histórico">
            <p className="text-sm text-cocoa-700">Cadastrada em {formatDateTimeBR(String(f.created_at ?? ''))}. Alterações ficam registradas na auditoria (Administração → Auditoria). Pagamentos estornados ou cancelados nunca são apagados.</p>
          </Card>
        </aside>
      </div>

      <PaymentDialog mode={payDialog?.mode ?? 'confirmar'} pay={payDialog?.pay ?? null} open={!!payDialog} accounts={accounts.data?.rows ?? []}
        onClose={() => setPayDialog(null)} busy={busy}
        onSubmit={async (fn, args, ok) => { if (await run(fn, args, ok)) setPayDialog(null); }} />
      <AddPaymentDialog open={addOpen} eventId={id} busy={busy} onClose={() => setAddOpen(false)}
        onSubmit={async (args) => { if (await run('festa_payment_add', args, 'Pagamento previsto incluído.')) setAddOpen(false); }} />
      <ConfirmDialog open={cancelOpen} title="Cancelar festa" danger confirmLabel="Cancelar festa" loading={busy}
        message={<>
          <p>A festa será cancelada. Pagamentos previstos são cancelados e o título a receber é cancelado. Nada é apagado.</p>
          {confirmedCount > 0 && <Alert tone="warning">Há {confirmedCount} pagamento(s) recebido(s). Estorne-os antes de cancelar a festa.</Alert>}
        </>}
        onCancel={() => setCancelOpen(false)}
        onConfirm={async () => {
          if (!cancelReason.trim()) return toast('Informe o motivo do cancelamento.', 'warning');
          if (await run('festa_cancel_event', { p_event: id, p_reason: cancelReason.trim() }, 'Festa cancelada.')) setCancelOpen(false);
        }}>
        <TextInput label="Motivo do cancelamento" required value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
      </ConfirmDialog>
    </>
  );
}

function PaymentDialog({ mode, pay, open, accounts, onClose, onSubmit, busy }: {
  mode: 'confirmar' | 'corrigir' | 'estornar' | 'editar'; pay: Row | null; open: boolean; accounts: Row[]; onClose: () => void; busy: boolean;
  onSubmit: (fn: string, args: Record<string, unknown>, ok: string) => void;
}) {
  const [v, setV] = useState({ amount: '', paid_at: todaySP(), method: 'pix', account: '', ref: '', notes: '', reason: '', verified: false, kind: 'parcela', description: '', due: '' });
  useEffect(() => {
    if (!pay) return;
    setV({
      amount: String(pay.amount ?? ''), paid_at: String(pay.confirmed_at ?? todaySP()), method: String(pay.method ?? 'pix'), account: String(pay.account_id ?? ''),
      ref: '', notes: '', reason: '', verified: false, kind: String(pay.kind ?? 'parcela'), description: String(pay.description ?? ''), due: String(pay.due_date ?? '')
    });
  }, [pay]);
  if (!pay) return null;
  const set = (k: keyof typeof v) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const methodOpts = FESTA_METHODS.map((m) => ({ value: m.value, label: m.label }));
  const accOpts = [{ value: '', label: 'Conta padrão do banco' }, ...accounts.map((a) => ({ value: String(a.id), label: String(a.name) }))];
  const titles = { confirmar: 'Confirmar recebimento', corrigir: 'Corrigir pagamento confirmado', estornar: pay.status === 'confirmado' ? 'Estornar recebimento' : 'Cancelar pagamento previsto', editar: 'Editar pagamento previsto' } as const;

  const submit = () => {
    const pid = String(pay.id);
    if (mode === 'confirmar') {
      if (!v.verified) return;
      onSubmit('festa_payment_confirm', { p_payment: pid, p_paid_at: v.paid_at, p_method: v.method, p_account: v.account || null, p_external_ref: v.ref || null, p_notes: v.notes || null, p_verified: v.verified }, 'Pagamento confirmado e lançado no financeiro.');
    } else if (mode === 'corrigir') {
      onSubmit('festa_payment_correct', { p_payment: pid, p_amount: num(v.amount), p_paid_at: v.paid_at, p_method: v.method, p_account: v.account || null, p_reason: v.reason }, 'Pagamento corrigido (estorno + novo lançamento).');
    } else if (mode === 'estornar') {
      onSubmit('festa_payment_cancel', { p_payment: pid, p_reason: v.reason }, pay.status === 'confirmado' ? 'Recebimento estornado.' : 'Pagamento cancelado.');
    } else {
      onSubmit('festa_payment_update', { p_payment: pid, p_kind: v.kind, p_description: v.description, p_amount: num(v.amount), p_due: v.due || null, p_method: v.method, p_notes: null }, 'Pagamento atualizado.');
    }
  };

  const needsReason = mode === 'corrigir' || mode === 'estornar';
  const canSubmit = !busy && (mode !== 'confirmar' || v.verified) && (!needsReason || v.reason.trim().length > 0) && (mode !== 'editar' || num(v.amount) > 0);
  return (
    <Modal open={open} onClose={onClose} title={titles[mode]} description={`${formatReais(Number(pay.amount ?? 0))} · ${String(pay.description || FESTA_PAYMENT_KINDS.find((k) => k.value === pay.kind)?.label || '')}`}
      footer={<><Button variant="secondary" onClick={onClose}>Voltar</Button><Button onClick={submit} loading={busy} disabled={!canSubmit} variant={mode === 'estornar' ? 'danger' : 'primary'}>Confirmar</Button></>}>
      <div className="space-y-3">
        {mode === 'confirmar' && <>
          <p className="text-sm text-cocoa-700">Só registre como recebido o que já entrou na conta. Comprovante não basta: confira no extrato ou no banco.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <TextInput label="Data do recebimento" type="date" value={v.paid_at} onChange={set('paid_at')} />
            <SelectInput label="Forma" value={v.method} onChange={set('method')} options={methodOpts} />
            <SelectInput label="Conta" value={v.account} onChange={set('account')} options={accOpts} />
            <TextInput label="Referência (ex.: e2eId do Pix)" value={v.ref} onChange={set('ref')} />
          </div>
          <Checkbox label="Confirmo que o valor entrou na conta (conferido no extrato ou no banco)" checked={v.verified} onChange={set('verified')} />
        </>}
        {mode === 'corrigir' && <>
          <p className="text-sm text-cocoa-700">O lançamento anterior é estornado e o novo valor é registrado uma única vez. O histórico fica preservado.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <TextInput label="Valor correto (R$)" inputMode="decimal" value={v.amount} onChange={set('amount')} />
            <TextInput label="Data do recebimento" type="date" value={v.paid_at} onChange={set('paid_at')} />
            <SelectInput label="Forma" value={v.method} onChange={set('method')} options={methodOpts} />
            <SelectInput label="Conta" value={v.account} onChange={set('account')} options={accOpts} />
          </div>
          <TextInput label="Motivo da correção" required value={v.reason} onChange={set('reason')} />
        </>}
        {mode === 'estornar' && <>
          <p className="text-sm text-cocoa-700">{pay.status === 'confirmado' ? 'O recebimento é estornado no financeiro. Nada é apagado.' : 'O pagamento previsto é cancelado.'}</p>
          <TextInput label="Motivo" required value={v.reason} onChange={set('reason')} />
        </>}
        {mode === 'editar' && <div className="grid gap-3 md:grid-cols-2">
          <SelectInput label="Tipo" value={v.kind} onChange={set('kind')} options={FESTA_PAYMENT_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
          <TextInput label="Descrição" value={v.description} onChange={set('description')} />
          <TextInput label="Valor (R$)" inputMode="decimal" value={v.amount} onChange={set('amount')} />
          <TextInput label="Vencimento" type="date" value={v.due} onChange={set('due')} />
          <SelectInput label="Forma prevista" value={v.method} onChange={set('method')} options={methodOpts} />
        </div>}
      </div>
    </Modal>
  );
}

function AddPaymentDialog({ open, eventId, busy, onClose, onSubmit }: {
  open: boolean; eventId: string; busy: boolean; onClose: () => void; onSubmit: (args: Record<string, unknown>) => void;
}) {
  const [v, setV] = useState({ kind: 'parcela', description: '', amount: '', due: '', method: 'pix' });
  const set = (k: keyof typeof v) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Modal open={open} onClose={onClose} title="Novo pagamento previsto" description="Previsto não entra como recebido. Confirme depois, quando o valor entrar."
      footer={<><Button variant="secondary" onClick={onClose}>Voltar</Button>
        <Button loading={busy} disabled={num(v.amount) <= 0} onClick={() => onSubmit({ p_event: eventId, p_kind: v.kind, p_description: v.description, p_amount: num(v.amount), p_due: v.due || null, p_method: v.method, p_notes: null })}>Incluir</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        <SelectInput label="Tipo" value={v.kind} onChange={set('kind')} options={FESTA_PAYMENT_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
        <TextInput label="Descrição" value={v.description} onChange={set('description')} />
        <TextInput label="Valor (R$)" inputMode="decimal" value={v.amount} onChange={set('amount')} />
        <TextInput label="Vencimento" type="date" value={v.due} onChange={set('due')} />
        <SelectInput label="Forma prevista" value={v.method} onChange={set('method')} options={FESTA_METHODS.map((m) => ({ value: m.value, label: m.label }))} />
      </div>
    </Modal>
  );
}


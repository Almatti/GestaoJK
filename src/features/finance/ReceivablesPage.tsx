import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Banknote, Plus, Repeat, Search } from 'lucide-react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Filter, Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card, Stat } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingBlock, friendlyError } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Overlay';
import { TextInput, TextArea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { ResourceForm } from '@/features/resource/ResourceForm';
import type { ResourceDef } from '@/features/resource/types';
import { formatReais, formatNumber } from '@/domain/money';
import { formatDateBR, todaySP, addDays } from '@/domain/dates';
import { exportCsv } from '@/lib/export';
import { ReceiptDialog } from './ReceiptDialog';
import { ReceivableStatusBadge } from './ReceivableStatusBadge';
import { WhatsAppButton } from './WhatsAppButton';

const FIN = [['', 'Todas'], ['vencido', 'Vencidos'], ['a_vencer', 'A vencer (7 dias)'], ['em_aberto', 'Em aberto'], ['parcialmente_pago', 'Parcialmente pagos'], ['pago', 'Pagos'], ['renegociado', 'Renegociados'], ['cancelado', 'Cancelados']];

const manualDef: ResourceDef = {
  table: 'receivables', title: 'Recebíveis', singular: 'Conta a receber', resource: 'financeiro', searchColumns: [], columns: [],
  fields: [
    { name: 'customer_id', label: 'Cliente', type: 'ref', ref: { table: 'customers', label: 'name' }, required: true },
    { name: 'description', label: 'Descrição', type: 'text', required: true, wide: true },
    { name: 'category_id', label: 'Categoria', type: 'ref', ref: { table: 'financial_categories', label: 'name', filters: [{ column: 'direction', op: 'eq', value: 'receita' }] } },
    { name: 'amount', label: 'Valor (R$)', type: 'money', required: true, min: 0.01 },
    { name: 'competence_date', label: 'Competência', type: 'date', required: true, defaultValue: todaySP() },
    { name: 'due_date', label: 'Vencimento', type: 'date', required: true },
    { name: 'payment_method', label: 'Forma prevista', type: 'select', options: [['pix', 'Pix'], ['boleto', 'Boleto'], ['dinheiro', 'Dinheiro'], ['transferencia', 'Transferência']].map(([value, label]) => ({ value: value!, label: label! })) },
    { name: 'notes', label: 'Observações', type: 'textarea' }
  ]
};

export function ReceivablesPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [receipt, setReceipt] = useState<Row | null>(null);
  const [reneg, setReneg] = useState<Row | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const customer = params.get('cliente');
  const filters: Filter[] = [];
  if (status) filters.push({ column: 'financial_status', op: 'eq', value: status });
  if (customer) filters.push({ column: 'customer_id', op: 'eq', value: customer });
  const q = useList<Row>('receivables_view', { filters, search: { columns: ['description', 'customer_name', 'customer_trade_name'], term }, order: [{ column: 'due_date' }], range: [0, 299], count: true });
  const all = useList<Row>('receivables_view', { filters: [{ column: 'status', op: 'in', value: ['em_aberto', 'parcialmente_pago'] }], range: [0, 4999] });

  const kpi = useMemo(() => {
    const rows = all.data?.rows ?? [];
    const sum = (f: (r: Row) => boolean) => rows.filter(f).reduce((s, r) => s + Number(r.outstanding), 0);
    const t = todaySP();
    return { open: sum(() => true), overdue: sum((r) => String(r.due_date) < t), soon: sum((r) => String(r.due_date) >= t && String(r.due_date) <= addDays(t, 7)), month: sum((r) => String(r.due_date).slice(0, 7) === t.slice(0, 7)) };
  }, [all.data]);

  const rows = q.data?.rows ?? [];
  const canReceive = can('financeiro', 'create') || can('cobranca', 'edit');

  return (
    <div className="animate-fade-in">
      <PageHeader title="Contas a receber" subtitle="Faturado ≠ recebido. Valores em aberto não são saldo disponível."
        actions={<>
          <Button variant="secondary" size="sm" onClick={() => exportCsv('contas-a-receber', rows, [{ key: 'customer_name', label: 'Cliente' }, { key: 'description', label: 'Descrição' }, { key: 'due_date', label: 'Vencimento', format: 'date' }, { key: 'amount', label: 'Valor', format: 'money' }, { key: 'outstanding', label: 'Em aberto', format: 'money' }, { key: 'financial_status', label: 'Situação' }])}>Exportar CSV</Button>
          {can('financeiro', 'create') && <Button icon={<Plus className="size-4" />} onClick={() => setNewOpen(true)}>Lançamento manual</Button>}
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total em aberto" value={formatReais(kpi.open)} />
        <Stat label="Vencido" value={formatReais(kpi.overdue)} tone="down" />
        <Stat label="Vence em 7 dias" value={formatReais(kpi.soon)} />
        <Stat label="Vence neste mês" value={formatReais(kpi.month)} />
      </div>
      <div className="card mb-4 flex flex-col gap-3 p-3 sm:flex-row">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-cocoa-700" aria-hidden /><input className="input pl-10" placeholder="Buscar cliente ou descrição…" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Buscar" /></div>
        <select className="input h-11 w-auto py-0" aria-label="Situação" value={status} onChange={(e) => { setStatus(e.target.value); const p = new URLSearchParams(params); if (e.target.value) p.set('status', e.target.value); else p.delete('status'); setParams(p, { replace: true }); }}>
          {FIN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {customer && <Button variant="ghost" size="sm" onClick={() => { const p = new URLSearchParams(params); p.delete('cliente'); setParams(p); }}>Limpar filtro de cliente</Button>}
      </div>
      {q.isLoading ? <Card opaque><LoadingBlock /></Card> : q.isError ? <ErrorState error={q.error} /> : rows.length === 0 ? <Card><EmptyState title="Nenhum título encontrado" /></Card> : (
        <div className="surface overflow-x-auto rounded-[var(--radius-card)]">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-cocoa-700"><tr><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Descrição</th><th className="px-4 py-3">Vencimento</th><th className="px-4 py-3 text-right">Valor</th><th className="px-4 py-3 text-right">Em aberto</th><th className="px-4 py-3">Situação</th><th className="px-4 py-3"><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)} className="border-t border-tangerine-100 hover:bg-cream-100/60">
                  <td className="px-4 py-3">{r.customer_id ? <Link className="font-semibold hover:underline" to={`/clientes/${r.customer_id}`}>{String(r.customer_trade_name ?? r.customer_name)}</Link> : <span className="font-semibold">{String(r.customer_name ?? '—')}</span>}</td>
                  <td className="px-4 py-3">{String(r.description)}{r.order_id ? <Link className="ml-1 text-xs text-tangerine-900 underline" to={`/pedidos/${r.order_id}`}>pedido</Link> : null}</td>
                  <td className="px-4 py-3">{formatDateBR(r.due_date as string)}{Number(r.days_overdue) > 0 && !['pago', 'cancelado', 'renegociado'].includes(String(r.status)) ? <span className="block text-xs text-danger-700">{formatNumber(Number(r.days_overdue))} dia(s) de atraso</span> : null}</td>
                  <td className="num px-4 py-3 text-right">{formatReais(r.amount as number)}</td>
                  <td className="num px-4 py-3 text-right font-semibold">{formatReais(r.outstanding as number)}</td>
                  <td className="px-4 py-3"><ReceivableStatusBadge receivableId={String(r.id)} financialStatus={String(r.financial_status)} paymentMethod={r.payment_method as string} /></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {r.origin === 'festas' ? (
                        <Link to={`/festas/${String(r.festa_event_id)}`} className="inline-flex items-center rounded-control px-3 py-1.5 text-xs font-semibold text-tangerine-900 hover:bg-cream-100">Ver festa</Link>
                      ) : ['em_aberto', 'parcialmente_pago'].includes(String(r.status)) && canReceive && <Button size="sm" icon={<Banknote className="size-4" />} onClick={() => setReceipt(r)}>Receber</Button>}
                      {['em_aberto', 'parcialmente_pago'].includes(String(r.status)) && (r.customer_whatsapp || r.customer_phone) ? (
                        <WhatsAppButton small label="" phone={String(r.customer_whatsapp ?? r.customer_phone)} templateKey={String(r.financial_status) === 'vencido' ? 'boleto_vencido' : 'lembrete_vencimento'}
                          values={{ NOME_CLIENTE: String(r.customer_trade_name ?? r.customer_name), VALOR_ORIGINAL: formatReais(r.outstanding as number), DATA_VENCIMENTO: formatDateBR(r.due_date as string), DIAS_ATRASO: String(r.days_overdue) }}
                          customerId={String(r.customer_id)} refType="receivable" refId={String(r.id)} />
                      ) : null}
                      {r.origin !== 'festas' && ['em_aberto', 'parcialmente_pago'].includes(String(r.status)) && can('financeiro', 'approve') && <Button size="sm" variant="ghost" icon={<Repeat className="size-4" />} title="Renegociar" aria-label="Renegociar" onClick={() => setReneg(r)} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ReceiptDialog receivable={receipt} open={!!receipt} onClose={() => setReceipt(null)} />
      <RenegotiateDialog receivable={reneg} onClose={() => setReneg(null)} />
      <ResourceForm def={manualDef} row={null} open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function RenegotiateDialog({ receivable, onClose }: { receivable: Row | null; onClose: () => void }) {
  const [v, setV] = useState({ n: '2', first: addDays(todaySP(), 30), total: '', reason: '' });
  const toast = useToast();
  const invalidate = useInvalidateAll();
  if (!receivable) return null;
  const outstanding = Number(receivable.amount) - Number(receivable.paid_amount);
  const submit = async () => {
    if (!v.reason.trim()) return toast('Informe a justificativa.', 'warning');
    try {
      await db().rpc('renegotiate_receivable', { p_receivable: receivable.id, p_installments: Number(v.n), p_first_due: v.first, p_new_total: Number(v.total || outstanding), p_reason: v.reason });
      invalidate();
      toast('Renegociação registrada. O título original foi mantido como "renegociado".');
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  return (
    <Modal open onClose={onClose} title="Renegociar título" description={String(receivable.description)} size="sm" footer={<Button onClick={submit}>Renegociar</Button>}>
      <div className="grid grid-cols-2 gap-3">
        <TextInput label="Parcelas" type="number" min={1} max={24} value={v.n} onChange={(e) => setV((s) => ({ ...s, n: e.target.value }))} />
        <TextInput label="1º vencimento" type="date" value={v.first} onChange={(e) => setV((s) => ({ ...s, first: e.target.value }))} />
        <TextInput wrapperClassName="col-span-2" label="Novo total (R$)" type="number" step="0.01" placeholder={outstanding.toFixed(2)} value={v.total} onChange={(e) => setV((s) => ({ ...s, total: e.target.value }))} hint={`Em aberto: ${formatReais(outstanding)}`} />
        <TextArea wrapperClassName="col-span-2" label="Justificativa" value={v.reason} onChange={(e) => setV((s) => ({ ...s, reason: e.target.value }))} />
      </div>
    </Modal>
  );
}

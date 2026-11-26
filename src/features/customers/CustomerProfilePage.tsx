import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Pencil, Plus, ShieldCheck, Archive, RotateCcw } from 'lucide-react';
import { useList, useRecord, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card, Stat, Tabs, KeyValue } from '@/components/ui/Layout';
import { Badge, EmptyState, ErrorState, LoadingBlock, friendlyError } from '@/components/ui/Feedback';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Overlay';
import { SelectInput, TextArea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { formatDocument, formatPhoneBR, VERIFICATION_STATUS, type VerificationStatus } from '@/domain/documents';
import { formatReais, formatNumber } from '@/domain/money';
import { formatDateBR, formatDateTimeBR, diffDays, todaySP } from '@/domain/dates';
import { ORDER_STATUS, type OrderStatus } from '@/domain/orders';
import { EQUIPMENT_STATUS, type EquipmentStatus } from '@/domain/equipment';
import { CustomerForm } from './CustomerForm';
import { HealthFactors, useHealth } from './HealthPanel';
import { ConditionsPanel } from './ConditionsPanel';
import { ReceivableStatusBadge } from '@/features/finance/ReceivableStatusBadge';
import { WhatsAppButton } from '@/features/finance/WhatsAppButton';
import { Attachments } from '@/components/ui/Attachments';

type Tab = 'geral' | 'cadastro' | 'condicoes' | 'pedidos' | 'financeiro' | 'equipamentos' | 'servicos' | 'documentos' | 'atendimento';

export function CustomerProfilePage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [tab, setTab] = useState<Tab>('geral');
  const [editOpen, setEditOpen] = useState(false);
  const c = useRecord<Row>('customers', id);
  const orders = useList<Row>('orders', { filters: [{ column: 'customer_id', op: 'eq', value: id }], order: [{ column: 'order_date', ascending: false }], range: [0, 499] });
  const finVisible = can('cobranca') || can('financeiro');
  const recv = useList<Row>('receivables_view', { filters: [{ column: 'customer_id', op: 'eq', value: id }], order: [{ column: 'due_date', ascending: false }], range: [0, 499] }, { enabled: finVisible });
  const equipment = useList<Row>('equipment', { select: '*,type:equipment_types(name)', filters: [{ column: 'customer_id', op: 'eq', value: id }] });
  const sos = useList<Row>('service_orders', { select: '*,service:services(name)', filters: [{ column: 'customer_id', op: 'eq', value: id }], order: [{ column: 'created_at', ascending: false }] });
  const conditions = useList<Row>('commercial_conditions', { filters: [{ column: 'customer_id', op: 'eq', value: id }], order: [{ column: 'valid_from', ascending: false }] });
  const verifications = useList<Row>('customer_verifications', { filters: [{ column: 'customer_id', op: 'eq', value: id }], order: [{ column: 'checked_at', ascending: false }] });
  const interactions = useList<Row>('customer_interactions', { filters: [{ column: 'customer_id', op: 'eq', value: id }], order: [{ column: 'occurred_at', ascending: false }], range: [0, 99] });

  const today = todaySP();
  const current = conditions.data?.rows.find((x) => String(x.valid_from) <= today && (!x.valid_to || String(x.valid_to) >= today));
  const committed = useMemo(() => (orders.data?.rows ?? []).filter((o) => !['orcamento', 'aguardando_confirmacao', 'cancelado'].includes(String(o.status))), [orders.data]);
  const health = useHealth(c.data, committed, current?.expected_liters_per_week ? Number(current.expected_liters_per_week) : null, undefined, current?.expected_interval_days as number | null);

  const kpis = useMemo(() => {
    const total = committed.reduce((s, o) => s + Number(o.total), 0);
    const liters = committed.reduce((s, o) => s + Number(o.total_liters), 0);
    const first = committed.at(-1)?.order_date as string | undefined;
    const spanDays = first ? Math.max(diffDays(first, today), 7) : 0;
    const open = (recv.data?.rows ?? []).filter((r) => ['em_aberto', 'parcialmente_pago', 'vencido', 'a_vencer'].includes(String(r.financial_status)));
    const monthly = new Map<string, number>();
    for (const o of committed) monthly.set(String(o.order_date).slice(0, 7), (monthly.get(String(o.order_date).slice(0, 7)) ?? 0) + Number(o.total_liters));
    return {
      total, liters, ticket: committed.length ? total / committed.length : 0,
      perWeek: spanDays ? (liters / spanDays) * 7 : 0, perMonth: spanDays ? (liters / spanDays) * 30 : 0,
      frequency: committed.length > 1 ? spanDays / (committed.length - 1) : null,
      last: committed[0]?.order_date as string | undefined,
      outstanding: open.reduce((s, r) => s + Number(r.outstanding), 0),
      overdue: open.filter((r) => r.financial_status === 'vencido' || (r.financial_status === 'parcialmente_pago' && String(r.due_date) < today)).reduce((s, r) => s + Number(r.outstanding), 0),
      maintenanceCost: (sos.data?.rows ?? []).reduce((s, o) => s + Number(o.cost ?? 0), 0),
      chart: [...monthly.entries()].sort().slice(-12).map(([m, l]) => ({ month: `${m.slice(5)}/${m.slice(2, 4)}`, liters: l }))
    };
  }, [committed, recv.data, sos.data, today]);

  if (c.isLoading) return <Card opaque><LoadingBlock rows={8} /></Card>;
  if (c.isError) return <ErrorState error={c.error} />;
  if (!c.data) return <Card><EmptyState title="Cliente não encontrado" action={<Link to="/clientes"><Button variant="secondary">Voltar</Button></Link>} /></Card>;
  const cu = c.data;

  const setStatus = async (status: string) => {
    try {
      await db().update('customers', String(cu.id), { status });
      invalidate();
      toast(`Cliente ${status === 'ativo' ? 'reativado' : status}. Histórico preservado.`);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'geral', label: 'Visão geral' }, { key: 'cadastro', label: 'Cadastro' }, { key: 'condicoes', label: 'Condições comerciais' },
    { key: 'pedidos', label: 'Pedidos', count: orders.data?.rows.length },
    ...(finVisible ? [{ key: 'financeiro' as Tab, label: 'Financeiro e cobranças', count: recv.data?.rows.length }] : []),
    { key: 'equipamentos', label: 'Equipamentos', count: equipment.data?.rows.length }, { key: 'servicos', label: 'Serviços técnicos', count: sos.data?.rows.length },
    { key: 'documentos', label: 'Documentos' }, { key: 'atendimento', label: 'Atendimento e histórico' }
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={[{ label: 'Clientes', to: '/clientes' }, { label: String(cu.trade_name ?? cu.name) }]}
        title={String(cu.trade_name ?? cu.name)}
        subtitle={<span className="flex flex-wrap items-center gap-2">{cu.trade_name ? String(cu.name) : null} {formatDocument(cu.document as string)} <Badge tone={cu.status === 'ativo' ? 'success' : 'neutral'}>{String(cu.status)}</Badge> <Badge tone="info">{VERIFICATION_STATUS[cu.verification_status as VerificationStatus]}</Badge></span>}
        actions={<>
          {cu.whatsapp || cu.phone ? <WhatsAppButton phone={String(cu.whatsapp ?? cu.phone)} text={`Olá, ${String(cu.trade_name ?? cu.name)}! `} customerId={String(cu.id)} /> : null}
          {can('pedidos', 'create') && <Link to={`/pedidos/novo?cliente=${cu.id}`}><Button icon={<Plus className="size-4" />}>Novo pedido</Button></Link>}
          {can('clientes', 'edit') && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditOpen(true)}>Editar</Button>}
          {can('clientes', 'archive') && (cu.status === 'ativo'
            ? <Button variant="ghost" icon={<Archive className="size-4" />} onClick={() => setStatus('inativo')}>Inativar</Button>
            : <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setStatus('ativo')}>Reativar</Button>)}
        </>}
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'geral' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Total comprado" value={formatReais(kpis.total)} hint={`${committed.length} pedido(s)`} />
            <Stat label="Litros consumidos" value={`${formatNumber(kpis.liters)} L`} hint={`${formatNumber(kpis.perWeek, 1)} L/semana · ${formatNumber(kpis.perMonth)} L/mês`} />
            <Stat label="Ticket médio" value={formatReais(kpis.ticket)} hint={kpis.frequency ? `Pedido a cada ${formatNumber(kpis.frequency)} dias` : 'Frequência indisponível'} />
            <Stat label="Último pedido" value={formatDateBR(kpis.last)} hint={kpis.last ? `há ${diffDays(kpis.last, today)} dia(s)` : undefined} />
            {finVisible && <Stat label="Saldo pendente" value={formatReais(kpis.outstanding)} hint={`${formatReais(kpis.overdue)} vencido`} tone={kpis.overdue > 0 ? 'down' : 'neutral'} />}
            <Stat label="Equipamentos vinculados" value={String(equipment.data?.rows.length ?? 0)} />
            <Stat label="Custos de manutenção" value={formatReais(kpis.maintenanceCost)} />
            <Stat label="Próxima assepsia" value={formatDateBR((equipment.data?.rows ?? []).map((e) => e.next_sanitization_at as string).filter(Boolean).sort()[0])} />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2" title="Histórico de consumo (litros/mês)">
              {kpis.chart.length ? (
                <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={kpis.chart}><CartesianGrid strokeDasharray="3 6" stroke="#FFCC97" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11, fill: '#92543A' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 11, fill: '#92543A' }} axisLine={false} tickLine={false} width={40} /><Tooltip formatter={(v) => [`${formatNumber(Number(v))} L`, 'Litros']} contentStyle={{ borderRadius: 14 }} /><Bar dataKey="liters" fill="#FF8F2E" radius={[10, 10, 0, 0]} /></BarChart></ResponsiveContainer></div>
              ) : <EmptyState title="Sem pedidos confirmados" />}
            </Card>
            <Card title="Saúde comercial">{health ? <HealthFactors h={health} /> : <LoadingBlock rows={2} />}</Card>
          </div>
          {cu.notes ? <Card title="Anotações internas"><p className="whitespace-pre-wrap text-sm">{String(cu.notes)}</p></Card> : null}
        </div>
      )}

      {tab === 'cadastro' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card opaque className="lg:col-span-2" title="Dados cadastrais">
            <KeyValue items={[
              ['Tipo', cu.person_type === 'PF' ? 'Pessoa física' : 'Pessoa jurídica'], [cu.person_type === 'PF' ? 'Nome' : 'Razão social', String(cu.name)], ['Nome fantasia', cu.trade_name as string],
              ['CPF/CNPJ', formatDocument(cu.document as string)], ['Inscrição estadual', cu.state_registration as string], ['Situação cadastral (fonte)', cu.registration_status as string],
              ['Telefone', cu.phone ? formatPhoneBR(String(cu.phone)) : null], ['WhatsApp', cu.whatsapp ? formatPhoneBR(String(cu.whatsapp)) : null], ['E-mail', cu.email as string], ['E-mail financeiro', cu.finance_email as string],
              ['Endereço', [cu.street, cu.number, cu.complement, cu.district].filter(Boolean).join(', ')], ['Cidade/UF', [cu.city, cu.state].filter(Boolean).join('/')], ['CEP', cu.cep as string],
              ['Responsável', cu.manager_name as string], ['Responsável financeiro', cu.finance_contact_name as string], ['Origem', cu.origin as string], ['Cadastrado em', formatDateTimeBR(cu.created_at as string)]
            ]} />
          </Card>
          <VerificationsCard customerId={String(cu.id)} rows={verifications.data?.rows ?? []} />
        </div>
      )}

      {tab === 'condicoes' && <ConditionsPanel customerId={String(cu.id)} />}

      {tab === 'pedidos' && (
        <Card opaque>
          {(orders.data?.rows ?? []).length === 0 ? <EmptyState title="Nenhum pedido" /> : (
            <ul className="divide-y divide-tangerine-100">
              {orders.data!.rows.map((o) => (
                <li key={String(o.id)}><Link to={`/pedidos/${o.id}`} className="flex flex-wrap items-center gap-3 py-3 hover:bg-cream-100/60">
                  <span className="font-semibold">Nº {String(o.number)}</span><span className="text-sm text-cocoa-700">{formatDateBR(o.order_date as string)}</span>
                  <Badge tone={o.status === 'cancelado' ? 'neutral' : o.status === 'finalizado' ? 'success' : 'info'}>{ORDER_STATUS[o.status as OrderStatus]}</Badge>
                  <span className="num ml-auto text-sm">{formatNumber(Number(o.total_liters))} L · <strong>{formatReais(o.total as number)}</strong></span>
                </Link></li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'financeiro' && (
        <Card opaque title="Títulos (situação financeira e cartorária separadas)" action={<Link to={`/financeiro/receber?cliente=${cu.id}`} className="text-sm font-semibold text-tangerine-900 hover:underline">Abrir em contas a receber</Link>}>
          {(recv.data?.rows ?? []).length === 0 ? <EmptyState title="Nenhum título" /> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead className="text-left text-xs uppercase text-cocoa-700"><tr><th className="py-2">Descrição</th><th>Vencimento</th><th className="text-right">Valor</th><th className="text-right">Em aberto</th><th>Situação</th></tr></thead>
              <tbody>{recv.data!.rows.map((r) => (<tr key={String(r.id)} className="border-t border-tangerine-100"><td className="py-2.5">{String(r.description)}</td><td>{formatDateBR(r.due_date as string)}</td><td className="num text-right">{formatReais(r.amount as number)}</td><td className="num text-right">{formatReais(r.outstanding as number)}</td><td><ReceivableStatusBadge receivableId={String(r.id)} financialStatus={String(r.financial_status)} /></td></tr>))}</tbody>
            </table></div>
          )}
        </Card>
      )}

      {tab === 'equipamentos' && (
        <Card opaque>
          {(equipment.data?.rows ?? []).length === 0 ? <EmptyState title="Nenhum equipamento com este cliente" /> : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">{equipment.data!.rows.map((e) => (
              <li key={String(e.id)}><Link to={`/equipamentos/${e.id}`} className="block rounded-2xl border border-tangerine-100 p-4 hover:bg-cream-100">
                <p className="font-semibold">{String(e.asset_code)} · {String((e.type as Row | null)?.name ?? '')}</p>
                <p className="mt-1 text-sm text-cocoa-700">{EQUIPMENT_STATUS[e.status as EquipmentStatus]} desde {formatDateBR(String(e.custody_since).slice(0, 10))} · Próx. assepsia {formatDateBR(e.next_sanitization_at as string)}</p>
              </Link></li>))}</ul>
          )}
        </Card>
      )}

      {tab === 'servicos' && (
        <Card opaque>
          {(sos.data?.rows ?? []).length === 0 ? <EmptyState title="Nenhuma ordem de serviço" /> : (
            <ul className="divide-y divide-tangerine-100">{sos.data!.rows.map((s) => (
              <li key={String(s.id)}><Link to={`/ordens-de-servico/${s.id}`} className="flex flex-wrap items-center gap-3 py-3 hover:bg-cream-100/60">
                <span className="font-semibold">OS nº {String(s.number)}</span><span className="text-sm">{String((s.service as Row | null)?.name ?? '')}</span>
                <Badge tone={s.status === 'concluida' ? 'success' : 'info'}>{String(s.status)}</Badge>
                <span className="ml-auto text-sm text-cocoa-700">{formatDateBR(s.scheduled_date as string)}</span>
              </Link></li>))}</ul>
          )}
        </Card>
      )}

      {tab === 'documentos' && <Attachments entityType="customer" entityId={String(cu.id)} />}

      {tab === 'atendimento' && <InteractionsCard customerId={String(cu.id)} rows={interactions.data?.rows ?? []} />}

      <CustomerForm row={cu} open={editOpen} onClose={() => setEditOpen(false)} />
    </div>
  );
}

function VerificationsCard({ customerId, rows }: { customerId: string; rows: Row[] }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<VerificationStatus>('conferencia_manual');
  const [notes, setNotes] = useState('');
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const { can } = useAuth();
  const save = async () => {
    try {
      await db().insert('customer_verifications', { customer_id: customerId, status, source: 'Conferência manual na fonte oficial (Receita Federal)', notes: notes || null });
      await db().update('customers', customerId, { verification_status: status });
      invalidate();
      toast('Verificação registrada.');
      setOpen(false);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  return (
    <Card title="Verificações cadastrais" action={can('clientes', 'edit') && <Button size="sm" variant="soft" icon={<ShieldCheck className="size-4" />} onClick={() => setOpen(true)}>Registrar</Button>}>
      {rows.length === 0 ? <p className="text-sm text-cocoa-700">Nenhuma verificação registrada.</p> : (
        <ul className="space-y-2 text-sm">{rows.map((v) => (
          <li key={String(v.id)} className="rounded-xl bg-white/70 p-3"><Badge tone={v.status === 'verificado_fonte_oficial' ? 'success' : v.status === 'divergencia' ? 'danger' : 'info'}>{VERIFICATION_STATUS[v.status as VerificationStatus]}</Badge>
            <p className="mt-1 text-xs text-cocoa-700">{String(v.source)} · {formatDateTimeBR(v.checked_at as string)}</p>{v.notes ? <p className="mt-1">{String(v.notes)}</p> : null}</li>))}</ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Registrar verificação" size="sm" footer={<Button onClick={save}>Salvar</Button>}>
        <div className="space-y-3">
          <SelectInput label="Resultado" value={status} onChange={(e) => setStatus(e.target.value as VerificationStatus)} options={Object.entries(VERIFICATION_STATUS).map(([value, label]) => ({ value, label }))} />
          <TextArea label="Observações (fonte, protocolo, divergências)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <p className="text-xs text-cocoa-700">A existência de CPF só pode ser confirmada por serviço autorizado ou conferência manual na fonte oficial.</p>
        </div>
      </Modal>
    </Card>
  );
}

function InteractionsCard({ customerId, rows }: { customerId: string; rows: Row[] }) {
  const [kind, setKind] = useState('nota');
  const [summary, setSummary] = useState('');
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const add = async () => {
    if (!summary.trim()) return;
    try {
      await db().insert('customer_interactions', { customer_id: customerId, kind, summary });
      setSummary('');
      invalidate();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card opaque title="Registrar atendimento">
        <div className="space-y-3">
          <SelectInput label="Tipo" value={kind} onChange={(e) => setKind(e.target.value)} options={[['nota', 'Nota'], ['ligacao', 'Ligação'], ['whatsapp', 'WhatsApp'], ['visita', 'Visita'], ['email', 'E-mail'], ['reuniao', 'Reunião']].map(([value, label]) => ({ value: value!, label: label! }))} />
          <TextArea label="Resumo" value={summary} onChange={(e) => setSummary(e.target.value)} />
          <Button onClick={add} disabled={!summary.trim()}>Adicionar</Button>
        </div>
      </Card>
      <Card opaque className="lg:col-span-2" title="Linha do tempo">
        {rows.length === 0 ? <EmptyState title="Sem registros" /> : (
          <ol className="space-y-3 border-l-2 border-tangerine-200 pl-4">{rows.map((i) => (
            <li key={String(i.id)} className="relative"><span className="absolute -left-[23px] top-1.5 size-3 rounded-full bg-tangerine-700" aria-hidden />
              <p className="text-xs text-cocoa-700">{formatDateTimeBR(i.occurred_at as string)} · {String(i.kind)}</p><p className="text-sm">{String(i.summary)}</p></li>))}</ol>
        )}
      </Card>
    </div>
  );
}

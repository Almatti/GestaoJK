import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { CalendarDays, ChevronLeft, ChevronRight, FileUp, List, Plus, ShoppingBasket } from 'lucide-react';
import { useList } from '@/data/hooks';
import type { Filter, Row } from '@/data/types';
import { PageHeader, Card, Stat } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, ErrorState, LoadingBlock, Alert } from '@/components/ui/Feedback';
import { TextInput, SelectInput } from '@/components/ui/Form';
import { formatNumber, formatReais } from '@/domain/money';
import { addDays, formatDateBR, todaySP } from '@/domain/dates';
import { FESTA_FIN_STATUS, FESTA_OPS_STATUS } from '@/domain/festas';
import { useAuth } from '@/features/auth/AuthContext';
import { clsx as cn } from 'clsx';
import { FestasDataNotice } from './shared';

const toneOf = (s: string) => (FESTA_FIN_STATUS as Record<string, { tone: 'info' | 'warning' | 'success' | 'danger' | 'neutral'; label: string }>)[s] ?? { tone: 'neutral' as const, label: s };
const opsOf = (s: string) => FESTA_OPS_STATUS.find((o) => o.value === s) ?? { value: s, label: s, tone: 'neutral' as const };

export function FinanceBadge({ status }: { status: unknown }) {
  const t = toneOf(String(status));
  return <Badge tone={t.tone}>{t.label}</Badge>;
}
export function OpsBadge({ status }: { status: unknown }) {
  const o = opsOf(String(status));
  return <Badge tone={o.tone} icon={false}>{o.label}</Badge>;
}

function monthBounds(iso: string) {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { first, last, y, m };
}

export function FestasPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [view, setView] = useState<'lista' | 'calendario'>('lista');
  const [from, setFrom] = useState(addDays(todaySP(), -30));
  const [to, setTo] = useState(addDays(todaySP(), 150));
  const [term, setTerm] = useState('');
  const [fin, setFin] = useState('');
  const [ops, setOps] = useState('');
  const [month, setMonth] = useState(todaySP().slice(0, 7) + '-01');

  const common: Filter[] = [];
  if (fin) common.push({ column: 'financial_status', op: 'eq', value: fin });
  if (ops) common.push({ column: 'ops_status', op: 'eq', value: ops });
  const search = term.trim() ? { columns: ['client_name', 'event_name', 'code'], term: term.trim() } : undefined;

  const listFilters: Filter[] = [...common, { column: 'event_date', op: 'gte', value: from }, { column: 'event_date', op: 'lte', value: to }];
  const list = useList<Row>('festa_events_view', { filters: listFilters, search, order: [{ column: 'event_date', ascending: true }], range: [0, 999], count: true }, { enabled: view === 'lista' });

  const { first, last, y, m } = monthBounds(month);
  const calFilters: Filter[] = [...common, { column: 'event_date', op: 'gte', value: first }, { column: 'event_date', op: 'lte', value: last }];
  const cal = useList<Row>('festa_events_view', { filters: calFilters, search, order: [{ column: 'event_date', ascending: true }], range: [0, 999] }, { enabled: view === 'calendario' });

  const upcoming = useList<Row>('festa_events_view', {
    filters: [{ column: 'event_date', op: 'gte', value: todaySP() }, { column: 'ops_status', op: 'neq', value: 'cancelado' }],
    order: [{ column: 'event_date', ascending: true }], range: [0, 4]
  });

  const rows = (view === 'lista' ? list.data?.rows : cal.data?.rows) ?? [];
  const active = rows.filter((r) => r.ops_status !== 'cancelado');
  const kpi = useMemo(() => {
    const sum = (k: string) => active.reduce((s, r) => s + Number(r[k] ?? 0), 0);
    return { count: active.length, previsto: sum('total'), recebido: sum('received'), receber: sum('outstanding') };
  }, [active]);

  const errorOf = view === 'lista' ? list.error : cal.error;
  const loading = view === 'lista' ? list.isLoading : cal.isLoading;

  return (
    <>
      <PageHeader title="Festas" subtitle="Eventos, pagamentos e preparação. Integrado ao financeiro: cada festa gera um título a receber."
        actions={<>
          {can('festas', 'create') && <Button variant="secondary" icon={<FileUp className="size-4" />} onClick={() => navigate('/festas/importar')}>Importar PDF</Button>}
          <Button variant="secondary" icon={<ShoppingBasket className="size-4" />} onClick={() => navigate('/festas/planejamento')}>Compras e checklist</Button>
          {can('festas', 'create') && <Button icon={<Plus className="size-4" />} onClick={() => navigate('/festas/novo')}>Nova festa</Button>}
        </>} />

      <FestasDataNotice />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Eventos no período" value={kpi.count} hint={`${rows.length - kpi.count} cancelado(s)`} />
        <Stat label="Faturamento previsto" value={formatReais(kpi.previsto)} hint="Soma dos totais das festas" />
        <Stat label="Recebido" value={formatReais(kpi.recebido)} hint="Somente pagamentos confirmados" tone="up" />
        <Stat label="A receber" value={formatReais(kpi.receber)} hint="Saldo devedor" tone={kpi.receber > 0 ? 'down' : 'neutral'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card title={view === 'lista' ? 'Festas por data' : `Calendário · ${String(m).padStart(2, '0')}/${y}`}
          action={<div className="flex gap-1 rounded-control bg-cream-200 p-1">
            <button type="button" onClick={() => setView('lista')} className={cn('flex items-center gap-1 rounded-control px-3 py-1.5 text-sm font-semibold', view === 'lista' ? 'bg-white text-tangerine-900 shadow-soft' : 'text-cocoa-700')}><List className="size-4" />Lista</button>
            <button type="button" onClick={() => setView('calendario')} className={cn('flex items-center gap-1 rounded-control px-3 py-1.5 text-sm font-semibold', view === 'calendario' ? 'bg-white text-tangerine-900 shadow-soft' : 'text-cocoa-700')}><CalendarDays className="size-4" />Calendário</button>
          </div>}>
          <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {view === 'lista' ? <>
              <TextInput label="De" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <TextInput label="Até" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </> : <div className="flex items-end gap-2 md:col-span-2">
              <Button variant="secondary" size="sm" icon={<ChevronLeft className="size-4" />} onClick={() => setMonth(addDays(month, -1).slice(0, 7) + '-01')} aria-label="Mês anterior" />
              <span className="min-w-32 text-center font-semibold text-cocoa-900">{String(m).padStart(2, '0')}/{y}</span>
              <Button variant="secondary" size="sm" icon={<ChevronRight className="size-4" />} onClick={() => setMonth(addDays(last, 1))} aria-label="Próximo mês" />
            </div>}
            <TextInput label="Cliente ou evento" placeholder="Buscar" value={term} onChange={(e) => setTerm(e.target.value)} />
            <SelectInput label="Situação financeira" value={fin} onChange={(e) => setFin(e.target.value)} placeholder="Todas"
              options={Object.entries(FESTA_FIN_STATUS).map(([value, v]) => ({ value, label: v.label }))} />
            <SelectInput label="Situação do evento" value={ops} onChange={(e) => setOps(e.target.value)} placeholder="Todas"
              options={FESTA_OPS_STATUS.map((o) => ({ value: o.value, label: o.label }))} />
          </div>

          {errorOf ? <ErrorState error={errorOf} /> : loading ? <LoadingBlock rows={5} /> : view === 'lista'
            ? <FestaList rows={rows} />
            : <FestaCalendar month={month} rows={rows} onOpen={(id) => navigate(`/festas/${id}`)} />}
        </Card>

        <div className="space-y-4">
          <Card title="Próximos eventos">
            {upcoming.isLoading ? <LoadingBlock rows={3} /> : (upcoming.data?.rows ?? []).length === 0
              ? <p className="text-sm text-cocoa-700">Nenhuma festa futura cadastrada.</p>
              : <ul className="space-y-3">{(upcoming.data?.rows ?? []).map((r) => (
                <li key={String(r.id)}>
                  <Link to={`/festas/${String(r.id)}`} className="block rounded-control p-2 hover:bg-cream-100">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-cocoa-900">{String(r.event_name || r.code)}</span>
                      <FinanceBadge status={r.financial_status} />
                    </div>
                    <div className="text-xs text-cocoa-700">{formatDateBR(r.event_date as string)}{r.event_time ? ` · ${String(r.event_time).slice(0, 5)}` : ''} · {String(r.client_name || 'cliente não informado')}</div>
                  </Link>
                </li>))}</ul>}
          </Card>
          <Alert tone="info" title="Lembretes automáticos">
            Avisos aparecem em Notificações: 3 dias antes, 2 dias antes e no dia da festa, pagamentos vencidos, produtos não conferidos e cadastros incompletos. Os prazos ficam em Configurações → Festas.
          </Alert>
        </div>
      </div>
    </>
  );
}

function FestaList({ rows }: { rows: Row[] }) {
  if (!rows.length) return <EmptyState title="Nenhuma festa neste filtro" description="Cadastre uma festa ou importe o PDF do pedido." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead><tr className="border-b border-tangerine-100 text-left text-xs uppercase tracking-wide text-cocoa-700">
          <th className="py-2 pr-3">Data</th><th className="py-2 pr-3">Festa</th><th className="py-2 pr-3">Cliente</th>
          <th className="py-2 pr-3 text-right">Total</th><th className="py-2 pr-3 text-right">Recebido</th><th className="py-2 pr-3 text-right">Saldo</th>
          <th className="py-2 pr-3">Financeiro</th><th className="py-2">Evento</th>
        </tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={String(r.id)} className="border-b border-tangerine-100/60 hover:bg-cream-100">
            <td className="py-2 pr-3 whitespace-nowrap">{r.event_date ? formatDateBR(r.event_date as string) : <span className="text-warning-700">sem data</span>}{r.event_time ? <div className="text-xs text-cocoa-700">{String(r.event_time).slice(0, 5)}</div> : null}</td>
            <td className="py-2 pr-3"><Link to={`/festas/${String(r.id)}`} className="font-semibold text-tangerine-900 hover:underline">{String(r.event_name || 'Sem nome')}</Link><div className="text-xs text-cocoa-700">{String(r.code)}</div></td>
            <td className="py-2 pr-3">{String(r.client_name || '—')}</td>
            <td className="py-2 pr-3 text-right">{formatReais(Number(r.total ?? 0))}</td>
            <td className="py-2 pr-3 text-right text-success-700">{formatReais(Number(r.received ?? 0))}</td>
            <td className="py-2 pr-3 text-right">{formatReais(Number(r.outstanding ?? 0))}</td>
            <td className="py-2 pr-3"><FinanceBadge status={r.financial_status} /></td>
            <td className="py-2"><OpsBadge status={r.ops_status} /></td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

/** Calendário mensal: cada dia lista as festas; a cor indica a situação financeira. */
function FestaCalendar({ month, rows, onOpen }: { month: string; rows: Row[]; onOpen: (id: string) => void }) {
  const { first, last } = monthBounds(month);
  const startWeekday = new Date(first + 'T00:00:00Z').getUTCDay();
  const days = Number(last.slice(8));
  const cells: (string | null)[] = [...Array(startWeekday).fill(null), ...Array.from({ length: days }, (_, i) => `${first.slice(0, 8)}${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    const d = String(r.event_date ?? '');
    if (!d) continue;
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }
  const today = todaySP();
  const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[640px] grid-cols-7 gap-1 text-xs">
        {weekdays.map((w) => <div key={w} className="py-1 text-center font-semibold uppercase text-cocoa-700">{w}</div>)}
        {cells.map((d, i) => (
          <div key={i} className={cn('min-h-24 rounded-control border p-1', d ? 'border-tangerine-100 bg-white' : 'border-transparent bg-transparent', d === today && 'ring-2 ring-tangerine-500')}>
            {d && <>
              <div className="font-semibold text-cocoa-900">{Number(d.slice(8))}</div>
              <div className="mt-1 space-y-1">
                {(byDay.get(d) ?? []).slice(0, 4).map((r) => (
                  <button key={String(r.id)} type="button" onClick={() => onOpen(String(r.id))}
                    className={cn('block w-full truncate rounded px-1 py-0.5 text-left text-[11px] font-medium',
                      r.ops_status === 'cancelado' ? 'bg-cream-200 text-cocoa-500 line-through' : r.financial_status === 'vencido' ? 'bg-danger-50 text-danger-700' : r.financial_status === 'pago' ? 'bg-success-50 text-success-700' : 'bg-tangerine-100 text-tangerine-900')}
                    title={`${String(r.event_name || r.code)} · ${String(r.client_name || '')}`}>
                    {r.event_time ? `${String(r.event_time).slice(0, 5)} ` : ''}{String(r.event_name || r.code)}
                  </button>))}
                {(byDay.get(d) ?? []).length > 4 && <div className="text-[10px] text-cocoa-700">+{(byDay.get(d) ?? []).length - 4} festas</div>}
              </div>
            </>}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-cocoa-700">Cores: pendente/parcial em tangerina · vencido em vermelho · pago em verde · cancelado riscado. Quantidade de festas no mês: {formatNumber(rows.filter((r) => r.ops_status !== 'cancelado').length)}.</p>
    </div>
  );
}

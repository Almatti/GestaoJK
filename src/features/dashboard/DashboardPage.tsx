import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, RadialBar, RadialBarChart, PolarAngleAxis } from 'recharts';
import { AlertTriangle, Banknote, Beer, CalendarClock, Cpu, Gavel, ListTodo, PackageX, TrendingUp, Truck, Users, Wallet, Wrench, Sparkles } from 'lucide-react';
import { useRpc } from '@/data/hooks';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card, Stat } from '@/components/ui/Layout';
import { Badge, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { formatReais, formatNumber, formatPercent } from '@/domain/money';
import { formatDateBR, periodFor, previousPeriod, todaySP, type PeriodPreset, type Period } from '@/domain/dates';
import { PeriodFilter } from './PeriodFilter';

export interface Metrics {
  orders_count: number; liters_sold: number; kegs_sold: number; active_customers: number; inactive_customers: number;
  low_rotation_points: number; healthy_points: number; top_products: { name: string; liters: number; revenue: number }[];
  equipment: { available: number; external: number; maintenance: number; idle: number }; maintenance_due: number;
  service_orders_open: number; deliveries_scheduled: number; priority_tasks: number; overdue_tasks: number; low_stock: number;
  daily_series: { day: string; liters: number; revenue: number | null }[];
  revenue_billed?: number; cogs?: number; revenue_received?: number; expenses_paid?: number; receivable_open?: number; receivable_overdue?: number;
  receivable_due_soon?: number; payable_open?: number; payable_overdue?: number; in_protest?: number; paid_with_cartorial_pending?: number;
  cash_balance?: number; cash_projection_30d?: number;
}

const delta = (cur: number, prev: number) => (prev ? ((cur - prev) / prev) * 100 : null);
const deltaHint = (cur: number, prev: number) => {
  const d = delta(cur, prev);
  return d === null ? 'Sem base de comparação' : `${d >= 0 ? '▲' : '▼'} ${formatPercent(Math.abs(d))} vs. período anterior`;
};

export function DashboardPage() {
  const { profile, can } = useAuth();
  const [preset, setPreset] = useState<PeriodPreset>('mes');
  const [custom, setCustom] = useState<Period>({ start: todaySP(), end: todaySP() });
  const period = useMemo(() => periodFor(preset, todaySP(), custom), [preset, custom]);
  const prev = useMemo(() => previousPeriod(period), [period]);
  const q = useRpc<Metrics>('dashboard_metrics', { p_start: period.start, p_end: period.end });
  const qp = useRpc<Metrics>('dashboard_metrics', { p_start: prev.start, p_end: prev.end });
  const m = q.data;
  const pm = qp.data;
  const fin = m?.revenue_billed !== undefined;
  const hour = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()));
  const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  const grossProfit = fin ? (m!.revenue_billed ?? 0) - (m!.cogs ?? 0) : 0;
  const marginPct = fin && m!.revenue_billed ? (grossProfit / m!.revenue_billed) * 100 : 0;

  const attention = m
    ? [
        fin && (m.receivable_overdue ?? 0) > 0 && { tone: 'danger' as const, icon: Banknote, text: `${formatReais(m.receivable_overdue)} em títulos vencidos`, to: '/financeiro/receber?status=vencido' },
        fin && (m.paid_with_cartorial_pending ?? 0) > 0 && { tone: 'warning' as const, icon: Gavel, text: `${m.paid_with_cartorial_pending} título(s) pago(s) ainda em protesto — providenciar anuência`, to: '/financeiro/protestos' },
        m.low_rotation_points > 0 && { tone: 'warning' as const, icon: TrendingUp, text: `${m.low_rotation_points} ponto(s) fixo(s) com baixa rotatividade`, to: '/inteligencia-comercial' },
        m.inactive_customers > 0 && { tone: 'info' as const, icon: Users, text: `${m.inactive_customers} cliente(s) sem pedidos há mais de 60 dias`, to: '/inteligencia-comercial' },
        m.maintenance_due > 0 && { tone: 'warning' as const, icon: Wrench, text: `${m.maintenance_due} equipamento(s) com manutenção/assepsia nos próximos 7 dias`, to: '/equipamentos' },
        m.low_stock > 0 && { tone: 'danger' as const, icon: PackageX, text: `${m.low_stock} item(ns) de estoque abaixo do mínimo`, to: '/estoque' },
        m.equipment.idle > 0 && { tone: 'info' as const, icon: Cpu, text: `${m.equipment.idle} equipamento(s) ocioso(s)`, to: '/equipamentos?status=disponivel' },
        m.overdue_tasks > 0 && { tone: 'warning' as const, icon: ListTodo, text: `${m.overdue_tasks} tarefa(s) vencida(s)`, to: '/tarefas' },
        fin && (m.payable_overdue ?? 0) > 0 && { tone: 'danger' as const, icon: Wallet, text: `${formatReais(m.payable_overdue)} em contas a pagar vencidas`, to: '/financeiro/pagar' }
      ].filter(Boolean) as { tone: 'danger' | 'warning' | 'info'; icon: typeof Banknote; text: string; to: string }[]
    : [];

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`${greet}, ${(profile?.full_name || 'equipe').split(' ')[0]}`}
        subtitle={`Central de comando · ${formatDateBR(period.start)} a ${formatDateBR(period.end)}`}
        actions={<PeriodFilter preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} />}
      />
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {fin ? (
          <>
            <Stat label="Faturamento" value={m ? formatReais(m.revenue_billed) : <Skeleton className="h-7 w-28" />} hint={m && pm ? deltaHint(m.revenue_billed!, pm.revenue_billed!) : undefined} tone={m && pm && m.revenue_billed! >= pm.revenue_billed! ? 'up' : 'down'} icon={<Banknote className="size-5" />} to="/pedidos" help="Pedidos confirmados no período (competência). Não é dinheiro recebido." />
            <Stat label="Recebido" value={m ? formatReais(m.revenue_received) : <Skeleton className="h-7 w-28" />} hint="Regime de caixa (pagamentos registrados)" icon={<Wallet className="size-5" />} to="/financeiro/fluxo-de-caixa" />
            <Stat label="Lucro bruto" value={m ? formatReais(grossProfit) : <Skeleton className="h-7 w-28" />} hint={m ? `Margem bruta ${formatPercent(marginPct)}` : undefined} icon={<TrendingUp className="size-5" />} to="/relatorios" help="Faturamento − custo dos produtos vendidos (sem tributos)." />
            <Stat label="A receber (aberto)" value={m ? formatReais(m.receivable_open) : <Skeleton className="h-7 w-28" />} hint={m ? `${formatReais(m.receivable_overdue)} vencidos` : undefined} tone="down" icon={<CalendarClock className="size-5" />} to="/financeiro/receber" help="Não é saldo disponível." />
          </>
        ) : (
          <>
            <Stat label="Pedidos" value={m ? formatNumber(m.orders_count) : <Skeleton className="h-7 w-16" />} icon={<Beer className="size-5" />} to="/pedidos" />
            <Stat label="Entregas (7 dias)" value={m ? formatNumber(m.deliveries_scheduled) : <Skeleton className="h-7 w-16" />} icon={<Truck className="size-5" />} to="/logistica" />
            <Stat label="OS abertas" value={m ? formatNumber(m.service_orders_open) : <Skeleton className="h-7 w-16" />} icon={<Wrench className="size-5" />} to="/ordens-de-servico" />
            <Stat label="Tarefas prioritárias" value={m ? formatNumber(m.priority_tasks) : <Skeleton className="h-7 w-16" />} icon={<ListTodo className="size-5" />} to="/tarefas" />
          </>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Evolução de vendas" action={<Badge tone="info">Litros por dia</Badge>}>
          <div className="h-64">
            {m ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={m.daily_series} margin={{ left: -10, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="gLiters" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FC6500" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#FFCC97" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 6" stroke="#FFCC97" vertical={false} />
                  <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(8, 10) + '/' + d.slice(5, 7)} tick={{ fontSize: 11, fill: '#92543A' }} tickLine={false} axisLine={false} minTickGap={20} />
                  <YAxis tick={{ fontSize: 11, fill: '#92543A' }} tickLine={false} axisLine={false} width={48} />
                  <Tooltip formatter={(v) => [`${formatNumber(Number(v))} L`, 'Litros']} labelFormatter={(d) => formatDateBR(String(d))} contentStyle={{ borderRadius: 14, border: '1px solid #FFCC97' }} />
                  <Area type="monotone" dataKey="liters" stroke="#D64101" strokeWidth={2.5} fill="url(#gLiters)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : <Skeleton className="h-full w-full" />}
          </div>
        </Card>

        <Card title="Central de atenção" action={<Link to="/notificacoes" className="text-sm font-semibold text-tangerine-900 hover:underline">Ver tudo</Link>}>
          {!m ? <Skeleton className="h-40 w-full" /> : attention.length === 0 ? (
            <p className="py-8 text-center text-sm text-cocoa-700">Nenhum ponto de atenção no momento. 🎯</p>
          ) : (
            <ul className="space-y-2">
              {attention.map((a) => (
                <li key={a.text}>
                  <Link to={a.to} className="flex items-start gap-3 rounded-2xl bg-white/70 p-3 text-sm transition hover:bg-white">
                    <span className={a.tone === 'danger' ? 'text-danger-700' : a.tone === 'warning' ? 'text-warning-700' : 'text-info-700'}><a.icon className="size-5" aria-hidden /></span>
                    <span className="flex-1">{a.text}</span>
                    <AlertTriangle className="sr-only" aria-label={a.tone === 'danger' ? 'Crítico' : 'Atenção'} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Litros vendidos" value={m ? `${formatNumber(m.liters_sold)} L` : '—'} hint={m && pm ? deltaHint(m.liters_sold, pm.liters_sold) : undefined} to="/relatorios" />
        <Stat label="Barris" value={m ? formatNumber(m.kegs_sold) : '—'} to="/pedidos" />
        <Stat label="Pedidos" value={m ? formatNumber(m.orders_count) : '—'} to="/pedidos" />
        <Stat label="Clientes ativos" value={m ? formatNumber(m.active_customers) : '—'} to="/clientes" />
        <Stat label="Pontos saudáveis" value={m ? formatNumber(m.healthy_points) : '—'} hint={m ? `${m.low_rotation_points} com baixa rotatividade` : undefined} to="/inteligencia-comercial" />
        <Stat label="Clientes inativos" value={m ? formatNumber(m.inactive_customers) : '—'} to="/inteligencia-comercial" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Produtos mais vendidos">
          {m?.top_products.length ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={m.top_products} layout="vertical" margin={{ left: 0, right: 12 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: '#69351F' }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => [`${formatNumber(Number(v))} L`, 'Litros']} contentStyle={{ borderRadius: 14, border: '1px solid #FFCC97' }} />
                  <Bar dataKey="liters" radius={[0, 10, 10, 0]} fill="#FF8F2E" maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="py-10 text-center text-sm text-cocoa-700">Sem vendas no período.</p>}
        </Card>

        <Card title="Patrimônio">
          {m ? (
            <div className="flex items-center gap-4">
              <div className="h-36 w-36 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart innerRadius="70%" outerRadius="100%" data={[{ v: m.equipment.external, fill: '#FC6500' }]} startAngle={90} endAngle={-270}>
                    <PolarAngleAxis type="number" domain={[0, Math.max(1, m.equipment.external + m.equipment.available + m.equipment.maintenance)]} tick={false} />
                    <RadialBar dataKey="v" cornerRadius={12} background={{ fill: '#FDEADD' }} />
                  </RadialBarChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-1.5 text-sm">
                <li><Link className="hover:underline" to="/equipamentos?status=em_ponto_fixo"><strong className="num">{m.equipment.external}</strong> externos (clientes/eventos)</Link></li>
                <li><Link className="hover:underline" to="/equipamentos?status=disponivel"><strong className="num">{m.equipment.available}</strong> disponíveis</Link></li>
                <li><strong className="num">{m.equipment.maintenance}</strong> em manutenção/higienização</li>
                <li><strong className="num">{m.equipment.idle}</strong> ociosos</li>
                <li><strong className="num">{m.maintenance_due}</strong> manutenções próximas</li>
              </ul>
            </div>
          ) : <Skeleton className="h-36 w-full" />}
        </Card>

        {fin ? (
          <Card title="Financeiro em foco">
            {m && (
              <ul className="space-y-2 text-sm">
                <Row label="Saldo em contas" value={formatReais(m.cash_balance)} to="/financeiro" />
                <Row label="Projeção de caixa (30 dias)" value={formatReais(m.cash_projection_30d)} to="/financeiro/fluxo-de-caixa" />
                <Row label="Vencendo em 7 dias" value={formatReais(m.receivable_due_soon)} to="/financeiro/receber" />
                <Row label="Contas a pagar em aberto" value={formatReais(m.payable_open)} to="/financeiro/pagar" />
                <Row label="Valores em protesto" value={formatReais(m.in_protest)} to="/financeiro/protestos" />
              </ul>
            )}
          </Card>
        ) : (
          <Card title="Operação">
            {m && (
              <ul className="space-y-2 text-sm">
                <Row label="Entregas programadas (7 dias)" value={String(m.deliveries_scheduled)} to="/logistica" />
                <Row label="Ordens de serviço abertas" value={String(m.service_orders_open)} to="/ordens-de-servico" />
                <Row label="Itens abaixo do mínimo" value={String(m.low_stock)} to="/estoque" />
              </ul>
            )}
          </Card>
        )}
      </div>

      {can('ia') && (
        <Link to="/assistente" className="card mt-4 flex items-center gap-4 transition hover:shadow-[var(--shadow-lift)]">
          <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-tangerine-500 to-tangerine-800 text-white"><Sparkles className="size-6" /></span>
          <div><p className="font-display font-bold">Pergunte ao assistente</p><p className="text-sm text-cocoa-700">“Quais clientes estão consumindo menos?” · “Quanto temos a receber neste mês?”</p></div>
        </Link>
      )}
    </div>
  );
}

function Row({ label, value, to }: { label: string; value: string; to: string }) {
  return (
    <li>
      <Link to={to} className="flex items-center justify-between gap-3 rounded-xl bg-white/60 px-3 py-2.5 hover:bg-white">
        <span className="text-cocoa-700">{label}</span>
        <span className="num font-semibold">{value}</span>
      </Link>
    </li>
  );
}

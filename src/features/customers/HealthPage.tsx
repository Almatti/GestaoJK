import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useList } from '@/data/hooks';
import type { Row } from '@/data/types';
import { PageHeader, Card } from '@/components/ui/Layout';
import { LoadingBlock, ErrorState, EmptyState } from '@/components/ui/Feedback';
import { DEFAULT_HEALTH_THRESHOLDS, evaluateHealth, HEALTH_LEVELS, type HealthLevel, type HealthThresholds } from '@/domain/health';
import { todaySP, formatDateBR } from '@/domain/dates';
import { formatNumber, formatReais } from '@/domain/money';
import { HealthBadge } from './HealthPanel';
import { WhatsAppButton } from '@/features/finance/WhatsAppButton';

/** Inteligência comercial: saúde dos pontos fixos (separada da situação financeira). */
export function HealthPage() {
  const cons = useList<Row>('customer_consumption', { filters: [{ column: 'status', op: 'eq', value: 'ativo' }], range: [0, 999] });
  const orders = useList<Row>('orders', { select: 'customer_id,order_date,total_liters,status', filters: [{ column: 'order_date', op: 'gte', value: new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10) }], range: [0, 9999] });
  const settings = useList<Row>('settings', { filters: [{ column: 'key', op: 'eq', value: 'health.thresholds' }] });
  const customers = useList<Row>('customers', { select: 'id,created_at,whatsapp,phone,name,trade_name', range: [0, 999] });
  const [level, setLevel] = useState<HealthLevel | ''>('');
  const thresholds = (settings.data?.rows[0]?.value as HealthThresholds) ?? DEFAULT_HEALTH_THRESHOLDS;

  const rows = useMemo(() => {
    const byCustomer = new Map<string, Row[]>();
    for (const o of orders.data?.rows ?? []) {
      if (['orcamento', 'aguardando_confirmacao', 'cancelado'].includes(String(o.status))) continue;
      const k = String(o.customer_id);
      byCustomer.set(k, [...(byCustomer.get(k) ?? []), o]);
    }
    const cmap = new Map((customers.data?.rows ?? []).map((c) => [String(c.id), c]));
    return (cons.data?.rows ?? [])
      .filter((c) => c.segment !== 'evento')
      .map((c) => {
        const cust = cmap.get(String(c.customer_id));
        const h = evaluateHealth({
          today: todaySP(), customerSince: String(cust?.created_at ?? c.customer_since).slice(0, 10),
          expectedLitersPerWeek: c.expected_liters_per_week ? Number(c.expected_liters_per_week) : null,
          orders: (byCustomer.get(String(c.customer_id)) ?? []).map((o) => ({ date: String(o.order_date), liters: Number(o.total_liters) }))
        }, thresholds);
        return { c, h, cust };
      })
      .sort((a, b) => a.h.score - b.h.score);
  }, [cons.data, orders.data, customers.data, thresholds]);

  const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.h.level]: (acc[r.h.level] ?? 0) + 1 }), {});
  const shown = level ? rows.filter((r) => r.h.level === level) : rows;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Saúde comercial dos pontos fixos" subtitle="Classificação automática configurável. Saúde comercial é independente da situação financeira. Nenhuma decisão de encerramento é tomada automaticamente." />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(Object.keys(HEALTH_LEVELS) as HealthLevel[]).map((l) => (
          <button key={l} onClick={() => setLevel(level === l ? '' : l)} aria-pressed={level === l} className={`card card-sm text-left transition ${level === l ? 'ring-2 ring-tangerine-700' : ''}`}>
            <HealthBadge level={l} />
            <p className="num mt-2 font-display text-2xl font-extrabold">{counts[l] ?? 0}</p>
          </button>
        ))}
      </div>
      {cons.isLoading || orders.isLoading ? <Card opaque><LoadingBlock /></Card> : cons.isError ? <ErrorState error={cons.error} /> : shown.length === 0 ? (
        <Card><EmptyState title="Nenhum ponto fixo nesta classificação" /></Card>
      ) : (
        <div className="surface overflow-x-auto rounded-[var(--radius-card)]">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-cocoa-700">
              <tr><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Classificação</th><th className="px-4 py-3 text-right">Litros 30d</th><th className="px-4 py-3 text-right">Meta/semana</th><th className="px-4 py-3">Último pedido</th><th className="px-4 py-3">Principal fator</th><th className="px-4 py-3">Ação</th></tr>
            </thead>
            <tbody>
              {shown.map(({ c, h, cust }) => (
                <tr key={String(c.customer_id)} className="border-t border-tangerine-100">
                  <td className="px-4 py-3"><Link className="font-semibold hover:underline" to={`/clientes/${c.customer_id}`}>{String(c.trade_name ?? c.name)}</Link><p className="text-xs text-cocoa-700">Equip.: {String(c.equipment_count)} · Total: {formatReais(c.total_purchased as number)}</p></td>
                  <td className="px-4 py-3"><HealthBadge level={h.level} /></td>
                  <td className="num px-4 py-3 text-right">{formatNumber(h.litersWindow)} L</td>
                  <td className="num px-4 py-3 text-right">{c.expected_liters_per_week ? `${formatNumber(Number(c.expected_liters_per_week))} L` : '—'}</td>
                  <td className="px-4 py-3">{formatDateBR(c.last_order_date as string)}</td>
                  <td className="max-w-xs px-4 py-3 text-cocoa-700">{h.factors.find((f) => f.impact === 'negativo')?.label ?? h.factors[0]?.label}</td>
                  <td className="px-4 py-3">{cust && (h.lowRotation || h.level === 'inativo') && <WhatsAppButton phone={String(cust.whatsapp ?? cust.phone ?? '')} templateKey={h.level === 'inativo' ? 'reativacao' : 'baixa_rotatividade'} values={{ NOME_CLIENTE: String(c.trade_name ?? c.name) }} customerId={String(c.customer_id)} refType="customer" refId={String(c.customer_id)} small />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-cocoa-700">Critérios atuais: excelente ≥ {thresholds.excellentRatio * 100}% da meta · saudável ≥ {thresholds.healthyRatio * 100}% · atenção ≥ {thresholds.attentionRatio * 100}% · inativo após {thresholds.inactiveDays} dias sem pedido · mínimo de {thresholds.minHistoryDays} dias de histórico. Ajuste em Configurações.</p>
    </div>
  );
}

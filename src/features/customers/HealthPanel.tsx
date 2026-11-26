import { useMemo } from 'react';
import { Badge } from '@/components/ui/Feedback';
import { DEFAULT_HEALTH_THRESHOLDS, evaluateHealth, HEALTH_LEVELS, type HealthLevel, type HealthResult, type HealthThresholds } from '@/domain/health';
import { todaySP } from '@/domain/dates';
import type { Tone } from '@/domain/collections';
import type { Row } from '@/data/types';

export const HEALTH_TONE: Record<HealthLevel, Tone> = { excelente: 'success', saudavel: 'success', atencao: 'warning', critico: 'danger', inativo: 'neutral', sem_historico: 'info' };

export function useHealth(customer: Row | null | undefined, orders: Row[], expectedLitersPerWeek: number | null, thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS, expectedIntervalDays?: number | null): HealthResult | null {
  return useMemo(() => {
    if (!customer) return null;
    return evaluateHealth({
      today: todaySP(),
      customerSince: String(customer.created_at).slice(0, 10),
      expectedLitersPerWeek,
      expectedIntervalDays,
      orders: orders.filter((o) => !['orcamento', 'aguardando_confirmacao', 'cancelado'].includes(String(o.status))).map((o) => ({ date: String(o.order_date), liters: Number(o.total_liters ?? 0) }))
    }, thresholds);
  }, [customer, orders, expectedLitersPerWeek, thresholds, expectedIntervalDays]);
}

export function HealthBadge({ level }: { level: HealthLevel }) {
  return <Badge tone={HEALTH_TONE[level]}>{HEALTH_LEVELS[level]}</Badge>;
}

export function HealthFactors({ h }: { h: HealthResult }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <HealthBadge level={h.level} />
        {h.lowRotation && <Badge tone="warning">Baixa rotatividade</Badge>}
        <span className="num text-sm text-cocoa-700">Pontuação {h.score}/100</span>
      </div>
      <ul className="space-y-1.5 text-sm">
        {h.factors.map((f) => (
          <li key={f.key} className="flex gap-2"><span aria-hidden>{f.impact === 'positivo' ? '🟢' : f.impact === 'negativo' ? '🔴' : '⚪'}</span><span><span className="sr-only">{f.impact}: </span>{f.label}</span></li>
        ))}
      </ul>
      {h.suggestions.length > 0 && (
        <div className="rounded-2xl bg-tangerine-100/60 p-3 text-sm">
          <p className="font-semibold">Sugestões (decisão humana):</p>
          <ul className="mt-1 list-disc pl-5">{h.suggestions.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

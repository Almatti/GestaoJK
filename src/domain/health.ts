/**
 * Saúde comercial de pontos fixos — independente da situação financeira.
 * Clientes sem histórico suficiente NÃO são classificados como críticos.
 */
export const HEALTH_LEVELS = {
  excelente: 'Excelente',
  saudavel: 'Saudável',
  atencao: 'Atenção',
  critico: 'Crítico',
  inativo: 'Inativo',
  sem_historico: 'Histórico insuficiente'
} as const;
export type HealthLevel = keyof typeof HEALTH_LEVELS;

export interface HealthThresholds {
  excellentRatio: number; // consumo/meta >= → excelente
  healthyRatio: number;
  attentionRatio: number; // abaixo → crítico
  inactiveDays: number; // dias sem pedido → inativo
  minHistoryDays: number; // dias desde o cadastro para avaliar
  minOrders: number;
  trendDropPercent: number; // queda relevante entre janelas
  windowDays: number; // janela de análise (ex.: 30)
}

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  excellentRatio: 1.1,
  healthyRatio: 0.85,
  attentionRatio: 0.5,
  inactiveDays: 60,
  minHistoryDays: 30,
  minOrders: 2,
  trendDropPercent: 30,
  windowDays: 30
};

export interface HealthInput {
  today: string;
  customerSince: string;
  /** Meta esperada em litros por semana (derivada de barris/semana × litragem quando aplicável). */
  expectedLitersPerWeek: number | null;
  orders: { date: string; liters: number; kegs?: number }[];
  expectedIntervalDays?: number | null;
}

export interface HealthFactor {
  key: string;
  label: string;
  impact: 'positivo' | 'neutro' | 'negativo';
}

export interface HealthResult {
  level: HealthLevel;
  score: number; // 0–100
  ratio: number | null;
  litersWindow: number;
  litersPrevWindow: number;
  trendPercent: number | null;
  daysSinceLastOrder: number | null;
  factors: HealthFactor[];
  suggestions: string[];
  lowRotation: boolean;
}

const dayMs = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / dayMs);

export function evaluateHealth(input: HealthInput, t: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS): HealthResult {
  const factors: HealthFactor[] = [];
  const suggestions: string[] = [];
  const sorted = [...input.orders].sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = sorted.at(-1);
  const daysSinceLast = last ? daysBetween(last.date, input.today) : null;
  const inWindow = (o: { date: string }, from: number, to: number) => {
    const age = daysBetween(o.date, input.today);
    return age >= from && age < to;
  };
  const litersWindow = sorted.filter((o) => inWindow(o, 0, t.windowDays)).reduce((s, o) => s + o.liters, 0);
  const litersPrev = sorted.filter((o) => inWindow(o, t.windowDays, t.windowDays * 2)).reduce((s, o) => s + o.liters, 0);
  const trend = litersPrev > 0 ? ((litersWindow - litersPrev) / litersPrev) * 100 : null;
  const historyDays = daysBetween(input.customerSince, input.today);

  const base = { litersWindow, litersPrevWindow: litersPrev, trendPercent: trend, daysSinceLastOrder: daysSinceLast };

  if (historyDays < t.minHistoryDays || sorted.length < t.minOrders) {
    if (daysSinceLast !== null && daysSinceLast > t.inactiveDays) {
      // ainda assim é inativo
    } else {
      factors.push({ key: 'historico', label: `Cliente com ${historyDays} dia(s) de cadastro e ${sorted.length} pedido(s): histórico insuficiente.`, impact: 'neutro' });
      return { ...base, level: 'sem_historico', score: 50, ratio: null, factors, suggestions: ['Acompanhar os primeiros pedidos.'], lowRotation: false };
    }
  }

  if (daysSinceLast === null || daysSinceLast > t.inactiveDays) {
    factors.push({ key: 'inatividade', label: daysSinceLast === null ? 'Nenhum pedido registrado.' : `${daysSinceLast} dias sem pedidos (limite ${t.inactiveDays}).`, impact: 'negativo' });
    suggestions.push('Contato comercial de reativação.', 'Avaliar recolhimento de equipamento.');
    return { ...base, level: 'inativo', score: 0, ratio: 0, factors, suggestions, lowRotation: true };
  }

  let ratio: number | null = null;
  if (input.expectedLitersPerWeek && input.expectedLitersPerWeek > 0) {
    const expectedWindow = (input.expectedLitersPerWeek / 7) * t.windowDays;
    ratio = litersWindow / expectedWindow;
    factors.push({
      key: 'meta',
      label: `Consumo de ${litersWindow.toFixed(0)} L em ${t.windowDays} dias vs. meta de ${expectedWindow.toFixed(0)} L (${(ratio * 100).toFixed(0)}%).`,
      impact: ratio >= t.healthyRatio ? 'positivo' : ratio >= t.attentionRatio ? 'neutro' : 'negativo'
    });
  } else {
    factors.push({ key: 'meta', label: 'Sem meta de consumo definida — classificação baseada em tendência e frequência.', impact: 'neutro' });
  }

  if (trend !== null) {
    factors.push({
      key: 'tendencia',
      label: `Tendência de ${trend >= 0 ? 'crescimento' : 'queda'} de ${Math.abs(trend).toFixed(0)}% vs. janela anterior.`,
      impact: trend <= -t.trendDropPercent ? 'negativo' : trend >= 10 ? 'positivo' : 'neutro'
    });
  }

  if (input.expectedIntervalDays && daysSinceLast > input.expectedIntervalDays * 1.5) {
    factors.push({ key: 'frequencia', label: `Último pedido há ${daysSinceLast} dias (esperado a cada ${input.expectedIntervalDays}).`, impact: 'negativo' });
  }

  let level: HealthLevel;
  if (ratio !== null) {
    level = ratio >= t.excellentRatio ? 'excelente' : ratio >= t.healthyRatio ? 'saudavel' : ratio >= t.attentionRatio ? 'atencao' : 'critico';
  } else {
    level = trend !== null && trend <= -t.trendDropPercent ? 'atencao' : 'saudavel';
  }
  const negatives = factors.filter((f) => f.impact === 'negativo').length;
  if (level === 'excelente' && negatives > 0) level = 'saudavel';
  if (level === 'saudavel' && negatives > 1) level = 'atencao';

  const lowRotation = ratio !== null && ratio < t.healthyRatio;
  if (lowRotation) suggestions.push('Contato comercial para entender a queda.', 'Revisar condições comerciais.');
  if (level === 'critico') suggestions.push('Agendar visita.', 'Avaliar renegociação ou recolhimento de equipamento (decisão humana).');
  if (trend !== null && trend <= -t.trendDropPercent) suggestions.push('Investigar queda de consumo.');

  const score = Math.max(0, Math.min(100, Math.round((ratio ?? 0.9) * 70 + (trend !== null ? Math.max(-30, Math.min(30, trend)) : 0) - negatives * 10)));
  return { ...base, level, score, ratio, factors, suggestions: [...new Set(suggestions)], lowRotation };
}

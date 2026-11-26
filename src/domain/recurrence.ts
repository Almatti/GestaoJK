/**
 * Expansão de recorrências (subconjunto RFC 5545: FREQ, INTERVAL, BYDAY, COUNT, UNTIL).
 * Suporta, por exemplo, reuniões toda terça (FREQ=WEEKLY;BYDAY=TU) e a cada 15 dias (FREQ=WEEKLY;INTERVAL=2).
 */
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export interface Rule { freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'; interval: number; byDay: number[]; count?: number; until?: string }

export function parseRRule(rule: string | null | undefined): Rule | null {
  if (!rule) return null;
  const parts = Object.fromEntries(rule.replace(/^RRULE:/, '').split(';').map((p) => p.split('=') as [string, string]));
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(parts.FREQ ?? '')) return null;
  return {
    freq: parts.FREQ as Rule['freq'],
    interval: Math.max(1, Number(parts.INTERVAL ?? 1)),
    byDay: (parts.BYDAY ?? '').split(',').filter(Boolean).map((d) => DAY_CODES.indexOf(d.slice(-2))).filter((d) => d >= 0),
    count: parts.COUNT ? Number(parts.COUNT) : undefined,
    until: parts.UNTIL ? `${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}` : undefined
  };
}

export function buildRRule(preset: string, startIso: string): string | null {
  const dow = DAY_CODES[new Date(startIso).getUTCDay()];
  switch (preset) {
    case 'diaria': return 'FREQ=DAILY';
    case 'semanal': return `FREQ=WEEKLY;BYDAY=${dow}`;
    case 'quinzenal': return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${dow}`;
    case 'mensal': return 'FREQ=MONTHLY';
    case 'anual': return 'FREQ=YEARLY';
    case 'dias_uteis': return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    default: return null;
  }
}

export function describeRRule(rule: string | null | undefined): string {
  const r = parseRRule(rule);
  if (!r) return 'Não se repete';
  const names = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  if (r.freq === 'DAILY') return r.interval > 1 ? `A cada ${r.interval} dias` : 'Diariamente';
  if (r.freq === 'WEEKLY') {
    const days = r.byDay.map((d) => names[d]).join(', ');
    return r.interval === 2 ? `Quinzenal (${days})` : r.interval > 1 ? `A cada ${r.interval} semanas (${days})` : `Toda(s) ${days}`;
  }
  if (r.freq === 'MONTHLY') return 'Mensalmente';
  return 'Anualmente';
}

const DAY = 86_400_000;

/** Ocorrências (início em ms) dentro de [from, to). Considera o dia da semana em UTC−3 (São Paulo). */
export function occurrences(startIso: string, rule: string | null | undefined, from: Date, to: Date, max = 500): Date[] {
  const start = new Date(startIso);
  const r = parseRRule(rule);
  if (!r) return start >= from && start < to ? [start] : [];
  const out: Date[] = [];
  const spDow = (d: Date) => new Date(d.getTime() - 3 * 3600_000).getUTCDay();
  const until = r.until ? new Date(`${r.until}T23:59:59-03:00`) : null;
  let n = 0;
  const push = (d: Date) => {
    if (until && d > until) return false;
    if (r.count !== undefined && n >= r.count) return false;
    n++;
    if (d >= from && d < to) out.push(d);
    return d < to && out.length < max;
  };
  if (r.freq === 'DAILY') {
    for (let d = start; ; d = new Date(d.getTime() + r.interval * DAY)) if (!push(d)) break;
  } else if (r.freq === 'WEEKLY') {
    const days = r.byDay.length ? r.byDay : [spDow(start)];
    const weekStart = new Date(start.getTime() - spDow(start) * DAY);
    for (let w = 0; ; w += r.interval) {
      let cont = true;
      for (const dow of [...days].sort()) {
        const d = new Date(weekStart.getTime() + (w * 7 + dow) * DAY);
        if (d < start) continue;
        if (!push(d)) { cont = false; break; }
      }
      if (!cont || w > 5000) break;
    }
  } else {
    for (let i = 0; i < 2000; i += r.interval) {
      const d = new Date(start);
      if (r.freq === 'MONTHLY') d.setUTCMonth(start.getUTCMonth() + i);
      else d.setUTCFullYear(start.getUTCFullYear() + i);
      if (!push(d)) break;
    }
  }
  return out;
}

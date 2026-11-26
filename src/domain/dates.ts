/**
 * Datas comerciais tratadas no fuso America/Sao_Paulo. Datas "de calendário" (vencimento, entrega)
 * são strings ISO 'AAAA-MM-DD' para evitar deslocamentos de fuso.
 */
export const TIME_ZONE = 'America/Sao_Paulo';
export type ISODate = string; // 'YYYY-MM-DD'

const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Data de hoje em São Paulo (YYYY-MM-DD). */
export function todaySP(now: Date = new Date()): ISODate {
  return ymd.format(now);
}

export function toISODateSP(d: Date): ISODate {
  return ymd.format(d);
}

function parse(d: ISODate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, day!));
}
function fmt(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: ISODate, days: number): ISODate {
  const dt = parse(d);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fmt(dt);
}

export function addMonths(d: ISODate, months: number): ISODate {
  const dt = parse(d);
  const day = dt.getUTCDate();
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + months);
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, last));
  return fmt(dt);
}

/** Diferença em dias de calendário (b − a). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
}

export function weekday(d: ISODate): number {
  return parse(d).getUTCDay(); // 0 = domingo
}

export function isWeekend(d: ISODate): boolean {
  const w = weekday(d);
  return w === 0 || w === 6;
}

export function isBusinessDay(d: ISODate, holidays: ReadonlySet<string> = new Set()): boolean {
  return !isWeekend(d) && !holidays.has(d);
}

export function nextBusinessDay(d: ISODate, holidays: ReadonlySet<string> = new Set()): ISODate {
  let cur = d;
  while (!isBusinessDay(cur, holidays)) cur = addDays(cur, 1);
  return cur;
}

export function addBusinessDays(d: ISODate, n: number, holidays: ReadonlySet<string> = new Set()): ISODate {
  let cur = d;
  let left = n;
  while (left > 0) {
    cur = addDays(cur, 1);
    if (isBusinessDay(cur, holidays)) left--;
  }
  return cur;
}

/** DD/MM/AAAA */
export function formatDateBR(d: ISODate | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});
export function formatDateTimeBR(ts: string | Date | null | undefined): string {
  if (!ts) return '—';
  return dateTimeFmt.format(typeof ts === 'string' ? new Date(ts) : ts).replace(',', '');
}

/** Converte DD/MM/AAAA → AAAA-MM-DD (ou null se inválida). */
export function parseDateBR(v: string): ISODate | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return fmt(parse(iso)) === iso ? iso : null;
}

export type PeriodPreset = 'hoje' | 'semana' | 'mes' | 'trimestre' | 'semestre' | 'ano' | 'personalizado';

export interface Period {
  start: ISODate;
  end: ISODate;
}

export function periodFor(preset: PeriodPreset, today: ISODate = todaySP(), custom?: Period): Period {
  const [y, m] = today.split('-').map(Number) as [number, number];
  switch (preset) {
    case 'hoje':
      return { start: today, end: today };
    case 'semana': {
      const w = weekday(today);
      const start = addDays(today, -((w + 6) % 7)); // segunda-feira
      return { start, end: addDays(start, 6) };
    }
    case 'mes':
      return { start: `${y}-${String(m).padStart(2, '0')}-01`, end: addDays(addMonths(`${y}-${String(m).padStart(2, '0')}-01`, 1), -1) };
    case 'trimestre': {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      const start = `${y}-${String(qm).padStart(2, '0')}-01`;
      return { start, end: addDays(addMonths(start, 3), -1) };
    }
    case 'semestre': {
      const start = m <= 6 ? `${y}-01-01` : `${y}-07-01`;
      return { start, end: addDays(addMonths(start, 6), -1) };
    }
    case 'ano':
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    case 'personalizado':
      return custom ?? { start: today, end: today };
  }
}

/** Período imediatamente anterior, de mesma duração. */
export function previousPeriod(p: Period): Period {
  const len = diffDays(p.start, p.end) + 1;
  return { start: addDays(p.start, -len), end: addDays(p.start, -1) };
}

/** ISO (UTC) → 'YYYY-MM-DDTHH:mm' no horário de São Paulo (para <input type="datetime-local">). */
export function toSPLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(iso))
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
}

/** 'YYYY-MM-DDTHH:mm' digitado em São Paulo → ISO com offset (Brasil sem horário de verão desde 2019: −03:00). */
export function fromSPLocalInput(local: string | null | undefined): string | null {
  if (!local) return null;
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(local)) return local;
  return new Date(`${local.length === 16 ? `${local}:00` : local}-03:00`).toISOString();
}

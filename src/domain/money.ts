/**
 * Dinheiro é manipulado em CENTAVOS inteiros no frontend e em NUMERIC no banco.
 * Nunca use ponto flutuante para persistir valores. Arredondamento: meio para longe do zero.
 */
export type Cents = number;

export function roundHalfAwayFromZero(value: number): number {
  const sign = value < 0 ? -1 : 1;
  // toPrecision corrige ruído binário (ex.: 1.005 * 100 = 100.49999...)
  return sign * Math.round(Number(Math.abs(value).toPrecision(12)));
}

/** Converte reais (number ou string decimal "123.45" / "123,45") para centavos inteiros. */
export function toCents(value: number | string | null | undefined): Cents {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return roundHalfAwayFromZero(value * 100);
  const normalized = value.trim().replace(/\s|R\$/g, '');
  const decimal = normalized.includes(',') ? normalized.replace(/\./g, '').replace(',', '.') : normalized;
  const parsed = Number(decimal);
  if (!Number.isFinite(parsed)) throw new Error(`Valor monetário inválido: ${value}`);
  // Usa aritmética de string para evitar erros de ponto flutuante
  const [intPart = '0', fracPart = ''] = decimal.replace('-', '').split('.');
  const frac = (fracPart + '000').slice(0, 3);
  let cents = Number(intPart) * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1;
  return decimal.startsWith('-') ? -cents : cents;
}

/** Centavos -> string decimal com 2 casas, formato aceito pelo PostgreSQL NUMERIC. */
export function centsToDecimal(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function fromCents(cents: Cents): number {
  return Number(centsToDecimal(cents));
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export function formatBRL(cents: Cents): string {
  return brl.format(cents / 100);
}

/** Formata valor em reais vindo do banco (string NUMERIC ou number). */
export function formatReais(value: number | string | null | undefined): string {
  return formatBRL(toCents(value ?? 0));
}

/** Multiplica centavos por fator (ex.: litros, percentual) com arredondamento correto. */
export function mulCents(cents: Cents, factor: number): Cents {
  return roundHalfAwayFromZero(cents * factor);
}

export function percentOf(cents: Cents, percent: number): Cents {
  return roundHalfAwayFromZero((cents * percent) / 100);
}

export function sumCents(values: Cents[]): Cents {
  return values.reduce((acc, v) => acc + v, 0);
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

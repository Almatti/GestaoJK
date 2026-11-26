import { formatReais, formatNumber, formatPercent } from '@/domain/money';
import { formatDateBR, formatDateTimeBR } from '@/domain/dates';

export type CellFormat = 'money' | 'date' | 'datetime' | 'number' | 'liters' | 'percent' | 'boolean' | 'text';

export function formatCell(value: unknown, format: CellFormat = 'text'): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (format) {
    case 'money': return formatReais(value as number);
    case 'date': return formatDateBR(String(value));
    case 'datetime': return formatDateTimeBR(String(value));
    case 'number': return formatNumber(Number(value), Number.isInteger(Number(value)) ? 0 : 2);
    case 'liters': return `${formatNumber(Number(value), 0)} L`;
    case 'percent': return formatPercent(Number(value));
    case 'boolean': return value ? 'Sim' : 'Não';
    default: return Array.isArray(value) ? value.join(', ') : String(value);
  }
}

export const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

import type { ReactNode } from 'react';
import type { Resource } from '@/domain/permissions';
import type { CellFormat } from '@/lib/format';
import type { Filter, Row } from '@/data/types';
import type { Tone } from '@/domain/collections';

export type FieldType = 'text' | 'textarea' | 'number' | 'money' | 'percent' | 'date' | 'datetime' | 'time' | 'boolean' | 'select' | 'ref' | 'email' | 'phone' | 'tags' | 'json' | 'color';

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  ref?: { table: string; label: string; filters?: Filter[]; valueColumn?: string };
  help?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  wide?: boolean;
  defaultValue?: unknown;
  /** Validação extra: retorna mensagem de erro ou null. */
  validate?: (value: unknown, all: Row) => string | null;
}

export interface ColumnDef {
  key: string;
  label: string;
  format?: CellFormat;
  render?: (row: Row) => ReactNode;
  align?: 'right' | 'left';
  sortable?: boolean;
  /** Valor para exportação quando há render customizado. */
  exportValue?: (row: Row) => unknown;
  hideOnMobile?: boolean;
}

export interface StatusMap {
  column: string;
  map: Record<string, { label: string; tone: Tone }>;
}

export interface ResourceDef {
  table: string;
  title: string;
  singular: string;
  subtitle?: string;
  resource: Resource;
  idColumn?: string;
  select?: string;
  fields: FieldDef[];
  columns: ColumnDef[];
  searchColumns: string[];
  defaultOrder?: { column: string; ascending?: boolean }[];
  baseFilters?: Filter[];
  filters?: { column: string; label: string; options: { value: string; label: string }[] }[];
  status?: StatusMap;
  archive?: { column: string; value: unknown; activeValue: unknown };
  /** Rascunhos locais permitidos (apenas recursos sem dados sensíveis). */
  draft?: boolean;
  cardTitle?: (row: Row) => ReactNode;
  cardSubtitle?: (row: Row) => ReactNode;
  rowLink?: (row: Row) => string;
  rowActions?: (row: Row) => ReactNode;
  emptyHint?: string;
  beforeSave?: (values: Row, isNew: boolean) => Row;
  allowDelete?: boolean;
  /** Formulário especializado no lugar do genérico. */
  renderForm?: (props: { row: Row | null; open: boolean; onClose: () => void }) => ReactNode;
}

import { z } from 'zod';
import { isValidEmail, isValidPhoneBR } from '@/domain/documents';
import type { FieldDef } from './types';
import type { Row } from '@/data/types';
import { fromSPLocalInput, toSPLocalInput } from '@/domain/dates';

/** Gera o schema Zod a partir das definições de campos (validação no cliente; o banco valida novamente). */
export function buildSchema(fields: FieldDef[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    let s: z.ZodTypeAny;
    switch (f.type) {
      case 'number':
      case 'money':
      case 'percent': {
        let n = z.coerce.number({ message: 'Informe um número válido' });
        if (f.min !== undefined) n = n.min(f.min, `Mínimo ${f.min}`);
        if (f.max !== undefined) n = n.max(f.max, `Máximo ${f.max}`);
        s = f.required ? n : z.union([z.literal('').transform(() => null), z.null(), n]).optional();
        break;
      }
      case 'boolean':
        s = z.boolean().optional();
        break;
      case 'tags':
      case 'json':
        s = z.any();
        break;
      case 'email':
        s = f.required
          ? z.string().trim().refine(isValidEmail, 'E-mail inválido')
          : z.string().trim().refine((v) => !v || isValidEmail(v), 'E-mail inválido').optional().nullable();
        break;
      case 'phone':
        s = f.required
          ? z.string().trim().refine(isValidPhoneBR, 'Telefone inválido (DDD + número)')
          : z.string().trim().refine((v) => !v || isValidPhoneBR(v), 'Telefone inválido (DDD + número)').optional().nullable();
        break;
      default:
        s = f.required ? z.string({ message: 'Campo obrigatório' }).trim().min(1, 'Campo obrigatório') : z.string().optional().nullable();
    }
    shape[f.name] = s;
  }
  return z.object(shape).passthrough().superRefine((all, ctx) => {
    for (const f of fields) {
      const msg = f.validate?.((all as Row)[f.name], all as Row);
      if (msg) ctx.addIssue({ code: 'custom', path: [f.name], message: msg });
    }
  });
}

/** Converte valores do formulário para o formato do banco (strings vazias → null, tags → array). */
export function toDbValues(fields: FieldDef[], values: Row): Row {
  const out: Row = {};
  for (const f of fields) {
    let v = values[f.name];
    if (v === '' || v === undefined) v = null;
    if (f.type === 'tags' && typeof v === 'string') v = v.split(',').map((s) => s.trim()).filter(Boolean);
    if (f.type === 'json' && typeof v === 'string') {
      try {
        v = v.trim() ? JSON.parse(v) : null;
      } catch {
        throw new Error(`"${f.label}" não é um JSON válido`);
      }
    }
    if ((f.type === 'number' || f.type === 'money' || f.type === 'percent') && v !== null) v = Number(v);
    if (f.type === 'boolean') v = Boolean(v);
    if (f.type === 'datetime' && typeof v === 'string') v = fromSPLocalInput(v);
    out[f.name] = v;
  }
  return out;
}

export function toFormValues(fields: FieldDef[], row: Row | null): Row {
  const out: Row = {};
  for (const f of fields) {
    let v = row ? row[f.name] : f.defaultValue;
    if (f.type === 'tags' && Array.isArray(v)) v = v.join(', ');
    if (f.type === 'json' && v && typeof v === 'object') v = JSON.stringify(v, null, 2);
    if (f.type === 'datetime' && typeof v === 'string') v = toSPLocalInput(v);
    if (f.type === 'boolean') v = Boolean(v ?? f.defaultValue ?? false);
    out[f.name] = v ?? (f.type === 'boolean' ? false : '');
  }
  return out;
}

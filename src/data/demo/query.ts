/** Mini motor de consultas compatível com o subconjunto PostgREST usado pela aplicação. */
import type { Filter, ListOptions, Row } from '../types';

const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function matchFilter(row: Row, f: Filter): boolean {
  const v = row[f.column];
  switch (f.op) {
    case 'eq': return String(v) === String(f.value);
    case 'neq': return String(v) !== String(f.value);
    case 'gt': return (v as number | string) > (f.value as number | string);
    case 'gte': return (v as number | string) >= (f.value as number | string);
    case 'lt': return (v as number | string) < (f.value as number | string);
    case 'lte': return (v as number | string) <= (f.value as number | string);
    case 'in': return (f.value as unknown[]).map(String).includes(String(v));
    case 'not_in': return !(f.value as unknown[]).map(String).includes(String(v));
    case 'is': return f.value === null ? v === null || v === undefined : v === f.value;
    case 'ilike': return norm(v).includes(norm(String(f.value).replace(/%/g, '')));
  }
}

/** Divide a string de select no nível superior (ignorando vírgulas dentro de parênteses). */
function splitTop(select: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of select) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function applySelect(rows: Row[], select: string | undefined, resolve: (table: string) => Row[]): Row[] {
  if (!select || select === '*') return rows;
  const parts = splitTop(select);
  const embeds = parts
    .map((p) => /^(\w+):(\w+)(?:!\w+)?\((.*)\)$/.exec(p))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ alias: m[1]!, table: m[2]!, cols: m[3]! }));
  const plain = parts.filter((p) => !p.includes('('));
  return rows.map((r) => {
    const base: Row = plain.includes('*') ? { ...r } : Object.fromEntries(plain.map((c) => [c, r[c]]));
    for (const e of embeds) {
      const fk = r[`${e.alias}_id`];
      const target = fk ? resolve(e.table).find((x) => String(x.id) === String(fk)) : undefined;
      base[e.alias] = target ? applySelect([target], e.cols, resolve)[0] : null;
    }
    return base;
  });
}

export function runQuery(rows: Row[], opts: ListOptions, resolve: (table: string) => Row[]) {
  let out = rows.filter((r) => (opts.filters ?? []).every((f) => f.value === undefined || f.value === '' || matchFilter(r, f)));
  if (opts.search?.term.trim()) {
    const term = norm(opts.search.term.trim());
    out = out.filter((r) => opts.search!.columns.some((c) => norm(r[c]).includes(term)));
  }
  for (const o of [...(opts.order ?? [])].reverse()) {
    out = [...out].sort((a, b) => {
      const av = a[o.column] as string | number | null;
      const bv = b[o.column] as string | number | null;
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = av < bv ? -1 : 1;
      return o.ascending === false ? -cmp : cmp;
    });
  }
  const count = out.length;
  if (opts.range) out = out.slice(opts.range[0], opts.range[1] + 1);
  return { rows: applySelect(out, opts.select, resolve), count };
}

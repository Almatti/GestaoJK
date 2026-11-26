/**
 * Normalização da resposta "office" da CNPJá (https://cnpja.com/api — GET /office/:taxId, comercial ou aberta).
 * Arquivo PURO (sem APIs do Deno): usado pela Edge Function cnpj-lookup e testado no Vitest.
 */
export interface CnpjData {
  taxId: string;
  legalName: string;
  tradeName: string;
  status: string;
  statusDate: string | null;
  founded: string | null;
  head: boolean | null;
  nature: string;
  size: string;
  equity: number | null;
  simples: boolean | null;
  simei: boolean | null;
  mainActivity: { code: string; text: string } | null;
  sideActivities: { code: string; text: string }[];
  cep: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  phone: string;
  phones: string[];
  email: string;
  emails: string[];
  stateRegistration: string;
  registrations: { number: string; state: string; enabled: boolean; status: string; type: string }[];
  members: { name: string; role: string; since: string | null }[];
  sourceUpdated: string | null;
  stale: boolean;
}

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === 'object' ? (v as J) : {});
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
const str = (v: unknown): string => (v == null ? '' : String(v));
const txt = (v: unknown): string => str(obj(v).text);

export function normalizeCnpjaOffice(raw: unknown): CnpjData {
  const j = obj(raw);
  const company = obj(j.company);
  const address = obj(j.address);
  const phones = arr(j.phones).map((p) => `${str(p.area)}${str(p.number)}`).filter(Boolean);
  const emails = arr(j.emails).map((e) => str(e.address)).filter(Boolean);
  const regs = arr(j.registrations).map((r) => ({ number: str(r.number), state: str(r.state), enabled: Boolean(r.enabled), status: txt(r.status), type: txt(r.type) }));
  const state = str(address.state);
  const activeReg = regs.find((r) => r.enabled && r.state === state) ?? regs.find((r) => r.enabled);
  const act = (a: J) => ({ code: str(a.id), text: str(a.text) });
  const simples = obj(company.simples);
  const simei = obj(company.simei);
  return {
    taxId: str(j.taxId),
    legalName: str(company.name),
    tradeName: str(j.alias),
    status: txt(j.status),
    statusDate: str(j.statusDate) || null,
    founded: str(j.founded) || null,
    head: typeof j.head === 'boolean' ? j.head : null,
    nature: txt(company.nature),
    size: txt(company.size),
    equity: typeof company.equity === 'number' ? company.equity : null,
    simples: typeof simples.optant === 'boolean' ? simples.optant : null,
    simei: typeof simei.optant === 'boolean' ? simei.optant : null,
    mainActivity: j.mainActivity ? act(obj(j.mainActivity)) : null,
    sideActivities: arr(j.sideActivities).map(act),
    cep: str(address.zip),
    street: str(address.street),
    number: str(address.number),
    complement: str(address.details),
    district: str(address.district),
    city: str(address.city),
    state,
    phone: phones[0] ?? '',
    phones,
    email: emails[0] ?? '',
    emails,
    stateRegistration: activeReg?.number ?? '',
    registrations: regs,
    // Somente nome e qualificação dos sócios (dados públicos); CPFs não são armazenados.
    members: arr(company.members).map((m) => ({ name: str(obj(m.person).name), role: txt(m.role), since: str(m.since) || null })),
    sourceUpdated: str(j.updated) || null,
    stale: j.stale === true
  };
}

/** Parâmetros da consulta comercial conforme as configurações (cache para economizar créditos). */
export function cnpjaQuery(opts: { maxAgeDays: number; simples: boolean; registrations: boolean; refresh?: boolean }): string {
  const p = new URLSearchParams({ strategy: 'CACHE_IF_ERROR', maxAge: String(opts.refresh ? 1 : Math.min(3650, Math.max(1, Math.round(opts.maxAgeDays)))), maxStale: '365' });
  if (opts.simples) p.set('simples', 'true');
  if (opts.registrations) p.set('registrations', 'ORIGIN');
  return p.toString();
}

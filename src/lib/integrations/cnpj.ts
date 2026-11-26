/**
 * Consulta de dados cadastrais de empresas (CNPJ). CPF NUNCA é enviado.
 * - Com o servidor (Supabase): Edge Function `cnpj-lookup` → CNPJá (API comercial com a chave guardada no servidor,
 *   ou API aberta da CNPJá enquanto a chave não estiver configurada). Dados em tempo real com cache configurável.
 * - Modo local/demonstração: BrasilAPI (https://brasilapi.com.br), que redistribui dados públicos da Receita.
 * A fonte e a data de cada consulta são registradas (customer_verifications / company.registry_checked_at).
 */
import { normalizeCnpj } from '@/domain/documents';
import { db } from '@/data/hooks';
import { normalizeCnpjaOffice, type CnpjData } from '../../../supabase/functions/_shared/cnpja';

export type { CnpjData };
export { normalizeCnpjaOffice };

export const CNPJ_SOURCE = 'BrasilAPI (dados públicos da Receita Federal)';

export interface CnpjLookup {
  found: boolean;
  source: string;
  checkedAt: string;
  /** true quando a fonte consultou inscrições estaduais (API comercial). */
  registrationsChecked?: boolean;
  data?: CnpjData;
}

/** Texto da situação da inscrição estadual para exibir ao usuário. */
export function stateRegistrationInfo(r: Pick<CnpjLookup, 'registrationsChecked'>, d: CnpjData): string {
  if (!r.registrationsChecked) return 'IE não consultada (requer a chave da API comercial CNPJá)';
  if (d.stateRegistration) return `IE ${d.stateRegistration}${d.state ? `/${d.state}` : ''}`;
  if (d.registrations.length) return `Sem IE ativa (${d.registrations.map((x) => `${x.number}/${x.state}: ${x.status || (x.enabled ? 'ativa' : 'inativa')}`).join('; ')})`;
  return 'Sem inscrição estadual na UF (contribuinte isento ou não inscrito)';
}

/** Consulta pública via BrasilAPI (usada sem servidor). */
export async function lookupCnpjBrasilApi(cnpj: string, fetcher: typeof fetch = fetch): Promise<CnpjData | null> {
  const c = normalizeCnpj(cnpj);
  const res = await fetcher(`https://brasilapi.com.br/api/cnpj/v1/${c}`, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Consulta indisponível (HTTP ${res.status})`);
  const j = (await res.json()) as Record<string, unknown>;
  const s = (k: string) => (j[k] == null ? '' : String(j[k]));
  const phone = s('ddd_telefone_1');
  const email = s('email');
  return {
    ...normalizeCnpjaOffice({}),
    taxId: c, legalName: s('razao_social'), tradeName: s('nome_fantasia'), status: s('descricao_situacao_cadastral'),
    founded: s('data_inicio_atividade') || null, nature: s('natureza_juridica'), size: s('porte'),
    mainActivity: j.cnae_fiscal ? { code: s('cnae_fiscal'), text: s('cnae_fiscal_descricao') } : null,
    cep: s('cep'), street: [s('descricao_tipo_de_logradouro'), s('logradouro')].filter(Boolean).join(' '), number: s('numero'),
    complement: s('complemento'), district: s('bairro'), city: s('municipio'), state: s('uf'),
    phone, phones: phone ? [phone] : [], email, emails: email ? [email] : []
  };
}

/** Consulta o CNPJ pela melhor fonte disponível no modo atual. */
export async function lookupCompany(cnpj: string, opts: { purpose?: 'customer' | 'company'; refresh?: boolean } = {}): Promise<CnpjLookup> {
  if (db().mode === 'supabase') {
    return db().invoke<CnpjLookup>('cnpj-lookup', { cnpj: normalizeCnpj(cnpj), purpose: opts.purpose ?? 'customer', refresh: opts.refresh === true });
  }
  const data = await lookupCnpjBrasilApi(cnpj);
  return { found: !!data, source: CNPJ_SOURCE, checkedAt: new Date().toISOString(), registrationsChecked: false, data: data ?? undefined };
}

/** Resumo enxuto guardado junto do cadastro (sem CPFs). */
export function companySnapshot(d: CnpjData, source: string, checkedAt: string, registrationsChecked = false) {
  return {
    source, checked_at: checkedAt, registrations_checked: registrationsChecked, source_updated: d.sourceUpdated, stale: d.stale, status: d.status, status_date: d.statusDate,
    founded: d.founded, head: d.head, nature: d.nature, size: d.size, equity: d.equity, simples: d.simples, simei: d.simei,
    main_activity: d.mainActivity, side_activities: d.sideActivities, phones: d.phones, emails: d.emails,
    registrations: d.registrations, members: d.members
  };
}

/** Converte um número de telefone em formato legível (DDD + número). */
export function formatPhoneBR(p: string): string {
  const d = p.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p;
}

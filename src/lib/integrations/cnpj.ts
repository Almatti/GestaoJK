/**
 * Consulta de dados cadastrais de empresas via BrasilAPI (https://brasilapi.com.br), que redistribui dados
 * PÚBLICOS da Receita Federal. Não substitui consulta oficial (Serpro/RFB). CPF NUNCA é enviado.
 * A fonte e a data de cada consulta são registradas em customer_verifications.
 */
import { normalizeCnpj } from '@/domain/documents';

export const CNPJ_SOURCE = 'BrasilAPI (dados públicos da Receita Federal)';

export interface CnpjResult {
  legalName: string; tradeName: string; status: string; cep: string; street: string; number: string; complement: string;
  district: string; city: string; state: string; phone: string; email: string;
}

export async function lookupCnpj(cnpj: string, fetcher: typeof fetch = fetch): Promise<CnpjResult | null> {
  const c = normalizeCnpj(cnpj);
  const res = await fetcher(`https://brasilapi.com.br/api/cnpj/v1/${c}`, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Consulta indisponível (HTTP ${res.status})`);
  const j = (await res.json()) as Record<string, unknown>;
  const s = (k: string) => (j[k] == null ? '' : String(j[k]));
  return {
    legalName: s('razao_social'), tradeName: s('nome_fantasia'), status: s('descricao_situacao_cadastral'), cep: s('cep'),
    street: [s('descricao_tipo_de_logradouro'), s('logradouro')].filter(Boolean).join(' '), number: s('numero'), complement: s('complemento'),
    district: s('bairro'), city: s('municipio'), state: s('uf'), phone: s('ddd_telefone_1'), email: s('email')
  };
}

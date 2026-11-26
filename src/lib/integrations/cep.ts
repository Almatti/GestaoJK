/** Consulta de CEP via ViaCEP (serviço público e gratuito: https://viacep.com.br). Falha não bloqueia o cadastro. */
import { onlyDigits } from '@/domain/documents';

export interface CepResult { street: string; district: string; city: string; state: string; complement: string }

export async function lookupCep(cep: string, fetcher: typeof fetch = fetch): Promise<CepResult | null> {
  const d = onlyDigits(cep);
  if (d.length !== 8) return null;
  const res = await fetcher(`https://viacep.com.br/ws/${d}/json/`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Consulta de CEP indisponível');
  const j = (await res.json()) as Record<string, string | boolean>;
  if (j.erro) return null;
  return { street: String(j.logradouro ?? ''), district: String(j.bairro ?? ''), city: String(j.localidade ?? ''), state: String(j.uf ?? ''), complement: String(j.complemento ?? '') };
}

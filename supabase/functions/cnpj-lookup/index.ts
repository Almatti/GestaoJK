/**
 * Consulta de CNPJ em tempo real pela CNPJá (https://cnpja.com/api).
 * - Com o segredo CNPJA_API_KEY: API comercial (Receita Federal + Simples/MEI + inscrição estadual), com cache
 *   configurável (settings cnpj.*) para economizar créditos.
 * - Sem a chave: API aberta da CNPJá (gratuita, limitada a poucas consultas por minuto, somente Receita Federal).
 * A chave NUNCA vai ao navegador. CPF nunca é consultado. O documento não é registrado em log.
 */
import { adminClient, handle, HttpError, json, requirePerm } from '../_shared/http.ts';
import { cnpjaQuery, normalizeCnpjaOffice } from '../_shared/cnpja.ts';

const CNPJ_RE = /^[0-9A-Z]{12}\d{2}$/;

Deno.serve(handle(async (req) => {
  const { cnpj, purpose, refresh } = await req.json();
  // Cadastro de clientes exige permissão em clientes; dados da empresa exigem administração.
  await requirePerm(req, purpose === 'company' ? 'admin' : 'clientes', purpose === 'company' ? 'edit' : 'view');
  const taxId = String(cnpj ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!CNPJ_RE.test(taxId)) throw new HttpError(400, 'CNPJ inválido');

  const admin = adminClient();
  const { data: rows } = await admin.from('settings').select('key,value').in('key', ['cnpj.max_age_days', 'cnpj.include_simples', 'cnpj.include_registrations']);
  const cfg = Object.fromEntries((rows ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  const key = Deno.env.get('CNPJA_API_KEY');

  const url = key
    ? `https://api.cnpja.com/office/${taxId}?${cnpjaQuery({ maxAgeDays: Number(cfg['cnpj.max_age_days'] ?? 30), simples: cfg['cnpj.include_simples'] !== false, registrations: cfg['cnpj.include_registrations'] !== false, refresh: refresh === true })}`
    : `https://open.cnpja.com/office/${taxId}`;
  const res = await fetch(url, { headers: key ? { Authorization: key, Accept: 'application/json' } : { Accept: 'application/json' } });

  if (res.status === 404) return json({ found: false });
  if (res.status === 401) throw new HttpError(502, 'Chave da CNPJá inválida — verifique o segredo CNPJA_API_KEY');
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    throw new HttpError(429, (body as { message?: string }).message === 'not enough credits' ? 'Créditos da CNPJá esgotados' : 'Limite de consultas por minuto da CNPJá atingido — tente em instantes');
  }
  if (!res.ok) throw new HttpError(502, `Consulta de CNPJ indisponível (HTTP ${res.status})`);

  const data = normalizeCnpjaOffice(await res.json());
  await admin.from('integrations').update({ status: 'conectada', last_sync_at: new Date().toISOString(), last_error: null }).eq('provider', 'cnpja');
  return json({
    found: true,
    source: key ? 'CNPJá — API comercial (Receita Federal, Simples Nacional, CCC)' : 'CNPJá — API aberta (Receita Federal)',
    checkedAt: new Date().toISOString(),
    // Inscrição estadual só vem da API comercial (CCC/SINTEGRA); a API aberta não informa IE.
    registrationsChecked: !!key && cfg['cnpj.include_registrations'] !== false,
    data
  });
}));

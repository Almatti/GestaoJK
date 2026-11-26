// Utilitários compartilhados das Edge Functions (Deno).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * Origens permitidas (CORS). APP_ORIGIN aceita uma ou mais URLs separadas por vírgula. Além delas, aceita os
 * endereços da Vercel deste projeto (domínio de produção e versões de teste), definidos em VERCEL_ORIGIN_PATTERN.
 * Observação: CORS não substitui a autenticação — toda função exige JWT e verifica permissão no banco.
 */
const ORIGINS = (Deno.env.get('APP_ORIGIN') ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const PATTERN = new RegExp(Deno.env.get('VERCEL_ORIGIN_PATTERN') ?? '^https://gestaojk(-[a-z0-9]+)*\\.vercel\\.app$');

export function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (ORIGINS.length === 0) return '*';
  return ORIGINS.includes(origin) || PATTERN.test(origin) ? origin : null;
}

export const cors: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin'
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
}

/** Cliente com o JWT do chamador: todas as consultas respeitam RLS. */
export function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false }
  });
}

export async function requirePerm(req: Request, resource: string, action = 'view'): Promise<{ client: SupabaseClient; userId: string }> {
  const client = userClient(req);
  const { data: u } = await client.auth.getUser();
  if (!u.user) throw new HttpError(401, 'Não autenticado');
  const { data: ok, error } = await client.rpc('has_perm', { p_resource: resource, p_action: action });
  if (error || !ok) throw new HttpError(403, 'Permissão negada');
  return { client, userId: u.user.id };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function withOrigin(res: Response, origin: string | null): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) if (!headers.has(k)) headers.set(k, v);
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    const origin = allowedOrigin(req.headers.get('Origin'));
    if (req.method === 'OPTIONS') return withOrigin(new Response('ok'), origin);
    try {
      return withOrigin(await fn(req), origin);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      // Nunca registrar segredos ou payloads completos.
      console.error(`[${status}]`, e instanceof Error ? e.message : 'erro');
      return withOrigin(json({ error: e instanceof Error ? e.message : 'Erro interno' }, status), origin);
    }
  };
}

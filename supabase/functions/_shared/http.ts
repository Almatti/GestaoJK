// Utilitários compartilhados das Edge Functions (Deno).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_ORIGIN = Deno.env.get('APP_ORIGIN') ?? '*';
export const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
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

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    try {
      return await fn(req);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      // Nunca registrar segredos ou payloads completos.
      console.error(`[${status}]`, e instanceof Error ? e.message : 'erro');
      return json({ error: e instanceof Error ? e.message : 'Erro interno' }, status);
    }
  };
}

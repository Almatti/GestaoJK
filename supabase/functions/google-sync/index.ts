/**
 * Integração Google Agenda + Google Tasks (OAuth 2.0 — https://developers.google.com/identity/protocols/oauth2/web-server).
 * Política: sincronização UNIDIRECIONAL (sistema → Google) para evitar ciclos. Identificadores externos e hash
 * do conteúdo evitam duplicidades. Compromissos financeiros (cobrança/pagamento) NÃO são enviados ao Google.
 * Segredos: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_STATE_SECRET (Edge Function secrets).
 */
import { adminClient, cors, handle, HttpError, json, requirePerm } from '../_shared/http.ts';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/tasks'];
const SKIP_KINDS = new Set(['cobranca', 'pagamento']);

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new HttpError(503, `${k} não configurado`);
  return v;
};
const callbackUrl = () => `${env('SUPABASE_URL')}/functions/v1/google-sync`;

async function hmac(data: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env('GOOGLE_STATE_SECRET')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, '');
}
async function sha(data: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function accessToken(admin: ReturnType<typeof adminClient>): Promise<string> {
  const { data } = await admin.from('integration_secrets').select('data').eq('provider', 'google_calendar').maybeSingle();
  const refresh = data?.data?.refresh_token;
  if (!refresh) throw new HttpError(400, 'Conta Google não conectada');
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), refresh_token: refresh, grant_type: 'refresh_token' }) });
  if (!res.ok) throw new HttpError(502, 'Falha ao renovar token do Google');
  return (await res.json()).access_token;
}

async function setStatus(admin: ReturnType<typeof adminClient>, status: string, error: string | null = null) {
  await admin.from('integrations').update({ status, last_error: error, updated_at: new Date().toISOString(), ...(status === 'conectada' && !error ? { last_sync_at: new Date().toISOString() } : {}) }).in('provider', ['google_calendar', 'google_tasks']);
}

async function sync(admin: ReturnType<typeof adminClient>) {
  const token = await accessToken(admin);
  const cfg = (await admin.from('integrations').select('config').eq('provider', 'google_calendar').single()).data?.config ?? {};
  const calendarId = encodeURIComponent(cfg.calendar_id ?? 'primary');
  const taskList = encodeURIComponent(cfg.task_list ?? '@default');
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  let pushed = 0, failed = 0;

  const { data: events } = await admin.from('calendar_events').select('*').gte('starts_at', since).eq('sync_origin', 'interno').limit(500);
  for (const ev of events ?? []) {
    if (SKIP_KINDS.has(ev.kind)) continue;
    const body = { summary: ev.title, location: ev.location ?? undefined, description: ev.notes ?? undefined, start: { dateTime: ev.starts_at, timeZone: 'America/Sao_Paulo' }, end: { dateTime: ev.ends_at ?? new Date(new Date(ev.starts_at).getTime() + 3600_000).toISOString(), timeZone: 'America/Sao_Paulo' }, recurrence: ev.recurrence_rule ? [`RRULE:${ev.recurrence_rule}`] : undefined, status: ev.status === 'cancelado' ? 'cancelled' : 'confirmed' };
    const hash = await sha(JSON.stringify(body));
    const { data: rec } = await admin.from('external_sync_records').select('*').eq('provider', 'google_calendar').eq('entity_type', 'calendar_event').eq('entity_id', ev.id).maybeSingle();
    if (rec?.last_hash === hash) continue;
    const url = rec ? `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(rec.external_id)}` : `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
    const res = await fetch(url, { method: rec ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      failed++;
      await admin.from('external_sync_records').upsert({ provider: 'google_calendar', entity_type: 'calendar_event', entity_id: ev.id, external_id: rec?.external_id ?? `pendente-${ev.id}`, direction: 'push', status: 'erro', error: `HTTP ${res.status}`, attempts: (rec?.attempts ?? 0) + 1 }, { onConflict: 'provider,entity_type,entity_id' });
      continue;
    }
    const g = await res.json();
    await admin.from('external_sync_records').upsert({ provider: 'google_calendar', entity_type: 'calendar_event', entity_id: ev.id, external_id: g.id, direction: 'push', last_hash: hash, status: 'ok', error: null, last_synced_at: new Date().toISOString() }, { onConflict: 'provider,entity_type,entity_id' });
    await admin.from('calendar_events').update({ external_id: g.id, external_etag: g.etag }).eq('id', ev.id);
    pushed++;
  }

  // Google Tasks não armazena horário: apenas data de vencimento. Horários permanecem na agenda interna.
  const { data: tasks } = await admin.from('tasks').select('id,title,description,due_date,status').is('parent_id', null).in('status', ['a_fazer', 'em_andamento', 'concluida']).gte('created_at', since).limit(500);
  for (const t of tasks ?? []) {
    const body = { title: t.title, notes: t.description ?? undefined, due: t.due_date ? `${t.due_date}T00:00:00.000Z` : undefined, status: t.status === 'concluida' ? 'completed' : 'needsAction' };
    const hash = await sha(JSON.stringify(body));
    const { data: rec } = await admin.from('external_sync_records').select('*').eq('provider', 'google_tasks').eq('entity_type', 'task').eq('entity_id', t.id).maybeSingle();
    if (rec?.last_hash === hash) continue;
    const url = rec ? `https://tasks.googleapis.com/tasks/v1/lists/${taskList}/tasks/${encodeURIComponent(rec.external_id)}` : `https://tasks.googleapis.com/tasks/v1/lists/${taskList}/tasks`;
    const res = await fetch(url, { method: rec ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { failed++; continue; }
    const g = await res.json();
    await admin.from('external_sync_records').upsert({ provider: 'google_tasks', entity_type: 'task', entity_id: t.id, external_id: g.id, direction: 'push', last_hash: hash, status: 'ok', error: null, last_synced_at: new Date().toISOString() }, { onConflict: 'provider,entity_type,entity_id' });
    pushed++;
  }
  await setStatus(admin, failed ? 'sincronizacao_pendente' : 'conectada', failed ? `${failed} item(ns) com falha — reprocesse` : null);
  return { pushed, failed };
}

Deno.serve(handle(async (req) => {
  const admin = adminClient();
  const url = new URL(req.url);

  // Retorno do OAuth (GET com code + state assinado)
  if (req.method === 'GET' && url.searchParams.get('code')) {
    const [payload, sig] = (url.searchParams.get('state') ?? '').split('.');
    if (!payload || sig !== (await hmac(payload))) throw new HttpError(400, 'Estado OAuth inválido');
    const { redirect, exp } = JSON.parse(atob(payload));
    if (Date.now() > exp) throw new HttpError(400, 'Autorização expirada');
    const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: url.searchParams.get('code')!, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), redirect_uri: callbackUrl(), grant_type: 'authorization_code' }) });
    if (!res.ok) throw new HttpError(502, 'Falha ao obter token do Google');
    const tok = await res.json();
    if (tok.refresh_token) await admin.from('integration_secrets').upsert({ provider: 'google_calendar', data: { refresh_token: tok.refresh_token }, updated_at: new Date().toISOString() });
    await setStatus(admin, 'conectada');
    return new Response(null, { status: 302, headers: { ...cors, Location: redirect } });
  }

  await requirePerm(req, 'admin', 'edit');
  const { op, redirect } = await req.json();
  if (op === 'connect') {
    const payload = btoa(JSON.stringify({ redirect: redirect ?? Deno.env.get('APP_ORIGIN'), exp: Date.now() + 10 * 60_000 }));
    const state = `${payload}.${await hmac(payload)}`;
    await setStatus(admin, 'aguardando_autorizacao');
    const auth = `${AUTH_URL}?${new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: callbackUrl(), response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state })}`;
    return json({ url: auth });
  }
  if (op === 'disconnect') {
    const { data } = await admin.from('integration_secrets').select('data').eq('provider', 'google_calendar').maybeSingle();
    if (data?.data?.refresh_token) await fetch(`${REVOKE_URL}?token=${encodeURIComponent(data.data.refresh_token)}`, { method: 'POST' }).catch(() => undefined);
    await admin.from('integration_secrets').delete().eq('provider', 'google_calendar');
    await setStatus(admin, 'desconectada');
    return json({ message: 'Conta Google desconectada.' });
  }
  if (op === 'sync') {
    const r = await sync(admin);
    return json({ message: `Sincronização concluída: ${r.pushed} enviado(s), ${r.failed} falha(s).` });
  }
  throw new HttpError(400, 'Operação inválida');
}));

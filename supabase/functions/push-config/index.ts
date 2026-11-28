/**
 * Chave pública para inscrição no push (VAPID). As chaves são geradas UMA vez, no servidor, e guardadas em
 * integration_secrets (somente o servidor lê). Só administradores geram; os demais apenas leem a chave pública.
 */
import webpush from 'npm:web-push@3.6.7';
import { adminClient, handle, json, requirePerm } from '../_shared/http.ts';

Deno.serve(handle(async (req) => {
  const { client } = await requirePerm(req, 'dashboard', 'view');
  const admin = adminClient();
  const { data } = await admin.from('integration_secrets').select('data').eq('provider', 'web_push').maybeSingle();
  let cfg = (data?.data ?? {}) as Record<string, string>;
  if (!cfg.vapid_public) {
    const { data: isAdmin } = await client.rpc('has_perm', { p_resource: 'admin', p_action: 'edit' });
    if (!isAdmin) return json({ publicKey: null });
    const keys = webpush.generateVAPIDKeys();
    cfg = { ...cfg, vapid_public: keys.publicKey, vapid_private: keys.privateKey, vapid_subject: 'https://gestaojk-almatti-creatives-projects.vercel.app' };
    await admin.from('integration_secrets').upsert({ provider: 'web_push', data: cfg, updated_at: new Date().toISOString() });
    await admin.from('integrations').update({ status: 'conectada', last_error: null, updated_at: new Date().toISOString() }).eq('provider', 'web_push');
  }
  return json({ publicKey: cfg.vapid_public });
}));

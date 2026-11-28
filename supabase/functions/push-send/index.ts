/**
 * Envio de notificações push para o celular. Acionado pelo banco (trigger em notifications) com segredo.
 * Privacidade (LGPD): a mensagem enviada ao aparelho é genérica — não contém nome de cliente, valor ou número de
 * pedido. Os detalhes ficam só dentro do sistema, depois de abrir o app.
 */
import webpush from 'npm:web-push@3.6.7';
import { adminClient, json } from '../_shared/http.ts';

const hhmm = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());

Deno.serve(async (req) => {
  try {
    const admin = adminClient();
    const { data: sec } = await admin.from('integration_secrets').select('data').eq('provider', 'web_push').maybeSingle();
    const cfg = (sec?.data ?? {}) as Record<string, string>;
    if (!cfg.webhook_secret || req.headers.get('x-push-secret') !== cfg.webhook_secret) return json({ error: 'não autorizado' }, 401);
    if (!cfg.vapid_public || !cfg.vapid_private) return json({ skipped: 'chaves push não geradas' });

    const { id } = await req.json();
    const { data: n } = await admin.from('notifications').select('*').eq('id', id).maybeSingle();
    if (!n) return json({ skipped: 'notificação não encontrada' });

    // Horário silencioso (Configurações → Notificações): só alertas de prioridade alta tocam o celular.
    const { data: q } = await admin.from('settings').select('value').eq('key', 'notifications.quiet_hours').maybeSingle();
    const quiet = (q?.value ?? { start: '22:00', end: '07:00' }) as { start: string; end: string };
    const t = hhmm();
    const inQuiet = quiet.start > quiet.end ? (t >= quiet.start || t < quiet.end) : (t >= quiet.start && t < quiet.end);
    if (inQuiet && n.priority !== 'alta') return json({ skipped: 'horário silencioso' });

    // Destinatários: o usuário específico, ou quem tem permissão de ver o recurso da notificação.
    const [{ data: subs }, { data: profs }, { data: perms }] = await Promise.all([
      admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth'),
      admin.from('profiles').select('id,role,active'),
      n.target_resource ? admin.from('role_permissions').select('role').eq('resource', n.target_resource).eq('action', 'view') : Promise.resolve({ data: null })
    ]);
    const active = new Map((profs ?? []).filter((p) => p.active).map((p) => [p.id, p.role]));
    const allowedRoles = n.target_resource ? new Set((perms ?? []).map((p) => p.role)) : null;
    const targets = (subs ?? []).filter((s) => {
      if (n.user_id) return s.user_id === n.user_id && active.has(s.user_id);
      const role = active.get(s.user_id);
      return !!role && (!allowedRoles || allowedRoles.has(role));
    });
    if (!targets.length) return json({ sent: 0 });

    webpush.setVapidDetails(cfg.vapid_subject ?? 'https://gestaojk-almatti-creatives-projects.vercel.app', cfg.vapid_public, cfg.vapid_private);
    const payload = JSON.stringify({
      title: 'JK Gestão',
      body: n.priority === 'alta' ? 'Atenção: há um alerta importante no sistema.' : 'Você tem uma nova notificação.',
      tag: n.dedup_key ?? String(n.id),
      url: n.link ?? '/notificacoes'
    });
    let sent = 0;
    const gone: string[] = [];
    await Promise.allSettled(targets.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: n.priority === 'alta' ? 'high' : 'normal' });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(s.id); // aparelho removeu a inscrição
      }
    }));
    if (gone.length) await admin.from('push_subscriptions').delete().in('id', gone);
    return json({ sent, removed: gone.length });
  } catch (e) {
    console.error('[push-send]', e instanceof Error ? e.message : 'erro');
    return json({ error: 'falha no envio' }, 500);
  }
});

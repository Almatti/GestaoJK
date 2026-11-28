/** Notificações push no celular (Web Push). A inscrição fica no servidor, vinculada ao usuário. */
import { db } from '@/data/hooks';

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

const urlBase64ToUint8Array = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

/** iPhone só recebe push quando o app está instalado na tela inicial. */
const isIosBrowser = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !(navigator as { standalone?: boolean }).standalone;

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return isIosBrowser() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enablePush(): Promise<void> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permissão de notificação não concedida. Libere nas configurações do navegador.');
  const cfg = await db().invoke<{ publicKey: string | null }>('push-config', {});
  if (!cfg.publicKey) throw new Error('O envio de notificações ainda não está configurado no servidor. Peça ao administrador.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cfg.publicKey) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const existing = await db().list<{ id: string }>('push_subscriptions', { filters: [{ column: 'endpoint', op: 'eq', value: json.endpoint }], range: [0, 0] });
  const values = { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, user_agent: navigator.userAgent.slice(0, 200), last_seen_at: new Date().toISOString() };
  if (existing.rows[0]) await db().update('push_subscriptions', String(existing.rows[0].id), values);
  else await db().insert('push_subscriptions', values);
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const existing = await db().list<{ id: string }>('push_subscriptions', { filters: [{ column: 'endpoint', op: 'eq', value: sub.endpoint }], range: [0, 0] });
  if (existing.rows[0]) await db().remove('push_subscriptions', String(existing.rows[0].id));
  await sub.unsubscribe();
}

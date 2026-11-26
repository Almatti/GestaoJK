// Convite de usuário pelo Supabase Auth (somente administradores). O perfil e o papel vêm de user_invitations.
import { adminClient, handle, HttpError, json, requirePerm } from '../_shared/http.ts';

Deno.serve(handle(async (req) => {
  await requirePerm(req, 'admin', 'edit');
  const { email } = await req.json();
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'E-mail inválido');
  const admin = adminClient();
  const { data: inv } = await admin.from('user_invitations').select('id').eq('email', email.toLowerCase()).eq('status', 'pendente').maybeSingle();
  if (!inv) throw new HttpError(400, 'Registre o convite antes de enviar o e-mail');
  const { error } = await admin.auth.admin.inviteUserByEmail(email.toLowerCase(), { redirectTo: Deno.env.get('APP_ORIGIN') ?? undefined });
  if (error) throw new HttpError(400, error.message);
  return json({ ok: true });
}));

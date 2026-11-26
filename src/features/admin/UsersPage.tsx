import { useState } from 'react';
import { UserPlus, Check, X as XIcon } from 'lucide-react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card, Tabs } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, LoadingBlock, friendlyError } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Overlay';
import { SelectInput, TextInput } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { ACTIONS, PERMISSION_MATRIX, RESOURCES, ROLES, type Role, type Resource } from '@/domain/permissions';
import { formatDateTimeBR } from '@/domain/dates';

const ROLE_OPTS = Object.entries(ROLES).map(([value, label]) => ({ value, label }));
const ACTION_LABEL = { view: 'Ver', create: 'Criar', edit: 'Editar', approve: 'Aprovar', cancel: 'Cancelar', export: 'Exportar', archive: 'Arquivar' };

export function UsersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [tab, setTab] = useState<'usuarios' | 'convites' | 'permissoes'>('usuarios');
  const [invite, setInvite] = useState(false);
  const profiles = useList<Row>('profiles', { order: [{ column: 'full_name' }], range: [0, 499] });
  const invites = useList<Row>('user_invitations', { order: [{ column: 'created_at', ascending: false }] }, { enabled: tab === 'convites' });

  const update = async (p: Row, values: Row) => {
    try {
      await db().update('profiles', String(p.id), values);
      invalidate();
      toast('Usuário atualizado.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Usuários e permissões" subtitle="Sem cadastro público: novos usuários entram por convite ou aprovação. A autorização é aplicada no banco (RLS)." actions={<Button icon={<UserPlus className="size-4" />} onClick={() => setInvite(true)}>Convidar usuário</Button>} />
      <Tabs tabs={[{ key: 'usuarios', label: 'Usuários' }, { key: 'convites', label: 'Convites' }, { key: 'permissoes', label: 'Matriz de permissões' }]} value={tab} onChange={setTab} />
      {tab === 'usuarios' && (profiles.isLoading ? <Card opaque><LoadingBlock /></Card> : (
        <div className="surface overflow-x-auto rounded-[var(--radius-card)]">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-cream-100 text-left text-xs uppercase text-cocoa-700"><tr><th className="px-4 py-3">Usuário</th><th className="px-4 py-3">Perfil</th><th className="px-4 py-3">Situação</th><th className="px-4 py-3">Desde</th><th className="px-4 py-3" /></tr></thead>
            <tbody>{(profiles.data?.rows ?? []).map((p) => (
              <tr key={String(p.id)} className="border-t border-tangerine-100">
                <td className="px-4 py-3"><p className="font-semibold">{String(p.full_name || '—')}</p><p className="text-xs text-cocoa-700">{String(p.email ?? '')}</p></td>
                <td className="px-4 py-3"><select aria-label="Perfil" className="input h-9 w-auto py-0 text-sm" value={String(p.role)} disabled={p.id === user?.id} onChange={(e) => update(p, { role: e.target.value })}>{ROLE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></td>
                <td className="px-4 py-3">{p.active ? <Badge tone="success">Ativo</Badge> : <Badge tone="warning">Aguardando aprovação / inativo</Badge>}</td>
                <td className="px-4 py-3 text-xs">{formatDateTimeBR(p.created_at as string)}</td>
                <td className="px-4 py-3">{p.id !== user?.id && (p.active ? <Button size="sm" variant="ghost" icon={<XIcon className="size-4" />} onClick={() => update(p, { active: false })}>Desativar</Button> : <Button size="sm" variant="soft" icon={<Check className="size-4" />} onClick={() => update(p, { active: true })}>Aprovar</Button>)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ))}
      {tab === 'convites' && (
        <Card opaque>{(invites.data?.rows ?? []).length === 0 ? <EmptyState title="Nenhum convite" /> : (
          <ul className="divide-y divide-tangerine-100 text-sm">{invites.data!.rows.map((i) => <li key={String(i.id)} className="flex flex-wrap items-center gap-3 py-2.5"><span className="flex-1">{String(i.email)}</span><Badge>{ROLES[i.role as Role]}</Badge><Badge tone={i.status === 'aceito' ? 'success' : i.status === 'pendente' ? 'info' : 'neutral'}>{String(i.status)}</Badge>{i.status === 'pendente' && <Button size="sm" variant="ghost" onClick={async () => { await db().update('user_invitations', String(i.id), { status: 'revogado' }); invalidate(); }}>Revogar</Button>}</li>)}</ul>
        )}</Card>
      )}
      {tab === 'permissoes' && (
        <Card opaque title="Permissões por perfil">
          <p className="mb-3 text-sm text-cocoa-700">Fonte única: src/domain/permissions.ts → migration de permissões (gerada por script). Alterações exigem nova migration revisada.</p>
          <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-xs">
            <thead><tr><th className="sticky left-0 bg-white py-2 text-left">Recurso</th>{Object.entries(ROLES).map(([k, l]) => <th key={k} className="px-1 py-2 text-left font-semibold">{l}</th>)}</tr></thead>
            <tbody>{(Object.keys(RESOURCES) as Resource[]).map((r) => (
              <tr key={r} className="border-t border-tangerine-100"><td className="sticky left-0 bg-white py-2 pr-2 font-medium">{RESOURCES[r]}</td>
                {(Object.keys(ROLES) as Role[]).map((role) => { const acts = PERMISSION_MATRIX[role][r] ?? []; return <td key={role} className="px-1 py-2 align-top">{acts.length === ACTIONS.length ? <Badge tone="success" icon={false}>Total</Badge> : acts.length ? acts.map((a) => ACTION_LABEL[a]).join(', ') : <span className="text-cocoa-500">—</span>}</td>; })}</tr>))}</tbody>
          </table></div>
        </Card>
      )}
      {invite && <InviteDialog onClose={() => setInvite(false)} />}
    </div>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('leitura');
  const [sendEmail, setSendEmail] = useState(true);
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const submit = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('E-mail inválido.', 'warning');
    try {
      await db().insert('user_invitations', { email: email.toLowerCase(), role });
      if (sendEmail) {
        try {
          await db().invoke('invite-user', { email: email.toLowerCase() });
          toast('Convite registrado e e-mail enviado pelo Supabase Auth.');
        } catch {
          toast('Convite registrado. O envio automático do e-mail requer a Edge Function "invite-user" publicada; o usuário pode se cadastrar e será ativado com o perfil escolhido.', 'warning');
        }
      } else toast('Convite registrado.');
      invalidate();
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  return (
    <Modal open onClose={onClose} title="Convidar usuário" size="sm" footer={<Button onClick={submit}>Convidar</Button>}>
      <div className="space-y-3">
        <TextInput label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <SelectInput label="Perfil" options={ROLE_OPTS} value={role} onChange={(e) => setRole(e.target.value as Role)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="accent-[var(--color-tangerine-800)]" />Enviar e-mail de convite</label>
        <Alert tone="info">Ao criar a conta com este e-mail, o usuário é ativado automaticamente com o perfil escolhido. Cadastros sem convite ficam inativos até aprovação.</Alert>
      </div>
    </Modal>
  );
}

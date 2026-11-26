import { useState } from 'react';
import { Link } from 'react-router';
import { Bell, BellRing, Check, Archive, Clock, CheckCheck, Play } from 'lucide-react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card, Tabs } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, LoadingBlock, friendlyError, Alert } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { formatDateTimeBR, todaySP } from '@/domain/dates';
import type { Tone } from '@/domain/collections';

const CATS = { financeiro: 'Financeiras', comercial: 'Comerciais', operacional: 'Operacionais', logistica: 'Logísticas', tecnico: 'Técnicas', estrategico: 'Estratégicas', administrativo: 'Administrativas', marketing: 'Marketing', integracoes: 'Integrações', seguranca: 'Segurança' };
const PRIO: Record<string, Tone> = { baixa: 'neutral', normal: 'info', alta: 'warning', critica: 'danger' };

export function NotificationsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [tab, setTab] = useState<'nao_lida' | 'lida' | 'resolvida' | 'arquivada'>('nao_lida');
  const [cat, setCat] = useState('');
  const q = useList<Row>('notifications', { filters: [{ column: 'status', op: tab === 'nao_lida' ? 'in' : 'eq', value: tab === 'nao_lida' ? ['nao_lida', 'adiada'] : tab }, ...(cat ? [{ column: 'category', op: 'eq' as const, value: cat }] : [])], order: [{ column: 'created_at', ascending: false }], range: [0, 299] });
  const rows = (q.data?.rows ?? []).filter((n) => n.status !== 'adiada' || !n.snoozed_until || String(n.snoozed_until) <= new Date().toISOString());
  const pushSupported = 'Notification' in window;

  const set = async (n: Row, status: string, extra: Row = {}) => {
    try {
      await db().update('notifications', String(n.id), { status, ...extra });
      invalidate();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  const markAll = async () => {
    for (const n of rows.filter((r) => r.status === 'nao_lida')) await db().update('notifications', String(n.id), { status: 'lida' }).catch(() => undefined);
    invalidate();
  };
  const enablePush = async () => {
    const p = await Notification.requestPermission();
    toast(p === 'granted' ? 'Notificações do navegador autorizadas.' : 'Permissão não concedida.', p === 'granted' ? 'success' : 'warning');
  };
  const runNow = async () => {
    try {
      const r = await db().rpc<{ effects?: number }>('run_automations', { p_day: todaySP() });
      invalidate();
      toast(`${r?.effects ?? 0} novo(s) alerta(s)/mensagem(ns).`);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  const summary = Object.entries(CATS).map(([k, l]) => [l, (q.data?.rows ?? []).filter((n) => n.category === k).length] as const).filter(([, c]) => c > 0);

  return (
    <div className="animate-fade-in">
      <PageHeader title="Central de notificações" subtitle="Alertas gerados pelas automações do servidor, sem duplicidade (chave única por evento e dia)."
        actions={<>
          {pushSupported && Notification.permission !== 'granted' && <Button variant="secondary" icon={<BellRing className="size-4" />} onClick={enablePush}>Ativar notificações push</Button>}
          {can('automacoes', 'edit') && <Button variant="secondary" icon={<Play className="size-4" />} onClick={runNow}>Verificar agora</Button>}
          {tab === 'nao_lida' && rows.length > 0 && <Button icon={<CheckCheck className="size-4" />} onClick={markAll}>Marcar todas como lidas</Button>}
        </>} />
      {tab === 'nao_lida' && summary.length > 0 && <div className="mb-4"><Alert tone="info" title="Resumo de prioridades">{summary.map(([l, c]) => `${l}: ${c}`).join(' · ')}</Alert></div>}
      <Tabs tabs={[{ key: 'nao_lida', label: 'Não lidas' }, { key: 'lida', label: 'Lidas' }, { key: 'resolvida', label: 'Resolvidas' }, { key: 'arquivada', label: 'Arquivadas' }]} value={tab} onChange={setTab} />
      <div className="mb-3"><select aria-label="Categoria" className="input h-10 w-auto py-0 text-sm" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Todas as categorias</option>{Object.entries(CATS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      {q.isLoading ? <Card opaque><LoadingBlock /></Card> : rows.length === 0 ? <Card><EmptyState icon={<Bell className="size-7" />} title="Nada por aqui" description="Você está em dia." /></Card> : (
        <ul className="space-y-2">{rows.map((n) => (
          <li key={String(n.id)} className="surface flex flex-wrap items-start gap-3 rounded-[var(--radius-card-sm)] p-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><Badge tone={PRIO[String(n.priority)]}>{String(n.priority)}</Badge><Badge icon={false}>{CATS[n.category as keyof typeof CATS]}</Badge><span className="text-xs text-cocoa-700">{formatDateTimeBR(n.created_at as string)}</span></div>
              <p className="mt-1 font-semibold">{n.link ? <Link className="hover:underline" to={String(n.link)} onClick={() => n.status === 'nao_lida' && set(n, 'lida')}>{String(n.title)}</Link> : String(n.title)}</p>
              {n.body ? <p className="text-sm text-cocoa-700">{String(n.body)}</p> : null}
            </div>
            <div className="flex gap-1">
              {n.status !== 'lida' && n.status !== 'resolvida' && <Button size="icon" variant="ghost" aria-label="Marcar como lida" title="Lida" onClick={() => set(n, 'lida')} icon={<Check className="size-4" />} />}
              <Button size="icon" variant="ghost" aria-label="Resolvida" title="Resolvida" onClick={() => set(n, 'resolvida')} icon={<CheckCheck className="size-4" />} />
              <Button size="icon" variant="ghost" aria-label="Adiar 1 dia" title="Adiar 1 dia" onClick={() => set(n, 'adiada', { snoozed_until: new Date(Date.now() + 864e5).toISOString() })} icon={<Clock className="size-4" />} />
              <Button size="icon" variant="ghost" aria-label="Arquivar" title="Arquivar" onClick={() => set(n, 'arquivada')} icon={<Archive className="size-4" />} />
            </div>
          </li>))}</ul>
      )}
    </div>
  );
}

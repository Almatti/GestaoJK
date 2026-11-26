import { useState } from 'react';
import { Play, Plus } from 'lucide-react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card, Tabs } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { ResourceForm } from '@/features/resource/ResourceForm';
import type { ResourceDef } from '@/features/resource/types';
import { opts } from '@/features/resource/definitions';
import { AUTOMATION_ACTIONS, AUTOMATION_TRIGGERS } from '@/domain/automation';
import { formatDateTimeBR, todaySP } from '@/domain/dates';

const ruleDef: ResourceDef = {
  table: 'automation_rules', title: 'Regras', singular: 'Regra', resource: 'automacoes', searchColumns: [], columns: [],
  fields: [
    { name: 'name', label: 'Nome', type: 'text', required: true, wide: true },
    { name: 'trigger', label: 'Gatilho', type: 'select', options: opts(AUTOMATION_TRIGGERS), required: true },
    { name: 'action', label: 'Ação', type: 'select', options: opts(AUTOMATION_ACTIONS), required: true },
    { name: 'dedup_window', label: 'Executar no máximo uma vez por', type: 'select', options: opts({ dia: 'Dia', semana: 'Semana', mes: 'Mês', unico: 'Uma única vez' }), defaultValue: 'dia' },
    { name: 'responsible_role', label: 'Perfil responsável', type: 'select', options: opts({ financeiro: 'Financeiro', comercial: 'Comercial', logistica: 'Logística', tecnico: 'Técnico', administrativo: 'Administrativo' }) },
    { name: 'action_config', label: 'Configuração (JSON)', type: 'json', help: 'Ex.: {"template":"lembrete_vencimento","days_before":1}' },
    { name: 'conditions', label: 'Condições (JSON)', type: 'json', help: 'Ex.: [{"field":"dias","op":"lte","value":1}]' },
    { name: 'active', label: 'Ativa', type: 'boolean', defaultValue: true }
  ]
};

export function AutomationsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [tab, setTab] = useState<'regras' | 'execucoes' | 'falhas'>('regras');
  const [editing, setEditing] = useState<Row | null | undefined>(undefined);
  const rules = useList<Row>('automation_rules', { order: [{ column: 'name' }] });
  const runs = useList<Row>('automation_runs', { order: [{ column: 'started_at', ascending: false }], range: [0, 49] });
  const fails = useList<Row>('automation_executions', { select: '*,rule:automation_rules(name)', filters: [{ column: 'result', op: 'eq', value: 'falha' }], order: [{ column: 'executed_at', ascending: false }], range: [0, 99] });
  const effects = useList<Row>('automation_executions', { select: '*,rule:automation_rules(name)', filters: [{ column: 'result', op: 'eq', value: 'sucesso' }], order: [{ column: 'executed_at', ascending: false }], range: [0, 99] }, { enabled: tab === 'execucoes' });

  const run = async () => {
    try {
      const r = await db().rpc<{ effects?: number; skipped?: string }>('run_automations', { p_day: todaySP() });
      invalidate();
      toast(r?.skipped ? `Ignorada: ${r.skipped}` : `${r?.effects ?? 0} efeito(s) novo(s). Repetir a execução não duplica efeitos.`);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  const toggle = async (r: Row) => {
    try {
      await db().update('automation_rules', String(r.id), { active: !r.active });
      invalidate();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Motor de automações" subtitle="Gatilho → Condição → Ação, executado diariamente no servidor (pg_cron), com idempotência, controle de concorrência e registro de falhas."
        actions={<>{can('automacoes', 'edit') && <Button variant="secondary" icon={<Play className="size-4" />} onClick={run}>Executar agora</Button>}{can('automacoes', 'create') && <Button icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>Nova regra</Button>}</>} />
      <div className="mb-4"><Alert tone="info">Não depende de nenhuma aba aberta. Se o serviço ficar indisponível, a próxima execução processa as pendências (as chaves de idempotência evitam duplicações).</Alert></div>
      <Tabs tabs={[{ key: 'regras', label: 'Regras' }, { key: 'execucoes', label: 'Execuções' }, { key: 'falhas', label: 'Falhas', count: fails.data?.rows.length }]} value={tab} onChange={setTab} />
      {tab === 'regras' && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(rules.data?.rows ?? []).map((r) => (
            <Card key={String(r.id)} opaque>
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-display font-bold">{String(r.name)}</p><p className="text-sm text-cocoa-700">{AUTOMATION_TRIGGERS[r.trigger as keyof typeof AUTOMATION_TRIGGERS] ?? String(r.trigger)} → {AUTOMATION_ACTIONS[r.action as keyof typeof AUTOMATION_ACTIONS] ?? String(r.action)}</p></div>
                <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'Ativa' : 'Inativa'}</Badge>
              </div>
              <p className="mt-2 text-xs text-cocoa-700">Janela: {String(r.dedup_window)} · Última execução: {formatDateTimeBR(r.last_run_at as string)} · Próxima: {formatDateTimeBR(r.next_run_at as string)}</p>
              {can('automacoes', 'edit') && <div className="mt-3 flex gap-2"><Button size="sm" variant="soft" onClick={() => toggle(r)}>{r.active ? 'Desativar' : 'Ativar'}</Button><Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Editar</Button></div>}
            </Card>
          ))}
        </div>
      )}
      {tab === 'execucoes' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card opaque title="Execuções do motor">{(runs.data?.rows ?? []).length === 0 ? <EmptyState title="Nenhuma execução" /> : <ul className="divide-y divide-tangerine-100 text-sm">{runs.data!.rows.map((r) => <li key={String(r.id)} className="flex justify-between gap-2 py-2"><span>{formatDateTimeBR(r.started_at as string)}</span><span>{String(r.effects)} efeito(s)</span><Badge tone={r.status === 'concluida' ? 'success' : r.status === 'falha' ? 'danger' : 'info'}>{String(r.status)}</Badge></li>)}</ul>}</Card>
          <Card opaque title="Efeitos registrados (chaves de idempotência)">{(effects.data?.rows ?? []).length === 0 ? <EmptyState title="Nenhum efeito" /> : <ul className="divide-y divide-tangerine-100 text-xs">{effects.data!.rows.map((e) => <li key={String(e.id)} className="py-1.5"><strong>{String((e.rule as Row | null)?.name ?? '')}</strong> · {String(e.entity_type)} · {formatDateTimeBR(e.executed_at as string)}</li>)}</ul>}</Card>
        </div>
      )}
      {tab === 'falhas' && <Card opaque>{(fails.data?.rows ?? []).length === 0 ? <EmptyState title="Nenhuma falha registrada" /> : <ul className="divide-y divide-tangerine-100 text-sm">{fails.data!.rows.map((f) => <li key={String(f.id)} className="py-2"><p className="font-semibold">{String((f.rule as Row | null)?.name ?? '')}</p><p className="text-xs text-danger-700">{String(f.error)}</p><p className="text-xs text-cocoa-700">{formatDateTimeBR(f.executed_at as string)} · tentativas {String(f.attempts)}</p></li>)}</ul>}</Card>}
      {editing !== undefined && <ResourceForm def={ruleDef} row={editing} open onClose={() => setEditing(undefined)} />}
    </div>
  );
}

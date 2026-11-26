import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { ListPlus, Save, Printer } from 'lucide-react';
import { useRecord, db, useInvalidateAll, useList } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Badge, LoadingBlock, friendlyError, EmptyState } from '@/components/ui/Feedback';
import { SelectInput, TextArea, TextInput } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { formatDateTimeBR, formatDateBR } from '@/domain/dates';
import { printDocument, escHtml } from '@/lib/export';

interface Decision { text: string; owner?: string; due?: string; task_id?: string }
const TEMPLATES: Record<string, string> = {
  administrativa: '1. Pendências da semana\n2. Pessoas e rotinas\n3. Compras\n4. Encaminhamentos',
  financeira: '1. Caixa e projeção\n2. Inadimplência e cobranças\n3. Protestos\n4. Contas a pagar\n5. Decisões',
  operacional: '1. Entregas e recolhimentos\n2. Estoque e barris\n3. Equipamentos e manutenções\n4. Ocorrências',
  estrategica: '1. Indicadores e metas\n2. Clientes com baixa rotatividade\n3. Marketing\n4. Plano de ação',
  parceiros: '1. Pedidos do período\n2. Créditos e abatimentos\n3. Saldo devedor\n4. Próximos passos'
};

export function MeetingDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const m = useRecord<Row>('meetings', id);
  const profiles = useList<Row>('profiles', { select: 'id,full_name', filters: [{ column: 'active', op: 'eq', value: true }] });
  const [agenda, setAgenda] = useState('');
  const [notes, setNotes] = useState('');
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [d, setD] = useState<Decision>({ text: '' });
  useEffect(() => {
    if (!m.data) return;
    setAgenda(String(m.data.agenda ?? TEMPLATES[String(m.data.template)] ?? ''));
    setNotes(String(m.data.notes ?? ''));
    setDecisions((m.data.decisions as Decision[] | null) ?? []);
  }, [m.data]);
  if (m.isLoading) return <Card opaque><LoadingBlock /></Card>;
  if (!m.data) return <Card><EmptyState title="Reunião não encontrada" /></Card>;
  const mt = m.data;
  const editable = can('organizacao', 'edit');

  const save = async (status?: string) => {
    try {
      await db().update('meetings', String(mt.id), { agenda, notes, decisions, ...(status ? { status } : {}) });
      invalidate();
      toast('Reunião salva.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  const toTask = async (i: number) => {
    const dec = decisions[i]!;
    try {
      const t = await db().insert<Row>('tasks', { title: dec.text, assignee_id: dec.owner || null, due_date: dec.due || null, priority: 'normal', status: 'a_fazer', category: 'reuniao', ref_type: 'meeting', ref_id: mt.id, source_key: `meeting:${mt.id}:${i}`, checklist: [] });
      const next = decisions.map((x, j) => (j === i ? { ...x, task_id: String(t.id) } : x));
      setDecisions(next);
      await db().update('meetings', String(mt.id), { decisions: next });
      invalidate();
      toast('Decisão convertida em tarefa.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  const name = (pid?: string) => profiles.data?.rows.find((p) => p.id === pid)?.full_name as string | undefined;

  return (
    <div className="animate-fade-in">
      <PageHeader breadcrumbs={[{ label: 'Reuniões', to: '/reunioes' }, { label: String(mt.title) }]} title={String(mt.title)} subtitle={<span className="flex items-center gap-2">{formatDateTimeBR(mt.starts_at as string)} <Badge tone={mt.status === 'realizada' ? 'success' : 'info'}>{String(mt.status)}</Badge></span>}
        actions={<>
          <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => printDocument(`Ata — ${String(mt.title)}`, `<h1>${escHtml(String(mt.title))}</h1><p>${escHtml(formatDateTimeBR(mt.starts_at as string))} · Participantes: ${escHtml(((mt.participants as string[] | null) ?? []).join(', '))}</p><h2>Pauta</h2><div class="doc">${escHtml(agenda)}</div><h2>Anotações</h2><div class="doc">${escHtml(notes)}</div><h2>Decisões</h2><ul>${decisions.map((x) => `<li>${escHtml(x.text)}${x.owner ? ` — ${escHtml(name(x.owner) ?? '')}` : ''}${x.due ? ` (prazo ${formatDateBR(x.due)})` : ''}</li>`).join('')}</ul>`)}>Ata (PDF)</Button>
          {editable && <Button variant="secondary" icon={<Save className="size-4" />} onClick={() => save()}>Salvar</Button>}
          {editable && mt.status !== 'realizada' && <Button onClick={() => save('realizada')}>Concluir reunião</Button>}
        </>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card opaque title="Pauta e anotações">
          <TextArea label="Pauta / tópicos" disabled={!editable} className="min-h-40" value={agenda} onChange={(e) => setAgenda(e.target.value)} />
          <TextArea label="Anotações" disabled={!editable} wrapperClassName="mt-3" className="min-h-56" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Card>
        <Card opaque title="Decisões e pendências">
          <ul className="space-y-2">{decisions.map((x, i) => (
            <li key={i} className="rounded-2xl border border-tangerine-100 p-3 text-sm">
              <p className="font-medium">{x.text}</p>
              <p className="text-xs text-cocoa-700">{name(x.owner) ?? 'Sem responsável'} · {x.due ? formatDateBR(x.due) : 'sem prazo'}</p>
              {x.task_id ? <Badge tone="success">Tarefa criada</Badge> : editable && <Button size="sm" variant="soft" icon={<ListPlus className="size-4" />} onClick={() => toTask(i)}>Converter em tarefa</Button>}
            </li>))}</ul>
          {editable && (
            <div className="mt-3 space-y-2">
              <TextInput label="Nova decisão / pendência" value={d.text} onChange={(e) => setD((s) => ({ ...s, text: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <SelectInput label="Responsável" placeholder="—" options={(profiles.data?.rows ?? []).map((p) => ({ value: String(p.id), label: String(p.full_name || 'Sem nome') }))} value={d.owner ?? ''} onChange={(e) => setD((s) => ({ ...s, owner: e.target.value }))} />
                <TextInput label="Prazo" type="date" value={d.due ?? ''} onChange={(e) => setD((s) => ({ ...s, due: e.target.value }))} />
              </div>
              <Button variant="soft" disabled={!d.text.trim()} onClick={() => { setDecisions((l) => [...l, d]); setD({ text: '' }); }}>Adicionar</Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

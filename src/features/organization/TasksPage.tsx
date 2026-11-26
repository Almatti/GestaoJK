import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { clsx } from 'clsx';
import { Plus, Trash2 } from 'lucide-react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card, Tabs } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, friendlyError } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Overlay';
import { Checkbox, SelectInput, TextArea, TextInput } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { addDays, formatDateBR, todaySP, weekday, periodFor } from '@/domain/dates';
import type { Tone } from '@/domain/collections';

const STATUS: Record<string, [string, Tone]> = { a_fazer: ['A fazer', 'info'], em_andamento: ['Em andamento', 'warning'], bloqueada: ['Bloqueada', 'danger'], concluida: ['Concluída', 'success'], cancelada: ['Cancelada', 'neutral'] };
const PRIORITY: Record<string, Tone> = { baixa: 'neutral', normal: 'info', alta: 'warning', urgente: 'danger' };
type View = 'kanban' | 'lista' | 'minhas' | 'semana' | 'mes';
interface Check { text: string; done: boolean }

export function TasksPage() {
  const { can, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>('kanban');
  const [editing, setEditing] = useState<Row | null>(null);
  const [open, setOpen] = useState(params.get('novo') === '1');
  const [dragId, setDragId] = useState<string | null>(null);
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const q = useList<Row>('tasks', { select: '*,assignee:profiles(full_name)', filters: [{ column: 'status', op: 'neq', value: 'cancelada' }], order: [{ column: 'due_date' }], range: [0, 1999] });
  const all = q.data?.rows ?? [];
  const top = all.filter((t) => !t.parent_id);
  const today = todaySP();

  const setStatus = async (t: Row, status: string) => {
    try {
      await db().update('tasks', String(t.id), { status, completed_at: status === 'concluida' ? new Date().toISOString() : null });
      invalidate();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  const progress = (t: Row) => {
    const subs = all.filter((s) => s.parent_id === t.id);
    const cl = (t.checklist as Check[] | null) ?? [];
    const total = subs.length + cl.length;
    if (!total) return null;
    return Math.round(((subs.filter((s) => s.status === 'concluida').length + cl.filter((c) => c.done).length) / total) * 100);
  };
  const item = (t: Row) => {
    const p = progress(t);
    const overdue = t.due_date && String(t.due_date) < today && t.status !== 'concluida';
    return (
      <button key={String(t.id)} draggable onDragStart={() => setDragId(String(t.id))} onClick={() => { setEditing(t); setOpen(true); }} className="block w-full rounded-2xl border border-tangerine-100 bg-white p-3 text-left shadow-sm transition hover:shadow-[var(--shadow-soft)]">
        <p className={clsx('text-sm font-semibold', t.status === 'concluida' && 'line-through opacity-60')}>{String(t.title)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone={PRIORITY[String(t.priority)]}>{String(t.priority)}</Badge>
          {t.due_date ? <Badge tone={overdue ? 'danger' : 'neutral'} icon={false}>{overdue ? 'Vencida · ' : ''}{formatDateBR(t.due_date as string)}</Badge> : null}
          {(t.assignee as Row | null)?.full_name ? <span className="text-xs text-cocoa-700">{String((t.assignee as Row).full_name)}</span> : null}
        </div>
        {p !== null && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-tangerine-100" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso"><div className="h-full rounded-full bg-gradient-to-r from-tangerine-500 to-tangerine-800" style={{ width: `${p}%` }} /></div>}
      </button>
    );
  };

  const doneRate = top.length ? Math.round((top.filter((t) => t.status === 'concluida').length / top.length) * 100) : 0;
  const weekP = periodFor('semana', today);
  const monthP = periodFor('mes', today);

  return (
    <div className="animate-fade-in">
      <PageHeader title="Tarefas" subtitle={`Central de produtividade · ${doneRate}% concluído`} actions={can('organizacao', 'create') && <Button icon={<Plus className="size-4" />} onClick={() => { setEditing(null); setOpen(true); }}>Nova tarefa</Button>} />
      <Tabs tabs={[{ key: 'kanban', label: 'Kanban' }, { key: 'lista', label: 'Lista' }, { key: 'minhas', label: 'Minha rotina' }, { key: 'semana', label: 'Planejamento semanal' }, { key: 'mes', label: 'Planejamento mensal' }]} value={view} onChange={setView} />
      {view === 'kanban' && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {(['a_fazer', 'em_andamento', 'bloqueada', 'concluida'] as const).map((s) => (
            <div key={s} onDragOver={(e) => e.preventDefault()} onDrop={() => { const t = all.find((x) => x.id === dragId); if (t && t.status !== s) setStatus(t, s); setDragId(null); }} className="card min-h-60 p-3">
              <p className="mb-3 flex items-center justify-between font-display font-bold">{STATUS[s]![0]}<span className="num rounded-full bg-white px-2 text-xs">{top.filter((t) => t.status === s).length}</span></p>
              <div className="space-y-2">{top.filter((t) => t.status === s).map(item)}</div>
            </div>
          ))}
        </div>
      )}
      {view === 'lista' && (
        <Card opaque>{top.length === 0 ? <EmptyState title="Nenhuma tarefa" /> : (
          <ul className="divide-y divide-tangerine-100">{top.map((t) => (
            <li key={String(t.id)} className="flex items-center gap-3 py-2.5">
              <input type="checkbox" aria-label={`Concluir ${String(t.title)}`} className="size-5 accent-[var(--color-tangerine-800)]" checked={t.status === 'concluida'} onChange={(e) => setStatus(t, e.target.checked ? 'concluida' : 'a_fazer')} />
              <button className="flex-1 text-left text-sm" onClick={() => { setEditing(t); setOpen(true); }}><span className={t.status === 'concluida' ? 'line-through opacity-60' : ''}>{String(t.title)}</span></button>
              <Badge tone={STATUS[String(t.status)]![1]}>{STATUS[String(t.status)]![0]}</Badge><span className="w-24 text-right text-xs text-cocoa-700">{formatDateBR(t.due_date as string)}</span>
            </li>))}</ul>
        )}</Card>
      )}
      {view === 'minhas' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Hoje e atrasadas"><div className="space-y-2">{top.filter((t) => t.assignee_id === user?.id || !t.assignee_id).filter((t) => t.status !== 'concluida' && (!t.due_date || String(t.due_date) <= today)).map(item)}</div></Card>
          <Card title="Próximos 7 dias"><div className="space-y-2">{top.filter((t) => (t.assignee_id === user?.id || !t.assignee_id) && t.status !== 'concluida' && t.due_date && String(t.due_date) > today && String(t.due_date) <= addDays(today, 7)).map(item)}</div></Card>
        </div>
      )}
      {(view === 'semana' || view === 'mes') && (() => {
        const p = view === 'semana' ? weekP : monthP;
        const days: string[] = [];
        for (let d = p.start; d <= p.end; d = addDays(d, 1)) days.push(d);
        return (
          <div className={clsx('grid gap-2', view === 'semana' ? 'grid-cols-1 sm:grid-cols-7' : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7')}>
            {days.map((d) => (
              <div key={d} className={clsx('card min-h-28 p-2', d === today && 'ring-2 ring-tangerine-700')}>
                <p className="mb-1 text-xs font-bold">{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][weekday(d)]} {d.slice(8)}/{d.slice(5, 7)}</p>
                <div className="space-y-1">{top.filter((t) => t.due_date === d).map((t) => <button key={String(t.id)} onClick={() => { setEditing(t); setOpen(true); }} className={clsx('block w-full truncate rounded-lg bg-white px-2 py-1 text-left text-xs', t.status === 'concluida' && 'line-through opacity-60')}>{String(t.title)}</button>)}</div>
              </div>
            ))}
          </div>
        );
      })()}
      {open && <TaskDialog task={editing} all={all} onClose={() => { setOpen(false); if (params.get('novo')) { const np = new URLSearchParams(params); np.delete('novo'); setParams(np, { replace: true }); } }} />}
    </div>
  );
}

function TaskDialog({ task, all, onClose }: { task: Row | null; all: Row[]; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const profiles = useList<Row>('profiles', { select: 'id,full_name', filters: [{ column: 'active', op: 'eq', value: true }] });
  const comments = useList<Row>('task_comments', { filters: [{ column: 'task_id', op: 'eq', value: task?.id }], order: [{ column: 'created_at' }] }, { enabled: !!task });
  const [v, setV] = useState({ title: '', description: '', assignee_id: '', due_date: '', priority: 'normal', category: '', status: 'a_fazer', recurrence_rule: '' });
  const [checklist, setChecklist] = useState<Check[]>([]);
  const [newItem, setNewItem] = useState('');
  const [newSub, setNewSub] = useState('');
  const [comment, setComment] = useState('');
  const subs = task ? all.filter((s) => s.parent_id === task.id) : [];
  useEffect(() => {
    if (task) {
      setV({ title: String(task.title), description: String(task.description ?? ''), assignee_id: String(task.assignee_id ?? ''), due_date: String(task.due_date ?? ''), priority: String(task.priority), category: String(task.category ?? ''), status: String(task.status), recurrence_rule: String(task.recurrence_rule ?? '') });
      setChecklist((task.checklist as Check[] | null) ?? []);
    }
  }, [task]);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const save = async () => {
    if (!v.title.trim()) return toast('Informe o título.', 'warning');
    const values: Row = { ...v, assignee_id: v.assignee_id || null, due_date: v.due_date || null, category: v.category || null, recurrence_rule: v.recurrence_rule || null, checklist, completed_at: v.status === 'concluida' ? new Date().toISOString() : null };
    try {
      if (task) await db().update('tasks', String(task.id), values);
      else await db().insert('tasks', values);
      invalidate();
      toast('Tarefa salva.');
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  const addSub = async () => {
    if (!task || !newSub.trim()) return;
    await db().insert('tasks', { title: newSub, parent_id: task.id, status: 'a_fazer', priority: 'normal', checklist: [] });
    setNewSub('');
    invalidate();
  };
  const addComment = async () => {
    if (!task || !comment.trim()) return;
    await db().insert('task_comments', { task_id: task.id, body: comment });
    setComment('');
    invalidate();
  };
  return (
    <Modal open onClose={onClose} drawer title={task ? 'Tarefa' : 'Nova tarefa'} footer={<>{task && can('organizacao', 'edit') && <Button variant="ghost" onClick={async () => { await db().update('tasks', String(task.id), { status: 'cancelada' }); invalidate(); onClose(); }}>Cancelar tarefa</Button>}{can('organizacao', task ? 'edit' : 'create') && <Button onClick={save}>Salvar</Button>}</>}>
      <div className="space-y-4">
        <TextInput label="Título" required value={v.title} onChange={set('title')} />
        <div className="grid grid-cols-2 gap-3">
          <SelectInput label="Responsável" placeholder="Ninguém" options={(profiles.data?.rows ?? []).map((p) => ({ value: String(p.id), label: String(p.full_name || 'Sem nome') }))} value={v.assignee_id} onChange={set('assignee_id')} />
          <TextInput label="Prazo" type="date" value={v.due_date} onChange={set('due_date')} />
          <SelectInput label="Prioridade" options={Object.keys(PRIORITY).map((p) => ({ value: p, label: p }))} value={v.priority} onChange={set('priority')} />
          <SelectInput label="Status" options={Object.entries(STATUS).map(([value, [label]]) => ({ value, label }))} value={v.status} onChange={set('status')} />
          <TextInput label="Categoria" value={v.category} onChange={set('category')} placeholder="financeiro, comercial…" />
          <SelectInput label="Recorrência" options={[['', 'Nenhuma'], ['FREQ=DAILY', 'Diária'], ['FREQ=WEEKLY', 'Semanal'], ['FREQ=MONTHLY', 'Mensal'], ['FREQ=YEARLY', 'Anual']].map(([value, label]) => ({ value: value!, label: label! }))} value={v.recurrence_rule} onChange={set('recurrence_rule')} />
        </div>
        <TextArea label="Descrição" value={v.description} onChange={set('description')} />
        <div>
          <p className="label">Checklist</p>
          {checklist.map((c, i) => (
            <div key={i} className="flex items-center gap-2"><Checkbox label={c.text} checked={c.done} onChange={(e) => setChecklist((l) => l.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} /><Button size="icon" variant="ghost" aria-label="Remover item" onClick={() => setChecklist((l) => l.filter((_, j) => j !== i))} icon={<Trash2 className="size-4" />} /></div>
          ))}
          <div className="mt-1 flex gap-2"><input className="input" placeholder="Novo item" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newItem.trim()) { setChecklist((l) => [...l, { text: newItem, done: false }]); setNewItem(''); } }} aria-label="Novo item do checklist" /><Button variant="soft" onClick={() => { if (newItem.trim()) { setChecklist((l) => [...l, { text: newItem, done: false }]); setNewItem(''); } }}>Adicionar</Button></div>
        </div>
        {task && (
          <>
            <div>
              <p className="label">Subtarefas</p>
              <ul className="space-y-1 text-sm">{subs.map((s) => <li key={String(s.id)} className="flex items-center gap-2"><input type="checkbox" aria-label={String(s.title)} className="size-4 accent-[var(--color-tangerine-800)]" checked={s.status === 'concluida'} onChange={async (e) => { await db().update('tasks', String(s.id), { status: e.target.checked ? 'concluida' : 'a_fazer' }); invalidate(); }} />{String(s.title)}</li>)}</ul>
              <div className="mt-1 flex gap-2"><input className="input" placeholder="Nova subtarefa" value={newSub} onChange={(e) => setNewSub(e.target.value)} aria-label="Nova subtarefa" /><Button variant="soft" onClick={addSub}>Adicionar</Button></div>
            </div>
            <div>
              <p className="label">Comentários</p>
              <ul className="space-y-2 text-sm">{(comments.data?.rows ?? []).map((c) => <li key={String(c.id)} className="rounded-xl bg-cream-100 p-2">{String(c.body)}</li>)}</ul>
              <div className="mt-1 flex gap-2"><input className="input" placeholder="Escreva um comentário" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comentário" /><Button variant="soft" onClick={addComment}>Enviar</Button></div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

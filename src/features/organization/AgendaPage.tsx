import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, Plus, Repeat } from 'lucide-react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card, Tabs } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, friendlyError } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Overlay';
import { SelectInput, TextArea, TextInput } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { addDays, addMonths, fromSPLocalInput, toSPLocalInput, todaySP, weekday, formatDateBR } from '@/domain/dates';
import { buildRRule, describeRRule, occurrences } from '@/domain/recurrence';

const KINDS = { reuniao: 'Reunião', entrega: 'Entrega', recolhimento: 'Recolhimento', visita_tecnica: 'Visita técnica', manutencao: 'Manutenção', assepsia: 'Assepsia', evento_comercial: 'Evento comercial', cobranca: 'Cobrança', compra: 'Compra', pagamento: 'Pagamento', compromisso: 'Compromisso administrativo', estrategico: 'Compromisso estratégico' };
const COLORS: Record<string, string> = { reuniao: '#D64101', entrega: '#1f5fa8', recolhimento: '#4b6cb7', visita_tecnica: '#8a5a00', manutencao: '#8a5a00', assepsia: '#1e7a46', evento_comercial: '#FC6500', cobranca: '#b3261e', compra: '#69351F', pagamento: '#b3261e', compromisso: '#92543A', estrategico: '#A63900' };
const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
type View = 'dia' | 'semana' | 'mes' | 'ano' | 'lista';

interface Occ { ev: Row; start: Date; day: string }
const spDay = (d: Date) => toSPLocalInput(d.toISOString()).slice(0, 10);
const spTime = (d: Date) => toSPLocalInput(d.toISOString()).slice(11, 16);

export function AgendaPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>('mes');
  const [cursor, setCursor] = useState(todaySP());
  const [editing, setEditing] = useState<Row | null>(null);
  const [open, setOpen] = useState(params.get('novo') === '1');
  const [kind, setKind] = useState('');

  const range = useMemo(() => {
    const [y, m] = cursor.split('-');
    if (view === 'dia') return { start: cursor, end: addDays(cursor, 1) };
    if (view === 'semana') { const s = addDays(cursor, -weekday(cursor)); return { start: s, end: addDays(s, 7) }; }
    if (view === 'ano') return { start: `${y}-01-01`, end: `${Number(y) + 1}-01-01` };
    if (view === 'lista') return { start: cursor, end: addDays(cursor, 60) };
    const first = `${y}-${m}-01`;
    const s = addDays(first, -weekday(first));
    return { start: s, end: addDays(s, 42) };
  }, [view, cursor]);

  const q = useList<Row>('calendar_events', { filters: [{ column: 'status', op: 'neq', value: 'cancelado' }, ...(kind ? [{ column: 'kind', op: 'eq' as const, value: kind }] : [])], order: [{ column: 'starts_at' }], range: [0, 1999] });
  const occ: Occ[] = useMemo(() => {
    const from = new Date(`${range.start}T00:00:00-03:00`);
    const to = new Date(`${range.end}T00:00:00-03:00`);
    return (q.data?.rows ?? []).flatMap((ev) => occurrences(String(ev.starts_at), ev.recurrence_rule as string | null, from, to).map((start) => ({ ev, start, day: spDay(start) }))).sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [q.data, range]);
  const byDay = useMemo(() => occ.reduce<Record<string, Occ[]>>((acc, o) => ({ ...acc, [o.day]: [...(acc[o.day] ?? []), o] }), {}), [occ]);

  const move = (dir: 1 | -1) => setCursor((c) => (view === 'dia' ? addDays(c, dir) : view === 'semana' ? addDays(c, 7 * dir) : view === 'ano' ? addMonths(c, 12 * dir) : view === 'lista' ? addDays(c, 30 * dir) : addMonths(c, dir)));
  const [y, m] = cursor.split('-').map(Number) as [number, number];
  const title = view === 'ano' ? String(y) : view === 'mes' ? `${MONTHS[m - 1]} de ${y}` : view === 'dia' ? formatDateBR(cursor) : `${formatDateBR(range.start)} – ${formatDateBR(addDays(range.end, -1))}`;
  const pill = (o: Occ) => (
    <button key={`${o.ev.id}-${o.start.getTime()}`} onClick={() => { setEditing(o.ev); setOpen(true); }} className="flex w-full items-center gap-1 truncate rounded-lg px-1.5 py-0.5 text-left text-[11px] font-medium text-white" style={{ background: String(o.ev.color ?? COLORS[String(o.ev.kind)] ?? '#D64101') }} title={String(o.ev.title)}>
      {!o.ev.all_day && <span className="num opacity-90">{spTime(o.start)}</span>} <span className="truncate">{String(o.ev.title)}</span>{o.ev.recurrence_rule ? <Repeat className="size-3 shrink-0" aria-label="recorrente" /> : null}
    </button>
  );

  return (
    <div className="animate-fade-in">
      <PageHeader title="Agenda" subtitle="Compromissos internos, entregas, visitas e reuniões recorrentes. Sincronização com Google Agenda em Integrações."
        actions={can('organizacao', 'create') && <Button icon={<Plus className="size-4" />} onClick={() => { setEditing(null); setOpen(true); }}>Novo compromisso</Button>} />
      <Tabs tabs={[{ key: 'dia', label: 'Dia' }, { key: 'semana', label: 'Semana' }, { key: 'mes', label: 'Mês' }, { key: 'ano', label: 'Ano' }, { key: 'lista', label: 'Lista' }]} value={view} onChange={setView} />
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <Button variant="secondary" size="icon" aria-label="Anterior" onClick={() => move(-1)} icon={<ChevronLeft className="size-4" />} />
        <Button variant="secondary" size="icon" aria-label="Próximo" onClick={() => move(1)} icon={<ChevronRight className="size-4" />} />
        <Button variant="ghost" size="sm" onClick={() => setCursor(todaySP())}>Hoje</Button>
        <h2 className="font-display text-lg font-bold">{title}</h2>
        <select aria-label="Tipo" className="input ml-auto h-10 w-auto py-0 text-sm" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Todos os tipos</option>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>

      {view === 'mes' && (
        <div className="surface overflow-hidden rounded-[var(--radius-card)]">
          <div className="grid grid-cols-7 bg-cream-100 text-center text-xs font-semibold uppercase text-cocoa-700">{WEEK.map((w) => <div key={w} className="py-2">{w}</div>)}</div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 42 }, (_, i) => addDays(range.start, i)).map((d) => (
              <div key={d} className={clsx('min-h-24 border-t border-l border-tangerine-100 p-1 sm:min-h-28', d.slice(5, 7) !== String(m).padStart(2, '0') && 'bg-cream-100/50 text-cocoa-500')}>
                <button onClick={() => { setCursor(d); setView('dia'); }} className={clsx('num mb-1 grid size-6 place-items-center rounded-full text-xs font-semibold', d === todaySP() && 'bg-tangerine-800 text-white')}>{Number(d.slice(8))}</button>
                <div className="space-y-0.5">{(byDay[d] ?? []).slice(0, 3).map(pill)}{(byDay[d]?.length ?? 0) > 3 && <p className="text-[10px] text-cocoa-700">+{byDay[d]!.length - 3}</p>}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {(view === 'semana' || view === 'dia') && (
        <div className={clsx('grid gap-2', view === 'semana' ? 'grid-cols-1 sm:grid-cols-7' : 'grid-cols-1')}>
          {Array.from({ length: view === 'semana' ? 7 : 1 }, (_, i) => addDays(range.start, i)).map((d) => (
            <Card key={d} className={clsx('min-h-40 p-3', d === todaySP() && 'ring-2 ring-tangerine-700')}>
              <p className="mb-2 text-sm font-bold">{WEEK[weekday(d)]} {formatDateBR(d).slice(0, 5)}</p>
              <div className="space-y-1">{(byDay[d] ?? []).map(pill)}{!(byDay[d] ?? []).length && <p className="text-xs text-cocoa-700">Livre</p>}</div>
            </Card>
          ))}
        </div>
      )}
      {view === 'ano' && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {MONTHS.map((name, i) => { const mm = String(i + 1).padStart(2, '0'); const count = occ.filter((o) => o.day.slice(5, 7) === mm).length; return (
            <button key={name} onClick={() => { setCursor(`${y}-${mm}-01`); setView('mes'); }} className="card card-sm text-left hover:shadow-[var(--shadow-lift)]"><p className="font-display font-bold">{name}</p><p className="num text-sm text-cocoa-700">{count} compromisso(s)</p></button>); })}
        </div>
      )}
      {view === 'lista' && (
        <Card opaque>{occ.length === 0 ? <EmptyState title="Nenhum compromisso nos próximos 60 dias" /> : (
          <ul className="divide-y divide-tangerine-100">{occ.map((o) => (
            <li key={`${o.ev.id}-${o.start.getTime()}`}><button onClick={() => { setEditing(o.ev); setOpen(true); }} className="flex w-full flex-wrap items-center gap-3 py-2.5 text-left text-sm hover:bg-cream-100/60">
              <span className="num w-28 text-cocoa-700">{formatDateBR(o.day)} {o.ev.all_day ? '' : spTime(o.start)}</span>
              <span className="size-2.5 rounded-full" style={{ background: String(o.ev.color ?? COLORS[String(o.ev.kind)]) }} aria-hidden />
              <span className="flex-1 font-medium">{String(o.ev.title)}</span><Badge>{KINDS[o.ev.kind as keyof typeof KINDS]}</Badge>
              {o.ev.recurrence_rule ? <span className="text-xs text-cocoa-700">{describeRRule(String(o.ev.recurrence_rule))}</span> : null}
            </button></li>))}</ul>
        )}</Card>
      )}
      {open && <EventDialog ev={editing} onClose={() => { setOpen(false); if (params.get('novo')) { const p = new URLSearchParams(params); p.delete('novo'); setParams(p, { replace: true }); } }} />}
    </div>
  );
}

function presetFor(rule: string | null): string {
  if (!rule) return '';
  if (rule === 'FREQ=DAILY') return 'diaria';
  if (rule.includes('INTERVAL=2')) return 'quinzenal';
  if (rule.includes('MO,TU,WE,TH,FR')) return 'dias_uteis';
  if (rule.startsWith('FREQ=WEEKLY')) return 'semanal';
  if (rule === 'FREQ=MONTHLY') return 'mensal';
  if (rule === 'FREQ=YEARLY') return 'anual';
  return 'custom';
}

function EventDialog({ ev, onClose }: { ev: Row | null; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [v, setV] = useState({ title: '', kind: 'compromisso', start: `${todaySP()}T09:00`, end: `${todaySP()}T10:00`, all_day: false, location: '', priority: 'normal', recurrence: '', reminder: '30', notes: '', color: '' });
  useEffect(() => {
    if (ev) setV({ title: String(ev.title), kind: String(ev.kind), start: toSPLocalInput(ev.starts_at as string), end: toSPLocalInput(ev.ends_at as string), all_day: Boolean(ev.all_day), location: String(ev.location ?? ''), priority: String(ev.priority ?? 'normal'), recurrence: presetFor(ev.recurrence_rule as string | null), reminder: String((ev.reminder_minutes as number[] | null)?.[0] ?? 30), notes: String(ev.notes ?? ''), color: String(ev.color ?? '') });
  }, [ev]);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const save = async () => {
    if (!v.title.trim()) return toast('Informe o título.', 'warning');
    const starts = fromSPLocalInput(v.start)!;
    const values: Row = { title: v.title, kind: v.kind, starts_at: starts, ends_at: fromSPLocalInput(v.end), all_day: v.all_day, location: v.location || null, priority: v.priority, notes: v.notes || null, color: v.color || null,
      recurrence_rule: v.recurrence === 'custom' ? ev?.recurrence_rule ?? null : buildRRule(v.recurrence, starts), reminder_minutes: v.reminder ? [Number(v.reminder)] : [] };
    try {
      if (ev) await db().update('calendar_events', String(ev.id), values);
      else await db().insert('calendar_events', values);
      invalidate();
      toast('Compromisso salvo.');
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  const cancel = async () => {
    if (!ev || !confirm('Cancelar este compromisso (todas as ocorrências)?')) return;
    try {
      await db().update('calendar_events', String(ev.id), { status: 'cancelado' });
      invalidate();
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  return (
    <Modal open onClose={onClose} title={ev ? 'Compromisso' : 'Novo compromisso'} size="md" footer={<>{ev && can('organizacao', 'edit') && <Button variant="ghost" onClick={cancel}>Cancelar compromisso</Button>}{can('organizacao', ev ? 'edit' : 'create') && <Button onClick={save}>Salvar</Button>}</>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextInput wrapperClassName="sm:col-span-2" label="Título" required value={v.title} onChange={set('title')} />
        <SelectInput label="Tipo" options={Object.entries(KINDS).map(([value, label]) => ({ value, label }))} value={v.kind} onChange={set('kind')} />
        <SelectInput label="Prioridade" options={[['baixa', 'Baixa'], ['normal', 'Normal'], ['alta', 'Alta'], ['urgente', 'Urgente']].map(([value, label]) => ({ value: value!, label: label! }))} value={v.priority} onChange={set('priority')} />
        <TextInput label="Início" type="datetime-local" value={v.start} onChange={set('start')} />
        <TextInput label="Fim" type="datetime-local" value={v.end} onChange={set('end')} />
        <SelectInput label="Repetição" options={[['', 'Não se repete'], ['diaria', 'Diariamente'], ['dias_uteis', 'Dias úteis'], ['semanal', 'Semanalmente (mesmo dia da semana)'], ['quinzenal', 'A cada 15 dias'], ['mensal', 'Mensalmente'], ['anual', 'Anualmente'], ...(presetFor((ev?.recurrence_rule as string) ?? null) === 'custom' ? [['custom', describeRRule(ev?.recurrence_rule as string)]] : [])].map(([value, label]) => ({ value: value!, label: label! }))} value={v.recurrence} onChange={set('recurrence')} hint="Ex.: reunião toda terça pela manhã; reunião quinzenal com parceiros." />
        <SelectInput label="Lembrete" options={[['', 'Sem lembrete'], ['10', '10 min antes'], ['30', '30 min antes'], ['60', '1 hora antes'], ['1440', '1 dia antes']].map(([value, label]) => ({ value: value!, label: label! }))} value={v.reminder} onChange={set('reminder')} />
        <TextInput label="Local" value={v.location} onChange={set('location')} />
        <TextInput label="Cor (opcional)" type="color" value={v.color || '#D64101'} onChange={set('color')} />
        <TextArea wrapperClassName="sm:col-span-2" label="Observações" value={v.notes} onChange={set('notes')} />
      </div>
    </Modal>
  );
}

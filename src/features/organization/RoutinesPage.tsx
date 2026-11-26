import { useMemo } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { Card } from '@/components/ui/Layout';
import { friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { ResourcePage } from '@/features/resource/ResourcePage';
import { routinesDef } from '@/features/resource/definitions';
import { addDays, todaySP, periodFor } from '@/domain/dates';

/** Rotinas e hábitos com registro diário e percentual de conclusão no período. */
export function RoutinesPage() {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const routines = useList<Row>('routines', { filters: [{ column: 'active', op: 'eq', value: true }], order: [{ column: 'title' }] });
  const logs = useList<Row>('routine_logs', { filters: [{ column: 'done_on', op: 'gte', value: addDays(todaySP(), -40) }], range: [0, 9999] });
  const today = todaySP();
  const stats = useMemo(() => (routines.data?.rows ?? []).map((r) => {
    const p = r.frequency === 'diaria' ? { start: addDays(today, -6), end: today } : r.frequency === 'semanal' ? periodFor('semana', today) : r.frequency === 'mensal' ? periodFor('mes', today) : periodFor('ano', today);
    const mine = (logs.data?.rows ?? []).filter((l) => l.routine_id === r.id);
    const inPeriod = mine.filter((l) => String(l.done_on) >= p.start && String(l.done_on) <= p.end).length;
    const target = r.frequency === 'diaria' ? 7 * Number(r.target_per_period ?? 1) : Number(r.target_per_period ?? 1);
    return { r, doneToday: mine.find((l) => l.done_on === today), pct: Math.min(100, Math.round((inPeriod / target) * 100)) };
  }), [routines.data, logs.data, today]);

  const toggle = async (r: Row, log?: Row) => {
    try {
      if (log) await db().remove('routine_logs', String(log.id));
      else await db().insert('routine_logs', { routine_id: r.id, done_on: today });
      invalidate();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  return (
    <div className="space-y-6">
      {stats.length > 0 && (
        <Card title="Hoje">
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {stats.map(({ r, doneToday, pct }) => (
              <li key={String(r.id)}>
                <button onClick={() => toggle(r, doneToday)} aria-pressed={!!doneToday} className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left">
                  {doneToday ? <CheckCircle2 className="size-6 text-success-700" aria-hidden /> : <Circle className="size-6 text-cocoa-500" aria-hidden />}
                  <span className="flex-1"><span className="block text-sm font-semibold">{String(r.title)}</span><span className="text-xs text-cocoa-700">{String(r.kind)} · {String(r.frequency)} · {pct}% no período</span></span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <ResourcePage def={routinesDef} />
    </div>
  );
}

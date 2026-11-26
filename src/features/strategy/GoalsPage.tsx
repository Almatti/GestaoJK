import { useQueries } from '@tanstack/react-query';
import { ResourcePage } from '@/features/resource/ResourcePage';
import type { ResourceDef } from '@/features/resource/types';
import { opts } from '@/features/resource/definitions';
import { useList, db } from '@/data/hooks';
import type { Row } from '@/data/types';
import { Card } from '@/components/ui/Layout';
import { Badge } from '@/components/ui/Feedback';
import { formatNumber, formatReais } from '@/domain/money';
import { diffDays, formatDateBR, todaySP } from '@/domain/dates';

const METRIC = { faturamento: 'Faturamento (R$)', recebimentos: 'Recebimentos (R$)', litros_vendidos: 'Litros vendidos', pedidos: 'Pedidos', clientes_ativos: 'Clientes ativos', inadimplencia_percent: 'Inadimplência (%)', margem_contribuicao_percent: 'Margem (%)', equipamentos_ociosos: 'Equipamentos ociosos', manual: 'Indicador manual' };

const goalsDef: ResourceDef = {
  table: 'goals', title: 'Metas (SMART / OKR)', singular: 'Meta', resource: 'estrategia', searchColumns: ['title'], defaultOrder: [{ column: 'period_end' }],
  subtitle: 'Metas vinculadas a indicadores reais, calculados pelo banco de dados.',
  status: { column: 'status', map: { ativa: { label: 'Ativa', tone: 'info' }, concluida: { label: 'Concluída', tone: 'success' }, cancelada: { label: 'Cancelada', tone: 'neutral' } } },
  fields: [
    { name: 'title', label: 'Meta (específica e mensurável)', type: 'text', required: true, wide: true },
    { name: 'metric', label: 'Indicador vinculado', type: 'select', options: opts(METRIC), required: true },
    { name: 'target', label: 'Alvo', type: 'number', required: true },
    { name: 'direction', label: 'Melhor quando', type: 'select', options: opts({ maior: 'Maior', menor: 'Menor' }), defaultValue: 'maior' },
    { name: 'period_start', label: 'Início', type: 'date', required: true },
    { name: 'period_end', label: 'Fim', type: 'date', required: true },
    { name: 'manual_value', label: 'Valor atual (apenas indicador manual)', type: 'number' },
    { name: 'okr_parent', label: 'Objetivo pai (OKR)', type: 'ref', ref: { table: 'goals', label: 'title' } },
    { name: 'owner_id', label: 'Responsável', type: 'ref', ref: { table: 'profiles', label: 'full_name' } },
    { name: 'status', label: 'Situação', type: 'select', options: opts({ ativa: 'Ativa', concluida: 'Concluída', cancelada: 'Cancelada' }), defaultValue: 'ativa' },
    { name: 'notes', label: 'Plano de ação', type: 'textarea' }
  ],
  columns: [{ key: 'title', label: 'Meta' }, { key: 'metric', label: 'Indicador', render: (r) => METRIC[r.metric as keyof typeof METRIC] }, { key: 'target', label: 'Alvo', format: 'number', align: 'right' }, { key: 'period_end', label: 'Prazo', format: 'date' }, { key: 'status', label: 'Situação' }]
};

export function GoalsPage() {
  const goals = useList<Row>('goals', { filters: [{ column: 'status', op: 'eq', value: 'ativa' }], range: [0, 99] });
  const values = useQueries({ queries: (goals.data?.rows ?? []).map((g) => ({ queryKey: ['kpi', g.id, g.metric, g.period_start, g.period_end], queryFn: () => (g.metric === 'manual' ? Promise.resolve(Number(g.manual_value ?? 0)) : db().rpc<number | null>('kpi_value', { p_metric: g.metric, p_start: g.period_start, p_end: g.period_end })) })) });
  const t = todaySP();
  return (
    <div className="space-y-6">
      {(goals.data?.rows ?? []).length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {goals.data!.rows.map((g, i) => {
            const v = values[i]?.data;
            const target = Number(g.target);
            const pct = v == null ? null : g.direction === 'menor' ? (Number(v) <= target ? 100 : Math.max(0, (target / Number(v)) * 100)) : Math.min(100, (Number(v) / target) * 100);
            const total = Math.max(1, diffDays(String(g.period_start), String(g.period_end)));
            const elapsed = Math.min(1, Math.max(0, diffDays(String(g.period_start), t) / total));
            const behind = pct !== null && g.direction === 'maior' && pct / 100 < elapsed - 0.15;
            const money = ['faturamento', 'recebimentos'].includes(String(g.metric));
            return (
              <Card key={String(g.id)}>
                <div className="flex items-start justify-between gap-2"><p className="font-display font-bold">{String(g.title)}</p>{behind ? <Badge tone="danger">Abaixo do esperado</Badge> : pct === 100 ? <Badge tone="success">Atingida</Badge> : <Badge tone="info">No ritmo</Badge>}</div>
                <p className="mt-1 text-xs text-cocoa-700">{METRIC[g.metric as keyof typeof METRIC]} · até {formatDateBR(g.period_end as string)}</p>
                <p className="num mt-3 text-2xl font-extrabold">{v == null ? '—' : money ? formatReais(Number(v)) : formatNumber(Number(v), 1)} <span className="text-sm font-medium text-cocoa-700">/ {money ? formatReais(target) : formatNumber(target)}</span></p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-tangerine-100" role="progressbar" aria-valuenow={Math.round(pct ?? 0)} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso da meta"><div className="h-full rounded-full bg-gradient-to-r from-tangerine-500 to-tangerine-800" style={{ width: `${pct ?? 0}%` }} /></div>
                <p className="mt-1 text-xs text-cocoa-700">{Math.round(pct ?? 0)}% do alvo · {Math.round(elapsed * 100)}% do prazo decorrido</p>
              </Card>
            );
          })}
        </div>
      )}
      <ResourcePage def={goalsDef} />
    </div>
  );
}

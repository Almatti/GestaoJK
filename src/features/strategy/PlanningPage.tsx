import { useState } from 'react';
import { useList } from '@/data/hooks';
import type { Row } from '@/data/types';
import { Card, Tabs, PageHeader } from '@/components/ui/Layout';
import { ResourcePage } from '@/features/resource/ResourcePage';
import { projectsDef, strategyDef } from '@/features/resource/definitions';

const SWOT: [string, string, string][] = [['swot_forca', 'Forças', 'bg-success-50'], ['swot_fraqueza', 'Fraquezas', 'bg-danger-50'], ['swot_oportunidade', 'Oportunidades', 'bg-info-50'], ['swot_ameaca', 'Ameaças', 'bg-warning-50']];

export function PlanningPage() {
  const [tab, setTab] = useState<'swot' | 'itens' | 'projetos'>('swot');
  const items = useList<Row>('strategy_items', { filters: [{ column: 'kind', op: 'in', value: SWOT.map((s) => s[0]) }], range: [0, 499] });
  const risks = useList<Row>('strategy_items', { filters: [{ column: 'kind', op: 'eq', value: 'risco' }], range: [0, 199] });
  return (
    <div>
      <PageHeader title="Planejamento estratégico" subtitle="SWOT, riscos, objetivos, OKRs, planos de ação, personas, concorrentes e projetos internos." />
      <Tabs tabs={[{ key: 'swot', label: 'SWOT e riscos' }, { key: 'itens', label: 'Objetivos, OKRs, planos e personas' }, { key: 'projetos', label: 'Projetos internos' }]} value={tab} onChange={setTab} />
      {tab === 'swot' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {SWOT.map(([k, label, bg]) => (
              <Card key={k} title={label} className={bg}>
                <ul className="list-disc space-y-1 pl-5 text-sm">{(items.data?.rows ?? []).filter((i) => i.kind === k).map((i) => <li key={String(i.id)}>{String(i.title)}</li>)}</ul>
                {!(items.data?.rows ?? []).some((i) => i.kind === k) && <p className="text-sm text-cocoa-700">Adicione itens na aba “Objetivos…” escolhendo o tipo SWOT.</p>}
              </Card>
            ))}
          </div>
          <Card opaque title="Matriz de riscos (impacto × probabilidade)">
            {(risks.data?.rows ?? []).length === 0 ? <p className="text-sm text-cocoa-700">Nenhum risco cadastrado.</p> : (
              <ul className="space-y-1 text-sm">{[...risks.data!.rows].sort((a, b) => Number(b.impact ?? 0) * Number(b.probability ?? 0) - Number(a.impact ?? 0) * Number(a.probability ?? 0)).map((r) => <li key={String(r.id)} className="flex justify-between gap-2"><span>{String(r.title)}</span><span className="num">Severidade {Number(r.impact ?? 0) * Number(r.probability ?? 0)}</span></li>)}</ul>
            )}
          </Card>
        </div>
      )}
      {tab === 'itens' && <ResourcePage def={strategyDef} />}
      {tab === 'projetos' && <ResourcePage def={projectsDef} />}
    </div>
  );
}

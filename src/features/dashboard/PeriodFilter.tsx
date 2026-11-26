import type { Period, PeriodPreset } from '@/domain/dates';

const PRESETS: [PeriodPreset, string][] = [['hoje', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês'], ['trimestre', 'Trimestre'], ['semestre', 'Semestre'], ['ano', 'Ano'], ['personalizado', 'Personalizado']];

export function PeriodFilter({ preset, onPreset, custom, onCustom }: { preset: PeriodPreset; onPreset: (p: PeriodPreset) => void; custom: Period; onCustom: (p: Period) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Período" className="input h-10 w-auto py-0 text-sm" value={preset} onChange={(e) => onPreset(e.target.value as PeriodPreset)}>
        {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {preset === 'personalizado' && (
        <>
          <input type="date" aria-label="Início" className="input h-10 w-auto py-0 text-sm" value={custom.start} onChange={(e) => onCustom({ ...custom, start: e.target.value })} />
          <input type="date" aria-label="Fim" className="input h-10 w-auto py-0 text-sm" value={custom.end} onChange={(e) => onCustom({ ...custom, end: e.target.value })} />
        </>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { useList, useRpc, db } from '@/data/hooks';
import type { Row } from '@/data/types';
import { PageHeader, Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, LoadingBlock, friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { PeriodFilter } from '@/features/dashboard/PeriodFilter';
import { formatReais, formatPercent } from '@/domain/money';
import { periodFor, todaySP, formatDateBR, type Period, type PeriodPreset } from '@/domain/dates';
import { exportCsv, exportExcel, exportPdf, type ExportColumn } from '@/lib/export';

const DRE_LINES: [string, string, boolean?][] = [
  ['receita_bruta', 'Receita bruta', true], ['deducoes_estimadas', '(−) Deduções/tributos estimados'], ['receita_liquida', 'Receita líquida', true], ['cmv', '(−) Custo dos produtos vendidos'],
  ['lucro_bruto', 'Lucro bruto', true], ['despesas_variaveis', '(−) Despesas variáveis'], ['margem_contribuicao', 'Margem de contribuição', true], ['despesas_fixas', '(−) Despesas fixas'],
  ['resultado_operacional', 'Resultado operacional', true], ['receitas_financeiras', '(+) Receitas financeiras (juros/multas)'], ['despesas_financeiras', '(−) Despesas financeiras'], ['resultado_gerencial', 'Resultado gerencial', true]
];

interface ReportDef { key: string; label: string; table: string; select?: string; dateColumn?: string; columns: ExportColumn[]; filters?: { column: string; op: 'eq' | 'in' | 'gt'; value: unknown }[] }
const REPORTS: ReportDef[] = [
  { key: 'faturamento', label: 'Faturamento (pedidos)', table: 'orders', dateColumn: 'order_date', select: '*,customer:customers(name)', filters: [{ column: 'status', op: 'in', value: ['confirmado', 'em_preparacao', 'aguardando_entrega', 'em_rota', 'entregue', 'aguardando_recolhimento', 'finalizado'] }],
    columns: [{ key: 'number', label: 'Pedido' }, { key: 'order_date', label: 'Data', format: 'date' }, { key: 'customer', label: 'Cliente', value: (r) => (r.customer as Row | null)?.name }, { key: 'kind', label: 'Tipo' }, { key: 'total_liters', label: 'Litros', format: 'number' }, { key: 'total', label: 'Total', format: 'money' }, { key: 'total_cost', label: 'Custo', format: 'money' }, { key: 'margin_percent', label: 'Margem %', format: 'percent' }] },
  { key: 'recebimentos', label: 'Recebimentos', table: 'payments', dateColumn: 'paid_at', filters: [{ column: 'direction', op: 'eq', value: 'entrada' }],
    columns: [{ key: 'paid_at', label: 'Data', format: 'date' }, { key: 'method', label: 'Forma' }, { key: 'amount', label: 'Valor', format: 'money' }, { key: 'verified', label: 'Conferido', format: 'boolean' }, { key: 'reversed_at', label: 'Estornado em', format: 'datetime' }] },
  { key: 'inadimplencia', label: 'Inadimplência / vencidos', table: 'receivables_view', filters: [{ column: 'financial_status', op: 'in', value: ['vencido', 'parcialmente_pago'] }],
    columns: [{ key: 'customer_name', label: 'Cliente' }, { key: 'description', label: 'Título' }, { key: 'due_date', label: 'Vencimento', format: 'date' }, { key: 'days_overdue', label: 'Dias de atraso', format: 'number' }, { key: 'outstanding', label: 'Em aberto', format: 'money' }] },
  { key: 'despesas', label: 'Contas a pagar / despesas', table: 'payables', dateColumn: 'competence_date', select: '*,category:financial_categories(name)',
    columns: [{ key: 'competence_date', label: 'Competência', format: 'date' }, { key: 'description', label: 'Descrição' }, { key: 'category', label: 'Categoria', value: (r) => (r.category as Row | null)?.name }, { key: 'due_date', label: 'Vencimento', format: 'date' }, { key: 'amount', label: 'Valor', format: 'money' }, { key: 'status', label: 'Situação' }] },
  { key: 'consumo', label: 'Consumo por cliente', table: 'customer_consumption',
    columns: [{ key: 'name', label: 'Cliente' }, { key: 'segment', label: 'Segmento' }, { key: 'orders_count', label: 'Pedidos', format: 'number' }, { key: 'total_liters', label: 'Litros (total)', format: 'number' }, { key: 'liters_30d', label: 'Litros 30d', format: 'number' }, { key: 'total_purchased', label: 'Total comprado', format: 'money' }, { key: 'average_ticket', label: 'Ticket médio', format: 'money' }, { key: 'last_order_date', label: 'Último pedido', format: 'date' }] },
  { key: 'estoque', label: 'Posição de estoque', table: 'stock_positions', columns: [{ key: 'name', label: 'Item' }, { key: 'kind', label: 'Tipo' }, { key: 'physical', label: 'Físico', format: 'number' }, { key: 'reserved', label: 'Reservado', format: 'number' }, { key: 'available', label: 'Disponível', format: 'number' }, { key: 'min_quantity', label: 'Mínimo', format: 'number' }] },
  { key: 'patrimonio', label: 'Patrimônio', table: 'equipment', select: '*,type:equipment_types(name),customer:customers(name)', columns: [{ key: 'asset_code', label: 'Código' }, { key: 'type', label: 'Tipo', value: (r) => (r.type as Row | null)?.name }, { key: 'status', label: 'Situação' }, { key: 'customer', label: 'Cliente', value: (r) => (r.customer as Row | null)?.name }, { key: 'custody_since', label: 'Desde', format: 'datetime' }, { key: 'acquisition_value', label: 'Valor aquisição', format: 'money' }] },
  { key: 'os', label: 'Ordens de serviço', table: 'service_orders', dateColumn: 'scheduled_date', columns: [{ key: 'number', label: 'OS' }, { key: 'scheduled_date', label: 'Data', format: 'date' }, { key: 'status', label: 'Situação' }, { key: 'cost', label: 'Custo', format: 'money' }, { key: 'charged_amount', label: 'Cobrado', format: 'money' }] },
  { key: 'parceiros', label: 'Extrato de parceiros', table: 'partner_ledger', dateColumn: 'occurred_on', select: '*,partner:partners(name)', columns: [{ key: 'occurred_on', label: 'Data', format: 'date' }, { key: 'partner', label: 'Parceiro', value: (r) => (r.partner as Row | null)?.name }, { key: 'entry_type', label: 'Tipo' }, { key: 'amount', label: 'Valor', format: 'money' }, { key: 'description', label: 'Descrição' }] }
];

export function ReportsPage() {
  const [preset, setPreset] = useState<PeriodPreset>('mes');
  const [custom, setCustom] = useState<Period>({ start: todaySP(), end: todaySP() });
  const period = useMemo(() => periodFor(preset, todaySP(), custom), [preset, custom]);
  const dre = useRpc<Record<string, number | string>>('dre', { p_start: period.start, p_end: period.end });
  const toast = useToast();
  const cats = useList<Row>('financial_categories', {});

  const run = async (r: ReportDef, kind: 'csv' | 'xls' | 'pdf') => {
    try {
      const filters = [...(r.filters ?? [])] as { column: string; op: 'eq' | 'in' | 'gte' | 'lte' | 'gt'; value: unknown }[];
      if (r.dateColumn) filters.push({ column: r.dateColumn, op: 'gte', value: period.start }, { column: r.dateColumn, op: 'lte', value: period.end });
      const { rows } = await db().list<Row>(r.table, { select: r.select, filters, range: [0, 9999] });
      const name = `${r.key}-${period.start}-a-${period.end}`;
      if (kind === 'csv') exportCsv(name, rows, r.columns);
      else if (kind === 'xls') exportExcel(name, rows, r.columns);
      else exportPdf(`${r.label} — ${formatDateBR(period.start)} a ${formatDateBR(period.end)}`, rows, r.columns);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  const d = dre.data;
  return (
    <div className="animate-fade-in">
      <PageHeader title="Relatórios e BI" subtitle={`Período: ${formatDateBR(period.start)} a ${formatDateBR(period.end)} · valores reconciliáveis com os registros de origem`} actions={<PeriodFilter preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} />} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card opaque className="xl:col-span-2" title="DRE gerencial (competência)" action={d && <Button size="sm" variant="ghost" icon={<Printer className="size-4" />} onClick={() => exportPdf(`DRE gerencial ${formatDateBR(period.start)}–${formatDateBR(period.end)}`, DRE_LINES.map(([k, l]) => ({ linha: l, valor: d[k] })), [{ key: 'linha', label: 'Linha' }, { key: 'valor', label: 'Valor', format: 'money' }])}>PDF</Button>}>
          {dre.isLoading ? <LoadingBlock /> : d ? (
            <>
              <table className="w-full text-sm"><tbody>{DRE_LINES.map(([k, l, strong]) => (
                <tr key={k} className={`border-t border-tangerine-100 ${strong ? 'font-bold' : ''}`}><td className="py-2">{l}</td><td className="num text-right">{formatReais(Number(d[k] ?? 0))}</td>
                  <td className="num w-16 text-right text-xs text-cocoa-700">{Number(d.receita_liquida) ? formatPercent((Number(d[k] ?? 0) / Number(d.receita_liquida)) * 100) : ''}</td></tr>))}</tbody></table>
              <div className="mt-3"><Alert tone="info">{String(d.aviso)} Para regime de caixa, use o Fluxo de caixa. Despesas classificadas por grupo DRE ({(cats.data?.rows ?? []).length} categorias).</Alert></div>
            </>
          ) : <Alert tone="warning">DRE indisponível para seu perfil.</Alert>}
        </Card>
        <Card opaque className="xl:col-span-3" title="Relatórios exportáveis">
          <ul className="divide-y divide-tangerine-100">
            {REPORTS.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-2 py-3">
                <span className="flex-1 font-medium">{r.label}{r.dateColumn ? '' : <span className="ml-2 text-xs text-cocoa-700">(posição atual)</span>}</span>
                <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={() => run(r, 'csv')}>CSV</Button>
                <Button size="sm" variant="secondary" onClick={() => run(r, 'xls')}>Excel</Button>
                <Button size="sm" variant="secondary" onClick={() => run(r, 'pdf')}>PDF</Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

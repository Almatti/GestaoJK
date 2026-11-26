import { Link } from 'react-router';
import { useList } from '@/data/hooks';
import type { Row } from '@/data/types';
import { PageHeader, Card } from '@/components/ui/Layout';
import { Badge, EmptyState, LoadingBlock } from '@/components/ui/Feedback';
import { ResourcePage } from '@/features/resource/ResourcePage';
import type { ResourceDef } from '@/features/resource/types';
import { formatDateBR, todaySP } from '@/domain/dates';
import { formatNumber, formatReais } from '@/domain/money';

const priceTablesDef: ResourceDef = {
  table: 'price_tables', title: 'Tabelas comerciais padrão', singular: 'Tabela', resource: 'produtos', searchColumns: ['name'], defaultOrder: [{ column: 'name' }],
  archive: { column: 'active', value: false, activeValue: true },
  fields: [{ name: 'name', label: 'Nome', type: 'text', required: true, placeholder: 'Ex.: Eventos 2026' }, { name: 'applies_to', label: 'Aplica-se a', type: 'select', options: [{ value: 'evento', label: 'Eventos' }, { value: 'ponto_fixo', label: 'Pontos fixos' }, { value: 'todos', label: 'Todos' }], defaultValue: 'todos' }, { name: 'active', label: 'Ativa', type: 'boolean', defaultValue: true }],
  columns: [{ key: 'name', label: 'Tabela' }, { key: 'applies_to', label: 'Aplica-se a' }, { key: 'active', label: 'Ativa', format: 'boolean' }]
};

const tableItemsDef: ResourceDef = {
  table: 'price_table_items', title: 'Preços das tabelas', singular: 'Preço de tabela', resource: 'produtos', searchColumns: [], defaultOrder: [{ column: 'valid_from', ascending: false }],
  select: '*,price_table:price_tables(name),product:products(name)', allowDelete: true,
  fields: [
    { name: 'price_table_id', label: 'Tabela', type: 'ref', ref: { table: 'price_tables', label: 'name' }, required: true },
    { name: 'product_id', label: 'Produto', type: 'ref', ref: { table: 'products', label: 'name' }, required: true },
    { name: 'price_per_unit', label: 'Preço por litro/unidade (R$)', type: 'money', required: true, min: 0 },
    { name: 'valid_from', label: 'Vigente a partir de', type: 'date', required: true, defaultValue: todaySP() },
    { name: 'valid_to', label: 'Vigente até', type: 'date' }
  ],
  columns: [{ key: 'price_table.name', label: 'Tabela', sortable: false }, { key: 'product.name', label: 'Produto', sortable: false }, { key: 'price_per_unit', label: 'Preço', format: 'money', align: 'right' }, { key: 'valid_from', label: 'Desde', format: 'date' }, { key: 'valid_to', label: 'Até', format: 'date' }]
};

export function CommercialConditionsPage() {
  const conds = useList<Row>('commercial_conditions', { select: '*,customer:customers(name,trade_name)', order: [{ column: 'valid_from', ascending: false }], range: [0, 499] });
  const today = todaySP();
  const current = (conds.data?.rows ?? []).filter((c) => String(c.valid_from) <= today && (!c.valid_to || String(c.valid_to) >= today));
  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <PageHeader title="Condições comerciais" subtitle="Condições vigentes por cliente. Alterações criam nova vigência — pedidos antigos nunca são recalculados." />
        <Card opaque>
          {conds.isLoading ? <LoadingBlock /> : current.length === 0 ? <EmptyState title="Nenhuma condição vigente" description="Cadastre condições no perfil de cada cliente (aba Condições comerciais)." /> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs uppercase text-cocoa-700"><tr><th className="py-2">Cliente</th><th>Desde</th><th className="text-right">Prazo</th><th className="text-right">Desconto</th><th className="text-right">Meta semanal</th><th className="text-right">Limite</th><th /></tr></thead>
              <tbody>{current.map((c) => { const cu = c.customer as Row | null; return (
                <tr key={String(c.id)} className="border-t border-tangerine-100"><td className="py-2.5"><Link className="font-semibold hover:underline" to={`/clientes/${c.customer_id}`}>{String(cu?.trade_name ?? cu?.name ?? '')}</Link></td>
                  <td>{formatDateBR(c.valid_from as string)}</td><td className="num text-right">{String(c.payment_term_days)} d</td><td className="num text-right">{formatNumber(Number(c.discount_percent), 1)}%</td>
                  <td className="num text-right">{c.expected_liters_per_week ? `${formatNumber(Number(c.expected_liters_per_week))} L` : '—'}</td><td className="num text-right">{c.credit_limit != null ? formatReais(c.credit_limit as number) : '—'}</td><td><Badge tone="success">Vigente</Badge></td></tr>); })}</tbody>
            </table></div>
          )}
        </Card>
      </div>
      <ResourcePage def={priceTablesDef} />
      <ResourcePage def={tableItemsDef} />
    </div>
  );
}

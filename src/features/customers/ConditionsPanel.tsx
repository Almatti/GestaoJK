import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthContext';
import { ResourceForm } from '@/features/resource/ResourceForm';
import type { ResourceDef } from '@/features/resource/types';
import { formatDateBR, todaySP, addDays } from '@/domain/dates';
import { formatReais, formatNumber } from '@/domain/money';

const conditionDef = (customerId: string): ResourceDef => ({
  table: 'commercial_conditions', title: 'Condições', singular: 'Condição comercial', resource: 'clientes', searchColumns: [], columns: [],
  beforeSave: (v) => ({ ...v, customer_id: customerId }),
  fields: [
    { name: 'valid_from', label: 'Vigente a partir de', type: 'date', required: true, defaultValue: todaySP() },
    { name: 'valid_to', label: 'Vigente até', type: 'date', help: 'Vazio = indeterminado. Não pode sobrepor outra condição.' },
    { name: 'price_table_id', label: 'Tabela comercial', type: 'ref', ref: { table: 'price_tables', label: 'name' } },
    { name: 'discount_percent', label: 'Desconto padrão (%)', type: 'percent', min: 0, max: 100, defaultValue: 0 },
    { name: 'payment_term_days', label: 'Prazo de pagamento (dias)', type: 'number', min: 0, defaultValue: 0 },
    { name: 'preferred_payment_method', label: 'Forma de pagamento preferencial', type: 'select', options: [['pix', 'Pix'], ['boleto', 'Boleto'], ['dinheiro', 'Dinheiro'], ['cartao_credito', 'Cartão'], ['transferencia', 'Transferência']].map(([value, label]) => ({ value: value!, label: label! })) },
    { name: 'credit_limit', label: 'Limite de crédito (R$)', type: 'money', min: 0 },
    { name: 'expected_kegs_per_week', label: 'Meta mínima: barris por semana', type: 'number', min: 0 },
    { name: 'expected_liters_per_week', label: 'Meta mínima: litros por semana', type: 'number', min: 0, help: 'Usada na análise de saúde e baixa rotatividade.' },
    { name: 'min_kegs_per_order', label: 'Quantidade mínima de barris por pedido', type: 'number', min: 0 },
    { name: 'expected_interval_days', label: 'Frequência esperada (dias entre pedidos)', type: 'number', min: 0 },
    { name: 'preferred_delivery_days', label: 'Dias preferenciais de entrega', type: 'tags', placeholder: 'seg, qui' },
    { name: 'travel_fee', label: 'Taxa de deslocamento (R$)', type: 'money', min: 0, defaultValue: 0 },
    { name: 'included_services', label: 'Serviços inclusos', type: 'tags', placeholder: 'assepsia, manutenção preventiva' },
    { name: 'charged_services', label: 'Serviços cobrados', type: 'tags' },
    { name: 'contract_terms', label: 'Condições contratuais / comodato', type: 'textarea' },
    { name: 'maintenance_rules', label: 'Regras de manutenção', type: 'textarea' },
    { name: 'protest_terms', label: 'Condições de protesto', type: 'textarea' },
    { name: 'notes', label: 'Observações', type: 'textarea' }
  ]
});

const priceDef = (customerId: string): ResourceDef => ({
  table: 'customer_product_prices', title: 'Preços', singular: 'Preço personalizado', resource: 'clientes', searchColumns: [], columns: [],
  beforeSave: (v) => ({ ...v, customer_id: customerId, price_per_liter: v.keg_size_id ? null : v.price_per_liter, unit_price: v.keg_size_id ? v.unit_price : null }),
  fields: [
    { name: 'product_id', label: 'Produto', type: 'ref', ref: { table: 'products', label: 'name', filters: [{ column: 'status', op: 'eq', value: 'ativo' }] }, required: true },
    { name: 'keg_size_id', label: 'Tamanho do barril (opcional)', type: 'ref', ref: { table: 'keg_sizes', label: 'label' }, help: 'Com tamanho: informe o preço do barril inteiro. Sem tamanho: informe o preço por litro.' },
    { name: 'price_per_liter', label: 'Preço por litro (R$)', type: 'money', min: 0, validate: (v, all) => (!all.keg_size_id && (v === '' || v == null) ? 'Informe o preço por litro' : null) },
    { name: 'unit_price', label: 'Preço do barril (R$)', type: 'money', min: 0, validate: (v, all) => (all.keg_size_id && (v === '' || v == null) ? 'Informe o preço do barril' : null) },
    { name: 'valid_from', label: 'Vigente a partir de', type: 'date', required: true, defaultValue: todaySP() },
    { name: 'valid_to', label: 'Vigente até', type: 'date' }
  ]
});

export function ConditionsPanel({ customerId }: { customerId: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [form, setForm] = useState<'cond' | 'price' | null>(null);
  const conds = useList<Row>('commercial_conditions', { filters: [{ column: 'customer_id', op: 'eq', value: customerId }], order: [{ column: 'valid_from', ascending: false }] });
  const prices = useList<Row>('customer_product_prices', { select: '*,product:products(name),keg_size:keg_sizes(label)', filters: [{ column: 'customer_id', op: 'eq', value: customerId }], order: [{ column: 'valid_from', ascending: false }] });
  const today = todaySP();
  const isCurrent = (r: Row) => String(r.valid_from) <= today && (!r.valid_to || String(r.valid_to) >= today);

  // Encerrar vigência em vez de editar valores históricos.
  const endValidity = async (table: string, r: Row) => {
    try {
      await db().update(table, String(r.id), { valid_to: addDays(today, -1) < String(r.valid_from) ? r.valid_from : addDays(today, -1) });
      invalidate();
      toast('Vigência encerrada. Pedidos anteriores mantêm os valores originais.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card opaque title="Condições comerciais (com vigência)" action={can('clientes', 'create') && <Button size="sm" variant="soft" icon={<Plus className="size-4" />} onClick={() => setForm('cond')}>Nova condição</Button>}>
        {(conds.data?.rows ?? []).length === 0 ? <EmptyState title="Sem condições específicas" description="Sem condição, o pedido usa tabela padrão e preço do produto." /> : (
          <ul className="space-y-3">{conds.data!.rows.map((c) => (
            <li key={String(c.id)} className="rounded-2xl border border-tangerine-100 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {isCurrent(c) ? <Badge tone="success">Vigente</Badge> : <Badge>Histórico</Badge>}
                <span className="text-cocoa-700">{formatDateBR(c.valid_from as string)} → {c.valid_to ? formatDateBR(c.valid_to as string) : 'indeterminado'}</span>
                {isCurrent(c) && can('clientes', 'edit') && <button className="ml-auto text-xs font-semibold text-tangerine-900 underline" onClick={() => endValidity('commercial_conditions', c)}>Encerrar vigência</button>}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                <dt className="text-cocoa-700">Prazo</dt><dd>{String(c.payment_term_days)} dias</dd>
                <dt className="text-cocoa-700">Desconto</dt><dd>{formatNumber(Number(c.discount_percent), 1)}%</dd>
                <dt className="text-cocoa-700">Meta semanal</dt><dd>{c.expected_liters_per_week ? `${formatNumber(Number(c.expected_liters_per_week))} L` : '—'}{c.expected_kegs_per_week ? ` · ${String(c.expected_kegs_per_week)} barris` : ''}</dd>
                <dt className="text-cocoa-700">Limite de crédito</dt><dd>{c.credit_limit != null ? formatReais(c.credit_limit as number) : '—'}</dd>
                <dt className="text-cocoa-700">Serviços inclusos</dt><dd>{(c.included_services as string[] | null)?.join(', ') || '—'}</dd>
              </dl>
            </li>))}</ul>
        )}
      </Card>
      <Card opaque title="Preços personalizados" action={can('clientes', 'create') && <Button size="sm" variant="soft" icon={<Plus className="size-4" />} onClick={() => setForm('price')}>Novo preço</Button>}>
        <p className="mb-3 text-xs text-cocoa-700">Hierarquia aplicada nos pedidos: 1) preço do cliente para o tamanho de barril · 2) preço do cliente por litro · 3) tabela comercial · 4) preço padrão do produto.</p>
        {(prices.data?.rows ?? []).length === 0 ? <EmptyState title="Sem preços personalizados" /> : (
          <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-cocoa-700"><tr><th className="py-2">Produto</th><th>Tipo</th><th className="text-right">Preço</th><th>Vigência</th><th /></tr></thead>
            <tbody>{prices.data!.rows.map((p) => (
              <tr key={String(p.id)} className="border-t border-tangerine-100">
                <td className="py-2">{String((p.product as Row | null)?.name ?? '')}</td>
                <td>{p.keg_size_id ? `Barril ${String((p.keg_size as Row | null)?.label ?? '')}` : 'Por litro'}</td>
                <td className="num text-right">{p.keg_size_id ? formatReais(p.unit_price as number) : `${formatReais(p.price_per_liter as number)}/L`}</td>
                <td className="text-xs">{isCurrent(p) ? <Badge tone="success">Vigente</Badge> : `${formatDateBR(p.valid_from as string)}–${formatDateBR(p.valid_to as string)}`}</td>
                <td>{isCurrent(p) && can('clientes', 'edit') && <button className="text-xs font-semibold text-tangerine-900 underline" onClick={() => endValidity('customer_product_prices', p)}>Encerrar</button>}</td>
              </tr>))}</tbody></table>
        )}
      </Card>
      <ResourceForm def={conditionDef(customerId)} row={null} open={form === 'cond'} onClose={() => setForm(null)} />
      <ResourceForm def={priceDef(customerId)} row={null} open={form === 'price'} onClose={() => setForm(null)} />
    </div>
  );
}

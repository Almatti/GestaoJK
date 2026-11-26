import { useMemo, useState } from 'react';
import { PageHeader, Card } from '@/components/ui/Layout';
import { TextInput, SelectInput } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Feedback';
import { useList } from '@/data/hooks';
import type { Row } from '@/data/types';
import { calculatePricing, checkMargin, marginToMarkup, minimumPrice } from '@/domain/pricing';
import { formatBRL, formatPercent, toCents } from '@/domain/money';

const n = (v: string) => Number(v.replace(',', '.')) || 0;

export function PricingSimulatorPage() {
  const products = useList<Row>('products', { filters: [{ column: 'status', op: 'eq', value: 'ativo' }], order: [{ column: 'name' }] });
  const settings = useList<Row>('settings', { filters: [{ column: 'key', op: 'in', value: ['commercial.min_margin_percent', 'commercial.sales_tax_percent'] }] });
  const minMargin = Number(settings.data?.rows.find((s) => s.key === 'commercial.min_margin_percent')?.value ?? 20);
  const [f, setF] = useState({ product: '', cost: '10', liters: '50', price: '20', discount: '0', tax: '', fee: '0', commission: '0', freight: '0', logistics: '0', other: '0', loss: '0', margin: '' });
  const tax = f.tax === '' ? String(settings.data?.rows.find((s) => s.key === 'commercial.sales_tax_percent')?.value ?? 0) : f.tax;
  const margin = f.margin === '' ? String(minMargin) : f.margin;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const r = useMemo(() => calculatePricing({
    costPerLiterCents: toCents(n(f.cost)), liters: n(f.liters), pricePerLiterCents: toCents(n(f.price)), discountCents: toCents(n(f.discount)),
    salesTaxPercent: n(tax), financialFeePercent: n(f.fee), commissionPercent: n(f.commission), freightCents: toCents(n(f.freight)),
    logisticsCents: toCents(n(f.logistics)), otherVariableCents: toCents(n(f.other)), lossPercent: n(f.loss)
  }), [f, tax]);

  const absoluteCosts = r.productCost + toCents(n(f.freight)) + toCents(n(f.logistics)) + toCents(n(f.other));
  const minTotal = (() => {
    try {
      return minimumPrice(absoluteCosts, n(margin), n(tax) + n(f.fee) + n(f.commission)) + toCents(n(f.discount));
    } catch {
      return null;
    }
  })();
  const check = checkMargin(r, n(margin));

  return (
    <div className="animate-fade-in">
      <PageHeader title="Simulador de precificação" subtitle="Cálculos determinísticos de margem bruta e de contribuição. Margem ≠ markup: 20% de margem sobre custo de R$ 100 exige preço de R$ 125." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card opaque className="lg:col-span-2" title="Parâmetros">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <SelectInput wrapperClassName="col-span-2 sm:col-span-3" label="Carregar produto (opcional)" value={f.product} placeholder="—" options={(products.data?.rows ?? []).map((p) => ({ value: String(p.id), label: String(p.name) }))}
              onChange={(e) => { const p = products.data?.rows.find((x) => x.id === e.target.value); setF((s) => ({ ...s, product: e.target.value, cost: String(p?.cost_per_unit ?? s.cost), price: String(p?.price_per_unit ?? s.price) })); }} />
            <TextInput label="Custo por litro (R$)" inputMode="decimal" value={f.cost} onChange={set('cost')} />
            <TextInput label="Litros" inputMode="decimal" value={f.liters} onChange={set('liters')} />
            <TextInput label="Preço por litro (R$)" inputMode="decimal" value={f.price} onChange={set('price')} />
            <TextInput label="Desconto (R$)" inputMode="decimal" value={f.discount} onChange={set('discount')} />
            <TextInput label="Tributos sobre vendas (%)" inputMode="decimal" value={tax} onChange={set('tax')} hint="Estimativa — confirme com a contabilidade" />
            <TextInput label="Taxas financeiras (%)" inputMode="decimal" value={f.fee} onChange={set('fee')} />
            <TextInput label="Comissões (%)" inputMode="decimal" value={f.commission} onChange={set('commission')} />
            <TextInput label="Frete (R$)" inputMode="decimal" value={f.freight} onChange={set('freight')} />
            <TextInput label="Custos logísticos (R$)" inputMode="decimal" value={f.logistics} onChange={set('logistics')} />
            <TextInput label="Outras despesas variáveis (R$)" inputMode="decimal" value={f.other} onChange={set('other')} />
            <TextInput label="Perdas (%)" inputMode="decimal" value={f.loss} onChange={set('loss')} />
            <TextInput label="Margem desejada (%)" inputMode="decimal" value={margin} onChange={set('margin')} hint={`Equivale a markup de ${formatPercent(marginToMarkup(n(margin)))}`} />
          </div>
        </Card>
        <Card title="Resultado">
          <dl className="space-y-2 text-sm">
            {([
              ['Receita bruta', formatBRL(r.grossRevenue)], ['(−) Descontos', formatBRL(r.discount)], ['(−) Tributos sobre vendas', formatBRL(r.salesTaxes)], ['Receita líquida', formatBRL(r.netRevenue)],
              ['(−) Custo do produto (com perdas)', formatBRL(r.productCost)], ['Lucro bruto', formatBRL(r.grossProfit)], ['Margem bruta', formatPercent(r.grossMarginPercent)],
              ['(−) Custos e despesas variáveis', formatBRL(r.variableCosts)], ['Margem de contribuição', formatBRL(r.contributionMargin)], ['Margem de contribuição %', formatPercent(r.contributionMarginPercent)], ['Markup sobre custo', formatPercent(r.markupPercent)]
            ] as [string, string][]).map(([k, v]) => <div key={k} className="flex justify-between gap-2"><dt className="text-cocoa-700">{k}</dt><dd className="num font-semibold">{v}</dd></div>)}
          </dl>
          <div className="mt-4 space-y-3">
            <Alert tone={check.ok ? 'success' : 'warning'}>{check.message}</Alert>
            <div className="rounded-2xl bg-white/80 p-3 text-sm">
              <p className="text-cocoa-700">Preço total mínimo para {margin}% de margem de contribuição:</p>
              <p className="num font-display text-2xl font-extrabold">{minTotal !== null ? formatBRL(minTotal) : 'Margem + taxas ≥ 100%'}</p>
              {minTotal !== null && n(f.liters) > 0 && <p className="num text-cocoa-700">≈ {formatBRL(Math.ceil(minTotal / n(f.liters)))} por litro</p>}
              <p className="mt-1 text-xs text-cocoa-700">Fórmula: custos absolutos ÷ (1 − margem − taxas percentuais).</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

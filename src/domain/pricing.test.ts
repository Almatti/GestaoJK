import { calculatePricing, checkMargin, marginToMarkup, markupToMargin, minimumPrice, pickEffective, resolvePrice } from './pricing';

describe('precificação', () => {
  it('margem de 20% sobre custo R$100 ⇒ preço mínimo R$125 (não é markup)', () => {
    expect(minimumPrice(10000, 20)).toBe(12500);
    expect(marginToMarkup(20)).toBeCloseTo(25);
    expect(markupToMargin(25)).toBeCloseTo(20);
  });
  it('ajusta preço mínimo com taxas percentuais sobre a venda', () => {
    // 100 / (1 - 0.20 - 0.05) = 133.33 → arredonda para cima
    expect(minimumPrice(10000, 20, 5)).toBe(13334);
    expect(() => minimumPrice(10000, 60, 40)).toThrow();
  });
  it('calcula lucro bruto, margem bruta e margem de contribuição', () => {
    const r = calculatePricing({
      costPerLiterCents: 1000, liters: 50, pricePerLiterCents: 2000, discountCents: 5000,
      salesTaxPercent: 10, financialFeePercent: 2, freightCents: 3000
    });
    expect(r.grossRevenue).toBe(100000);
    expect(r.salesTaxes).toBe(9500);
    expect(r.netRevenue).toBe(85500);
    expect(r.productCost).toBe(50000);
    expect(r.grossProfit).toBe(35500);
    expect(r.grossMarginPercent).toBeCloseTo(41.52, 1);
    expect(r.variableCosts).toBe(50000 + 1900 + 3000);
    expect(r.contributionMargin).toBe(85500 - 54900);
    expect(r.markupPercent).toBeCloseTo(71, 0);
    expect(checkMargin(r, 20).ok).toBe(true);
    expect(checkMargin(r, 40).ok).toBe(false);
  });
  it('respeita a hierarquia de preços', () => {
    const base = { productPerLiterCents: 1500 };
    expect(resolvePrice({ ...base, customerVariantPriceCents: 60000, customerPerLiterCents: 1000, tablePerLiterCents: 1200 }, 50).source).toBe('cliente_barril');
    expect(resolvePrice({ ...base, customerPerLiterCents: 1000, tablePerLiterCents: 1200 }, 50)).toEqual({ source: 'cliente_litro', unitPriceCents: 50000, pricePerLiterCents: 1000 });
    expect(resolvePrice({ ...base, tablePerLiterCents: 1200 }, 30).unitPriceCents).toBe(36000);
    expect(resolvePrice({ ...base, variantPriceCents: 70000 }, 50).source).toBe('produto_barril');
    expect(resolvePrice(base, 20).unitPriceCents).toBe(30000);
  });
  it('seleciona condição vigente pela data', () => {
    const items = [
      { id: 'a', valid_from: '2026-01-01', valid_to: '2026-06-30' },
      { id: 'b', valid_from: '2026-07-01', valid_to: null }
    ];
    expect(pickEffective(items, '2026-03-10')?.id).toBe('a');
    expect(pickEffective(items, '2026-11-26')?.id).toBe('b');
    expect(pickEffective(items, '2025-12-31')).toBeUndefined();
  });
});

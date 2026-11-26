/**
 * Precificação e rentabilidade.
 * - Margem = lucro ÷ receita líquida. Markup = lucro ÷ custo. NUNCA confundir.
 * - Preço mínimo para margem m com taxas percentuais sobre a venda t: preço = custo ÷ (1 − m − t).
 *   Ex.: custo R$ 100, m = 20%, t = 0 ⇒ R$ 125,00.
 */
import { type Cents, roundHalfAwayFromZero } from './money';

export interface PricingInput {
  /** Custo por litro (centavos, pode ter frações → usamos number). */
  costPerLiterCents: number;
  liters: number;
  /** Preço de venda por litro (centavos). */
  pricePerLiterCents: number;
  discountCents?: Cents;
  /** Tributos sobre vendas estimados (% da receita bruta após descontos). */
  salesTaxPercent?: number;
  /** Taxas financeiras (cartão, boleto, Pix) em % da receita. */
  financialFeePercent?: number;
  commissionPercent?: number;
  /** Despesas variáveis absolutas (frete, deslocamento, perdas atribuídas). */
  freightCents?: Cents;
  logisticsCents?: Cents;
  otherVariableCents?: Cents;
  lossPercent?: number;
}

export interface PricingResult {
  grossRevenue: Cents;
  discount: Cents;
  salesTaxes: Cents;
  netRevenue: Cents;
  productCost: Cents;
  grossProfit: Cents;
  grossMarginPercent: number;
  variableCosts: Cents;
  contributionMargin: Cents;
  contributionMarginPercent: number;
  markupPercent: number;
}

const pct = (part: number, whole: number) => (whole === 0 ? 0 : (part / whole) * 100);

export function calculatePricing(i: PricingInput): PricingResult {
  const grossRevenue = roundHalfAwayFromZero(i.pricePerLiterCents * i.liters);
  const discount = i.discountCents ?? 0;
  const afterDiscount = grossRevenue - discount;
  const salesTaxes = roundHalfAwayFromZero((afterDiscount * (i.salesTaxPercent ?? 0)) / 100);
  const netRevenue = afterDiscount - salesTaxes;
  const lossFactor = 1 + (i.lossPercent ?? 0) / 100;
  const productCost = roundHalfAwayFromZero(i.costPerLiterCents * i.liters * lossFactor);
  const grossProfit = netRevenue - productCost;
  const percentFees = roundHalfAwayFromZero(
    (afterDiscount * ((i.financialFeePercent ?? 0) + (i.commissionPercent ?? 0))) / 100
  );
  const variableCosts =
    productCost + percentFees + (i.freightCents ?? 0) + (i.logisticsCents ?? 0) + (i.otherVariableCents ?? 0);
  const contributionMargin = netRevenue - variableCosts;
  return {
    grossRevenue,
    discount,
    salesTaxes,
    netRevenue,
    productCost,
    grossProfit,
    grossMarginPercent: pct(grossProfit, netRevenue),
    variableCosts,
    contributionMargin,
    contributionMarginPercent: pct(contributionMargin, netRevenue),
    markupPercent: pct(grossProfit, productCost)
  };
}

/**
 * Preço mínimo para atingir a margem desejada.
 * @param costCents custos absolutos considerados (produto + variáveis absolutas)
 * @param marginPercent margem desejada sobre a receita (ex.: 20)
 * @param percentOnSale soma das taxas/tributos percentuais incidentes sobre o preço (ex.: 6)
 */
export function minimumPrice(costCents: number, marginPercent: number, percentOnSale = 0): Cents {
  const divisor = 1 - marginPercent / 100 - percentOnSale / 100;
  if (divisor <= 0) throw new Error('Margem + taxas percentuais devem somar menos de 100%');
  // Arredonda PARA CIMA ao centavo para nunca ficar abaixo da margem.
  return Math.ceil(Number((costCents / divisor).toPrecision(12)));
}

export const marginToMarkup = (marginPercent: number) => (marginPercent / (100 - marginPercent)) * 100;
export const markupToMargin = (markupPercent: number) => (markupPercent / (100 + markupPercent)) * 100;

export type MarginIndicator = 'contribution' | 'gross';

export interface MarginCheck {
  ok: boolean;
  indicator: MarginIndicator;
  actualPercent: number;
  minimumPercent: number;
  message: string;
}

export function checkMargin(result: PricingResult, minimumPercent: number, indicator: MarginIndicator = 'contribution'): MarginCheck {
  const actual = indicator === 'contribution' ? result.contributionMarginPercent : result.grossMarginPercent;
  const ok = actual + 1e-9 >= minimumPercent;
  const label = indicator === 'contribution' ? 'Margem de contribuição' : 'Margem bruta';
  return {
    ok,
    indicator,
    actualPercent: actual,
    minimumPercent,
    message: ok
      ? `${label} de ${actual.toFixed(1)}% atende ao mínimo de ${minimumPercent}%.`
      : `${label} de ${actual.toFixed(1)}% está abaixo do mínimo de ${minimumPercent}%. Exige aprovação com justificativa.`
  };
}

/* ------------------------------------------------------------------ */
/* Hierarquia de preços                                                */
/* ------------------------------------------------------------------ */

export interface PriceSources {
  /** 1. Preço específico do cliente para o produto + tamanho do barril (preço do barril inteiro). */
  customerVariantPriceCents?: number | null;
  /** 2. Preço específico por litro do cliente. */
  customerPerLiterCents?: number | null;
  /** 3. Tabela comercial padrão aplicável (por litro), ex.: tabela de eventos/pontos fixos. */
  tablePerLiterCents?: number | null;
  /** 4. Preço padrão do produto por litro. */
  productPerLiterCents: number;
  /** Preço padrão do tamanho de barril (preço do barril inteiro), se existir. */
  variantPriceCents?: number | null;
}

export type PriceSource = 'cliente_barril' | 'cliente_litro' | 'tabela' | 'produto_barril' | 'produto_litro';

export interface ResolvedPrice {
  source: PriceSource;
  /** Preço unitário (por barril quando há litragem, ou por unidade). */
  unitPriceCents: number;
  pricePerLiterCents: number;
}

export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  cliente_barril: 'Preço do cliente para este barril',
  cliente_litro: 'Preço do cliente por litro',
  tabela: 'Tabela comercial',
  produto_barril: 'Preço padrão do barril',
  produto_litro: 'Preço padrão por litro'
};

export function resolvePrice(sources: PriceSources, litersPerUnit: number): ResolvedPrice {
  const liters = litersPerUnit > 0 ? litersPerUnit : 1;
  const fromUnit = (unit: number, source: PriceSource): ResolvedPrice => ({
    source,
    unitPriceCents: unit,
    pricePerLiterCents: unit / liters
  });
  const fromLiter = (perLiter: number, source: PriceSource): ResolvedPrice => ({
    source,
    unitPriceCents: roundHalfAwayFromZero(perLiter * liters),
    pricePerLiterCents: perLiter
  });
  if (sources.customerVariantPriceCents != null) return fromUnit(sources.customerVariantPriceCents, 'cliente_barril');
  if (sources.customerPerLiterCents != null) return fromLiter(sources.customerPerLiterCents, 'cliente_litro');
  if (sources.tablePerLiterCents != null) return fromLiter(sources.tablePerLiterCents, 'tabela');
  if (sources.variantPriceCents != null) return fromUnit(sources.variantPriceCents, 'produto_barril');
  return fromLiter(sources.productPerLiterCents, 'produto_litro');
}

/** Retorna a condição vigente em uma data (vigência inclusiva; fim nulo = indeterminado). */
export function isEffective(date: string, validFrom: string, validTo?: string | null): boolean {
  return validFrom <= date && (!validTo || date <= validTo);
}

export function pickEffective<T extends { valid_from: string; valid_to?: string | null }>(items: T[], date: string): T | undefined {
  return items
    .filter((i) => isEffective(date, i.valid_from, i.valid_to))
    .sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0];
}

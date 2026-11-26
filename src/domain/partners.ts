/**
 * Parceiros comerciais: créditos sobre pedidos elegíveis, abatimento de dívida e fechamento mensal.
 * Idempotência: cada pedido gera no máximo UM crédito (chave única partner_id + order_id no banco).
 */
import { type Cents, roundHalfAwayFromZero } from './money';

export type OrderKind = 'evento' | 'ponto_fixo' | 'avulso' | 'recorrente';
export type EligibilityEvent = 'confirmado' | 'entregue' | 'recebido';

export interface PartnerRule {
  percentEvent: number;
  percentFixed: number;
  fixedPerOrderCents: Cents;
  eligibility: EligibilityEvent;
  /** Se verdadeiro, créditos abatem a dívida do parceiro antes de virar saldo a pagar. */
  offsetDebt: boolean;
}

export interface PartnerOrder {
  id: string;
  kind: OrderKind;
  totalCents: Cents;
  confirmed: boolean;
  delivered: boolean;
  fullyPaid: boolean;
  cancelled: boolean;
}

export function isEligible(o: PartnerOrder, rule: PartnerRule): boolean {
  if (o.cancelled) return false;
  if (rule.eligibility === 'confirmado') return o.confirmed;
  if (rule.eligibility === 'entregue') return o.delivered;
  return o.fullyPaid;
}

export function creditForOrder(o: PartnerOrder, rule: PartnerRule): Cents {
  const pct = o.kind === 'evento' ? rule.percentEvent : rule.percentFixed;
  return roundHalfAwayFromZero((o.totalCents * pct) / 100) + rule.fixedPerOrderCents;
}

export interface CreditEntry {
  orderId: string;
  cents: Cents;
}

/** Calcula novos créditos ignorando pedidos já creditados (idempotente). */
export function computeNewCredits(orders: PartnerOrder[], rule: PartnerRule, alreadyCredited: ReadonlySet<string>): CreditEntry[] {
  return orders
    .filter((o) => isEligible(o, rule) && !alreadyCredited.has(o.id))
    .map((o) => ({ orderId: o.id, cents: creditForOrder(o, rule) }))
    .filter((c) => c.cents > 0);
}

export interface SettlementInput {
  /** Saldo devedor do parceiro com a empresa no início do período (positivo = parceiro deve). */
  openingDebtCents: Cents;
  newObligationsCents: Cents;
  paymentsCents: Cents;
  adjustmentsCents: Cents;
  credits: CreditEntry[];
  offsetDebt: boolean;
}

export interface SettlementResult {
  totalCreditsCents: Cents;
  offsetCents: Cents;
  closingDebtCents: Cents;
  creditPayableCents: Cents;
}

export function settle(i: SettlementInput): SettlementResult {
  const totalCredits = i.credits.reduce((s, c) => s + c.cents, 0);
  const debtBeforeCredits = i.openingDebtCents + i.newObligationsCents - i.paymentsCents + i.adjustmentsCents;
  const offset = i.offsetDebt ? Math.max(0, Math.min(totalCredits, debtBeforeCredits)) : 0;
  return {
    totalCreditsCents: totalCredits,
    offsetCents: offset,
    closingDebtCents: debtBeforeCredits - offset,
    creditPayableCents: totalCredits - offset
  };
}

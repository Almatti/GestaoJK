/**
 * Cobrança: vencimentos, multa, juros, status financeiro e status cartorário.
 *
 * Regras (configuráveis em collection_rules; nenhum percentual é fixado no código):
 * - A MULTA moratória incide UMA ÚNICA VEZ sobre o saldo em atraso (não é mensal/recorrente).
 * - Os JUROS de mora são simples, calculados pro rata die (mensal ÷ 30 × dias ou diário × dias).
 * - Vencimento em fim de semana/feriado pode ser prorrogado para o próximo dia útil (sem encargos até lá).
 * - Situação financeira e situação cartorária são independentes.
 * - Os percentuais dependem do contrato, do Código Civil e do CDC quando aplicável — validar juridicamente.
 */
import { type ISODate, addBusinessDays, addDays, diffDays, nextBusinessDay } from './dates';
import { type Cents, roundHalfAwayFromZero } from './money';

export interface ChargeRules {
  finePercent: number; // multa moratória (ex.: 2)
  interestPercent: number; // taxa de juros
  interestPeriod: 'mensal' | 'diario';
  graceDays: number; // carência antes de encargos
  dueDateHandling: 'proximo_dia_util' | 'manter';
  protestAfterDays: number; // dias após vencimento para encaminhar a protesto (data INTERNA)
  protestDayCount: 'corridos' | 'uteis';
}

export const EMPTY_CHARGE_RULES: ChargeRules = {
  finePercent: 0,
  interestPercent: 0,
  interestPeriod: 'mensal',
  graceDays: 0,
  dueDateHandling: 'proximo_dia_util',
  protestAfterDays: 0,
  protestDayCount: 'corridos'
};

export function effectiveDueDate(due: ISODate, rules: Pick<ChargeRules, 'dueDateHandling'>, holidays: ReadonlySet<string> = new Set()): ISODate {
  return rules.dueDateHandling === 'proximo_dia_util' ? nextBusinessDay(due, holidays) : due;
}

/** Dias de atraso em uma data de referência. 0 se ainda dentro do vencimento efetivo. */
export function daysLate(due: ISODate, refDate: ISODate, rules: Pick<ChargeRules, 'dueDateHandling'>, holidays: ReadonlySet<string> = new Set()): number {
  const eff = effectiveDueDate(due, rules, holidays);
  if (refDate <= eff) return 0;
  return diffDays(due, refDate);
}

export interface ChargeBreakdown {
  daysLate: number;
  principal: Cents;
  fine: Cents;
  interest: Cents;
  discount: Cents;
  total: Cents;
}

export function calculateCharges(
  outstandingCents: Cents,
  due: ISODate,
  refDate: ISODate,
  rules: ChargeRules,
  holidays: ReadonlySet<string> = new Set(),
  discountCents: Cents = 0
): ChargeBreakdown {
  const late = daysLate(due, refDate, rules, holidays);
  const chargeable = late > rules.graceDays && outstandingCents > 0;
  const fine = chargeable ? roundHalfAwayFromZero((outstandingCents * rules.finePercent) / 100) : 0;
  const dailyRate = rules.interestPeriod === 'mensal' ? rules.interestPercent / 30 : rules.interestPercent;
  const interest = chargeable ? roundHalfAwayFromZero((outstandingCents * dailyRate * late) / 100) : 0;
  const discount = late === 0 ? Math.min(discountCents, outstandingCents) : 0;
  return { daysLate: late, principal: outstandingCents, fine, interest, discount, total: outstandingCents + fine + interest - discount };
}

/** Data INTERNA prevista para encaminhamento a protesto (não é a data efetiva do protesto). */
export function plannedProtestDate(due: ISODate, rules: Pick<ChargeRules, 'protestAfterDays' | 'protestDayCount'>, holidays: ReadonlySet<string> = new Set()): ISODate | null {
  if (!rules.protestAfterDays || rules.protestAfterDays <= 0) return null;
  return rules.protestDayCount === 'uteis' ? addBusinessDays(due, rules.protestAfterDays, holidays) : addDays(due, rules.protestAfterDays);
}

/* ------------------------------------------------------------------ */
/* Situação financeira                                                 */
/* ------------------------------------------------------------------ */

export const FINANCIAL_STATUS = {
  em_aberto: 'Em aberto',
  a_vencer: 'A vencer',
  vencido: 'Vencido',
  parcialmente_pago: 'Parcialmente pago',
  pago: 'Pago',
  cancelado: 'Cancelado',
  renegociado: 'Renegociado'
} as const;
export type FinancialStatus = keyof typeof FINANCIAL_STATUS;

export interface ReceivableState {
  amountCents: Cents;
  paidCents: Cents;
  due: ISODate;
  cancelled?: boolean;
  renegotiated?: boolean;
}

export function deriveFinancialStatus(r: ReceivableState, today: ISODate, dueSoonDays = 7): FinancialStatus {
  if (r.cancelled) return 'cancelado';
  if (r.renegotiated) return 'renegociado';
  const outstanding = r.amountCents - r.paidCents;
  if (outstanding <= 0) return 'pago';
  if (r.due < today) return r.paidCents > 0 ? 'parcialmente_pago' : 'vencido';
  if (r.paidCents > 0) return 'parcialmente_pago';
  return diffDays(today, r.due) <= dueSoonDays ? 'a_vencer' : 'em_aberto';
}

export function isOverdue(r: ReceivableState, today: ISODate): boolean {
  return r.amountCents - r.paidCents > 0 && r.due < today && !r.cancelled && !r.renegotiated;
}

/* ------------------------------------------------------------------ */
/* Situação cartorária                                                 */
/* ------------------------------------------------------------------ */

export const PROTEST_STATUS = {
  nao_encaminhado: 'Não encaminhado',
  programado: 'Programado para encaminhamento',
  encaminhado: 'Encaminhado ao cartório',
  em_cartorio: 'Em cartório',
  protestado: 'Protestado',
  aguardando_anuencia: 'Aguardando anuência',
  aguardando_cancelamento: 'Aguardando cancelamento',
  cancelamento_solicitado: 'Cancelamento solicitado',
  protesto_cancelado: 'Protesto cancelado',
  retirado: 'Retirado antes do protesto'
} as const;
export type ProtestStatus = keyof typeof PROTEST_STATUS;

const CARTORIAL_PENDING: ProtestStatus[] = [
  'encaminhado',
  'em_cartorio',
  'protestado',
  'aguardando_anuencia',
  'aguardando_cancelamento',
  'cancelamento_solicitado'
];

export function hasCartorialPending(s: ProtestStatus): boolean {
  return CARTORIAL_PENDING.includes(s);
}

/** Transições permitidas da situação cartorária. */
export const PROTEST_TRANSITIONS: Record<ProtestStatus, ProtestStatus[]> = {
  nao_encaminhado: ['programado', 'encaminhado'],
  programado: ['encaminhado', 'nao_encaminhado'],
  encaminhado: ['em_cartorio', 'retirado', 'protestado'],
  em_cartorio: ['protestado', 'retirado'],
  protestado: ['aguardando_anuencia', 'aguardando_cancelamento', 'cancelamento_solicitado'],
  aguardando_anuencia: ['aguardando_cancelamento', 'cancelamento_solicitado'],
  aguardando_cancelamento: ['cancelamento_solicitado', 'protesto_cancelado'],
  cancelamento_solicitado: ['protesto_cancelado'],
  protesto_cancelado: [],
  retirado: []
};

export function canTransitionProtest(from: ProtestStatus, to: ProtestStatus): boolean {
  return PROTEST_TRANSITIONS[from].includes(to);
}

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface CombinedStatus {
  label: string;
  detail: string;
  tone: Tone;
  financialSettled: boolean;
  cartorialPending: boolean;
  /** Lembretes de cobrança financeira devem ser enviados? */
  sendFinancialReminders: boolean;
}

export function combinedStatus(financial: FinancialStatus, protest: ProtestStatus, paymentMethod?: string | null): CombinedStatus {
  const settled = financial === 'pago';
  const pending = hasCartorialPending(protest);
  const via = paymentMethod ? ` via ${paymentMethod}` : '';
  const stopReminders = settled || financial === 'cancelado' || financial === 'renegociado';
  if (settled && pending) {
    return {
      label: `Pago${via}, mas ainda em protesto`,
      detail: `Obrigação financeira quitada. Pendência cartorária: ${PROTEST_STATUS[protest]}. Não cobrar novamente — providenciar anuência/cancelamento.`,
      tone: 'warning',
      financialSettled: true,
      cartorialPending: true,
      sendFinancialReminders: false
    };
  }
  if (settled) {
    return { label: `Pago${via}`, detail: 'Quitado, sem pendências cartorárias.', tone: 'success', financialSettled: true, cartorialPending: false, sendFinancialReminders: false };
  }
  if (pending) {
    return {
      label: `${FINANCIAL_STATUS[financial]} · ${PROTEST_STATUS[protest]}`,
      detail: 'Título em aberto com acompanhamento cartorário.',
      tone: 'danger',
      financialSettled: false,
      cartorialPending: true,
      sendFinancialReminders: !stopReminders
    };
  }
  const tone: Tone = financial === 'vencido' ? 'danger' : financial === 'parcialmente_pago' || financial === 'a_vencer' ? 'warning' : financial === 'cancelado' ? 'neutral' : 'info';
  return {
    label: FINANCIAL_STATUS[financial],
    detail: protest === 'programado' ? 'Encaminhamento a protesto programado (data interna).' : '',
    tone,
    financialSettled: false,
    cartorialPending: false,
    sendFinancialReminders: !stopReminders
  };
}

/* ------------------------------------------------------------------ */
/* Pagamentos parciais                                                 */
/* ------------------------------------------------------------------ */

export interface PaymentApplication {
  appliedCents: Cents;
  newPaidCents: Cents;
  outstandingCents: Cents;
  overpaymentCents: Cents;
}

export function applyPayment(amountCents: Cents, alreadyPaidCents: Cents, paymentCents: Cents): PaymentApplication {
  if (paymentCents <= 0) throw new Error('O valor do pagamento deve ser positivo');
  const outstanding = Math.max(0, amountCents - alreadyPaidCents);
  const applied = Math.min(outstanding, paymentCents);
  return {
    appliedCents: applied,
    newPaidCents: alreadyPaidCents + applied,
    outstandingCents: outstanding - applied,
    overpaymentCents: paymentCents - applied
  };
}

/** Distribui um pagamento entre vários títulos, do vencimento mais antigo para o mais novo. */
export function allocatePayment<T extends { id: string; due: ISODate; outstandingCents: Cents }>(
  items: T[],
  paymentCents: Cents
): { allocations: { id: string; cents: Cents }[]; remainderCents: Cents } {
  let left = paymentCents;
  const allocations: { id: string; cents: Cents }[] = [];
  for (const item of [...items].sort((a, b) => (a.due < b.due ? -1 : 1))) {
    if (left <= 0) break;
    const cents = Math.min(left, item.outstandingCents);
    if (cents > 0) {
      allocations.push({ id: item.id, cents });
      left -= cents;
    }
  }
  return { allocations, remainderCents: left };
}


/** Converte uma regra de cobrança do banco (snake_case, ex.: collection_rule_snapshot) em ChargeRules. */
export function chargeRulesFromRow(r: Record<string, unknown> | null | undefined): ChargeRules {
  if (!r) return EMPTY_CHARGE_RULES;
  const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
  return {
    finePercent: num(r.fine_percent), interestPercent: num(r.interest_percent),
    interestPeriod: r.interest_period === 'diario' ? 'diario' : 'mensal', graceDays: num(r.grace_days),
    dueDateHandling: r.due_date_handling === 'manter' ? 'manter' : 'proximo_dia_util',
    protestAfterDays: num(r.protest_after_days), protestDayCount: r.protest_day_count === 'uteis' ? 'uteis' : 'corridos'
  };
}

export const ORDER_STATUS = {
  orcamento: 'Orçamento',
  aguardando_confirmacao: 'Aguardando confirmação',
  confirmado: 'Confirmado',
  em_preparacao: 'Em preparação',
  aguardando_entrega: 'Aguardando entrega',
  em_rota: 'Em rota',
  entregue: 'Entregue',
  aguardando_recolhimento: 'Aguardando recolhimento',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado'
} as const;
export type OrderStatus = keyof typeof ORDER_STATUS;

export const ORDER_KIND = { evento: 'Evento', ponto_fixo: 'Ponto fixo', avulso: 'Avulso', recorrente: 'Recorrente' } as const;

const FLOW: OrderStatus[] = [
  'orcamento',
  'aguardando_confirmacao',
  'confirmado',
  'em_preparacao',
  'aguardando_entrega',
  'em_rota',
  'entregue',
  'aguardando_recolhimento',
  'finalizado'
];

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  if (from === 'finalizado' || from === 'cancelado') return false;
  if (to === 'cancelado') return true;
  const fi = FLOW.indexOf(from);
  const ti = FLOW.indexOf(to);
  // Permite avançar (inclusive pular etapas operacionais), nunca voltar após confirmado.
  if (ti > fi) return true;
  return fi <= FLOW.indexOf('aguardando_confirmacao') && ti < fi;
}

/** Status a partir do qual o pedido gera efeitos (estoque reservado, recebível, entrega). */
export function isCommitted(s: OrderStatus): boolean {
  return FLOW.indexOf(s) >= FLOW.indexOf('confirmado');
}

export interface OrderLine {
  quantity: number;
  litersPerUnit: number;
  unitPriceCents: number;
  unitCostCents: number;
  discountCents: number;
}

export function lineTotals(l: OrderLine) {
  const gross = Math.round(l.quantity * l.unitPriceCents);
  const total = gross - l.discountCents;
  const cost = Math.round(l.quantity * l.unitCostCents);
  return { gross, total, cost, liters: l.quantity * l.litersPerUnit };
}

export function orderTotals(lines: OrderLine[], orderDiscountCents = 0, freightCents = 0) {
  const t = lines.map(lineTotals);
  const subtotal = t.reduce((s, x) => s + x.total, 0);
  const cost = t.reduce((s, x) => s + x.cost, 0);
  const liters = t.reduce((s, x) => s + x.liters, 0);
  const total = subtotal - orderDiscountCents + freightCents;
  const marginPercent = total > 0 ? ((total - cost - freightCents) / total) * 100 : 0;
  return { subtotal, cost, liters, total, marginPercent };
}

/** Divide total em parcelas sem perder centavos (resto vai para a primeira parcela). */
export function splitInstallments(totalCents: number, n: number): number[] {
  if (n < 1) throw new Error('Número de parcelas inválido');
  const base = Math.floor(totalCents / n);
  const rest = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? rest : 0));
}

/**
 * Estoque baseado em movimentações. Disponível = físico − reservado.
 * Saídas seguem FEFO (primeiro a vencer, primeiro a sair) quando há lotes com validade.
 */
export interface Lot {
  id: string;
  quantity: number;
  expiresAt: string | null;
}

export interface Allocation {
  lotId: string;
  quantity: number;
}

export class InsufficientStockError extends Error {
  constructor(public readonly requested: number, public readonly available: number) {
    super(`Estoque insuficiente: solicitado ${requested}, disponível ${available}`);
  }
}

export function allocateFEFO(lots: Lot[], quantity: number, today?: string): Allocation[] {
  if (quantity <= 0) throw new Error('Quantidade deve ser positiva');
  const usable = lots
    .filter((l) => l.quantity > 0 && (!today || !l.expiresAt || l.expiresAt >= today))
    .sort((a, b) => {
      if (a.expiresAt === b.expiresAt) return 0;
      if (a.expiresAt === null) return 1;
      if (b.expiresAt === null) return -1;
      return a.expiresAt < b.expiresAt ? -1 : 1;
    });
  const total = usable.reduce((s, l) => s + l.quantity, 0);
  if (total < quantity) throw new InsufficientStockError(quantity, total);
  const out: Allocation[] = [];
  let left = quantity;
  for (const lot of usable) {
    if (left <= 0) break;
    const q = Math.min(lot.quantity, left);
    out.push({ lotId: lot.id, quantity: q });
    left -= q;
  }
  return out;
}

export type MovementType =
  | 'entrada'
  | 'saida'
  | 'reserva'
  | 'liberacao_reserva'
  | 'transferencia'
  | 'devolucao'
  | 'perda'
  | 'vencimento'
  | 'ajuste'
  | 'consumo_interno'
  | 'inventario';

/** Sinal do efeito de cada movimentação no estoque FÍSICO. Reservas não mexem no físico. */
export const MOVEMENT_SIGN: Record<MovementType, -1 | 0 | 1> = {
  entrada: 1,
  devolucao: 1,
  saida: -1,
  perda: -1,
  vencimento: -1,
  consumo_interno: -1,
  transferencia: 0,
  reserva: 0,
  liberacao_reserva: 0,
  ajuste: 1, // ajuste usa quantidade com sinal
  inventario: 1
};

export interface StockPosition {
  physical: number;
  reserved: number;
  available: number;
}

export function stockPosition(physical: number, reserved: number): StockPosition {
  return { physical, reserved, available: physical - reserved };
}

export function canReserve(pos: StockPosition, quantity: number): boolean {
  return quantity > 0 && pos.available >= quantity;
}

export interface ConsumptionPoint {
  date: string;
  quantity: number;
}

/** Sugestão de compra: consumo médio diário × (lead time + cobertura) + reservas − disponível. */
export function suggestPurchase(opts: {
  history: ConsumptionPoint[];
  historyDays: number;
  leadTimeDays: number;
  coverageDays: number;
  available: number;
  futureReservations: number;
  minimum: number;
}): number {
  const consumed = opts.history.reduce((s, h) => s + h.quantity, 0);
  const daily = opts.historyDays > 0 ? consumed / opts.historyDays : 0;
  const need = daily * (opts.leadTimeDays + opts.coverageDays) + opts.futureReservations + opts.minimum;
  return Math.max(0, Math.ceil(need - opts.available));
}

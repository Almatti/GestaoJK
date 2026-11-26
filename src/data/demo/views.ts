/** Visões calculadas do ambiente de demonstração (equivalentes simplificados das views SQL). */
import { addDays, todaySP, diffDays } from '@/domain/dates';
import type { Row } from '../types';
import { table } from './store';

const n = (v: unknown) => Number(v ?? 0);

export function orderItemsComputed(): Row[] {
  return table('order_items').map((i) => ({
    ...i,
    total: Math.round((n(i.quantity) * n(i.unit_price) - n(i.discount)) * 100) / 100,
    total_cost: Math.round(n(i.quantity) * n(i.unit_cost) * 100) / 100,
    liters: n(i.quantity) * n(i.liters_per_unit)
  }));
}

export function stockPositions(): Row[] {
  const mov = table('inventory_movements');
  const res = table('stock_reservations').filter((r) => r.status === 'ativa');
  return table('stock_items')
    .filter((s) => s.status !== 'arquivado')
    .map((s) => {
      const physical = mov.filter((m) => m.stock_item_id === s.id).reduce((a, m) => a + n(m.quantity), 0);
      const reserved = res.filter((r) => r.stock_item_id === s.id).reduce((a, r) => a + n(r.quantity), 0);
      return { stock_item_id: s.id, id: s.id, name: s.name, kind: s.kind, unit: s.unit, min_quantity: s.min_quantity, product_id: s.product_id, keg_size_id: s.keg_size_id, returnable: s.returnable, physical, reserved, available: physical - reserved };
    });
}

export function financialStatus(r: Row, today = todaySP()): string {
  if (['cancelado', 'renegociado', 'pago'].includes(String(r.status))) return String(r.status);
  if (String(r.due_date) < today) return n(r.paid_amount) > 0 ? 'parcialmente_pago' : 'vencido';
  if (n(r.paid_amount) > 0) return 'parcialmente_pago';
  return String(r.due_date) <= addDays(today, 7) ? 'a_vencer' : 'em_aberto';
}

export function receivablesView(): Row[] {
  const customers = new Map(table('customers').map((c) => [c.id, c]));
  const today = todaySP();
  return table('receivables').map((r) => {
    const c = customers.get(r.customer_id as string) ?? {};
    return {
      ...r,
      customer_name: c.name, customer_trade_name: c.trade_name, customer_whatsapp: c.whatsapp, customer_phone: c.phone,
      outstanding: Math.max(n(r.amount) - n(r.paid_amount), 0),
      financial_status: financialStatus(r, today),
      days_overdue: Math.max(diffDays(String(r.due_date), today), 0)
    };
  });
}

export function accountBalances(): Row[] {
  const tx = table('financial_transactions');
  return table('financial_accounts').map((a) => {
    const mine = tx.filter((t) => t.account_id === a.id);
    return { id: a.id, name: a.name, kind: a.kind, opening_balance: a.opening_balance, balance: n(a.opening_balance) + mine.reduce((s, t) => s + n(t.amount), 0), unreconciled: mine.filter((t) => !t.reconciled).reduce((s, t) => s + n(t.amount), 0) };
  });
}

const COMMITTED = (s: unknown) => !['orcamento', 'aguardando_confirmacao', 'cancelado'].includes(String(s));

export function customerConsumption(): Row[] {
  const today = todaySP();
  const orders = table('orders').filter((o) => COMMITTED(o.status));
  return table('customers').map((c) => {
    const mine = orders.filter((o) => o.customer_id === c.id);
    const cond = table('commercial_conditions').find((cc) => cc.customer_id === c.id && String(cc.valid_from) <= today && (!cc.valid_to || String(cc.valid_to) >= today));
    const age = (o: Row) => diffDays(String(o.order_date), today);
    return {
      customer_id: c.id, name: c.name, trade_name: c.trade_name, segment: c.segment, status: c.status,
      customer_since: String(c.created_at).slice(0, 10),
      last_order_date: mine.map((o) => String(o.order_date)).sort().at(-1) ?? null,
      orders_count: mine.length,
      liters_30d: mine.filter((o) => age(o) < 30).reduce((s, o) => s + n(o.total_liters), 0),
      liters_prev_30d: mine.filter((o) => age(o) >= 30 && age(o) < 60).reduce((s, o) => s + n(o.total_liters), 0),
      total_purchased: mine.reduce((s, o) => s + n(o.total), 0),
      total_liters: mine.reduce((s, o) => s + n(o.total_liters), 0),
      average_ticket: mine.length ? mine.reduce((s, o) => s + n(o.total), 0) / mine.length : 0,
      expected_liters_per_week: cond?.expected_liters_per_week ?? null,
      expected_kegs_per_week: cond?.expected_kegs_per_week ?? null,
      equipment_count: table('equipment').filter((e) => e.customer_id === c.id && ['em_ponto_fixo', 'instalado', 'em_evento'].includes(String(e.status))).length
    };
  });
}

export function lotBalances(): Row[] {
  const mov = table('inventory_movements');
  return table('inventory_lots').map((l) => ({ lot_id: l.id, id: l.id, stock_item_id: l.stock_item_id, lot_code: l.lot_code, expires_at: l.expires_at ?? null, quantity: mov.filter((m) => m.lot_id === l.id).reduce((s, m) => s + n(m.quantity), 0) }));
}

export const VIEWS: Record<string, () => Row[]> = {
  lot_balances: lotBalances,
  order_items: orderItemsComputed,
  stock_positions: stockPositions,
  receivables_view: receivablesView,
  account_balances: accountBalances,
  customer_consumption: customerConsumption
};

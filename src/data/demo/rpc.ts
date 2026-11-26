/**
 * RPCs do ambiente de demonstração. Reutilizam o domínio TypeScript. Em produção valem as funções SQL
 * (supabase/migrations/*_business_functions.sql), que são a fonte de verdade transacional.
 */
import { addDays, addMonths, diffDays, todaySP } from '@/domain/dates';
import { calculateCharges, type ChargeRules } from '@/domain/collections';
import { toCents, fromCents } from '@/domain/money';
import { renderTemplate } from '@/domain/messages';
import { formatBRL } from '@/domain/money';
import { formatDateBR } from '@/domain/dates';
import type { Row } from '../types';
import { nowIso, table, uid } from './store';
import { accountBalances, customerConsumption, orderItemsComputed, stockPositions } from './views';

const n = (v: unknown) => Number(v ?? 0);
const COMMITTED = (s: unknown) => !['orcamento', 'aguardando_confirmacao', 'cancelado'].includes(String(s));
const fail = (msg: string): never => {
  throw new Error(msg);
};

function recalcOrder(orderId: string) {
  const o = table('orders').find((x) => x.id === orderId);
  if (!o) return;
  const items = orderItemsComputed().filter((i) => i.order_id === orderId);
  const subtotal = items.reduce((s, i) => s + n(i.total), 0);
  const cost = items.reduce((s, i) => s + n(i.total_cost), 0);
  const total = subtotal - n(o.discount) + n(o.freight);
  Object.assign(o, { subtotal, total_cost: cost, total_liters: items.reduce((s, i) => s + n(i.liters), 0), total, margin_percent: total > 0 ? Math.round(((subtotal - n(o.discount) - cost) / total) * 10000) / 100 : null });
}
export { recalcOrder };

function rule(): ChargeRules & Row {
  const r = table('collection_rules').find((x) => !x.customer_id) ?? {};
  return {
    finePercent: n(r.fine_percent), interestPercent: n(r.interest_percent), interestPeriod: (r.interest_period as 'mensal') ?? 'mensal',
    graceDays: n(r.grace_days), dueDateHandling: (r.due_date_handling as 'proximo_dia_util') ?? 'proximo_dia_util',
    protestAfterDays: n(r.protest_after_days), protestDayCount: (r.protest_day_count as 'uteis') ?? 'corridos', ...r
  };
}

function setting<T>(key: string, fallback: T): T {
  return (table('settings').find((s) => s.key === key)?.value as T) ?? fallback;
}

function resolvePrice(customer: string, product: string, keg: string | null) {
  const today = todaySP();
  const liters = keg ? n(table('keg_sizes').find((k) => k.id === keg)?.liters) || 1 : 1;
  const eff = (r: Row) => String(r.valid_from) <= today && (!r.valid_to || String(r.valid_to) >= today);
  const cp = table('customer_product_prices').filter((p) => p.customer_id === customer && p.product_id === product && eff(p));
  const byKeg = cp.find((p) => keg && p.keg_size_id === keg && p.unit_price != null);
  if (byKeg) return { source: 'cliente_barril', unit_price: n(byKeg.unit_price), price_per_liter: n(byKeg.unit_price) / liters, liters };
  const perL = cp.find((p) => !p.keg_size_id && p.price_per_liter != null);
  if (perL) return { source: 'cliente_litro', unit_price: Math.round(n(perL.price_per_liter) * liters * 100) / 100, price_per_liter: n(perL.price_per_liter), liters };
  const variant = table('product_variants').find((v) => v.product_id === product && v.keg_size_id === keg && v.price != null);
  if (variant) return { source: 'produto_barril', unit_price: n(variant.price), price_per_liter: n(variant.price) / liters, liters };
  const p = table('products').find((x) => x.id === product);
  return { source: 'produto_litro', unit_price: Math.round(n(p?.price_per_unit) * liters * 100) / 100, price_per_liter: n(p?.price_per_unit), liters };
}

function notify(category: string, title: string, body: string, link: string, dedup: string, priority = 'normal') {
  if (table('notifications').some((x) => x.dedup_key === dedup)) return 0;
  table('notifications').push({ id: uid(), category, priority, title, body, link, status: 'nao_lida', dedup_key: dedup, created_at: nowIso() });
  return 1;
}

function renderForReceivable(tplKey: string, r: Row): string {
  const tpl = table('message_templates').find((t) => t.key === tplKey && t.active);
  const c = table('customers').find((x) => x.id === r.customer_id) ?? {};
  const co = table('company')[0] ?? {};
  const ch = calculateCharges(toCents(n(r.amount) - n(r.paid_amount)), String(r.due_date), todaySP(), rule());
  return renderTemplate(String(tpl?.body ?? ''), {
    NOME_CLIENTE: String(c.trade_name ?? c.name ?? ''), NOME_EMPRESA: String(co.trade_name ?? ''),
    VALOR_ORIGINAL: formatBRL(toCents(n(r.amount) - n(r.paid_amount))), VALOR_ATUALIZADO: formatBRL(ch.total),
    DATA_VENCIMENTO: formatDateBR(String(r.due_date)), DIAS_ATRASO: ch.daysLate, CHAVE_PIX: co.pix_key as string
  }).text;
}

export const DEMO_RPC: Record<string, (args: Record<string, unknown>) => unknown> = {
  resolve_price: (a) => [resolvePrice(String(a.p_customer), String(a.p_product), (a.p_keg_size as string) ?? null)],

  dashboard_metrics: (a) => {
    const start = String(a.p_start);
    const end = String(a.p_end);
    const t = todaySP();
    const orders = table('orders').filter((o) => COMMITTED(o.status) && String(o.order_date) >= start && String(o.order_date) <= end);
    const items = orderItemsComputed().filter((i) => orders.some((o) => o.id === i.order_id));
    const open = table('receivables').filter((r) => ['em_aberto', 'parcialmente_pago'].includes(String(r.status)));
    const payOpen = table('payables').filter((r) => ['em_aberto', 'parcialmente_pago'].includes(String(r.status)));
    const out = (rs: Row[]) => rs.reduce((s, r) => s + n(r.amount) - n(r.paid_amount), 0);
    const cons = customerConsumption();
    const eq = table('equipment').filter((e) => e.status !== 'inativo');
    const balance = accountBalances().reduce((s, b) => s + n(b.balance), 0);
    const products = new Map(table('products').map((p) => [p.id, p.name]));
    const top = new Map<string, { name: string; liters: number; revenue: number }>();
    for (const i of items) {
      const k = String(i.product_id);
      const cur = top.get(k) ?? { name: String(products.get(k)), liters: 0, revenue: 0 };
      cur.liters += n(i.liters);
      cur.revenue += n(i.total);
      top.set(k, cur);
    }
    const days: Row[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const od = orders.filter((o) => o.order_date === d);
      days.push({ day: d, liters: od.reduce((s, o) => s + n(o.total_liters), 0), revenue: od.reduce((s, o) => s + n(o.total), 0) });
    }
    const protestPending = table('protest_records').filter((p) => ['encaminhado', 'em_cartorio', 'protestado', 'aguardando_anuencia', 'aguardando_cancelamento', 'cancelamento_solicitado'].includes(String(p.status)));
    const recvById = new Map(table('receivables').map((r) => [r.id, r]));
    return {
      period: { start, end },
      orders_count: orders.length,
      liters_sold: orders.reduce((s, o) => s + n(o.total_liters), 0),
      kegs_sold: items.filter((i) => i.keg_size_id).reduce((s, i) => s + n(i.quantity), 0),
      active_customers: table('customers').filter((c) => c.status === 'ativo').length,
      inactive_customers: cons.filter((c) => c.status === 'ativo' && (!c.last_order_date || String(c.last_order_date) < addDays(t, -60)) && String(c.customer_since) < addDays(t, -30)).length,
      low_rotation_points: cons.filter((c) => n(c.expected_liters_per_week) > 0 && n(c.liters_30d) < (n(c.expected_liters_per_week) / 7) * 30 * 0.85 && String(c.customer_since) < addDays(t, -30)).length,
      healthy_points: cons.filter((c) => n(c.expected_liters_per_week) > 0 && n(c.liters_30d) >= (n(c.expected_liters_per_week) / 7) * 30 * 0.85).length,
      top_products: [...top.values()].sort((a, b) => b.liters - a.liters).slice(0, 5),
      equipment: {
        available: eq.filter((e) => e.status === 'disponivel').length,
        external: eq.filter((e) => ['instalado', 'em_ponto_fixo', 'em_evento', 'aguardando_recolhimento', 'em_transporte'].includes(String(e.status))).length,
        maintenance: eq.filter((e) => ['em_manutencao', 'em_higienizacao'].includes(String(e.status))).length,
        idle: eq.filter((e) => e.status === 'disponivel' && diffDays(String(e.custody_since).slice(0, 10), t) >= setting('equipment.idle_days', 15)).length
      },
      maintenance_due: eq.filter((e) => (e.next_maintenance_at && String(e.next_maintenance_at) <= addDays(t, 7)) || (e.next_sanitization_at && String(e.next_sanitization_at) <= addDays(t, 7))).length,
      service_orders_open: table('service_orders').filter((s) => ['aberta', 'agendada', 'em_execucao'].includes(String(s.status))).length,
      deliveries_scheduled: table('deliveries').filter((d) => d.status === 'programada').length,
      priority_tasks: table('tasks').filter((x) => ['a_fazer', 'em_andamento'].includes(String(x.status)) && ['alta', 'urgente'].includes(String(x.priority))).length,
      overdue_tasks: table('tasks').filter((x) => ['a_fazer', 'em_andamento'].includes(String(x.status)) && x.due_date && String(x.due_date) < t).length,
      low_stock: stockPositions().filter((s) => n(s.min_quantity) > 0 && n(s.available) <= n(s.min_quantity)).length,
      daily_series: days,
      revenue_billed: orders.reduce((s, o) => s + n(o.total), 0),
      cogs: orders.reduce((s, o) => s + n(o.total_cost), 0),
      revenue_received: table('payments').filter((p) => p.direction === 'entrada' && !p.reversed_at && String(p.paid_at) >= start && String(p.paid_at) <= end).reduce((s, p) => s + n(p.amount), 0),
      expenses_paid: table('payments').filter((p) => p.direction === 'saida' && !p.reversed_at && String(p.paid_at) >= start && String(p.paid_at) <= end).reduce((s, p) => s + n(p.amount), 0),
      receivable_open: out(open),
      receivable_overdue: out(open.filter((r) => String(r.due_date) < t)),
      receivable_due_soon: out(open.filter((r) => String(r.due_date) >= t && String(r.due_date) <= addDays(t, 7))),
      payable_open: out(payOpen),
      payable_overdue: out(payOpen.filter((r) => String(r.due_date) < t)),
      in_protest: protestPending.filter((p) => ['encaminhado', 'em_cartorio', 'protestado'].includes(String(p.status))).reduce((s, p) => { const r = recvById.get(p.receivable_id as string); return s + (r ? n(r.amount) - n(r.paid_amount) : 0); }, 0),
      paid_with_cartorial_pending: protestPending.filter((p) => recvById.get(p.receivable_id as string)?.status === 'pago').length,
      cash_balance: balance,
      cash_projection_30d: balance + out(open.filter((r) => String(r.due_date) <= addDays(t, 30))) - out(payOpen.filter((r) => String(r.due_date) <= addDays(t, 30)))
    };
  },

  cash_flow: (a) => {
    const rows: Row[] = [];
    for (let d = String(a.p_start); d <= String(a.p_end); d = addDays(d, 1)) {
      const tx = table('financial_transactions').filter((t) => t.occurred_on === d);
      rows.push({
        day: d,
        realized_in: tx.filter((t) => t.kind === 'recebimento').reduce((s, t) => s + n(t.amount), 0),
        realized_out: -tx.filter((t) => t.kind === 'pagamento').reduce((s, t) => s + n(t.amount), 0),
        expected_in: table('receivables').filter((r) => r.due_date === d && ['em_aberto', 'parcialmente_pago'].includes(String(r.status))).reduce((s, r) => s + n(r.amount) - n(r.paid_amount), 0),
        expected_out: table('payables').filter((r) => r.due_date === d && ['em_aberto', 'parcialmente_pago'].includes(String(r.status))).reduce((s, r) => s + n(r.amount) - n(r.paid_amount), 0)
      });
    }
    return rows;
  },

  dre: (a) => {
    const orders = table('orders').filter((o) => COMMITTED(o.status) && String(o.delivery_date ?? o.order_date) >= String(a.p_start) && String(o.delivery_date ?? o.order_date) <= String(a.p_end));
    const gross = orders.reduce((s, o) => s + n(o.total), 0);
    const cogs = orders.reduce((s, o) => s + n(o.total_cost), 0);
    const tax = Math.round(gross * n(setting('commercial.sales_tax_percent', 0))) / 100;
    const cats = new Map(table('financial_categories').map((c) => [c.id, c.dre_group]));
    const pay = table('payables').filter((p) => p.status !== 'cancelado' && String(p.competence_date) >= String(a.p_start) && String(p.competence_date) <= String(a.p_end));
    const grp = (g: string) => pay.filter((p) => cats.get(p.category_id as string) === g).reduce((s, p) => s + n(p.amount), 0);
    const variable = grp('despesas_variaveis');
    const fixed = grp('despesas_fixas');
    return {
      regime: 'competencia', receita_bruta: gross, receita_produtos: gross, receita_servicos: 0, deducoes_estimadas: tax, receita_liquida: gross - tax,
      cmv: cogs, lucro_bruto: gross - tax - cogs, despesas_variaveis: variable, margem_contribuicao: gross - tax - cogs - variable,
      despesas_fixas: fixed, resultado_operacional: gross - tax - cogs - variable - fixed, receitas_financeiras: 0, despesas_financeiras: grp('despesas_financeiras'),
      resultado_gerencial: gross - tax - cogs - variable - fixed - grp('despesas_financeiras'),
      aviso: 'DRE gerencial para apoio à decisão. Não substitui as demonstrações contábeis oficiais.'
    };
  },

  kpi_value: (a) => {
    const m = DEMO_RPC.dashboard_metrics!(a) as Record<string, number>;
    const map: Record<string, number | null> = {
      faturamento: m.revenue_billed!, recebimentos: m.revenue_received!, litros_vendidos: m.liters_sold!, pedidos: m.orders_count!, clientes_ativos: m.active_customers!,
      inadimplencia_percent: m.receivable_open ? Math.round((m.receivable_overdue! / m.receivable_open) * 10000) / 100 : null,
      margem_contribuicao_percent: m.revenue_billed ? Math.round(((m.revenue_billed - m.cogs!) / m.revenue_billed) * 10000) / 100 : null
    };
    return map[String(a.p_metric)] ?? null;
  },

  receivable_charges: (a) => {
    const r = table('receivables').find((x) => x.id === a.p_receivable);
    if (!r) return [];
    const c = calculateCharges(toCents(n(r.amount) - n(r.paid_amount)), String(r.due_date), String(a.p_ref ?? todaySP()), rule());
    return [{ days_late: c.daysLate, principal: fromCents(c.principal), fine: fromCents(c.fine), interest: fromCents(c.interest), total: fromCents(c.total) }];
  },

  global_search: (a) => {
    const q = String(a.p_query).toLowerCase();
    const res: Row[] = [];
    table('customers').filter((c) => `${c.name} ${c.trade_name} ${c.document}`.toLowerCase().includes(q)).slice(0, 8).forEach((c) => res.push({ kind: 'cliente', id: c.id, title: c.trade_name ?? c.name, subtitle: c.city, link: `/clientes/${c.id}` }));
    table('orders').filter((o) => String(o.number) === q).forEach((o) => res.push({ kind: 'pedido', id: o.id, title: `Pedido nº ${o.number}`, subtitle: o.status, link: `/pedidos/${o.id}` }));
    table('equipment').filter((e) => String(e.asset_code).toLowerCase().includes(q)).forEach((e) => res.push({ kind: 'equipamento', id: e.id, title: e.asset_code, subtitle: e.status, link: `/equipamentos/${e.id}` }));
    table('products').filter((p) => String(p.name).toLowerCase().includes(q)).forEach((p) => res.push({ kind: 'produto', id: p.id, title: p.name, subtitle: p.sku, link: '/produtos' }));
    table('tasks').filter((t) => String(t.title).toLowerCase().includes(q)).forEach((t) => res.push({ kind: 'tarefa', id: t.id, title: t.title, subtitle: t.status, link: '/tarefas' }));
    return res;
  },

  confirm_order: (a) => {
    const o = table('orders').find((x) => x.id === a.p_order) ?? fail('Pedido não encontrado');
    if (!['orcamento', 'aguardando_confirmacao'].includes(String(o.status))) return { already_confirmed: true };
    const items = orderItemsComputed().filter((i) => i.order_id === o.id);
    if (!items.length) fail('Pedido sem itens');
    const minMargin = n(setting('commercial.min_margin_percent', 20));
    if (o.margin_percent != null && n(o.margin_percent) < minMargin && !String(a.p_margin_justification ?? '').trim())
      fail(`Margem de ${o.margin_percent}% abaixo do mínimo de ${minMargin}%. Requer aprovação com justificativa.`);
    const pos = stockPositions();
    for (const i of items) {
      const si = table('stock_items').find((s) => s.product_id === i.product_id && s.keg_size_id === i.keg_size_id);
      if (!si) continue;
      const p = pos.find((x) => x.stock_item_id === si.id);
      if (n(p?.available) < n(i.quantity)) fail(`Estoque disponível insuficiente (disponível ${n(p?.available)}, solicitado ${n(i.quantity)})`);
      table('stock_reservations').push({ id: uid(), stock_item_id: si.id, quantity: i.quantity, order_id: o.id, status: 'ativa', created_at: nowIso() });
    }
    for (const eq of (a.p_equipment as string[] | undefined) ?? []) {
      const start = String(o.delivery_date ?? o.order_date);
      const end = o.pickup_date ? String(o.pickup_date) : '9999-12-31';
      const clash = table('equipment_reservations').find((r) => r.equipment_id === eq && r.status === 'ativa' && String(r.starts_at).slice(0, 10) <= end && start <= String(r.ends_at ?? '9999-12-31').slice(0, 10));
      if (clash) fail('Equipamento já reservado para outro compromisso no mesmo período');
      table('equipment_reservations').push({ id: uid(), equipment_id: eq, customer_id: o.customer_id, order_id: o.id, starts_at: start, ends_at: o.pickup_date ?? null, status: 'ativa', created_at: nowIso() });
      const e = table('equipment').find((x) => x.id === eq);
      if (e && e.status === 'disponivel') e.status = 'reservado';
    }
    const cond = table('commercial_conditions').find((c) => c.customer_id === o.customer_id);
    const term = n(cond?.payment_term_days ?? rule().default_term_days);
    const nInst = n(o.installments) || 1;
    const totalC = toCents(n(o.total));
    const base = Math.floor(totalC / nInst);
    for (let i = 1; i <= nInst; i++) {
      table('receivables').push({ id: uid(), customer_id: o.customer_id, order_id: o.id, description: `Pedido nº ${o.number} — parcela ${i}/${nInst}`, installment_no: i, installment_count: nInst,
        competence_date: o.delivery_date ?? o.order_date, issue_date: todaySP(), due_date: addDays(String(o.first_due_date ?? addDays(String(o.delivery_date ?? o.order_date), term)), (i - 1) * 30),
        amount: fromCents(base + (i === 1 ? totalC - base * nInst : 0)), paid_amount: 0, interest_amount: 0, fine_amount: 0, discount_amount: 0, status: 'em_aberto', payment_method: o.payment_method, created_at: nowIso() });
    }
    if (o.delivery_date) table('deliveries').push({ id: uid(), kind: 'entrega', order_id: o.id, customer_id: o.customer_id, scheduled_date: o.delivery_date, scheduled_time: o.delivery_time, address: o.delivery_address, status: 'programada', full_kegs: items.reduce((s, i) => s + n(i.quantity), 0), empty_kegs: 0, cylinders: 0, equipment_ids: [], created_at: nowIso() });
    table('tasks').push({ id: uid(), title: `Preparar pedido nº ${o.number}`, status: 'a_fazer', priority: 'alta', category: 'operacional', due_date: o.delivery_date ?? o.order_date, ref_type: 'order', ref_id: o.id, checklist: [], created_at: nowIso() });
    table('order_status_history').push({ id: uid(), order_id: o.id, from_status: o.status, to_status: 'confirmado', changed_at: nowIso() });
    Object.assign(o, { status: 'confirmado', confirmed_at: nowIso(), margin_justification: a.p_margin_justification ?? o.margin_justification });
    return { status: 'confirmado' };
  },

  set_order_status: (a) => {
    const o = table('orders').find((x) => x.id === a.p_order) ?? fail('Pedido não encontrado');
    if (a.p_status === 'cancelado') return DEMO_RPC.cancel_order!({ p_order: a.p_order, p_reason: a.p_notes ?? 'Cancelado' });
    if (['entregue', 'aguardando_recolhimento', 'finalizado'].includes(String(a.p_status))) {
      for (const r of table('stock_reservations').filter((x) => x.order_id === o.id && x.status === 'ativa')) {
        table('inventory_movements').push({ id: uid(), stock_item_id: r.stock_item_id, movement_type: 'saida', quantity: -n(r.quantity), ref_type: 'order', ref_id: o.id, created_at: nowIso() });
        r.status = 'consumida';
      }
      for (const res of table('equipment_reservations').filter((x) => x.order_id === o.id && x.status === 'ativa')) {
        const e = table('equipment').find((x) => x.id === res.equipment_id);
        if (!e) continue;
        const to = o.kind === 'evento' ? 'em_evento' : 'em_ponto_fixo';
        table('equipment_movements').push({ id: uid(), equipment_id: e.id, from_status: e.status, to_status: to, to_location: 'cliente', customer_id: o.customer_id, order_id: o.id, reason: 'Entrega do pedido', moved_at: nowIso() });
        Object.assign(e, { status: to, customer_id: o.customer_id, location: 'cliente', custody_since: nowIso() });
      }
      table('deliveries').filter((d) => d.order_id === o.id && d.kind === 'entrega' && d.status !== 'cancelada').forEach((d) => Object.assign(d, { status: 'concluida', completed_at: nowIso() }));
    }
    table('order_status_history').push({ id: uid(), order_id: o.id, from_status: o.status, to_status: a.p_status, changed_at: nowIso() });
    o.status = a.p_status;
    return null;
  },

  cancel_order: (a) => {
    const o = table('orders').find((x) => x.id === a.p_order) ?? fail('Pedido não encontrado');
    if (table('receivables').some((r) => r.order_id === o.id && n(r.paid_amount) > 0)) fail('Há pagamentos registrados; estorne-os antes de cancelar');
    table('stock_reservations').filter((r) => r.order_id === o.id && r.status === 'ativa').forEach((r) => (r.status = 'liberada'));
    table('receivables').filter((r) => r.order_id === o.id && r.status === 'em_aberto').forEach((r) => (r.status = 'cancelado'));
    table('deliveries').filter((d) => d.order_id === o.id).forEach((d) => (d.status = 'cancelada'));
    for (const res of table('equipment_reservations').filter((x) => x.order_id === o.id && x.status === 'ativa')) {
      res.status = 'cancelada';
      const e = table('equipment').find((x) => x.id === res.equipment_id);
      if (e && e.status === 'reservado') e.status = 'disponivel';
    }
    Object.assign(o, { status: 'cancelado', cancelled_at: nowIso(), cancel_reason: a.p_reason });
    return null;
  },

  duplicate_order: (a) => {
    const o = table('orders').find((x) => x.id === a.p_order) ?? fail('Pedido não encontrado');
    const id = uid();
    const number = Math.max(0, ...table('orders').map((x) => n(x.number))) + 1;
    table('orders').push({ ...o, id, number, status: 'orcamento', order_date: todaySP(), delivery_date: a.p_delivery_date ?? null, confirmed_at: null, source_order_id: o.id, created_at: nowIso() });
    for (const i of table('order_items').filter((x) => x.order_id === o.id)) {
      const pr = resolvePrice(String(o.customer_id), String(i.product_id), (i.keg_size_id as string) ?? null);
      table('order_items').push({ ...i, id: uid(), order_id: id, unit_price: pr.unit_price, price_per_liter: pr.price_per_liter, price_source: pr.source });
    }
    recalcOrder(id);
    return id;
  },

  register_receipt: (a) => {
    const r = table('receivables').find((x) => x.id === a.p_receivable) ?? fail('Título não encontrado');
    if (['cancelado', 'renegociado', 'pago'].includes(String(r.status))) fail(`Título ${r.status} não aceita pagamento`);
    const amount = n(a.p_amount);
    const principal = Math.min(amount - n(a.p_interest) - n(a.p_fine), n(r.amount) - n(r.paid_amount));
    const payId = uid();
    const acc = table('financial_accounts')[0];
    table('payments').push({ id: payId, direction: 'entrada', method: a.p_method, amount, paid_at: a.p_paid_at ?? todaySP(), account_id: acc?.id, customer_id: r.customer_id, verified: !!a.p_verified, external_ref: a.p_external_ref, notes: a.p_notes, created_at: nowIso() });
    table('payment_allocations').push({ id: uid(), payment_id: payId, receivable_id: r.id, amount, principal, interest: n(a.p_interest), fine: n(a.p_fine), reversed: false });
    r.paid_amount = Math.round((n(r.paid_amount) + principal) * 100) / 100;
    r.status = n(r.paid_amount) >= n(r.amount) ? 'pago' : 'parcialmente_pago';
    if (r.status === 'pago') Object.assign(r, { paid_at: a.p_paid_at ?? todaySP(), payment_method: a.p_method });
    if (acc) table('financial_transactions').push({ id: uid(), account_id: acc.id, kind: 'recebimento', amount, occurred_on: a.p_paid_at ?? todaySP(), description: r.description, payment_id: payId, reconciled: false, created_at: nowIso() });
    if (r.status === 'pago') {
      table('message_queue').filter((m) => m.ref_id === r.id && ['gerada', 'aberta'].includes(String(m.status))).forEach((m) => Object.assign(m, { status: 'cancelada', cancel_reason: 'Título quitado' }));
      const pr = table('protest_records').find((p) => p.receivable_id === r.id);
      if (pr && ['encaminhado', 'em_cartorio', 'protestado', 'aguardando_anuencia', 'aguardando_cancelamento', 'cancelamento_solicitado'].includes(String(pr.status)))
        notify('financeiro', 'Título pago com pendência cartorária', `${r.description} foi quitado, mas segue com pendência em cartório.`, '/financeiro/protestos', `paid_protest:${r.id}`, 'alta');
    }
    return { payment_id: payId, status: r.status };
  },

  pay_payable: (a) => {
    const b = table('payables').find((x) => x.id === a.p_payable) ?? fail('Conta não encontrada');
    const applied = Math.min(n(a.p_amount), n(b.amount) - n(b.paid_amount));
    const acc = table('financial_accounts')[0];
    const payId = uid();
    table('payments').push({ id: payId, direction: 'saida', method: a.p_method, amount: applied, paid_at: a.p_paid_at ?? todaySP(), account_id: acc?.id, verified: true, created_at: nowIso() });
    b.paid_amount = n(b.paid_amount) + applied;
    b.status = n(b.paid_amount) >= n(b.amount) ? 'pago' : 'parcialmente_pago';
    if (acc) table('financial_transactions').push({ id: uid(), account_id: acc.id, kind: 'pagamento', amount: -applied, occurred_on: a.p_paid_at ?? todaySP(), description: b.description, payment_id: payId, reconciled: false, created_at: nowIso() });
    return { payment_id: payId };
  },

  run_automations: () => {
    const t = todaySP();
    let effects = 0;
    for (const r of table('receivables').filter((x) => ['em_aberto', 'parcialmente_pago'].includes(String(x.status)))) {
      const late = diffDays(String(r.due_date), t);
      const tpl = late === -1 ? 'lembrete_vencimento' : late === 0 ? 'boleto_hoje' : late > 0 && (late - 1) % 3 === 0 ? 'boleto_vencido' : null;
      if (!tpl) continue;
      const dedup = `${tpl}:receivable:${r.id}:${t}`;
      if (table('message_queue').some((m) => m.dedup_key === dedup)) continue;
      const c = table('customers').find((x) => x.id === r.customer_id);
      table('message_queue').push({ id: uid(), template_key: tpl, customer_id: r.customer_id, phone: c?.whatsapp ?? c?.phone, body: renderForReceivable(tpl, r), ref_type: 'receivable', ref_id: r.id, scheduled_for: t, dedup_key: dedup, status: 'gerada', created_at: nowIso() });
      effects++;
    }
    for (const s of stockPositions().filter((x) => n(x.min_quantity) > 0 && n(x.available) <= n(x.min_quantity)))
      effects += notify('operacional', 'Estoque abaixo do mínimo', `${s.name}: disponível ${s.available}.`, '/estoque', `low_stock:${s.id}:${t}`, 'alta');
    for (const c of customerConsumption().filter((x) => n(x.expected_liters_per_week) > 0 && n(x.liters_30d) < (n(x.expected_liters_per_week) / 7) * 30 * 0.5))
      effects += notify('comercial', 'Queda de consumo / baixa rotatividade', `${c.trade_name ?? c.name} consumiu ${c.liters_30d} L nos últimos 30 dias.`, `/clientes/${c.customer_id}`, `consumption:${c.customer_id}:${t}`, 'alta');
    table('automation_runs').push({ id: uid(), run_date: t, started_at: nowIso(), finished_at: nowIso(), effects, status: 'concluida' });
    return { effects };
  },

  move_equipment: (a) => {
    const e = table('equipment').find((x) => x.id === a.p_equipment) ?? fail('Equipamento não encontrado');
    table('equipment_movements').push({ id: uid(), equipment_id: e.id, from_status: e.status, to_status: a.p_to_status, from_location: e.location, to_location: a.p_location ?? (a.p_customer ? 'cliente' : 'deposito'), customer_id: a.p_customer ?? null, reason: a.p_reason, moved_at: nowIso() });
    Object.assign(e, { status: a.p_to_status, customer_id: a.p_customer ?? null, location: a.p_location ?? (a.p_customer ? 'cliente' : 'deposito'), custody_since: nowIso() });
    if (['em_ponto_fixo', 'instalado'].includes(String(a.p_to_status))) e.next_sanitization_at = addDays(todaySP(), n(setting('equipment.sanitization_days', 15)));
    return null;
  },

  finalize_service_order: (a) => {
    const s = table('service_orders').find((x) => x.id === a.p_so) ?? fail('OS não encontrada');
    if (s.status === 'concluida') return { already_completed: true };
    for (const it of table('service_order_items').filter((x) => x.service_order_id === s.id)) {
      const p = stockPositions().find((x) => x.stock_item_id === it.stock_item_id);
      if (n(p?.physical) < n(it.quantity)) fail('Estoque insuficiente para a peça');
      table('inventory_movements').push({ id: uid(), stock_item_id: it.stock_item_id, movement_type: 'saida', quantity: -n(it.quantity), ref_type: 'service_order', ref_id: s.id, created_at: nowIso() });
    }
    const svc = table('services').find((x) => x.id === s.service_id);
    const e = table('equipment').find((x) => x.id === s.equipment_id);
    if (e && svc?.category === 'assepsia') Object.assign(e, { last_sanitization_at: todaySP(), next_sanitization_at: addDays(todaySP(), n(setting('equipment.sanitization_days', 15))) });
    if (e && String(svc?.category ?? '').startsWith('manutencao')) Object.assign(e, { last_maintenance_at: todaySP(), next_maintenance_at: addDays(todaySP(), n(setting('equipment.maintenance_days', 90))) });
    if (!s.is_free && n(s.charged_amount) > 0 && s.customer_id)
      table('receivables').push({ id: uid(), customer_id: s.customer_id, service_order_id: s.id, description: `OS nº ${s.number} — ${svc?.name ?? 'Serviço'}`, installment_no: 1, installment_count: 1, competence_date: todaySP(), issue_date: todaySP(), due_date: addDays(todaySP(), 7), amount: s.charged_amount, paid_amount: 0, status: 'em_aberto', created_at: nowIso() });
    Object.assign(s, { status: 'concluida', completed_at: nowIso(), work_done: a.p_work_done ?? s.work_done });
    return { ok: true };
  },

  schedule_service_order: (a) => {
    const s = table('service_orders').find((x) => x.id === a.p_so) ?? fail('OS não encontrada');
    Object.assign(s, { scheduled_date: a.p_date, scheduled_time: a.p_time, status: 'agendada' });
    table('calendar_events').push({ id: uid(), title: `OS nº ${s.number}`, kind: 'visita_tecnica', starts_at: `${a.p_date}T${a.p_time ?? '09:00'}:00-03:00`, ref_type: 'service_order', ref_id: s.id, status: 'confirmado', priority: 'normal', created_at: nowIso() });
    return null;
  },

  reverse_payment: (a) => {
    if (!String(a.p_reason ?? '').trim()) fail('Justificativa obrigatória');
    const p = table('payments').find((x) => x.id === a.p_payment) ?? fail('Pagamento não encontrado');
    if (p.reversed_at) fail('Pagamento já estornado');
    for (const al of table('payment_allocations').filter((x) => x.payment_id === p.id && !x.reversed)) {
      const target = al.receivable_id ? table('receivables').find((r) => r.id === al.receivable_id) : table('payables').find((r) => r.id === al.payable_id);
      if (target) {
        target.paid_amount = Math.round((n(target.paid_amount) - n(al.principal)) * 100) / 100;
        target.status = n(target.paid_amount) <= 0 ? 'em_aberto' : 'parcialmente_pago';
        target.paid_at = null;
      }
      al.reversed = true;
    }
    Object.assign(p, { reversed_at: nowIso(), reverse_reason: a.p_reason });
    for (const t of table('financial_transactions').filter((x) => x.payment_id === p.id && ['recebimento', 'pagamento'].includes(String(x.kind))))
      table('financial_transactions').push({ id: uid(), account_id: t.account_id, kind: 'estorno', amount: -n(t.amount), occurred_on: todaySP(), description: `Estorno: ${a.p_reason}`, payment_id: p.id, reconciled: false, created_at: nowIso() });
    return null;
  },

  renegotiate_receivable: (a) => {
    const r = table('receivables').find((x) => x.id === a.p_receivable) ?? fail('Título não encontrado');
    if (!['em_aberto', 'parcialmente_pago'].includes(String(r.status))) fail('Título não pode ser renegociado');
    if (!String(a.p_reason ?? '').trim()) fail('Justificativa obrigatória');
    const nInst = Math.max(1, n(a.p_installments));
    const totalC = toCents(n(a.p_new_total));
    const base = Math.floor(totalC / nInst);
    Object.assign(r, { status: 'renegociado', notes: `${r.notes ? `${r.notes}\n` : ''}Renegociado: ${a.p_reason}` });
    table('message_queue').filter((m) => m.ref_id === r.id && ['gerada', 'aberta'].includes(String(m.status))).forEach((m) => Object.assign(m, { status: 'cancelada', cancel_reason: 'Título renegociado' }));
    for (let i = 1; i <= nInst; i++)
      table('receivables').push({ id: uid(), customer_id: r.customer_id, order_id: r.order_id, renegotiated_from: r.id, description: `Renegociação de "${r.description}" — ${i}/${nInst}`, installment_no: i, installment_count: nInst, competence_date: todaySP(), issue_date: todaySP(), due_date: addDays(String(a.p_first_due), (i - 1) * 30), amount: fromCents(base + (i === 1 ? totalC - base * nInst : 0)), paid_amount: 0, interest_amount: 0, fine_amount: 0, discount_amount: 0, status: 'em_aberto', payment_method: r.payment_method, category_id: r.category_id, created_at: nowIso() });
    return nInst;
  },

  receive_purchase: (a) => {
    const pu = table('purchases').find((x) => x.id === a.p_purchase) ?? fail('Compra não encontrada');
    if (['cancelada', 'recebida'].includes(String(pu.status))) fail(`Compra ${pu.status}`);
    let total = 0;
    for (const x of a.p_items as { item_id: string; quantity: number }[]) {
      const pi = table('purchase_items').find((i) => i.id === x.item_id && i.purchase_id === pu.id) ?? fail('Item não encontrado');
      const q = n(x.quantity);
      if (q <= 0 || n(pi.received_quantity) + q > n(pi.quantity)) fail('Quantidade recebida inválida');
      let lotId: string | null = null;
      if (pi.lot_code) {
        const lot = table('inventory_lots').find((l) => l.stock_item_id === pi.stock_item_id && l.lot_code === pi.lot_code);
        lotId = String(lot?.id ?? '') || null;
        if (!lotId) { lotId = uid(); table('inventory_lots').push({ id: lotId, stock_item_id: pi.stock_item_id, lot_code: pi.lot_code, expires_at: pi.expires_at ?? null, received_at: todaySP() }); }
      }
      table('inventory_movements').push({ id: uid(), stock_item_id: pi.stock_item_id, lot_id: lotId, movement_type: 'entrada', quantity: q, unit_cost: pi.unit_cost, notes: `Recebimento compra nº ${pu.number}`, created_at: nowIso() });
      pi.received_quantity = n(pi.received_quantity) + q;
      const si = table('stock_items').find((s) => s.id === pi.stock_item_id);
      if (si) si.unit_cost = pi.unit_cost;
      total += Math.round(q * n(pi.unit_cost) * 100) / 100;
    }
    const complete = table('purchase_items').filter((i) => i.purchase_id === pu.id).every((i) => n(i.received_quantity) >= n(i.quantity));
    pu.status = complete ? 'recebida' : 'recebida_parcial';
    if (total > 0) {
      const cat = table('financial_categories').find((c) => c.name === 'Compra de chopp');
      table('payables').push({ id: uid(), supplier_id: pu.supplier_id, purchase_id: pu.id, description: `Compra nº ${pu.number}`, category_id: cat?.id ?? null, installment_no: table('payables').filter((p) => p.purchase_id === pu.id).length + 1, installment_count: 1, competence_date: todaySP(), due_date: pu.due_date ?? addDays(todaySP(), 30), amount: total, paid_amount: 0, status: 'em_aberto', created_at: nowIso() });
    }
    return { received_value: total, complete };
  },

  close_partner_month: (a) => {
    const pa = table('partners').find((x) => x.id === a.p_partner) ?? fail('Parceiro não encontrado');
    const per = `${String(a.p_period).slice(0, 7)}-01`;
    const perEnd = addDays(addMonths(per, 1), -1);
    if (table('partner_settlements').some((s) => s.partner_id === pa.id && s.period === per && s.status === 'fechado')) fail('Período já fechado para este parceiro');
    const ledger = table('partner_ledger').filter((l) => l.partner_id === pa.id);
    const opening = n(pa.opening_debt) + ledger.filter((l) => String(l.occurred_on) < per).reduce((s, l) => s + n(l.amount), 0);
    const inPer = ledger.filter((l) => String(l.occurred_on) >= per && String(l.occurred_on) <= perEnd);
    const obligations = inPer.filter((l) => l.entry_type === 'obrigacao').reduce((s, l) => s + n(l.amount), 0);
    const pays = -inPer.filter((l) => l.entry_type === 'pagamento').reduce((s, l) => s + n(l.amount), 0);
    const adj = inPer.filter((l) => ['ajuste', 'estorno'].includes(String(l.entry_type))).reduce((s, l) => s + n(l.amount), 0);
    const credited = new Set(ledger.filter((l) => l.entry_type === 'credito').map((l) => String(l.order_id)));
    const sid = uid();
    let credits = 0;
    for (const o of table('orders').filter((x) => x.partner_id === pa.id && x.status !== 'cancelado' && String(x.order_date) <= perEnd)) {
      if (credited.has(String(o.id))) continue;
      const recs = table('receivables').filter((r) => r.order_id === o.id && r.status !== 'cancelado');
      const eligible = pa.eligibility === 'confirmado' ? !!o.confirmed_at : pa.eligibility === 'entregue' ? ['entregue', 'aguardando_recolhimento', 'finalizado'].includes(String(o.status)) : recs.length > 0 && recs.every((r) => r.status === 'pago');
      if (!eligible) continue;
      const credit = Math.round(n(o.total) * n(o.kind === 'evento' ? pa.percent_event : pa.percent_fixed)) / 100 + n(pa.fixed_per_order);
      if (credit <= 0) continue;
      table('partner_ledger').push({ id: uid(), partner_id: pa.id, entry_type: 'credito', amount: pa.offset_debt ? -credit : 0, order_id: o.id, settlement_id: sid, occurred_on: perEnd, description: `Crédito pedido nº ${o.number}`, created_at: nowIso() });
      credits += credit;
    }
    const debt = opening + obligations - pays + adj;
    const offset = pa.offset_debt ? Math.max(0, Math.min(credits, debt)) : 0;
    const closing = debt - offset;
    table('partner_settlements').push({ id: sid, partner_id: pa.id, period: per, opening_debt: opening, new_obligations: obligations, payments: pays, adjustments: adj, total_credits: credits, offset_amount: offset, closing_debt: closing, credit_payable: credits - offset, status: 'fechado', closed_at: nowIso() });
    return { settlement_id: sid, credits, offset, closing_debt: closing, credit_payable: credits - offset };
  },

  reverse_partner_entry: (a) => {
    if (!String(a.p_reason ?? '').trim()) fail('Justificativa obrigatória');
    const e = table('partner_ledger').find((x) => x.id === a.p_entry) ?? fail('Lançamento não encontrado');
    if (table('partner_ledger').some((x) => x.reversed_entry_id === e.id)) fail('Lançamento já estornado');
    const id = uid();
    table('partner_ledger').push({ id, partner_id: e.partner_id, entry_type: 'estorno', amount: -n(e.amount), reversed_entry_id: e.id, occurred_on: todaySP(), description: `Estorno: ${a.p_reason}`, created_at: nowIso() });
    return id;
  },

  create_boleto: (a) => {
    const b = (a.p_boleto ?? {}) as Row;
    const due = String(b.due_date ?? '');
    const amount = n(b.original_amount);
    if (!due || !(amount > 0)) throw new Error('Informe vencimento e valor do boleto');
    let rid = (a.p_receivable as string) || null;
    const created = !rid;
    if (!rid) {
      if (!a.p_customer) throw new Error('Selecione o cliente do boleto');
      rid = uid();
      const issue = String(b.issue_date || todaySP());
      table('receivables').push({ id: rid, customer_id: a.p_customer, description: String(a.p_description || `Boleto${b.document_number ? ` nº ${b.document_number}` : b.our_number ? ` — nosso nº ${b.our_number}` : ''}`),
        installment_no: 1, installment_count: 1, competence_date: issue, issue_date: issue, due_date: due, amount, paid_amount: 0, discount_amount: 0,
        interest_amount: 0, fine_amount: 0, status: 'em_aberto', payment_method: 'boleto', created_at: nowIso() });
    } else {
      const r = table('receivables').find((x) => x.id === rid);
      if (!r) throw new Error('Título não encontrado');
      if (a.p_customer && r.customer_id !== a.p_customer) throw new Error('O título escolhido pertence a outro cliente');
      if (table('boletos').some((x) => x.receivable_id === rid && x.status !== 'cancelado')) throw new Error('Este título já tem um boleto ativo');
      r.payment_method = 'boleto';
    }
    const id = uid();
    const clean = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v === '' ? null : v]));
    table('boletos').push({ ...clean, id, receivable_id: rid, original_amount: amount, issue_date: b.issue_date || todaySP(), status: 'registrado', origin: 'manual', created_at: nowIso() });
    return { boleto_id: id, receivable_id: rid, receivable_created: created };
  },
  set_boleto_status: (a) => {
    const b = table('boletos').find((x) => x.id === a.p_boleto);
    if (!b) throw new Error('Boleto não encontrado');
    if (!String(a.p_reason ?? '').trim()) throw new Error('Informe o motivo');
    if (b.status === 'liquidado') throw new Error('Boleto já pago: para desfazer, estorne o pagamento no financeiro');
    const r = table('receivables').find((x) => x.id === b.receivable_id);
    if (a.p_status === 'registrado' && r?.status === 'cancelado') throw new Error('O título deste boleto está cancelado');
    b.status = a.p_status;
    if (a.p_cancel_receivable && a.p_status === 'cancelado' && r) {
      if (n(r.paid_amount) > 0) throw new Error('Há pagamentos no título: estorne-os antes de cancelá-lo');
      r.status = 'cancelado';
    }
    return { boleto_id: b.id, status: a.p_status };
  },
  transfer_between_accounts: (a) => {
    const g = uid();
    table('financial_transactions').push(
      { id: uid(), account_id: a.p_from, kind: 'transferencia_saida', amount: -n(a.p_amount), occurred_on: todaySP(), description: 'Transferência interna', transfer_group: g, created_at: nowIso() },
      { id: uid(), account_id: a.p_to, kind: 'transferencia_entrada', amount: n(a.p_amount), occurred_on: todaySP(), description: 'Transferência interna', transfer_group: g, created_at: nowIso() }
    );
    return g;
  }
};

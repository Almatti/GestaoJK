/** Dados FICTÍCIOS do ambiente de demonstração. Todos os nomes contêm "(DEMO)". */
import { addDays, todaySP } from '@/domain/dates';
import { uid, type Tables } from './store';
import { MESSAGE_TEMPLATE_SEED, SETTINGS_SEED } from './seedConfig';

export function seed(): Tables {
  const t = todaySP();
  const ts = (d: string) => `${d}T12:00:00.000Z`;
  const kegs = [10, 20, 30, 50].map((l) => ({ id: uid(), liters: l, label: `${l} L`, active: true }));
  const k50 = kegs[3]!.id;
  const k30 = kegs[2]!.id;
  const cat = { id: uid(), name: 'Chopp', active: true };
  const brand = { id: uid(), name: 'Cervejaria Exemplo (DEMO)', active: true };
  const products = [
    { id: uid(), name: 'Chopp Pilsen (DEMO)', sku: 'DEMO-PIL', internal_code: 'P01', category_id: cat.id, brand_id: brand.id, unit: 'litro', is_draft_beer: true, cost_per_unit: 9.5, price_per_unit: 19.9, min_stock: 0, status: 'ativo', created_at: ts(t) },
    { id: uid(), name: 'Chopp IPA (DEMO)', sku: 'DEMO-IPA', internal_code: 'P02', category_id: cat.id, brand_id: brand.id, unit: 'litro', is_draft_beer: true, cost_per_unit: 14, price_per_unit: 29.9, min_stock: 0, status: 'ativo', created_at: ts(t) }
  ];
  const stockItems = products.flatMap((p) => [k50, k30].map((k) => ({ id: uid(), name: `${p.name} — barril ${k === k50 ? 50 : 30} L`, kind: 'chopp', product_id: p.id, keg_size_id: k, unit: 'barril', min_quantity: 4, returnable: false, unit_cost: 0, status: 'ativo', created_at: ts(t) })));
  stockItems.push({ id: uid(), name: 'Kit limpeza assepsia (DEMO)', kind: 'limpeza', product_id: null as unknown as string, keg_size_id: null as unknown as string, unit: 'kit', min_quantity: 3, returnable: false, unit_cost: 12, status: 'ativo', created_at: ts(t) });
  const movements = stockItems.map((s, i) => ({ id: uid(), stock_item_id: s.id, lot_id: null, movement_type: 'entrada', quantity: i === 4 ? 6 : 12, location: 'deposito', notes: 'Estoque inicial (DEMO)', created_at: ts(addDays(t, -40)) }));

  const customers = [
    ['Bar Esquina Feliz (DEMO)', 'PJ', '11222333000181', 'ponto_fixo', 'São Paulo', 140, 100],
    ['Restaurante Sabor da Serra (DEMO)', 'PJ', '12ABC34501DE35', 'ponto_fixo', 'Campinas', 200, 150],
    ['Choperia Ponto Certo (DEMO)', 'PJ', null, 'ponto_fixo', 'São Paulo', 90, 80],
    ['Maria Eventos (DEMO)', 'PF', '52998224725', 'evento', 'Santo André', 60, null]
  ].map(([name, pt, doc, seg, city, age, expected]) => ({
    id: uid(), code: 0, person_type: pt, name, trade_name: name, document: doc, segment: seg, city, state: 'SP',
    whatsapp: '11987654321', phone: '1132654321', email: 'contato@exemplo.invalid', status: 'ativo',
    verification_status: doc ? 'formato_valido' : 'nao_verificado', created_at: ts(addDays(t, -(age as number))), expected
  }));
  customers.forEach((c, i) => (c.code = i + 1));
  const conditions = customers.filter((c) => c.expected).map((c) => ({ id: uid(), customer_id: c.id, valid_from: addDays(t, -365), valid_to: null, payment_term_days: 14, expected_liters_per_week: c.expected, discount_percent: 0, travel_fee: 0, created_at: ts(t) }));
  const customerPrices = [{ id: uid(), customer_id: customers[0]!.id, product_id: products[0]!.id, keg_size_id: null, price_per_liter: 18.5, unit_price: null, valid_from: addDays(t, -200), valid_to: null, created_at: ts(t) }];

  const orders: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  const receivables: Record<string, unknown>[] = [];
  let n = 100;
  const addOrder = (c: (typeof customers)[number], daysAgo: number, qty: number, status: string, paid: boolean) => {
    const id = uid();
    const date = addDays(t, -daysAgo);
    const price = c === customers[0] ? 925 : 995;
    const total = qty * price;
    orders.push({ id, number: ++n, kind: c.segment === 'evento' ? 'evento' : 'ponto_fixo', customer_id: c.id, status, order_date: date, delivery_date: date, installments: 1, discount: 0, freight: 0, subtotal: total, total, total_cost: qty * 475, total_liters: qty * 50, margin_percent: Math.round(((total - qty * 475) / total) * 10000) / 100, payment_method: 'boleto', confirmed_at: ts(date), created_at: ts(date) });
    items.push({ id: uid(), order_id: id, product_id: products[0]!.id, keg_size_id: k50, quantity: qty, liters_per_unit: 50, unit_price: price, price_per_liter: price / 50, price_source: 'tabela', unit_cost: 475, discount: 0 });
    receivables.push({ id: uid(), customer_id: c.id, order_id: id, description: `Pedido nº ${n} — parcela 1/1`, installment_no: 1, installment_count: 1, competence_date: date, issue_date: date, due_date: addDays(date, 14), amount: total, paid_amount: paid ? total : 0, interest_amount: 0, fine_amount: 0, discount_amount: 0, status: paid ? 'pago' : 'em_aberto', paid_at: paid ? addDays(date, 12) : null, payment_method: 'boleto', created_at: ts(date) });
  };
  for (let w = 0; w < 8; w++) addOrder(customers[0]!, 3 + w * 7, 2, 'finalizado', w > 1);
  for (let w = 0; w < 4; w++) addOrder(customers[1]!, 5 + w * 8, 3, 'finalizado', w > 0);
  addOrder(customers[2]!, 50, 1, 'finalizado', false);
  addOrder(customers[2]!, 20, 1, 'finalizado', false);
  addOrder(customers[3]!, 10, 4, 'finalizado', true);

  const eqType = { id: uid(), name: 'Chopeira elétrica', maintenance_days: 90, sanitization_days: 15, active: true };
  const equipment = [
    { id: uid(), asset_code: 'CHP-0001', type_id: eqType.id, brand: 'Marca X', model: '2 vias', status: 'em_ponto_fixo', location: 'cliente', customer_id: customers[0]!.id, custody_since: ts(addDays(t, -120)), next_sanitization_at: addDays(t, 3), next_maintenance_at: addDays(t, 40), ownership: 'propria', created_at: ts(t) },
    { id: uid(), asset_code: 'CHP-0002', type_id: eqType.id, brand: 'Marca X', model: '1 via', status: 'em_ponto_fixo', location: 'cliente', customer_id: customers[2]!.id, custody_since: ts(addDays(t, -80)), next_sanitization_at: addDays(t, -2), next_maintenance_at: addDays(t, 10), ownership: 'propria', created_at: ts(t) },
    { id: uid(), asset_code: 'CHP-0003', type_id: eqType.id, brand: 'Marca Y', model: '2 vias', status: 'disponivel', location: 'deposito', customer_id: null, custody_since: ts(addDays(t, -30)), ownership: 'propria', created_at: ts(t) }
  ];
  const services = [
    { id: uid(), name: 'Assepsia', category: 'assepsia', default_price: 150, cost: 40, free_for_fixed_points: true, active: true, checklist: [] },
    { id: uid(), name: 'Instalação de chopeira', category: 'instalacao', default_price: 200, cost: 60, free_for_fixed_points: true, active: true, checklist: [] },
    { id: uid(), name: 'Manutenção corretiva', category: 'manutencao_corretiva', default_price: 250, cost: 80, free_for_fixed_points: false, active: true, checklist: [] }
  ];
  const accounts = [{ id: uid(), name: 'Conta bancária (DEMO)', kind: 'banco', opening_balance: 5000, opening_date: addDays(t, -90), active: true }];
  const transactions = receivables.filter((r) => r.status === 'pago').map((r) => ({ id: uid(), account_id: accounts[0]!.id, kind: 'recebimento', amount: r.amount, occurred_on: r.paid_at, description: r.description, reconciled: false, created_at: ts(r.paid_at as string) }));
  const payments = receivables.filter((r) => r.status === 'pago').map((r) => ({ id: uid(), direction: 'entrada', method: 'boleto', amount: r.amount, paid_at: r.paid_at, account_id: accounts[0]!.id, customer_id: r.customer_id, verified: true, created_at: ts(r.paid_at as string) }));
  const boletoRecv = receivables.find((r) => r.status === 'em_aberto')!;
  const boletos = [{ id: uid(), receivable_id: boletoRecv.id, our_number: '000123', bank_code: '001', due_date: boletoRecv.due_date, original_amount: boletoRecv.amount, issue_date: boletoRecv.issue_date, digitable_line: '00190.00009 01234.567891 23456.789012 1 00000000000000', origin: 'manual', status: 'registrado', created_at: ts(t) }];
  const protestRecv = receivables.filter((r) => r.customer_id === customers[2]!.id)[0]!;
  const protests = [{ id: uid(), receivable_id: protestRecv.id, status: 'protestado', planned_date: addDays(protestRecv.due_date as string, 5), sent_at: addDays(protestRecv.due_date as string, 6), notary_office: 'Tabelionato de Protestos (DEMO)', protocol_number: 'DEMO-001', protested_at: addDays(protestRecv.due_date as string, 10), created_at: ts(t) }];

  const cats = [['Venda de chopp', 'receita', 'receita_produtos'], ['Serviços técnicos', 'receita', 'receita_servicos'], ['Compra de chopp', 'despesa', 'cmv'], ['Fretes e combustível', 'despesa', 'despesas_variaveis'], ['Aluguel', 'despesa', 'despesas_fixas'], ['Marketing', 'despesa', 'despesas_fixas']]
    .map(([name, direction, dre_group]) => ({ id: uid(), name, direction, dre_group, is_operational: true, active: true }));
  const payables = [
    { id: uid(), description: 'Aluguel do depósito (DEMO)', category_id: cats[4]!.id, due_date: addDays(t, 5), competence_date: t, amount: 2500, paid_amount: 0, status: 'em_aberto', installment_no: 1, installment_count: 1, recurrence: 'mensal', created_at: ts(t) },
    { id: uid(), description: 'Combustível (DEMO)', category_id: cats[3]!.id, due_date: addDays(t, -3), competence_date: addDays(t, -10), amount: 480, paid_amount: 0, status: 'em_aberto', installment_no: 1, installment_count: 1, created_at: ts(t) }
  ];
  const profiles = [{ id: 'demo-user', full_name: 'Usuário de demonstração', email: 'demo@jkchopp.invalid', role: 'admin', active: true, preferences: {} }];

  return {
    company: [{ id: 1, legal_name: 'JK CHOPP (DEMO)', trade_name: 'JK CHOPP', pix_key: 'demo@jkchopp.invalid', pix_merchant_name: 'JK CHOPP', pix_merchant_city: 'SAO PAULO', address: {} } as unknown as Record<string, unknown>],
    settings: SETTINGS_SEED.map(([key, value, description]) => ({ key, value, description })),
    profiles,
    keg_sizes: kegs, product_categories: [cat], brands: [brand], products, product_variants: [], price_tables: [], price_table_items: [],
    stock_items: stockItems, inventory_movements: movements, inventory_lots: [], stock_reservations: [],
    customers: customers.map(({ expected: _e, ...c }) => c), commercial_conditions: conditions, customer_product_prices: customerPrices,
    customer_contacts: [], customer_interactions: [], customer_verifications: [],
    orders, order_items: items, order_status_history: [], receivables, payables, payments, payment_allocations: [],
    financial_accounts: accounts, financial_transactions: transactions, financial_categories: cats,
    cost_centers: ['Comercial', 'Logística', 'Técnico', 'Administrativo'].map((name) => ({ id: uid(), name, active: true })),
    collection_rules: [{ id: uid(), customer_id: null, default_term_days: 14, fine_percent: 2, interest_percent: 1, interest_period: 'mensal', grace_days: 0, due_date_handling: 'proximo_dia_util', protest_after_days: 5, protest_day_count: 'uteis', remind_before_days: 1, remind_on_due: true, remind_after_every_days: 3, valid_from: addDays(t, -365), valid_to: null, notify_payment_confirmation: true }],
    boletos, pix_charges: [], protest_records: protests, protest_status_history: [], anuence_documents: [],
    equipment_types: [eqType], equipment, equipment_movements: [], equipment_reservations: [], maintenance_schedules: [],
    services, service_orders: [], service_order_items: [], vehicles: [], deliveries: [], purchases: [], purchase_items: [], suppliers: [],
    partners: [{ id: uid(), name: 'Parceiro Exemplo (DEMO)', percent_event: 10, percent_fixed: 5, fixed_per_order: 0, eligibility: 'entregue', offset_debt: true, opening_debt: 800, meeting_frequency_days: 15, status: 'ativo', created_at: ts(t) }],
    partner_ledger: [], partner_settlements: [],
    calendar_events: [{ id: uid(), title: 'Reunião semanal de gestão (DEMO)', kind: 'reuniao', starts_at: `${addDays(t, 1)}T12:00:00.000Z`, ends_at: `${addDays(t, 1)}T13:00:00.000Z`, recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU', priority: 'normal', status: 'confirmado', created_at: ts(t) }],
    tasks: [
      { id: uid(), title: 'Conferir cobranças do dia', status: 'a_fazer', priority: 'alta', due_date: t, category: 'financeiro', checklist: [], created_at: ts(t) },
      { id: uid(), title: 'Revisar clientes com baixa rotatividade', status: 'em_andamento', priority: 'normal', due_date: addDays(t, 2), category: 'comercial', checklist: [], created_at: ts(t) },
      { id: uid(), title: 'Organizar estoque de barris vazios', status: 'a_fazer', priority: 'normal', due_date: addDays(t, -1), category: 'operacional', checklist: [], created_at: ts(t) }
    ],
    routines: [], routine_logs: [], meetings: [], notes: [], projects: [], task_comments: [],
    marketing_campaigns: [], marketing_contents: [], marketing_metrics: [], leads: [], strategy_items: [], goals: [],
    message_templates: MESSAGE_TEMPLATE_SEED.map(([key, name, category, body]) => ({ id: uid(), key, name, category, body, channel: 'whatsapp', active: true })),
    message_queue: [], notifications: [],
    automation_rules: [
      { id: uid(), name: 'Lembrete 1 dia antes do vencimento', trigger: 'boleto_vencendo', action: 'gerar_mensagem', action_config: { template: 'lembrete_vencimento', days_before: 1 }, dedup_window: 'dia', active: true },
      { id: uid(), name: 'Cobrança após vencimento', trigger: 'boleto_vencido', action: 'gerar_mensagem', action_config: { template: 'boleto_vencido' }, dedup_window: 'dia', active: true }
    ],
    automation_executions: [], automation_runs: [],
    integrations: [['supabase', 'Supabase'], ['google_calendar', 'Google Agenda'], ['google_tasks', 'Google Tasks'], ['whatsapp_link', 'WhatsApp (links oficiais)'], ['whatsapp_cloud', 'WhatsApp Business Platform'], ['viacep', 'Consulta de CEP (ViaCEP)'], ['brasilapi_cnpj', 'Consulta CNPJ (BrasilAPI)'], ['serpro', 'Serpro'], ['banco', 'Banco (CNAB/OFX)'], ['pix_api', 'API Pix do PSP'], ['meta', 'Meta / Instagram'], ['gemini', 'Google Gemini API']]
      .map(([provider, name]) => ({ provider, name, status: provider === 'whatsapp_link' ? 'conectada' : 'nao_configurada', config: {} })),
    attachments: [], audit_logs: [], holidays: [], user_invitations: [], external_sync_records: [], purchase_quotes: [], document_templates: [], bank_statement_imports: []
  };
}

/**
 * Banco inicial do MODO LOCAL (uso real sem servidor): apenas configurações e catálogos-base editáveis.
 * Nenhum cliente, preço, custo ou valor financeiro é inventado.
 */
import { todaySP } from '@/domain/dates';
import { uid, type Tables } from './store';
import { MESSAGE_TEMPLATE_SEED, SETTINGS_SEED } from './seedConfig';

export function seedLocal(userName = 'Administrador'): Tables {
  const t = todaySP();
  const cats: [string, string, string][] = [
    ['Venda de chopp', 'receita', 'receita_produtos'], ['Venda de produtos', 'receita', 'receita_produtos'], ['Serviços técnicos', 'receita', 'receita_servicos'],
    ['Juros e multas recebidos', 'receita', 'receitas_financeiras'], ['Tributos sobre vendas', 'despesa', 'deducoes'], ['Compra de chopp', 'despesa', 'cmv'],
    ['Fretes e combustível', 'despesa', 'despesas_variaveis'], ['Comissões', 'despesa', 'despesas_variaveis'], ['Taxas financeiras', 'despesa', 'despesas_financeiras'],
    ['Manutenção', 'despesa', 'despesas_variaveis'], ['Aluguel', 'despesa', 'despesas_fixas'], ['Salários e pró-labore', 'despesa', 'despesas_fixas'],
    ['Marketing', 'despesa', 'despesas_fixas'], ['Impostos e taxas', 'despesa', 'despesas_fixas'], ['Serviços de terceiros', 'despesa', 'despesas_fixas'], ['Investimentos em equipamentos', 'despesa', 'investimentos']
  ];
  const integrations: [string, string][] = [['supabase', 'Supabase'], ['google_calendar', 'Google Agenda'], ['google_tasks', 'Google Tasks'], ['whatsapp_link', 'WhatsApp (links oficiais)'], ['whatsapp_cloud', 'WhatsApp Business Platform'], ['viacep', 'Consulta de CEP (ViaCEP)'], ['brasilapi_cnpj', 'Consulta CNPJ (BrasilAPI)'], ['serpro', 'Serpro'], ['banco', 'Banco (CNAB/OFX)'], ['pix_api', 'API Pix do PSP'], ['meta', 'Meta / Instagram'], ['gemini', 'Google Gemini API']];
  const empty = ['products', 'product_variants', 'price_tables', 'price_table_items', 'product_categories', 'brands', 'stock_items', 'inventory_movements', 'inventory_lots', 'stock_reservations', 'customers', 'commercial_conditions', 'customer_product_prices', 'customer_contacts', 'customer_interactions', 'customer_verifications', 'orders', 'order_items', 'order_status_history', 'receivables', 'payables', 'payments', 'payment_allocations', 'financial_transactions', 'boletos', 'pix_charges', 'protest_records', 'protest_status_history', 'anuence_documents', 'equipment', 'equipment_movements', 'equipment_reservations', 'maintenance_schedules', 'services', 'service_orders', 'service_order_items', 'vehicles', 'deliveries', 'purchases', 'purchase_items', 'purchase_quotes', 'suppliers', 'partners', 'partner_ledger', 'partner_settlements', 'calendar_events', 'tasks', 'routines', 'routine_logs', 'meetings', 'notes', 'projects', 'task_comments', 'marketing_campaigns', 'marketing_contents', 'marketing_metrics', 'leads', 'strategy_items', 'goals', 'message_queue', 'notifications', 'automation_executions', 'automation_runs', 'attachments', 'audit_logs', 'holidays', 'user_invitations', 'external_sync_records', 'document_templates', 'bank_statement_imports'];
  return {
    ...Object.fromEntries(empty.map((k) => [k, []])),
    company: [{ id: 1, legal_name: 'JK CHOPP', trade_name: 'JK CHOPP', pix_key: null, pix_merchant_name: 'JK CHOPP', pix_merchant_city: null, address: {} } as never],
    settings: SETTINGS_SEED.map(([key, value, description]) => ({ key, value, description })),
    profiles: [{ id: 'local-user', full_name: userName, email: null, role: 'admin', active: true, preferences: {} }],
    // Tamanhos citados na especificação como exemplos — editáveis/removíveis em Produtos → Tamanhos.
    keg_sizes: [10, 15, 20, 30, 50].map((l) => ({ id: uid(), liters: l, label: `${l} L`, active: true })),
    financial_categories: cats.map(([name, direction, dre_group]) => ({ id: uid(), name, direction, dre_group, is_operational: true, active: true })),
    cost_centers: ['Comercial', 'Logística', 'Técnico', 'Administrativo', 'Marketing'].map((name) => ({ id: uid(), name, active: true })),
    financial_accounts: [{ id: uid(), name: 'Caixa físico', kind: 'caixa', opening_balance: 0, opening_date: t, active: true }],
    // Regra global SEM percentuais: a administração define juros/multa/protesto conforme contratos.
    collection_rules: [{ id: uid(), customer_id: null, default_term_days: 0, fine_percent: 0, interest_percent: 0, interest_period: 'mensal', grace_days: 0, due_date_handling: 'proximo_dia_util', protest_after_days: 0, protest_day_count: 'corridos', remind_before_days: 1, remind_on_due: true, remind_after_every_days: 3, valid_from: t, valid_to: null, notify_payment_confirmation: true }],
    equipment_types: ['Chopeira', 'Cilindro de CO₂', 'Regulador', 'Torneira', 'Extratora', 'Barril', 'Geladeira', 'Ferramenta'].map((name) => ({ id: uid(), name, maintenance_days: null, sanitization_days: null, active: true })),
    message_templates: MESSAGE_TEMPLATE_SEED.map(([key, name, category, body]) => ({ id: uid(), key, name, category, body, channel: 'whatsapp', active: true })),
    automation_rules: [
      { id: uid(), name: 'Lembrete 1 dia antes do vencimento', trigger: 'boleto_vencendo', action: 'gerar_mensagem', action_config: { template: 'lembrete_vencimento', days_before: 1 }, dedup_window: 'dia', active: true },
      { id: uid(), name: 'Cobrança após vencimento', trigger: 'boleto_vencido', action: 'gerar_mensagem', action_config: { template: 'boleto_vencido' }, dedup_window: 'dia', active: true }
    ],
    integrations: integrations.map(([provider, name]) => ({ provider, name, status: provider === 'whatsapp_link' ? 'conectada' : 'nao_configurada', config: {} })),
    meta: [{ id: 'meta', created_at: new Date().toISOString(), last_backup_at: null, schema: 1 }]
  };
}

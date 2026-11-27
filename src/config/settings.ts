/** Definições tipadas das configurações editáveis pela interface (tabela `settings`). */
export type SettingType = 'number' | 'boolean' | 'text' | 'select' | 'json';
export interface SettingDef {
  key: string;
  label: string;
  type: SettingType;
  group: 'Comercial' | 'Financeiro' | 'Patrimônio' | 'Notificações' | 'Parceiros' | 'IA' | 'Marketing' | 'Consulta CNPJ';
  help?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  default: unknown;
}

export const SETTING_DEFS: SettingDef[] = [
  { key: 'cnpj.max_age_days', label: 'Validade dos dados de CNPJ (dias)', type: 'number', group: 'Consulta CNPJ', min: 1, max: 3650, default: 30, help: 'Dentro desse prazo a CNPJá responde do cache (sem custo). Depois, consulta a Receita em tempo real (consome créditos).' },
  { key: 'cnpj.include_simples', label: 'Incluir Simples Nacional / MEI', type: 'boolean', group: 'Consulta CNPJ', default: true, help: '+1 crédito por consulta online.' },
  { key: 'cnpj.include_registrations', label: 'Incluir inscrição estadual', type: 'boolean', group: 'Consulta CNPJ', default: true, help: '+1 crédito por consulta online.' },
  { key: 'commercial.min_margin_percent', label: 'Margem mínima comercial (%)', type: 'number', group: 'Comercial', min: 0, max: 95, default: 20, help: 'Pedidos abaixo exigem aprovação com justificativa.' },
  { key: 'commercial.margin_indicator', label: 'Indicador de aprovação', type: 'select', group: 'Comercial', default: 'contribution', options: [{ value: 'contribution', label: 'Margem de contribuição' }, { value: 'gross', label: 'Margem bruta' }] },
  { key: 'commercial.sales_tax_percent', label: 'Tributos estimados sobre vendas (%)', type: 'number', group: 'Comercial', min: 0, max: 60, default: 0, help: 'Defina com a contabilidade. Usado na DRE gerencial e no simulador.' },
  { key: 'health.thresholds', label: 'Critérios de saúde comercial', type: 'json', group: 'Comercial', default: { excellentRatio: 1.1, healthyRatio: 0.85, attentionRatio: 0.5, inactiveDays: 60, minHistoryDays: 30, minOrders: 2, trendDropPercent: 30, windowDays: 30 } },
  { key: 'boletos.due_days_after_issue', label: 'Vencimento do boleto (dias corridos após a emissão)', type: 'number', group: 'Financeiro', min: 0, max: 365, default: 5, help: 'Ao informar a data de emissão, o vencimento é preenchido automaticamente. Se o boleto lido trouxer outro vencimento, vale o do boleto (com aviso).' },
  { key: 'finance.due_soon_days', label: 'Dias para "a vencer"', type: 'number', group: 'Financeiro', min: 1, max: 60, default: 7 },
  { key: 'equipment.idle_days', label: 'Dias para equipamento ocioso', type: 'number', group: 'Patrimônio', min: 1, max: 365, default: 15 },
  { key: 'equipment.sanitization_days', label: 'Periodicidade padrão de assepsia (dias)', type: 'number', group: 'Patrimônio', min: 1, max: 365, default: 15 },
  { key: 'equipment.maintenance_days', label: 'Periodicidade padrão de manutenção (dias)', type: 'number', group: 'Patrimônio', min: 1, max: 730, default: 90 },
  { key: 'notifications.quiet_hours', label: 'Horário silencioso', type: 'json', group: 'Notificações', default: { start: '22:00', end: '07:00' } },
  { key: 'partners.eligibility', label: 'Elegibilidade padrão de crédito', type: 'select', group: 'Parceiros', default: 'entregue', options: [{ value: 'confirmado', label: 'Pedido confirmado' }, { value: 'entregue', label: 'Pedido entregue' }, { value: 'recebido', label: 'Pagamento recebido' }] },
  { key: 'ai.enabled', label: 'Assistente com provedor externo', type: 'boolean', group: 'IA', default: false, help: 'Desligado: o assistente usa apenas consultas internas determinísticas.' },
  { key: 'marketing.auto_hashtags', label: 'Inserir hashtags automaticamente', type: 'boolean', group: 'Marketing', default: false }
];

export function settingDefault<T>(key: string): T {
  return SETTING_DEFS.find((d) => d.key === key)?.default as T;
}

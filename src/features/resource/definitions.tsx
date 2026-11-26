/** Definições declarativas dos cadastros que usam o motor genérico (ResourcePage). */
import type { Tone } from '@/domain/collections';
import { EQUIPMENT_STATUS } from '@/domain/equipment';
import { formatReais } from '@/domain/money';
import { formatDateBR } from '@/domain/dates';
import type { ResourceDef, StatusMap } from './types';
import { isValidCnpj, isValidCpf } from '@/domain/documents';

/** CPF ou CNPJ opcional, validado pelos dígitos verificadores. */
const validDocument = (v: unknown): string | null => {
  const d = String(v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!d) return null;
  return isValidCnpj(d) || isValidCpf(d) ? null : 'CPF/CNPJ inválido';
};

export const opts = (rec: Record<string, string>) => Object.entries(rec).map(([value, label]) => ({ value, label }));
const status = (column: string, map: Record<string, [string, Tone]>): StatusMap => ({ column, map: Object.fromEntries(Object.entries(map).map(([k, [label, tone]]) => [k, { label, tone }])) });
const ACTIVE = status('status', { ativo: ['Ativo', 'success'], inativo: ['Inativo', 'neutral'], arquivado: ['Arquivado', 'neutral'] });
const archiveStatus = { column: 'status', value: 'arquivado', activeValue: 'ativo' };

export const UNIT_OPTIONS = opts({ litro: 'Litro', unidade: 'Unidade', caixa: 'Caixa', fardo: 'Fardo', kg: 'Kg', outro: 'Outro' });

export const productsDef: ResourceDef = {
  table: 'products', title: 'Produtos', singular: 'Produto', resource: 'produtos',
  subtitle: 'Chopp é vendido prioritariamente por litro. Tamanhos de barril são livres e configuráveis.',
  select: '*,category:product_categories(name),brand:brands(name)',
  searchColumns: ['name', 'sku', 'internal_code'], defaultOrder: [{ column: 'name' }], archive: archiveStatus, status: ACTIVE,
  fields: [
    { name: 'name', label: 'Nome', type: 'text', required: true, wide: true },
    { name: 'internal_code', label: 'Código interno', type: 'text' },
    { name: 'sku', label: 'SKU', type: 'text' },
    { name: 'category_id', label: 'Categoria', type: 'ref', ref: { table: 'product_categories', label: 'name' } },
    { name: 'brand_id', label: 'Marca', type: 'ref', ref: { table: 'brands', label: 'name' } },
    { name: 'supplier_id', label: 'Fornecedor', type: 'ref', ref: { table: 'suppliers', label: 'name' } },
    { name: 'unit', label: 'Unidade de venda', type: 'select', options: UNIT_OPTIONS, required: true, defaultValue: 'litro' },
    { name: 'is_draft_beer', label: 'É chopp (controle por litro e barril)', type: 'boolean', defaultValue: true },
    { name: 'cost_per_unit', label: 'Custo por litro/unidade (R$)', type: 'money', required: true, min: 0, help: 'Não invente valores: use o custo real do fornecedor.' },
    { name: 'price_per_unit', label: 'Preço de venda por litro/unidade (R$)', type: 'money', required: true, min: 0 },
    { name: 'min_margin_percent', label: 'Margem mínima específica (%)', type: 'percent', min: 0, max: 95, help: 'Vazio = usa a margem global.' },
    { name: 'min_stock', label: 'Estoque mínimo', type: 'number', min: 0 },
    { name: 'description', label: 'Descrição', type: 'textarea' },
    { name: 'notes', label: 'Observações', type: 'textarea' }
  ],
  columns: [
    { key: 'name', label: 'Produto' },
    { key: 'category.name', label: 'Categoria', sortable: false, hideOnMobile: true },
    { key: 'unit', label: 'Unidade', hideOnMobile: true },
    { key: 'cost_per_unit', label: 'Custo', format: 'money', align: 'right' },
    { key: 'price_per_unit', label: 'Preço', format: 'money', align: 'right' },
    { key: 'margin', label: 'Margem bruta', align: 'right', render: (r) => { const p = Number(r.price_per_unit); return p > 0 ? `${(((p - Number(r.cost_per_unit)) / p) * 100).toFixed(1)}%` : '—'; } },
    { key: 'status', label: 'Status' }
  ]
};

export const kegSizesDef: ResourceDef = {
  table: 'keg_sizes', title: 'Tamanhos de barril', singular: 'Tamanho', resource: 'produtos', searchColumns: ['label'], defaultOrder: [{ column: 'liters' }],
  archive: { column: 'active', value: false, activeValue: true },
  fields: [
    { name: 'liters', label: 'Litragem', type: 'number', required: true, min: 0.1 },
    { name: 'label', label: 'Rótulo', type: 'text', required: true, placeholder: 'Ex.: 50 L' },
    { name: 'active', label: 'Ativo', type: 'boolean', defaultValue: true }
  ],
  columns: [{ key: 'label', label: 'Tamanho' }, { key: 'liters', label: 'Litros', format: 'number', align: 'right' }, { key: 'active', label: 'Ativo', format: 'boolean' }]
};

export const categoriesDef: ResourceDef = {
  table: 'product_categories', title: 'Categorias de produto', singular: 'Categoria', resource: 'produtos', searchColumns: ['name'], defaultOrder: [{ column: 'name' }],
  fields: [{ name: 'name', label: 'Nome', type: 'text', required: true }, { name: 'active', label: 'Ativa', type: 'boolean', defaultValue: true }],
  columns: [{ key: 'name', label: 'Categoria' }, { key: 'active', label: 'Ativa', format: 'boolean' }]
};

export const brandsDef: ResourceDef = {
  table: 'brands', title: 'Marcas', singular: 'Marca', resource: 'produtos', searchColumns: ['name'], defaultOrder: [{ column: 'name' }],
  fields: [{ name: 'name', label: 'Nome', type: 'text', required: true }, { name: 'active', label: 'Ativa', type: 'boolean', defaultValue: true }],
  columns: [{ key: 'name', label: 'Marca' }, { key: 'active', label: 'Ativa', format: 'boolean' }]
};

export const SERVICE_CATEGORY = { instalacao: 'Instalação', assepsia: 'Assepsia', manutencao_preventiva: 'Manutenção preventiva', manutencao_corretiva: 'Manutenção corretiva', troca_componente: 'Troca de componentes', visita_tecnica: 'Visita técnica', deslocamento: 'Deslocamento', retirada: 'Retirada', recolhimento: 'Recolhimento', outro: 'Outro' };
export const servicesDef: ResourceDef = {
  table: 'services', title: 'Serviços', singular: 'Serviço', resource: 'produtos', searchColumns: ['name'], defaultOrder: [{ column: 'name' }],
  subtitle: 'Serviços podem ser gratuitos (ex.: inclusos para pontos fixos) ou cobrados conforme contrato.',
  archive: { column: 'active', value: false, activeValue: true },
  filters: [{ column: 'category', label: 'Categoria', options: opts(SERVICE_CATEGORY) }],
  fields: [
    { name: 'name', label: 'Nome', type: 'text', required: true, wide: true },
    { name: 'category', label: 'Categoria', type: 'select', options: opts(SERVICE_CATEGORY), required: true },
    { name: 'default_price', label: 'Preço padrão (R$)', type: 'money', min: 0 },
    { name: 'cost', label: 'Custo (R$)', type: 'money', min: 0 },
    { name: 'estimated_minutes', label: 'Tempo estimado (min)', type: 'number', min: 0 },
    { name: 'periodicity_days', label: 'Periodicidade (dias)', type: 'number', min: 0 },
    { name: 'free_for_fixed_points', label: 'Incluso (gratuito) para pontos fixos', type: 'boolean' },
    { name: 'free_conditions', label: 'Condições de gratuidade', type: 'textarea' },
    { name: 'materials', label: 'Materiais necessários', type: 'textarea' },
    { name: 'description', label: 'Descrição', type: 'textarea' },
    { name: 'active', label: 'Disponível', type: 'boolean', defaultValue: true }
  ],
  columns: [
    { key: 'name', label: 'Serviço' },
    { key: 'category', label: 'Categoria', render: (r) => SERVICE_CATEGORY[r.category as keyof typeof SERVICE_CATEGORY] ?? String(r.category) },
    { key: 'default_price', label: 'Preço', format: 'money', align: 'right' },
    { key: 'cost', label: 'Custo', format: 'money', align: 'right', hideOnMobile: true },
    { key: 'free_for_fixed_points', label: 'Incluso p/ ponto fixo', format: 'boolean' }
  ]
};

export const suppliersDef: ResourceDef = {
  table: 'suppliers', title: 'Fornecedores', singular: 'Fornecedor', resource: 'estoque', searchColumns: ['name', 'trade_name', 'document'], defaultOrder: [{ column: 'name' }],
  archive: archiveStatus, status: ACTIVE,
  fields: [
    { name: 'name', label: 'Razão social / nome', type: 'text', required: true, wide: true },
    { name: 'trade_name', label: 'Nome fantasia', type: 'text' },
    { name: 'document', label: 'CNPJ/CPF', type: 'text', validate: validDocument, help: 'Com CNPJ, use Consultar para preencher pela Receita Federal.',
      cnpjLookup: { purpose: 'supplier', snapshot: true, fill: { legalName: 'name', tradeName: 'trade_name', stateRegistration: 'state_registration', phone: 'phone', email: 'email', cep: 'cep', addressLine: 'address', city: 'city', state: 'state' } } },
    { name: 'state_registration', label: 'Inscrição estadual', type: 'text' },
    { name: 'contact_name', label: 'Contato', type: 'text' },
    { name: 'phone', label: 'Telefone', type: 'phone' },
    { name: 'whatsapp', label: 'WhatsApp', type: 'phone' },
    { name: 'email', label: 'E-mail', type: 'email' },
    { name: 'cep', label: 'CEP', type: 'text' },
    { name: 'address', label: 'Endereço', type: 'text', wide: true },
    { name: 'city', label: 'Cidade', type: 'text' },
    { name: 'state', label: 'UF', type: 'text' },
    { name: 'lead_time_days', label: 'Prazo de entrega (dias)', type: 'number', min: 0 },
    { name: 'payment_terms', label: 'Condições de pagamento', type: 'text' },
    { name: 'rating', label: 'Avaliação (1–5)', type: 'number', min: 1, max: 5 },
    { name: 'notes', label: 'Observações', type: 'textarea' }
  ],
  columns: [{ key: 'name', label: 'Fornecedor' }, { key: 'contact_name', label: 'Contato', hideOnMobile: true }, { key: 'phone', label: 'Telefone' }, { key: 'lead_time_days', label: 'Prazo (d)', format: 'number', align: 'right' }, { key: 'rating', label: 'Avaliação', format: 'number' }, { key: 'status', label: 'Status' }]
};

export const STOCK_KIND = { chopp: 'Chopp (barril cheio)', barril_vazio: 'Barril vazio', cilindro: 'Cilindro', gas: 'Gás', peca: 'Peça', ferramenta: 'Ferramenta', limpeza: 'Produto de limpeza', insumo: 'Insumo', mercadoria: 'Mercadoria', outro: 'Outro' };
export const stockItemsDef: ResourceDef = {
  table: 'stock_items', title: 'Itens de estoque', singular: 'Item de estoque', resource: 'estoque', searchColumns: ['name'], defaultOrder: [{ column: 'name' }],
  archive: archiveStatus, status: ACTIVE, filters: [{ column: 'kind', label: 'Tipo', options: opts(STOCK_KIND) }],
  fields: [
    { name: 'name', label: 'Nome', type: 'text', required: true, wide: true },
    { name: 'kind', label: 'Tipo', type: 'select', options: opts(STOCK_KIND), required: true },
    { name: 'product_id', label: 'Produto (para chopp)', type: 'ref', ref: { table: 'products', label: 'name' } },
    { name: 'keg_size_id', label: 'Tamanho do barril', type: 'ref', ref: { table: 'keg_sizes', label: 'label' } },
    { name: 'unit', label: 'Unidade', type: 'text', defaultValue: 'unidade' },
    { name: 'min_quantity', label: 'Quantidade mínima', type: 'number', min: 0 },
    { name: 'unit_cost', label: 'Custo unitário (R$)', type: 'money', min: 0 },
    { name: 'returnable', label: 'Recipiente retornável', type: 'boolean' }
  ],
  columns: [{ key: 'name', label: 'Item' }, { key: 'kind', label: 'Tipo', render: (r) => STOCK_KIND[r.kind as keyof typeof STOCK_KIND] }, { key: 'unit', label: 'Unidade' }, { key: 'min_quantity', label: 'Mínimo', format: 'number', align: 'right' }, { key: 'status', label: 'Status' }]
};

export const equipmentTypesDef: ResourceDef = {
  table: 'equipment_types', title: 'Tipos de equipamento', singular: 'Tipo', resource: 'equipamentos', searchColumns: ['name'], defaultOrder: [{ column: 'name' }],
  fields: [
    { name: 'name', label: 'Nome', type: 'text', required: true, placeholder: 'Chopeira, cilindro, regulador…' },
    { name: 'maintenance_days', label: 'Manutenção a cada (dias)', type: 'number', min: 1 },
    { name: 'sanitization_days', label: 'Assepsia a cada (dias)', type: 'number', min: 1 },
    { name: 'active', label: 'Ativo', type: 'boolean', defaultValue: true }
  ],
  columns: [{ key: 'name', label: 'Tipo' }, { key: 'maintenance_days', label: 'Manutenção (d)', format: 'number' }, { key: 'sanitization_days', label: 'Assepsia (d)', format: 'number' }]
};

export const EQUIPMENT_TONE: Record<string, Tone> = { disponivel: 'success', reservado: 'info', em_transporte: 'info', instalado: 'info', em_ponto_fixo: 'info', em_evento: 'info', aguardando_recolhimento: 'warning', em_manutencao: 'warning', em_higienizacao: 'warning', danificado: 'danger', extraviado: 'danger', inativo: 'neutral' };
export const equipmentDef: ResourceDef = {
  table: 'equipment', title: 'Equipamentos', singular: 'Equipamento', resource: 'equipamentos',
  subtitle: 'Rastreabilidade por movimentações registradas (custódia). Não há GPS em tempo real.',
  select: '*,type:equipment_types(name),customer:customers(name,trade_name)',
  searchColumns: ['asset_code', 'serial_number', 'brand', 'model'], defaultOrder: [{ column: 'asset_code' }],
  filters: [{ column: 'status', label: 'Situação', options: opts(EQUIPMENT_STATUS) }],
  status: { column: 'status', map: Object.fromEntries(Object.entries(EQUIPMENT_STATUS).map(([k, v]) => [k, { label: v, tone: EQUIPMENT_TONE[k]! }])) },
  rowLink: (r) => `/equipamentos/${r.id}`,
  fields: [
    { name: 'asset_code', label: 'Código patrimonial', type: 'text', required: true },
    { name: 'serial_number', label: 'Número de série', type: 'text' },
    { name: 'type_id', label: 'Tipo', type: 'ref', ref: { table: 'equipment_types', label: 'name' }, required: true },
    { name: 'brand', label: 'Marca', type: 'text' },
    { name: 'model', label: 'Modelo', type: 'text' },
    { name: 'ownership', label: 'Propriedade', type: 'select', options: opts({ propria: 'Própria', terceiro: 'Terceiro', comodato_fornecedor: 'Comodato do fornecedor' }), defaultValue: 'propria' },
    { name: 'acquired_at', label: 'Data de aquisição', type: 'date' },
    { name: 'acquisition_value', label: 'Valor de aquisição (R$)', type: 'money', min: 0 },
    { name: 'supplier_id', label: 'Fornecedor', type: 'ref', ref: { table: 'suppliers', label: 'name' } },
    { name: 'warranty_until', label: 'Garantia até', type: 'date' },
    { name: 'next_maintenance_at', label: 'Próxima manutenção', type: 'date' },
    { name: 'next_sanitization_at', label: 'Próxima assepsia', type: 'date' },
    { name: 'notes', label: 'Observações', type: 'textarea' }
  ],
  columns: [
    { key: 'asset_code', label: 'Patrimônio' },
    { key: 'type.name', label: 'Tipo', sortable: false },
    { key: 'customer', label: 'Com o cliente', render: (r) => { const c = r.customer as { name?: string; trade_name?: string } | null; return c ? c.trade_name ?? c.name : '—'; } },
    { key: 'next_sanitization_at', label: 'Próx. assepsia', format: 'date', hideOnMobile: true },
    { key: 'status', label: 'Situação' }
  ]
};

export const vehiclesDef: ResourceDef = {
  table: 'vehicles', title: 'Veículos', singular: 'Veículo', resource: 'logistica', searchColumns: ['plate', 'model'], defaultOrder: [{ column: 'plate' }],
  archive: { column: 'active', value: false, activeValue: true },
  fields: [{ name: 'plate', label: 'Placa', type: 'text', required: true }, { name: 'model', label: 'Modelo', type: 'text' }, { name: 'capacity', label: 'Capacidade', type: 'text' }, { name: 'odometer_km', label: 'Hodômetro (km)', type: 'number', min: 0 }, { name: 'active', label: 'Ativo', type: 'boolean', defaultValue: true }],
  columns: [{ key: 'plate', label: 'Placa' }, { key: 'model', label: 'Modelo' }, { key: 'capacity', label: 'Capacidade' }, { key: 'odometer_km', label: 'Km', format: 'number', align: 'right' }]
};

export const financialAccountsDef: ResourceDef = {
  table: 'financial_accounts', title: 'Contas bancárias e caixas', singular: 'Conta', resource: 'financeiro', searchColumns: ['name'], defaultOrder: [{ column: 'name' }],
  archive: { column: 'active', value: false, activeValue: true },
  fields: [
    { name: 'name', label: 'Nome', type: 'text', required: true },
    { name: 'kind', label: 'Tipo', type: 'select', options: opts({ banco: 'Banco', caixa: 'Caixa físico', carteira_digital: 'Carteira digital', outro: 'Outro' }), required: true },
    { name: 'bank_code', label: 'Código do banco', type: 'text' }, { name: 'agency', label: 'Agência', type: 'text' }, { name: 'account_number', label: 'Conta', type: 'text', help: 'Nunca cadastre senhas bancárias no sistema.' },
    { name: 'opening_balance', label: 'Saldo inicial (R$)', type: 'money' }, { name: 'opening_date', label: 'Data do saldo inicial', type: 'date', required: true },
    { name: 'active', label: 'Ativa', type: 'boolean', defaultValue: true }
  ],
  columns: [{ key: 'name', label: 'Conta' }, { key: 'kind', label: 'Tipo' }, { key: 'opening_balance', label: 'Saldo inicial', format: 'money', align: 'right' }, { key: 'opening_date', label: 'Desde', format: 'date' }]
};

export const DRE_GROUP = { receita_produtos: 'Receita de produtos', receita_servicos: 'Receita de serviços', deducoes: 'Deduções', cmv: 'CMV', despesas_variaveis: 'Despesas variáveis', despesas_fixas: 'Despesas fixas', despesas_financeiras: 'Despesas financeiras', receitas_financeiras: 'Receitas financeiras', investimentos: 'Investimentos', outras: 'Outras' };
export const financialCategoriesDef: ResourceDef = {
  table: 'financial_categories', title: 'Categorias financeiras', singular: 'Categoria', resource: 'financeiro', searchColumns: ['name'], defaultOrder: [{ column: 'direction' }, { column: 'name' }],
  filters: [{ column: 'direction', label: 'Tipo', options: opts({ receita: 'Receita', despesa: 'Despesa' }) }],
  fields: [
    { name: 'name', label: 'Nome', type: 'text', required: true },
    { name: 'direction', label: 'Tipo', type: 'select', options: opts({ receita: 'Receita', despesa: 'Despesa' }), required: true },
    { name: 'dre_group', label: 'Grupo na DRE', type: 'select', options: opts(DRE_GROUP), required: true },
    { name: 'is_operational', label: 'Operacional', type: 'boolean', defaultValue: true },
    { name: 'active', label: 'Ativa', type: 'boolean', defaultValue: true }
  ],
  columns: [{ key: 'name', label: 'Categoria' }, { key: 'direction', label: 'Tipo' }, { key: 'dre_group', label: 'Grupo DRE', render: (r) => DRE_GROUP[r.dre_group as keyof typeof DRE_GROUP] }]
};

export const costCentersDef: ResourceDef = {
  table: 'cost_centers', title: 'Centros de custo', singular: 'Centro de custo', resource: 'financeiro', searchColumns: ['name'], defaultOrder: [{ column: 'name' }],
  fields: [{ name: 'name', label: 'Nome', type: 'text', required: true }, { name: 'active', label: 'Ativo', type: 'boolean', defaultValue: true }],
  columns: [{ key: 'name', label: 'Centro de custo' }, { key: 'active', label: 'Ativo', format: 'boolean' }]
};

export const PAYABLE_STATUS = status('status', { em_aberto: ['Em aberto', 'info'], parcialmente_pago: ['Parcialmente pago', 'warning'], pago: ['Pago', 'success'], cancelado: ['Cancelado', 'neutral'] });
export const payablesDef: ResourceDef = {
  table: 'payables', title: 'Contas a pagar', singular: 'Conta a pagar', resource: 'financeiro',
  select: '*,supplier:suppliers(name),category:financial_categories(name)',
  searchColumns: ['description'], defaultOrder: [{ column: 'due_date' }], status: PAYABLE_STATUS,
  filters: [{ column: 'status', label: 'Situação', options: opts({ em_aberto: 'Em aberto', parcialmente_pago: 'Parcialmente pago', pago: 'Pago', cancelado: 'Cancelado' }) }],
  fields: [
    { name: 'description', label: 'Descrição', type: 'text', required: true, wide: true },
    { name: 'supplier_id', label: 'Fornecedor', type: 'ref', ref: { table: 'suppliers', label: 'name' } },
    { name: 'category_id', label: 'Categoria', type: 'ref', ref: { table: 'financial_categories', label: 'name', filters: [{ column: 'direction', op: 'eq', value: 'despesa' }] }, required: true },
    { name: 'cost_center_id', label: 'Centro de custo', type: 'ref', ref: { table: 'cost_centers', label: 'name' } },
    { name: 'amount', label: 'Valor (R$)', type: 'money', required: true, min: 0.01 },
    { name: 'competence_date', label: 'Competência', type: 'date', required: true },
    { name: 'due_date', label: 'Vencimento', type: 'date', required: true },
    { name: 'recurrence', label: 'Recorrência', type: 'select', options: opts({ mensal: 'Mensal', semanal: 'Semanal', anual: 'Anual' }) },
    { name: 'notes', label: 'Observações', type: 'textarea' }
  ],
  columns: [
    { key: 'description', label: 'Descrição' },
    { key: 'supplier.name', label: 'Fornecedor', sortable: false, hideOnMobile: true },
    { key: 'category.name', label: 'Categoria', sortable: false, hideOnMobile: true },
    { key: 'due_date', label: 'Vencimento', format: 'date' },
    { key: 'amount', label: 'Valor', format: 'money', align: 'right' },
    { key: 'paid_amount', label: 'Pago', format: 'money', align: 'right', hideOnMobile: true },
    { key: 'status', label: 'Situação' }
  ]
};

export const partnersDef: ResourceDef = {
  table: 'partners', title: 'Parceiros comerciais', singular: 'Parceiro', resource: 'parceiros', searchColumns: ['name'], defaultOrder: [{ column: 'name' }],
  subtitle: 'Créditos sobre pedidos elegíveis podem abater a dívida do parceiro. Fechamento mensal sem duplicidade.',
  archive: archiveStatus, status: ACTIVE, rowLink: (r) => `/parceiros/${r.id}`,
  fields: [
    { name: 'name', label: 'Nome', type: 'text', required: true, wide: true, help: 'Confirme nome e condições do parceiro citado nas anotações originais.' },
    { name: 'document', label: 'CPF/CNPJ', type: 'text', validate: validDocument, help: 'Com CNPJ, use Consultar para preencher pela Receita Federal.',
      cnpjLookup: { purpose: 'partner', snapshot: true, fill: { legalName: 'name', tradeName: 'trade_name', stateRegistration: 'state_registration', phone: 'phone', email: 'email', cep: 'cep', street: 'street', number: 'number', complement: 'complement', district: 'district', city: 'city', state: 'state' } } },
    { name: 'trade_name', label: 'Nome fantasia', type: 'text' },
    { name: 'state_registration', label: 'Inscrição estadual', type: 'text' },
    { name: 'phone', label: 'Telefone', type: 'phone' }, { name: 'whatsapp', label: 'WhatsApp', type: 'phone' }, { name: 'email', label: 'E-mail', type: 'email' },
    { name: 'cep', label: 'CEP', type: 'text' }, { name: 'street', label: 'Rua', type: 'text', wide: true }, { name: 'number', label: 'Número', type: 'text' },
    { name: 'complement', label: 'Complemento', type: 'text' }, { name: 'district', label: 'Bairro', type: 'text' }, { name: 'city', label: 'Cidade', type: 'text' }, { name: 'state', label: 'UF', type: 'text' },
    { name: 'percent_event', label: 'Crédito em eventos (%)', type: 'percent', min: 0, max: 100, defaultValue: 0 },
    { name: 'percent_fixed', label: 'Crédito em pontos fixos (%)', type: 'percent', min: 0, max: 100, defaultValue: 0 },
    { name: 'fixed_per_order', label: 'Valor fixo por pedido (R$)', type: 'money', min: 0, defaultValue: 0 },
    { name: 'eligibility', label: 'Pedido elegível quando', type: 'select', options: opts({ confirmado: 'Confirmado', entregue: 'Entregue', recebido: 'Pagamento recebido' }), required: true, defaultValue: 'entregue' },
    { name: 'offset_debt', label: 'Créditos abatem a dívida do parceiro', type: 'boolean', defaultValue: true },
    { name: 'opening_debt', label: 'Saldo devedor inicial (R$)', type: 'money', defaultValue: 0 },
    { name: 'meeting_frequency_days', label: 'Reuniões a cada (dias)', type: 'number', min: 1, defaultValue: 15 },
    { name: 'notes', label: 'Observações', type: 'textarea' }
  ],
  columns: [{ key: 'name', label: 'Parceiro' }, { key: 'percent_event', label: '% eventos', format: 'percent', align: 'right' }, { key: 'percent_fixed', label: '% pontos fixos', format: 'percent', align: 'right' }, { key: 'opening_debt', label: 'Dívida inicial', format: 'money', align: 'right' }, { key: 'status', label: 'Status' }]
};

export const routinesDef: ResourceDef = {
  table: 'routines', title: 'Rotinas e hábitos', singular: 'Rotina', resource: 'organizacao', searchColumns: ['title'], defaultOrder: [{ column: 'title' }],
  archive: { column: 'active', value: false, activeValue: true }, draft: true,
  filters: [{ column: 'kind', label: 'Tipo', options: opts({ rotina: 'Rotina', habito: 'Hábito' }) }],
  fields: [
    { name: 'title', label: 'Título', type: 'text', required: true, wide: true, placeholder: 'Ex.: Conferir cobranças' },
    { name: 'kind', label: 'Tipo', type: 'select', options: opts({ rotina: 'Rotina', habito: 'Hábito' }), required: true, defaultValue: 'rotina' },
    { name: 'frequency', label: 'Frequência', type: 'select', options: opts({ diaria: 'Diária', semanal: 'Semanal', mensal: 'Mensal', anual: 'Anual' }), required: true, defaultValue: 'diaria' },
    { name: 'target_per_period', label: 'Meta por período', type: 'number', min: 1, defaultValue: 1 },
    { name: 'active', label: 'Ativa', type: 'boolean', defaultValue: true }
  ],
  columns: [{ key: 'title', label: 'Rotina' }, { key: 'kind', label: 'Tipo' }, { key: 'frequency', label: 'Frequência' }, { key: 'active', label: 'Ativa', format: 'boolean' }]
};

export const notesDef: ResourceDef = {
  table: 'notes', title: 'Blocos de notas', singular: 'Nota', resource: 'organizacao', searchColumns: ['title', 'body', 'category'], defaultOrder: [{ column: 'updated_at', ascending: false }],
  draft: true, allowDelete: true,
  filters: [{ column: 'favorite', label: 'Favoritas', options: [{ value: 'true', label: 'Somente favoritas' }] }],
  fields: [
    { name: 'title', label: 'Título', type: 'text', required: true, wide: true },
    { name: 'category', label: 'Assunto', type: 'text' },
    { name: 'tags', label: 'Etiquetas (separadas por vírgula)', type: 'tags' },
    { name: 'customer_id', label: 'Cliente relacionado', type: 'ref', ref: { table: 'customers', label: 'name' } },
    { name: 'favorite', label: 'Favorita', type: 'boolean' },
    { name: 'body', label: 'Conteúdo', type: 'textarea', wide: true }
  ],
  cardSubtitle: (r) => String(r.body ?? '').slice(0, 140),
  columns: [{ key: 'title', label: 'Nota' }, { key: 'category', label: 'Assunto' }, { key: 'tags', label: 'Etiquetas', render: (r) => (r.tags as string[] | null)?.join(', ') ?? '—' }, { key: 'favorite', label: 'Favorita', format: 'boolean' }, { key: 'updated_at', label: 'Atualizada', format: 'datetime' }]
};

export const CAMPAIGN_STATUS = { planejada: 'Planejada', ativa: 'Ativa', pausada: 'Pausada', concluida: 'Concluída', cancelada: 'Cancelada' };
export const campaignsDef: ResourceDef = {
  table: 'marketing_campaigns', title: 'Campanhas', singular: 'Campanha', resource: 'marketing', searchColumns: ['name', 'code'], defaultOrder: [{ column: 'starts_on', ascending: false }],
  status: status('status', { planejada: ['Planejada', 'info'], ativa: ['Ativa', 'success'], pausada: ['Pausada', 'warning'], concluida: ['Concluída', 'neutral'], cancelada: ['Cancelada', 'neutral'] }), draft: true,
  fields: [
    { name: 'name', label: 'Nome', type: 'text', required: true, wide: true },
    { name: 'code', label: 'Código da campanha (atribuição)', type: 'text', help: 'Use também em parâmetros UTM e na origem do cliente/pedido.' },
    { name: 'kind', label: 'Tipo', type: 'select', options: opts({ aquisicao: 'Aquisição', reativacao: 'Reativação', eventos: 'Eventos', sazonal: 'Sazonal', branding: 'Branding', pontos_fixos: 'Aquisição de pontos fixos', outra: 'Outra' }), required: true, defaultValue: 'aquisicao' },
    { name: 'objective', label: 'Objetivo', type: 'text' }, { name: 'channel', label: 'Canal', type: 'text' }, { name: 'audience', label: 'Público', type: 'text' },
    { name: 'starts_on', label: 'Início', type: 'date' }, { name: 'ends_on', label: 'Fim', type: 'date' },
    { name: 'budget', label: 'Orçamento (R$)', type: 'money', min: 0 }, { name: 'spent', label: 'Investido (R$)', type: 'money', min: 0 },
    { name: 'utm_source', label: 'utm_source', type: 'text' }, { name: 'utm_medium', label: 'utm_medium', type: 'text' }, { name: 'utm_campaign', label: 'utm_campaign', type: 'text' },
    { name: 'status', label: 'Situação', type: 'select', options: opts(CAMPAIGN_STATUS), defaultValue: 'planejada' },
    { name: 'notes', label: 'Briefing / observações', type: 'textarea' }
  ],
  columns: [{ key: 'name', label: 'Campanha' }, { key: 'code', label: 'Código' }, { key: 'starts_on', label: 'Início', format: 'date' }, { key: 'budget', label: 'Orçamento', format: 'money', align: 'right' }, { key: 'spent', label: 'Investido', format: 'money', align: 'right' }, { key: 'status', label: 'Situação' }]
};

export const CONTENT_STATUS = { ideia: 'Ideia', producao: 'Produção', revisao: 'Revisão', aprovado: 'Aprovado', agendado: 'Agendado', publicado: 'Publicado', cancelado: 'Cancelado' };
export const contentsDef: ResourceDef = {
  table: 'marketing_contents', title: 'Conteúdos e calendário editorial', singular: 'Conteúdo', resource: 'marketing', searchColumns: ['title', 'theme', 'caption'], defaultOrder: [{ column: 'publish_date' }],
  select: '*,campaign:marketing_campaigns(name)', draft: true, allowDelete: true,
  filters: [{ column: 'status', label: 'Etapa', options: opts(CONTENT_STATUS) }],
  status: status('status', { ideia: ['Ideia', 'neutral'], producao: ['Produção', 'info'], revisao: ['Revisão', 'warning'], aprovado: ['Aprovado', 'success'], agendado: ['Agendado', 'info'], publicado: ['Publicado', 'success'], cancelado: ['Cancelado', 'neutral'] }),
  fields: [
    { name: 'title', label: 'Título', type: 'text', required: true, wide: true },
    { name: 'theme', label: 'Tema', type: 'text' }, { name: 'objective', label: 'Objetivo', type: 'text' },
    { name: 'platform', label: 'Plataforma', type: 'select', options: opts({ instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', tiktok: 'TikTok', google: 'Google', outro: 'Outro' }) },
    { name: 'format', label: 'Formato', type: 'select', options: opts({ post: 'Post', carrossel: 'Carrossel', reels: 'Reels', stories: 'Stories', video: 'Vídeo', anuncio: 'Anúncio' }) },
    { name: 'publish_date', label: 'Data de publicação', type: 'date' },
    { name: 'campaign_id', label: 'Campanha', type: 'ref', ref: { table: 'marketing_campaigns', label: 'name' } },
    { name: 'status', label: 'Etapa', type: 'select', options: opts(CONTENT_STATUS), defaultValue: 'ideia' },
    { name: 'cta', label: 'CTA', type: 'text' },
    { name: 'caption', label: 'Legenda', type: 'textarea', help: 'Hashtags não são inseridas automaticamente.' },
    { name: 'script', label: 'Roteiro', type: 'textarea' }
  ],
  columns: [{ key: 'title', label: 'Conteúdo' }, { key: 'platform', label: 'Plataforma' }, { key: 'format', label: 'Formato', hideOnMobile: true }, { key: 'publish_date', label: 'Publicação', format: 'date' }, { key: 'campaign.name', label: 'Campanha', sortable: false, hideOnMobile: true }, { key: 'status', label: 'Etapa' }]
};

export const leadsDef: ResourceDef = {
  table: 'leads', title: 'Leads', singular: 'Lead', resource: 'marketing', searchColumns: ['name', 'company', 'email'], defaultOrder: [{ column: 'created_at', ascending: false }],
  select: '*,campaign:marketing_campaigns(name)',
  filters: [{ column: 'stage', label: 'Etapa', options: opts({ novo: 'Novo', contato: 'Contato', qualificado: 'Qualificado', proposta: 'Proposta', ganho: 'Ganho', perdido: 'Perdido' }) }],
  status: status('stage', { novo: ['Novo', 'info'], contato: ['Contato', 'info'], qualificado: ['Qualificado', 'warning'], proposta: ['Proposta', 'warning'], ganho: ['Ganho', 'success'], perdido: ['Perdido', 'neutral'] }),
  fields: [
    { name: 'name', label: 'Nome', type: 'text', required: true }, { name: 'company', label: 'Empresa', type: 'text' }, { name: 'phone', label: 'Telefone', type: 'phone' }, { name: 'email', label: 'E-mail', type: 'email' },
    { name: 'campaign_id', label: 'Campanha de origem', type: 'ref', ref: { table: 'marketing_campaigns', label: 'name' } }, { name: 'source', label: 'Origem', type: 'text' },
    { name: 'stage', label: 'Etapa do funil', type: 'select', options: opts({ novo: 'Novo', contato: 'Contato', qualificado: 'Qualificado', proposta: 'Proposta', ganho: 'Ganho', perdido: 'Perdido' }), defaultValue: 'novo' },
    { name: 'notes', label: 'Observações', type: 'textarea' }
  ],
  columns: [{ key: 'name', label: 'Lead' }, { key: 'company', label: 'Empresa' }, { key: 'campaign.name', label: 'Campanha', sortable: false }, { key: 'stage', label: 'Etapa' }, { key: 'created_at', label: 'Entrada', format: 'datetime', hideOnMobile: true }]
};

export const STRATEGY_KIND = { swot_forca: 'SWOT · Força', swot_fraqueza: 'SWOT · Fraqueza', swot_oportunidade: 'SWOT · Oportunidade', swot_ameaca: 'SWOT · Ameaça', risco: 'Risco', persona: 'Persona', concorrente: 'Concorrente', posicionamento: 'Posicionamento', objetivo: 'Objetivo', okr: 'OKR', plano_acao: 'Plano de ação', ideia: 'Ideia' };
export const strategyDef: ResourceDef = {
  table: 'strategy_items', title: 'Planejamento estratégico', singular: 'Item estratégico', resource: 'estrategia', searchColumns: ['title', 'body'], defaultOrder: [{ column: 'kind' }],
  filters: [{ column: 'kind', label: 'Tipo', options: opts(STRATEGY_KIND) }], draft: true, allowDelete: true,
  status: status('status', { aberto: ['Aberto', 'info'], em_andamento: ['Em andamento', 'warning'], concluido: ['Concluído', 'success'], descartado: ['Descartado', 'neutral'] }),
  fields: [
    { name: 'kind', label: 'Tipo', type: 'select', options: opts(STRATEGY_KIND), required: true },
    { name: 'title', label: 'Título', type: 'text', required: true },
    { name: 'impact', label: 'Impacto (1–5)', type: 'number', min: 1, max: 5 }, { name: 'probability', label: 'Probabilidade (1–5)', type: 'number', min: 1, max: 5 },
    { name: 'due_date', label: 'Prazo', type: 'date' },
    { name: 'status', label: 'Situação', type: 'select', options: opts({ aberto: 'Aberto', em_andamento: 'Em andamento', concluido: 'Concluído', descartado: 'Descartado' }), defaultValue: 'aberto' },
    { name: 'body', label: 'Descrição', type: 'textarea' }
  ],
  columns: [{ key: 'kind', label: 'Tipo', render: (r) => STRATEGY_KIND[r.kind as keyof typeof STRATEGY_KIND] }, { key: 'title', label: 'Título' }, { key: 'impact', label: 'Impacto', format: 'number' }, { key: 'due_date', label: 'Prazo', format: 'date' }, { key: 'status', label: 'Situação' }]
};

export const projectsDef: ResourceDef = {
  table: 'projects', title: 'Projetos internos', singular: 'Projeto', resource: 'organizacao', searchColumns: ['name'], defaultOrder: [{ column: 'name' }],
  status: status('status', { planejado: ['Planejado', 'info'], ativo: ['Ativo', 'success'], pausado: ['Pausado', 'warning'], concluido: ['Concluído', 'neutral'], cancelado: ['Cancelado', 'neutral'] }),
  fields: [{ name: 'name', label: 'Nome', type: 'text', required: true, wide: true }, { name: 'starts_on', label: 'Início', type: 'date' }, { name: 'ends_on', label: 'Fim', type: 'date' }, { name: 'status', label: 'Situação', type: 'select', options: opts({ planejado: 'Planejado', ativo: 'Ativo', pausado: 'Pausado', concluido: 'Concluído', cancelado: 'Cancelado' }), defaultValue: 'ativo' }, { name: 'description', label: 'Descrição', type: 'textarea' }],
  columns: [{ key: 'name', label: 'Projeto' }, { key: 'starts_on', label: 'Início', format: 'date' }, { key: 'ends_on', label: 'Fim', format: 'date' }, { key: 'status', label: 'Situação' }]
};

export const templatesDef: ResourceDef = {
  table: 'message_templates', title: 'Modelos de mensagens', singular: 'Modelo', resource: 'automacoes', searchColumns: ['name', 'key', 'body'], defaultOrder: [{ column: 'category' }, { column: 'name' }],
  subtitle: 'Variáveis disponíveis: [NOME_CLIENTE] [NOME_EMPRESA] [VALOR_ORIGINAL] [VALOR_ATUALIZADO] [DATA_VENCIMENTO] [DIAS_ATRASO] [DATA_ENCAMINHAMENTO] [CHAVE_PIX] [LINHA_DIGITAVEL] [NUMERO_PEDIDO] [DATA_VISITA] [HORARIO_VISITA] [NOME_RESPONSAVEL] [DATA_ENTREGA]',
  archive: { column: 'active', value: false, activeValue: true },
  filters: [{ column: 'category', label: 'Categoria', options: opts({ cobranca: 'Cobrança', comercial: 'Comercial', tecnico: 'Técnico', logistica: 'Logística' }) }],
  fields: [
    { name: 'key', label: 'Identificador (sem espaços)', type: 'text', required: true, validate: (v) => (/^[a-z0-9_]+$/.test(String(v ?? '')) ? null : 'Use apenas letras minúsculas, números e _') },
    { name: 'name', label: 'Nome', type: 'text', required: true },
    { name: 'category', label: 'Categoria', type: 'select', options: opts({ cobranca: 'Cobrança', comercial: 'Comercial', tecnico: 'Técnico', logistica: 'Logística' }), required: true },
    { name: 'active', label: 'Ativo', type: 'boolean', defaultValue: true },
    { name: 'body', label: 'Mensagem', type: 'textarea', required: true }
  ],
  cardSubtitle: (r) => String(r.body ?? '').slice(0, 160),
  columns: [{ key: 'name', label: 'Modelo' }, { key: 'category', label: 'Categoria' }, { key: 'body', label: 'Mensagem', render: (r) => <span className="line-clamp-2 max-w-xl text-cocoa-700">{String(r.body)}</span> }, { key: 'active', label: 'Ativo', format: 'boolean' }]
};

export const holidaysDef: ResourceDef = {
  table: 'holidays', idColumn: 'day', title: 'Feriados', singular: 'Feriado', resource: 'admin', searchColumns: ['name'], defaultOrder: [{ column: 'day' }], allowDelete: false,
  subtitle: 'Usados na prorrogação de vencimentos e na contagem de dias úteis para protesto.',
  fields: [{ name: 'day', label: 'Data', type: 'date', required: true }, { name: 'name', label: 'Nome', type: 'text', required: true }, { name: 'scope', label: 'Abrangência', type: 'select', options: opts({ nacional: 'Nacional', estadual: 'Estadual', municipal: 'Municipal', empresa: 'Empresa' }), defaultValue: 'nacional' }],
  columns: [{ key: 'day', label: 'Data', format: 'date' }, { key: 'name', label: 'Feriado' }, { key: 'scope', label: 'Abrangência' }]
};

export const PURCHASE_STATUS = { solicitada: 'Solicitada', cotacao: 'Em cotação', aprovada: 'Aprovada', pedido_enviado: 'Pedido enviado', recebida_parcial: 'Recebida parcialmente', recebida: 'Recebida', cancelada: 'Cancelada' };
export const purchasesDef: ResourceDef = {
  table: 'purchases', title: 'Compras', singular: 'Compra', resource: 'estoque', searchColumns: ['notes'], defaultOrder: [{ column: 'created_at', ascending: false }],
  select: '*,supplier:suppliers(name)', rowLink: (r) => `/compras/${r.id}`,
  filters: [{ column: 'status', label: 'Situação', options: opts(PURCHASE_STATUS) }],
  status: status('status', { solicitada: ['Solicitada', 'info'], cotacao: ['Em cotação', 'info'], aprovada: ['Aprovada', 'success'], pedido_enviado: ['Pedido enviado', 'info'], recebida_parcial: ['Recebida parcialmente', 'warning'], recebida: ['Recebida', 'success'], cancelada: ['Cancelada', 'neutral'] }),
  fields: [
    { name: 'supplier_id', label: 'Fornecedor', type: 'ref', ref: { table: 'suppliers', label: 'name' } },
    { name: 'expected_date', label: 'Previsão de entrega', type: 'date' }, { name: 'due_date', label: 'Vencimento do pagamento', type: 'date' },
    { name: 'payment_terms', label: 'Condições de pagamento', type: 'text' },
    { name: 'status', label: 'Situação', type: 'select', options: opts(PURCHASE_STATUS), defaultValue: 'solicitada' },
    { name: 'notes', label: 'Observações', type: 'textarea' }
  ],
  columns: [{ key: 'number', label: 'Nº', format: 'number' }, { key: 'supplier.name', label: 'Fornecedor', sortable: false }, { key: 'expected_date', label: 'Previsão', format: 'date' }, { key: 'total', label: 'Total', format: 'money', align: 'right' }, { key: 'status', label: 'Situação' }]
};

export const meetingsDef: ResourceDef = {
  table: 'meetings', title: 'Reuniões', singular: 'Reunião', resource: 'organizacao', searchColumns: ['title', 'agenda', 'notes'], defaultOrder: [{ column: 'starts_at', ascending: false }],
  rowLink: (r) => `/reunioes/${r.id}`, draft: true,
  status: status('status', { agendada: ['Agendada', 'info'], realizada: ['Realizada', 'success'], cancelada: ['Cancelada', 'neutral'] }),
  filters: [{ column: 'template', label: 'Modelo', options: opts({ administrativa: 'Administrativa', financeira: 'Financeira', operacional: 'Operacional', estrategica: 'Estratégica', parceiros: 'Com parceiros', outra: 'Outra' }) }],
  fields: [
    { name: 'title', label: 'Título', type: 'text', required: true, wide: true },
    { name: 'template', label: 'Modelo', type: 'select', options: opts({ administrativa: 'Administrativa', financeira: 'Financeira', operacional: 'Operacional', estrategica: 'Estratégica', parceiros: 'Com parceiros', outra: 'Outra' }) },
    { name: 'starts_at', label: 'Data e horário', type: 'datetime', required: true },
    { name: 'partner_id', label: 'Parceiro (opcional)', type: 'ref', ref: { table: 'partners', label: 'name' } },
    { name: 'participants', label: 'Participantes (opcional, separados por vírgula)', type: 'tags', help: 'Pode deixar em branco se ainda não souber com quem será.' },
    { name: 'agenda', label: 'Pauta', type: 'textarea' }
  ],
  columns: [{ key: 'title', label: 'Reunião' }, { key: 'template', label: 'Modelo' }, { key: 'starts_at', label: 'Quando', format: 'datetime' }, { key: 'status', label: 'Situação' }]
};

export { formatReais, formatDateBR };

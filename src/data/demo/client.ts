import { isValidCnpj, isValidCpf, normalizeCnpj } from '@/domain/documents';
import { todaySP } from '@/domain/dates';
import type { DataClient, ListOptions, Row, SessionUser } from '../types';
import { loadDb, nowIso, resetDb, saveDb, table, uid } from './store';
import { seed } from './seed';
import { VIEWS } from './views';
import { runQuery } from './query';
import { DEMO_RPC, recalcOrder } from './rpc';

/** Espelha os DEFAULT das colunas do PostgreSQL (somente demonstração). */
function defaults(name: string): Row {
  const today = todaySP();
  const now = nowIso();
  const map: Record<string, Row> = {
    orders: { status: 'orcamento', order_date: today, discount: 0, freight: 0, installments: 1, subtotal: 0, total: 0, total_cost: 0, total_liters: 0 },
    service_orders: { status: 'aberta', priority: 'normal', cost: 0, charged_amount: 0, is_free: false, checklist: [] },
    purchases: { status: 'solicitada', total: 0 },
    purchase_items: { received_quantity: 0 },
    tasks: { status: 'a_fazer', priority: 'normal', checklist: [], depends_on: [] },
    customers: { status: 'ativo', verification_status: 'nao_verificado', segment: 'ponto_fixo' },
    receivables: { status: 'em_aberto', paid_amount: 0, interest_amount: 0, fine_amount: 0, discount_amount: 0, installment_no: 1, installment_count: 1, issue_date: today, competence_date: today },
    payables: { status: 'em_aberto', paid_amount: 0, installment_no: 1, installment_count: 1, competence_date: today },
    message_queue: { status: 'gerada', scheduled_for: today, channel: 'whatsapp' },
    notifications: { status: 'nao_lida', priority: 'normal' },
    meetings: { status: 'agendada', participants: [], decisions: [], topics: [] },
    equipment: { status: 'disponivel', location: 'deposito', custody_since: now, ownership: 'propria' },
    products: { status: 'ativo', unit: 'litro', is_draft_beer: true, min_stock: 0 },
    partners: { status: 'ativo', opening_debt: 0, percent_event: 0, percent_fixed: 0, fixed_per_order: 0, offset_debt: true },
    stock_items: { status: 'ativo', min_quantity: 0, unit: 'unidade', unit_cost: 0 },
    protest_records: { status: 'nao_encaminhado' },
    boletos: { status: 'registrado', origin: 'manual', issue_date: today },
    pix_charges: { status: 'gerado', kind: 'estatico' },
    calendar_events: { status: 'confirmado', priority: 'normal', all_day: false, participants: [], reminder_minutes: [30] },
    deliveries: { status: 'programada', full_kegs: 0, empty_kegs: 0, cylinders: 0, equipment_ids: [] },
    notes: { favorite: false, tags: [], is_draft: false, updated_at: now },
    leads: { stage: 'novo' }, goals: { status: 'ativa', direction: 'maior' }, routines: { active: true, target_per_period: 1 },
    keg_sizes: { active: true }, services: { active: true, checklist: [], default_price: 0, cost: 0 }, suppliers: { status: 'ativo' },
    marketing_campaigns: { status: 'planejada', budget: 0, spent: 0 }, marketing_contents: { status: 'ideia' }, strategy_items: { status: 'aberto' },
    projects: { status: 'ativo' }, user_invitations: { status: 'pendente' }, message_templates: { active: true, channel: 'whatsapp' },
    automation_rules: { active: true, conditions: [], action_config: {}, dedup_window: 'dia' }, financial_accounts: { active: true, opening_balance: 0, opening_date: today },
    commercial_conditions: { valid_from: today, discount_percent: 0, payment_term_days: 0, travel_fee: 0 }, customer_product_prices: { valid_from: today },
    inventory_lots: { received_at: today }, attachments: { archived_at: null }
  };
  return map[name] ?? {};
}

const NUMBERED: Record<string, string> = { orders: 'number', service_orders: 'number', purchases: 'number', customers: 'code' };
const listeners = new Set<(u: SessionUser | null) => void>();
const USER_KEY = 'jk-demo-session';

function resolve(name: string): Row[] {
  return VIEWS[name]?.() ?? table(name);
}

function beforeWrite(name: string, row: Row, isInsert: boolean) {
  if (name === 'customers' && row.document) {
    const doc = normalizeCnpj(String(row.document));
    const valid = row.person_type === 'PF' ? isValidCpf(doc) : isValidCnpj(doc);
    if (!valid) throw Object.assign(new Error(row.person_type === 'PF' ? 'CPF inválido' : 'CNPJ inválido'), { code: '22023' });
    if (table('customers').some((c) => c.document === doc && c.id !== row.id)) throw Object.assign(new Error('duplicate key value'), { code: '23505' });
    row.document = doc;
    if (!row.verification_status || row.verification_status === 'nao_verificado') row.verification_status = 'formato_valido';
  }
  if (name === 'order_items') {
    const o = table('orders').find((x) => x.id === row.order_id);
    if (o && !['orcamento', 'aguardando_confirmacao'].includes(String(o.status))) throw new Error('Itens só podem ser alterados antes da confirmação do pedido');
  }
  if (isInsert && NUMBERED[name]) {
    const col = NUMBERED[name]!;
    row[col] = Math.max(0, ...table(name).map((x) => Number(x[col] ?? 0))) + 1;
  }
}

function afterWrite(name: string, row: Row) {
  if (name === 'order_items') recalcOrder(String(row.order_id));
  if (name === 'orders') recalcOrder(String(row.id));
}

export function createDemoDataClient(): DataClient {
  loadDb(seed);
  return {
    mode: 'demo',
    async list<T>(name: string, opts: ListOptions = {}) {
      const r = runQuery(resolve(name), opts, resolve);
      return { rows: structuredClone(r.rows) as T[], count: r.count };
    },
    async get<T>(name: string, id: string, select?: string) {
      const r = runQuery(resolve(name), { filters: [{ column: name === 'integrations' ? 'provider' : name === 'settings' ? 'key' : 'id', op: 'eq', value: id }], select }, resolve);
      return (structuredClone(r.rows[0]) as T) ?? null;
    },
    async insert<T>(name: string, values: Row | Row[]) {
      const rows = (Array.isArray(values) ? values : [values]).map((v) => ({ id: uid(), created_at: nowIso(), ...defaults(name), ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) }));
      rows.forEach((r) => beforeWrite(name, r, true));
      table(name).push(...rows);
      rows.forEach((r) => afterWrite(name, r));
      saveDb();
      return structuredClone(rows[0]) as T;
    },
    async update<T>(name: string, id: string, values: Row, idColumn = 'id') {
      const row = table(name).find((r) => String(r[idColumn]) === String(id));
      if (!row) throw new Error('Registro não encontrado');
      const next = { ...row, ...values, updated_at: nowIso() };
      beforeWrite(name, next, false);
      Object.assign(row, next);
      afterWrite(name, row);
      saveDb();
      return structuredClone(row) as T;
    },
    async remove(name: string, id: string) {
      const t = table(name);
      const idx = t.findIndex((r) => r.id === id);
      if (idx >= 0) {
        const [row] = t.splice(idx, 1);
        if (row) afterWrite(name, row);
      }
      saveDb();
    },
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      const handler = DEMO_RPC[fn];
      if (!handler) throw new Error(`Função "${fn}" disponível apenas com o Supabase configurado (ambiente de produção).`);
      const out = handler(args);
      saveDb();
      return structuredClone(out) as T;
    },
    async invoke<T>(fn: string): Promise<T> {
      throw new Error(`Integração "${fn}" indisponível no ambiente de demonstração.`);
    },
    auth: {
      async getUser() {
        try {
          const raw = localStorage.getItem(USER_KEY);
          return raw ? (JSON.parse(raw) as SessionUser) : null;
        } catch {
          return null;
        }
      },
      async signIn(email) {
        const u = { id: 'demo-user', email: email || 'demo@jkchopp.invalid' };
        localStorage.setItem(USER_KEY, JSON.stringify(u));
        listeners.forEach((l) => l(u));
      },
      async signOut() {
        localStorage.removeItem(USER_KEY);
        listeners.forEach((l) => l(null));
      },
      async resetPassword() {
        /* sem e-mail no demo */
      },
      async updatePassword() {
        /* sem senha no demo */
      },
      onChange(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      }
    },
    storage: {
      async upload() {
        throw new Error('Envio de arquivos indisponível no ambiente de demonstração.');
      },
      async signedUrl() {
        throw new Error('Arquivos indisponíveis no ambiente de demonstração.');
      }
    }
  };
}

export { resetDb as resetDemoDb };

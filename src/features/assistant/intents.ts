/**
 * Assistente — camada DETERMINÍSTICA. Todos os números vêm de consultas verificáveis ao banco.
 * A IA (opcional) apenas interpreta/explica estes resultados; nunca calcula ou inventa valores.
 */
import type { DataClient, Row } from '@/data/types';
import { addDays, formatDateBR, periodFor, todaySP } from '@/domain/dates';
import { formatReais, formatNumber, formatPercent } from '@/domain/money';
import { evaluateHealth, HEALTH_LEVELS } from '@/domain/health';

export interface Answer {
  title: string;
  summary: string;
  table?: { columns: string[]; rows: (string | number)[][] };
  sources: string[];
  period?: string;
  limitations?: string;
  links?: { label: string; to: string }[];
}

interface Intent { key: string; patterns: RegExp[]; run: (db: DataClient) => Promise<Answer> }

const n = (v: unknown) => Number(v ?? 0);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const INTENTS: Intent[] = [
  {
    key: 'consumo_baixo', patterns: [/consum\w* menos/, /baixa rotativ/, /queda (de|no) consumo/, /consumindo pouco/],
    run: async (db) => {
      const { rows } = await db.list<Row>('customer_consumption', { filters: [{ column: 'status', op: 'eq', value: 'ativo' }], range: [0, 999] });
      const scored = rows.filter((r) => r.segment !== 'evento').map((r) => {
        const expected = n(r.expected_liters_per_week) ? (n(r.expected_liters_per_week) / 7) * 30 : null;
        const trend = n(r.liters_prev_30d) ? ((n(r.liters_30d) - n(r.liters_prev_30d)) / n(r.liters_prev_30d)) * 100 : null;
        return { r, ratio: expected ? n(r.liters_30d) / expected : null, trend };
      }).filter((x) => (x.ratio !== null && x.ratio < 0.85) || (x.trend !== null && x.trend <= -30)).sort((a, b) => (a.ratio ?? 1) - (b.ratio ?? 1));
      return {
        title: 'Clientes consumindo menos', sources: ['customer_consumption', 'commercial_conditions', 'orders'], period: 'Últimos 30 dias vs. 30 dias anteriores',
        summary: scored.length ? `${scored.length} ponto(s) fixo(s) abaixo de 85% da meta ou com queda ≥ 30%.` : 'Nenhum ponto fixo com consumo abaixo da meta ou queda relevante.',
        table: { columns: ['Cliente', 'Litros 30d', 'Meta 30d', '% da meta', 'Tendência'], rows: scored.slice(0, 15).map(({ r, ratio, trend }) => [String(r.trade_name ?? r.name), formatNumber(n(r.liters_30d)), r.expected_liters_per_week ? formatNumber((n(r.expected_liters_per_week) / 7) * 30) : '—', ratio === null ? '—' : formatPercent(ratio * 100, 0), trend === null ? '—' : formatPercent(trend, 0)]) },
        limitations: 'Clientes sem meta cadastrada são avaliados apenas pela tendência.', links: [{ label: 'Saúde comercial', to: '/inteligencia-comercial' }]
      };
    }
  },
  {
    key: 'baixo_retorno', patterns: [/baixo retorno/, /rentabilidade (dos|de) (clientes|pontos)/, /pontos? fixos? .*retorno/],
    run: async (db) => {
      const [cons, orders, eq] = await Promise.all([
        db.list<Row>('customer_consumption', { range: [0, 999] }),
        db.list<Row>('orders', { select: 'customer_id,total,total_cost,status,order_date', filters: [{ column: 'order_date', op: 'gte', value: addDays(todaySP(), -90) }], range: [0, 9999] }),
        db.list<Row>('equipment', { select: 'customer_id,acquisition_value,status', range: [0, 9999] })
      ]);
      const rows = cons.rows.filter((c) => c.segment !== 'evento' && c.status === 'ativo').map((c) => {
        const os = orders.rows.filter((o) => o.customer_id === c.customer_id && !['orcamento', 'aguardando_confirmacao', 'cancelado'].includes(String(o.status)));
        const profit = os.reduce((s, o) => s + n(o.total) - n(o.total_cost), 0);
        const eqs = eq.rows.filter((e) => e.customer_id === c.customer_id);
        const invested = eqs.reduce((s, e) => s + n(e.acquisition_value), 0);
        return { c, profit, eqCount: eqs.length, invested, roi: invested ? (profit / invested) * 100 : null };
      }).filter((x) => x.eqCount > 0).sort((a, b) => a.profit - b.profit);
      return {
        title: 'Pontos fixos com menor retorno', sources: ['orders', 'equipment', 'customer_consumption'], period: 'Últimos 90 dias',
        summary: rows.length ? `Ordenados pelo lucro bruto gerado (receita − custo do produto) nos últimos 90 dias, entre clientes com equipamentos.` : 'Nenhum ponto fixo com equipamento vinculado.',
        table: { columns: ['Cliente', 'Lucro bruto 90d', 'Equipamentos', 'Valor investido', 'Retorno s/ patrimônio'], rows: rows.slice(0, 15).map((x) => [String(x.c.trade_name ?? x.c.name), formatReais(x.profit), x.eqCount, formatReais(x.invested), x.roi === null ? '—' : formatPercent(x.roi, 0)]) },
        limitations: 'Custos logísticos e de manutenção não atribuídos individualmente não entram no cálculo. Decisões de recolhimento são humanas.'
      };
    }
  },
  {
    key: 'receber_mes', patterns: [/a receber/, /receber (neste|este|no) mes/, /quanto (temos|vamos) receber/],
    run: async (db) => {
      const p = periodFor('mes', todaySP());
      const { rows } = await db.list<Row>('receivables_view', { filters: [{ column: 'status', op: 'in', value: ['em_aberto', 'parcialmente_pago'] }, { column: 'due_date', op: 'gte', value: p.start }, { column: 'due_date', op: 'lte', value: p.end }], range: [0, 4999] });
      const total = rows.reduce((s, r) => s + n(r.outstanding), 0);
      const overdue = rows.filter((r) => String(r.due_date) < todaySP()).reduce((s, r) => s + n(r.outstanding), 0);
      return {
        title: 'A receber neste mês', sources: ['receivables'], period: `${formatDateBR(p.start)} a ${formatDateBR(p.end)}`,
        summary: `Em aberto com vencimento no mês: ${formatReais(total)} em ${rows.length} título(s), dos quais ${formatReais(overdue)} já vencidos. Valores a receber não são saldo disponível.`,
        table: { columns: ['Cliente', 'Vencimento', 'Em aberto'], rows: rows.slice(0, 20).map((r) => [String(r.customer_trade_name ?? r.customer_name), formatDateBR(r.due_date as string), formatReais(r.outstanding as number)]) },
        links: [{ label: 'Contas a receber', to: '/financeiro/receber' }]
      };
    }
  },
  {
    key: 'cobranca', patterns: [/precisam de cobranca/, /inadimpl/, /vencid/, /quem (deve|esta devendo)/, /cobrar/],
    run: async (db) => {
      const { rows } = await db.list<Row>('receivables_view', { filters: [{ column: 'financial_status', op: 'in', value: ['vencido', 'parcialmente_pago'] }], order: [{ column: 'due_date' }], range: [0, 4999] });
      const late = rows.filter((r) => String(r.due_date) < todaySP());
      const by = new Map<string, { name: string; total: number; days: number }>();
      for (const r of late) {
        const k = String(r.customer_id);
        const cur = by.get(k) ?? { name: String(r.customer_trade_name ?? r.customer_name), total: 0, days: 0 };
        cur.total += n(r.outstanding);
        cur.days = Math.max(cur.days, n(r.days_overdue));
        by.set(k, cur);
      }
      const list = [...by.values()].sort((a, b) => b.total - a.total);
      return {
        title: 'Clientes que precisam de cobrança', sources: ['receivables', 'protest_records'], period: `Posição em ${formatDateBR(todaySP())}`,
        summary: list.length ? `${list.length} cliente(s) com ${formatReais(list.reduce((s, x) => s + x.total, 0))} vencidos. Títulos pagos (inclusive em protesto) não aparecem.` : 'Nenhum título vencido em aberto.',
        table: { columns: ['Cliente', 'Vencido', 'Maior atraso (dias)'], rows: list.slice(0, 20).map((x) => [x.name, formatReais(x.total), x.days]) },
        links: [{ label: 'Fila de cobrança', to: '/financeiro/cobrancas' }]
      };
    }
  },
  {
    key: 'produtos_rentaveis', patterns: [/produtos? .*(rentab|margem|lucr)/, /maior rentabilidade/, /mais vendidos/],
    run: async (db) => {
      const [items, products] = await Promise.all([db.list<Row>('order_items', { range: [0, 99999] }), db.list<Row>('products', { range: [0, 999] })]);
      const by = new Map<string, { revenue: number; cost: number; liters: number }>();
      for (const i of items.rows) {
        const k = String(i.product_id);
        const cur = by.get(k) ?? { revenue: 0, cost: 0, liters: 0 };
        cur.revenue += n(i.total);
        cur.cost += n(i.total_cost);
        cur.liters += n(i.liters);
        by.set(k, cur);
      }
      const list = [...by.entries()].map(([id, v]) => ({ name: String(products.rows.find((p) => p.id === id)?.name ?? id), ...v, margin: v.revenue ? ((v.revenue - v.cost) / v.revenue) * 100 : 0 })).sort((a, b) => b.revenue - b.cost - (a.revenue - a.cost));
      return {
        title: 'Rentabilidade por produto', sources: ['order_items', 'products'], period: 'Todo o histórico de pedidos registrados',
        summary: list.length ? `Mais rentável em lucro bruto: ${list[0]!.name} (${formatReais(list[0]!.revenue - list[0]!.cost)}, margem ${formatPercent(list[0]!.margin)}).` : 'Sem itens de pedidos registrados.',
        table: { columns: ['Produto', 'Litros', 'Receita', 'Lucro bruto', 'Margem bruta'], rows: list.slice(0, 15).map((x) => [x.name, formatNumber(x.liters), formatReais(x.revenue), formatReais(x.revenue - x.cost), formatPercent(x.margin)]) },
        limitations: 'Inclui orçamentos e pedidos cancelados registrados como itens; use Relatórios para recortes por período.'
      };
    }
  },
  {
    key: 'ociosos', patterns: [/equipamentos? .*ocios/, /ocios/, /parados?/],
    run: async (db) => {
      const { rows } = await db.list<Row>('equipment', { select: '*,type:equipment_types(name)', filters: [{ column: 'status', op: 'eq', value: 'disponivel' }], order: [{ column: 'custody_since' }], range: [0, 999] });
      return {
        title: 'Equipamentos ociosos (disponíveis no depósito)', sources: ['equipment', 'equipment_movements'], period: `Posição em ${formatDateBR(todaySP())}`,
        summary: `${rows.length} equipamento(s) disponível(is). Os mais antigos parados aparecem primeiro.`,
        table: { columns: ['Código', 'Tipo', 'Parado desde'], rows: rows.slice(0, 20).map((e) => [String(e.asset_code), String((e.type as Row | null)?.name ?? ''), formatDateBR(String(e.custody_since).slice(0, 10))]) },
        links: [{ label: 'Equipamentos', to: '/equipamentos?status=disponivel' }]
      };
    }
  },
  {
    key: 'campanhas', patterns: [/campanhas? .*(venda|gerar|geraram|resultado)/, /quais campanhas/],
    run: async (db) => {
      const [camps, orders] = await Promise.all([db.list<Row>('marketing_campaigns', { range: [0, 499] }), db.list<Row>('orders', { select: 'campaign_id,total,status', range: [0, 99999] })]);
      const list = camps.rows.map((c) => { const os = orders.rows.filter((o) => o.campaign_id === c.id && !['orcamento', 'aguardando_confirmacao', 'cancelado'].includes(String(o.status))); return { name: String(c.name), orders: os.length, revenue: os.reduce((s, o) => s + n(o.total), 0), spent: n(c.spent) }; }).sort((a, b) => b.revenue - a.revenue);
      return {
        title: 'Vendas atribuídas a campanhas', sources: ['marketing_campaigns', 'orders'], summary: list.some((x) => x.orders) ? `Campanha com maior receita atribuída: ${list[0]!.name} (${formatReais(list[0]!.revenue)}).` : 'Nenhum pedido vinculado a campanhas. Vincule a campanha de origem nos pedidos/clientes.',
        table: { columns: ['Campanha', 'Pedidos', 'Receita atribuída', 'Investido'], rows: list.map((x) => [x.name, x.orders, formatReais(x.revenue), formatReais(x.spent)]) },
        limitations: 'Receita atribuída não é lucro. Sem integração Meta, investimento é o valor lançado manualmente.'
      };
    }
  },
  {
    key: 'margens', patterns: [/melhorar .*margen/, /margens? (baix|abaixo)/, /aumentar margem/],
    run: async (db) => {
      const [products, settings] = await Promise.all([db.list<Row>('products', { filters: [{ column: 'status', op: 'eq', value: 'ativo' }], range: [0, 999] }), db.list<Row>('settings', { filters: [{ column: 'key', op: 'eq', value: 'commercial.min_margin_percent' }] })]);
      const min = n(settings.rows[0]?.value ?? 20);
      const low = products.rows.map((p) => ({ p, m: n(p.price_per_unit) ? ((n(p.price_per_unit) - n(p.cost_per_unit)) / n(p.price_per_unit)) * 100 : 0 })).filter((x) => x.m < min + 5).sort((a, b) => a.m - b.m);
      return {
        title: 'Como melhorar as margens', sources: ['products', 'settings'],
        summary: `${low.length} produto(s) com margem bruta de tabela abaixo de ${min + 5}% (mínimo configurado: ${min}%). Sugestões: revisar preço por litro desses itens com o simulador; renegociar custo com fornecedores; limitar descontos sem aprovação; revisar clientes com preço personalizado abaixo da tabela; reduzir custos logísticos agrupando entregas por região.`,
        table: { columns: ['Produto', 'Custo/L', 'Preço/L', 'Margem bruta'], rows: low.slice(0, 15).map(({ p, m }) => [String(p.name), formatReais(p.cost_per_unit as number), formatReais(p.price_per_unit as number), formatPercent(m)]) },
        links: [{ label: 'Simulador de preços', to: '/precificacao' }], limitations: 'Margem de tabela (sem tributos e despesas variáveis). Para margem de contribuição use o simulador.'
      };
    }
  },
  {
    key: 'rotina', patterns: [/organiz\w* (minha )?rotina/, /rotina semanal/, /planej\w* (minha )?semana/],
    run: async (db) => {
      const p = periodFor('semana', todaySP());
      const [tasks, events, routines] = await Promise.all([
        db.list<Row>('tasks', { filters: [{ column: 'status', op: 'in', value: ['a_fazer', 'em_andamento'] }], order: [{ column: 'due_date' }], range: [0, 999] }),
        db.list<Row>('calendar_events', { filters: [{ column: 'starts_at', op: 'gte', value: `${p.start}T00:00:00-03:00` }, { column: 'starts_at', op: 'lte', value: `${p.end}T23:59:59-03:00` }], range: [0, 999] }),
        db.list<Row>('routines', { filters: [{ column: 'active', op: 'eq', value: true }], range: [0, 999] })
      ]);
      const overdue = tasks.rows.filter((t) => t.due_date && String(t.due_date) < todaySP());
      const week = tasks.rows.filter((t) => t.due_date && String(t.due_date) >= todaySP() && String(t.due_date) <= p.end);
      const prio = (t: Row) => ({ urgente: 0, alta: 1, normal: 2, baixa: 3 })[String(t.priority) as 'normal'] ?? 2;
      const plan = [...overdue, ...week].sort((a, b) => prio(a) - prio(b));
      return {
        title: 'Sugestão de rotina semanal', sources: ['tasks', 'calendar_events', 'routines'], period: `${formatDateBR(p.start)} a ${formatDateBR(p.end)}`,
        summary: `Priorize ${overdue.length} tarefa(s) atrasada(s), depois ${week.length} com prazo nesta semana. Há ${events.rows.length} compromisso(s) na agenda e ${routines.rows.length} rotina(s) ativas (ex.: conferir cobranças diariamente pela manhã, revisar clientes inativos às segundas, fechamento financeiro no fim do mês).`,
        table: { columns: ['Ordem', 'Tarefa', 'Prioridade', 'Prazo'], rows: plan.slice(0, 15).map((t, i) => [i + 1, String(t.title), String(t.priority), formatDateBR(t.due_date as string)]) },
        links: [{ label: 'Tarefas', to: '/tarefas' }, { label: 'Agenda', to: '/agenda' }]
      };
    }
  },
  {
    key: 'crescimento', patterns: [/estrategia de crescimento/, /crescer/, /campanha comercial/, /criar (uma )?campanha/],
    run: async (db) => {
      const cons = await db.list<Row>('customer_consumption', { range: [0, 999] });
      const inactive = cons.rows.filter((c) => c.status === 'ativo' && (!c.last_order_date || String(c.last_order_date) < addDays(todaySP(), -60)));
      const top = [...cons.rows].sort((a, b) => n(b.total_purchased) - n(a.total_purchased)).slice(0, 5);
      const health = cons.rows.filter((c) => n(c.expected_liters_per_week) > 0).map((c) => evaluateHealth({ today: todaySP(), customerSince: String(c.customer_since), expectedLitersPerWeek: n(c.expected_liters_per_week), orders: [] }));
      return {
        title: 'Estratégia de crescimento (sugestão baseada nos dados)', sources: ['customer_consumption'],
        summary: `1) Reativação: ${inactive.length} cliente(s) sem pedidos há 60+ dias — campanha de reativação via WhatsApp (modelo “Reativação”). 2) Expansão nos melhores clientes: ${top.map((t) => String(t.trade_name ?? t.name)).join(', ') || '—'} — oferecer novas linhas/tamanhos. 3) Pontos fixos com baixa rotatividade: visita e revisão de condições antes de investir mais patrimônio. 4) Aquisição: campanha para novos pontos fixos com código de campanha para medir CAC e ROI. 5) Eventos: pacote sazonal com serviços cobrados (instalação/retirada). Todas as ações dependem de aprovação humana.`,
        limitations: `Sugestões geradas por regras sobre os dados internos (${health.length} clientes com meta). Não são previsões.`, links: [{ label: 'Marketing', to: '/marketing' }, { label: 'Metas', to: '/metas' }]
      };
    }
  },
  {
    key: 'reuniao', patterns: [/ultima reuniao/, /resum\w* .*reuniao/],
    run: async (db) => {
      const { rows } = await db.list<Row>('meetings', { order: [{ column: 'starts_at', ascending: false }], range: [0, 0] });
      const m = rows[0];
      if (!m) return { title: 'Última reunião', summary: 'Nenhuma reunião registrada.', sources: ['meetings'] };
      const dec = (m.decisions as { text: string }[] | null) ?? [];
      return { title: `Resumo: ${String(m.title)}`, sources: ['meetings'], period: formatDateBR(String(m.starts_at).slice(0, 10)), summary: `Pauta: ${String(m.agenda ?? '—').slice(0, 400)}\nAnotações: ${String(m.notes ?? '—').slice(0, 600)}\nDecisões (${dec.length}): ${dec.map((d) => d.text).join('; ') || '—'}`, links: [{ label: 'Abrir reunião', to: `/reunioes/${m.id}` }] };
    }
  }
];

export const EXAMPLES = ['Quais clientes estão consumindo menos?', 'Quais pontos fixos apresentam baixo retorno?', 'Quanto temos a receber neste mês?', 'Quais clientes precisam de cobrança?', 'Quais produtos possuem maior rentabilidade?', 'Quais equipamentos estão ociosos?', 'Quais campanhas geraram vendas?', 'Como posso melhorar minhas margens?', 'Organize minha rotina semanal', 'Monte uma estratégia de crescimento', 'Resuma a última reunião'];

export function matchIntent(question: string): Intent | null {
  const q = norm(question);
  return INTENTS.find((i) => i.patterns.some((p) => p.test(q))) ?? null;
}

/** Minimização/anonimização antes de enviar a um provedor externo: remove documentos, e-mails e telefones. */
export function sanitizeForAi(text: string): string {
  return text
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]')
    .replace(/\b[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\/?[0-9A-Z]{4}-?\d{2}\b/g, '[CNPJ]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[EMAIL]')
    .replace(/(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}-?\d{4}/g, '[TELEFONE]');
}

export { HEALTH_LEVELS };

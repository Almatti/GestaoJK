/**
 * Módulo Festas — regras puras (fonte de verdade no cliente). O banco replica as mesmas regras em
 * `festa_events_view`, `festa_save`, `festa_payment_*` e `festa_generate_alerts` (migration 20261128003000).
 * Valores em centavos inteiros aqui; NUMERIC no banco. Pagamento só é "recebido" depois de confirmado.
 */
import { roundHalfAwayFromZero, sumCents, toCents, type Cents } from './money';
import type { ISODate } from './dates';
import type { PdfTextItem } from './boleto';

export const FESTA_OPS_STATUS = [
  { value: 'agendado', label: 'Agendado', tone: 'info' },
  { value: 'em_preparacao', label: 'Em preparação', tone: 'warning' },
  { value: 'pronto_entrega', label: 'Pronto para entrega', tone: 'warning' },
  { value: 'entregue', label: 'Entregue', tone: 'success' },
  { value: 'finalizado', label: 'Finalizado', tone: 'success' },
  { value: 'cancelado', label: 'Cancelado', tone: 'danger' }
] as const;
export type FestaOpsStatus = (typeof FESTA_OPS_STATUS)[number]['value'];

export const FESTA_FIN_STATUS = {
  pendente: { label: 'Pendente', tone: 'info' },
  parcialmente_pago: { label: 'Parcialmente pago', tone: 'warning' },
  pago: { label: 'Pago', tone: 'success' },
  vencido: { label: 'Vencido', tone: 'danger' },
  cancelado: { label: 'Cancelado', tone: 'neutral' }
} as const;
export type FestaFinStatus = keyof typeof FESTA_FIN_STATUS;

export const FESTA_UNITS = [
  { value: 'barril', label: 'Barril' },
  { value: 'unidade', label: 'Unidade' },
  { value: 'litro', label: 'Litro' },
  { value: 'outro', label: 'Outro' }
] as const;

export const FESTA_PAYMENT_KINDS = [
  { value: 'entrada', label: 'Entrada' },
  { value: 'parcela', label: 'Parcela' },
  { value: 'saldo', label: 'Saldo' },
  { value: 'outro', label: 'Outro' }
] as const;

export const FESTA_METHODS = [
  { value: 'pix', label: 'Pix' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'cartao_credito', label: 'Cartão de crédito' },
  { value: 'cartao_debito', label: 'Cartão de débito' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'outro', label: 'Outro' }
] as const;

export const DEFAULT_ALERT_DAYS = [3, 2, 0];

/** Valor de um item: quantidade × valor unitário − desconto + acréscimo (nunca negativo). */
export function itemTotalCents(item: { quantity: number; unitPriceCents: Cents; discountCents?: Cents; surchargeCents?: Cents }): Cents {
  const gross = roundHalfAwayFromZero(item.quantity * item.unitPriceCents);
  return Math.max(gross - (item.discountCents ?? 0) + (item.surchargeCents ?? 0), 0);
}

export interface FestaTotals {
  itemsCents: Cents;
  totalCents: Cents;
}

/** Total da festa = soma dos itens − desconto geral + acréscimo geral. */
export function festaTotals(itemTotals: Cents[], discountCents: Cents, surchargeCents: Cents): FestaTotals {
  const itemsCents = sumCents(itemTotals);
  return { itemsCents, totalCents: Math.max(itemsCents - discountCents + surchargeCents, 0) };
}

/** Situação financeira (espelho de `festa_events_view.financial_status`). */
export function festaFinancialStatus(p: {
  cancelled: boolean; totalCents: Cents; receivedCents: Cents; dueBalanceDate: ISODate | null; today: ISODate;
}): FestaFinStatus {
  if (p.cancelled) return 'cancelado';
  const outstanding = Math.max(p.totalCents - p.receivedCents, 0);
  if (p.totalCents > 0 && outstanding <= 0) return 'pago';
  if (outstanding > 0 && p.dueBalanceDate && p.dueBalanceDate < p.today) return 'vencido';
  if (p.receivedCents > 0) return 'parcialmente_pago';
  return 'pendente';
}

/** Vencimento do saldo: maior vencimento previsto; sem previsão, a data da festa. */
export function festaDueBalanceDate(scheduledDues: (ISODate | null)[], eventDate: ISODate | null): ISODate | null {
  const dues = scheduledDues.filter((d): d is ISODate => !!d).sort();
  return dues.length ? dues[dues.length - 1]! : eventDate;
}

/** Mensagem de validação do plano de pagamentos (null = válido). */
export function scheduleError(p: { totalCents: Cents; receivedCents: Cents; scheduledCents: Cents }): string | null {
  if (p.receivedCents + p.scheduledCents > p.totalCents) {
    return 'A soma dos pagamentos excede o total da festa.';
  }
  return null;
}

/** Campos que faltam no cadastro (alimenta o alerta de cadastro incompleto). */
export function festaMissingFields(e: { client_name?: string | null; client_phone?: string | null; event_name?: string | null; event_date?: string | null; event_time?: string | null; address?: string | null }): string[] {
  const blank = (v?: string | null) => !v || !v.trim();
  const missing: string[] = [];
  if (blank(e.client_name)) missing.push('nome do cliente');
  if (blank(e.client_phone)) missing.push('telefone');
  if (blank(e.event_name)) missing.push('nome do evento');
  if (blank(e.event_date)) missing.push('data');
  if (blank(e.event_time)) missing.push('horário');
  if (blank(e.address)) missing.push('endereço');
  return missing;
}

/** Prazos dos lembretes (dias antes da festa) a partir da configuração; valores inválidos voltam ao padrão. */
export function reminderDays(value: unknown): number[] {
  if (!Array.isArray(value)) return DEFAULT_ALERT_DAYS;
  const days = value.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 60);
  return days.length ? [...new Set(days)].sort((a, b) => b - a) : DEFAULT_ALERT_DAYS;
}

// ---------------------------------------------------------------------------
// Planejamento de compras
// ---------------------------------------------------------------------------
export interface PlanningRow {
  item_id: string;
  event_id: string;
  event_code: string;
  event_name: string | null;
  client_name: string | null;
  event_date: ISODate | null;
  event_time: string | null;
  product_name: string | null;
  unit: string;
  keg_liters: number | null;
  quantity: number;
  purchased_qty: number;
  separated_at: string | null;
  checked_at: string | null;
  purchased_at: string | null;
}

export interface PlanningGroup {
  key: string;
  product: string;
  unit: string;
  kegLiters: number | null;
  /** Quantidade total necessária (barris, unidades…). */
  quantity: number;
  /** Litros totais (somente para barris com litragem conhecida). */
  liters: number | null;
  purchased: number;
  missing: number;
  events: { id: string; code: string; name: string; date: ISODate | null; quantity: number }[];
  itemCount: number;
  separatedCount: number;
  checkedCount: number;
  purchasedCount: number;
}

/** Consolida os itens por produto + litragem. Quantidade necessária − comprada = ainda necessária. */
export function planningGroups(rows: PlanningRow[]): PlanningGroup[] {
  const map = new Map<string, PlanningGroup>();
  for (const r of rows) {
    const product = (r.product_name ?? '').trim() || 'Produto sem nome';
    const key = `${product.toLowerCase()}|${r.unit}|${r.keg_liters ?? ''}`;
    let g = map.get(key);
    if (!g) {
      g = { key, product, unit: r.unit, kegLiters: r.keg_liters, quantity: 0, liters: r.unit === 'barril' && r.keg_liters ? 0 : null,
        purchased: 0, missing: 0, events: [], itemCount: 0, separatedCount: 0, checkedCount: 0, purchasedCount: 0 };
      map.set(key, g);
    }
    g.quantity += r.quantity;
    if (g.liters !== null && r.keg_liters) g.liters += r.quantity * r.keg_liters;
    g.purchased += r.purchased_qty;
    g.itemCount += 1;
    if (r.separated_at) g.separatedCount += 1;
    if (r.checked_at) g.checkedCount += 1;
    if (r.purchased_at) g.purchasedCount += 1;
    const ev = g.events.find((x) => x.id === r.event_id);
    if (ev) ev.quantity += r.quantity;
    else g.events.push({ id: r.event_id, code: r.event_code, name: r.event_name ?? r.event_code, date: r.event_date, quantity: r.quantity });
  }
  for (const g of map.values()) {
    g.missing = Math.max(g.quantity - g.purchased, 0);
    g.events.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  }
  return [...map.values()].sort((a, b) => a.product.localeCompare(b.product, 'pt-BR') || (a.kegLiters ?? 0) - (b.kegLiters ?? 0));
}

// ---------------------------------------------------------------------------
// Leitura de PDF do pedido (heurística; campo não encontrado fica em branco)
// ---------------------------------------------------------------------------
export interface FestaExtractedItem {
  product_name: string;
  unit: string;
  keg_liters: string;
  quantity: string;
  unit_price: string;
  line_total: string;
}
export interface FestaExtractedPayment {
  kind: string;
  amount: string;
  due_date: string;
  method: string;
}
export interface FestaExtraction {
  client_name: string;
  client_phone: string;
  event_name: string;
  event_date: string;
  event_time: string;
  address: string;
  notes: string;
  discount_amount: string;
  surcharge_amount: string;
  total: string;
  items: FestaExtractedItem[];
  payments: FestaExtractedPayment[];
  /** Campos localizados (para destacar na prévia). */
  found: string[];
  /** Avisos para conferência humana. */
  warnings: string[];
}

const MONEY = '(\\d{1,3}(?:\\.\\d{3})*,\\d{2}|\\d+,\\d{2})';

/** Agrupa os trechos do PDF em linhas (mesma altura = mesma linha), da esquerda para a direita. */
export function linesFromItems(items: PdfTextItem[]): string[] {
  const out: string[] = [];
  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);
  for (const page of pages) {
    const sorted = items.filter((i) => i.page === page).sort((a, b) => b.y - a.y || a.x - b.x);
    let current: PdfTextItem[] = [];
    let baseY = Number.NaN;
    const flush = () => {
      if (current.length) out.push(current.sort((a, b) => a.x - b.x).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim());
      current = [];
    };
    for (const it of sorted) {
      const tol = Math.max(it.h || 8, 6) / 2;
      if (!Number.isNaN(baseY) && Math.abs(it.y - baseY) > tol) {
        flush();
      }
      if (current.length === 0) baseY = it.y;
      current.push(it);
    }
    flush();
  }
  return out.filter(Boolean);
}

/** "1.234,56" → "1234.56" (texto decimal com ponto). */
export function brMoneyToDecimal(v: string): string {
  return v.replace(/\./g, '').replace(',', '.');
}

function findMoney(lines: string[], label: RegExp): string {
  for (const l of lines) {
    const m = l.match(new RegExp(`(?:${label.source})\\s*[:-]?\\s*R?\\$?\\s*${MONEY}`, 'i'));
    if (m) return brMoneyToDecimal(m[1]!);
  }
  return '';
}

function findText(lines: string[], label: RegExp): string {
  for (const l of lines) {
    const m = l.match(new RegExp(`(?:^|\\s)(?:${label.source})\\s*[:-]\\s*(.+)$`, 'i'));
    if (m && m[1]!.trim()) return m[1]!.trim().replace(/\s{2,}.*$/, '').trim();
  }
  return '';
}

const METHOD_MAP: [RegExp, string][] = [
  [/pix/i, 'pix'], [/boleto/i, 'boleto'], [/dinheiro|especie|espécie/i, 'dinheiro'],
  [/cr[ée]dito/i, 'cartao_credito'], [/d[ée]bito/i, 'cartao_debito'], [/cart[aã]o/i, 'cartao_credito'],
  [/transfer/i, 'transferencia'], [/cheque/i, 'cheque']
];

const COMPOSITION = /(×|\bx\b|\bun\b|\bunid|caixa|fardo|\s=\s|consigna|descri|\bitens\b)/i;

/** "1.152,00" ou "2400" → número. */
function brNumber(tok: string): number {
  return Number(tok.replace(/\./g, '').replace(',', '.'));
}

/** "26/11/26" ou "26/11/2026" → ISO (ou '' se inválida). */
function brDateToIso(v: string): string {
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!m) return '';
  const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
  return `${year}-${m[2]}-${m[1]}`;
}

interface ParsedRow { qty: number; unit: number; total: number; pre: string; unitFixed: boolean }

/**
 * Linha de item: valores em R$ (unitário e total; a embalagem é ignorada). A quantidade é o número logo antes
 * do primeiro valor; se o OCR a deformar, ela é deduzida do total ÷ unitário. Se a conta não fechar, o
 * unitário é recalculado a partir do total ÷ quantidade (sinalizado para conferência).
 */
function parseItemRow(line: string): ParsedRow | null {
  const money = [...line.matchAll(/R\$\s*(\d[\d.]*(?:,\d{1,2})?)/g)];
  if (money.length < 2) return null;
  const before = line.slice(0, money[0]!.index).trim();
  const qMatch = before.match(/(\d+(?:[.,]\d+)?)\s*(?:x\s*)?$/i);
  let qty = qMatch ? Number(qMatch[1]!.replace(',', '.')) : 0;
  let unit = brNumber(money[0]![1]!);
  const total = brNumber(money[money.length - 1]![1]!);
  let unitFixed = false;
  if (!(qty > 0) && unit > 0) {
    const d = total / unit;
    if (Math.abs(d - Math.round(d)) < 0.01) qty = Math.round(d);
  }
  if (!(qty > 0)) return null;
  if (Math.abs(qty * unit - total) > 0.5 && total / qty <= 100000) {
    const fixed = Math.round((total / qty) * 100) / 100;
    if (Math.abs(qty * fixed - total) <= 0.5) { unit = fixed; unitFixed = true; }
  }
  const pre = (qMatch ? before.slice(0, before.length - qMatch[0].length) : before.replace(/[\d%\s]+$/, '')).trim();
  return { qty, unit, total, pre, unitFixed };
}

/** Nome do produto: texto antes da quantidade ou a linha acima (ignorando linhas de composição). */
function productName(lines: string[], index: number, pre: string): string {
  if (pre && !COMPOSITION.test(pre)) return pre;
  for (let j = index - 1; j >= 0 && j >= index - 4; j--) {
    const c = lines[j]!;
    if (c.length >= 3 && !COMPOSITION.test(c) && !/R\$|\d{2}\/\d{2}/.test(c)) return c;
  }
  return '';
}

/** Interpreta o texto do pedido. Campos ausentes ficam vazios; itens e pagamentos vêm para conferência. */
export function extractFestaFromLines(rawLines: string[]): FestaExtraction {
  const lines = rawLines.map((l) => l.replace(/R\$\s*/g, 'R$').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const r: FestaExtraction = {
    client_name: '', client_phone: '', event_name: '', event_date: '', event_time: '', address: '', notes: '',
    discount_amount: '', surcharge_amount: '', total: '', items: [], payments: [], found: [], warnings: []
  };

  // Cliente: "Nome: ..." (orçamentos) ou rótulos genéricos
  const nameLine = lines.map((l) => l.match(/\bNome\s*:\s*(.+?)(?=\s+(?:Data|Telefone|Tel|E-?mail|CPF|CNPJ|Endere[çc]o)\s*:|$)/i)?.[1]).find(Boolean);
  r.client_name = (nameLine ?? '').trim() || findText(lines, /cliente|contratante|nome do cliente/);
  r.event_name = findText(lines, /nome do evento|evento|festa|tipo de evento/);
  r.address = findText(lines, /endere[çc]o|local do evento|local/);

  // Telefone do CLIENTE: depois do bloco "CLIENTE" (o telefone do topo do documento costuma ser da empresa)
  const clienteAt = lines.findIndex((l) => /\bCLIENTE\b/.test(l));
  const phoneScope = clienteAt >= 0 ? lines.slice(clienteAt) : lines;
  const phoneLine = phoneScope.find((l) => /(telefone|celular|whatsapp|fone)\s*:/i.test(l));
  const phone = phoneLine?.match(/\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/);
  if (phone) r.client_phone = phone[0].trim();

  // Data do evento (não confundir com a data de emissão)
  const dateLine = lines.map((l) => l.match(/Data(?: do evento| da festa)?\s*:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1]).find(Boolean);
  if (dateLine) r.event_date = brDateToIso(dateLine);

  const timeLine = lines.find((l) => /hor[áa]rio\s*:|\bhora\s*:/i.test(l)) ?? lines.find((l) => /hor[áa]rio|hora\b/i.test(l));
  const tm = timeLine?.match(/(\d{1,2})\s*(?:h|:)\s*(\d{2})?/i);
  if (tm) r.event_time = `${tm[1]!.padStart(2, '0')}:${(tm[2] ?? '00').padStart(2, '0')}`;

  // Orçamento / emissão
  const orc = lines.map((l) => l.match(/\bORC-\d+\b/i)?.[0]).find(Boolean);
  const emissao = lines.map((l) => l.match(/Emiss[ãa]o\s*:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1]).find(Boolean);
  const obs = findText(lines, /observa[çc][õo]es?/);
  r.notes = [orc && `Orçamento ${orc}`, emissao && `emissão ${emissao}`, obs].filter(Boolean).join(' · ');

  r.discount_amount = findMoney(lines, /desconto/i);
  r.surcharge_amount = findMoney(lines, /acr[ée]scimo|taxa de servi[çc]o/i);
  const totalLine = lines.find((l) => /total\s+(?:estimado|do pedido|geral|a pagar)\s*:/i.test(l));
  r.total = totalLine ? brMoneyDecimal(totalLine.match(/:\s*R?\$?\s*(\d[\d.]*,\d{2})/)?.[1]) : findMoney(lines, /total/i);

  // Itens (vendas e consignação), com nome resolvido pela linha acima
  let inConsignment = false;
  let consignmentCount = 0;
  lines.forEach((line, index) => {
    if (/ITENS EM CONSIGNA/i.test(line)) { inConsignment = true; return; }
    if (/ITENS DE VENDA|DADOS PARA NOTA|CONDI[CÇ][ÕO]ES/i.test(line)) { inConsignment = false; return; }
    const row = parseItemRow(line);
    if (!row) return;
    const name = productName(lines, index, row.pre);
    if (!name) return;
    const liters = name.match(/(\d{1,3}(?:[.,]\d)?)\s*(?:l|lt|litros?)\b/i)?.[1]?.replace(',', '.') ?? '';
    const isKeg = (Number(liters) >= 20) || /barril|chopp|keg/i.test(name);
    const unit = isKeg ? 'barril' : /\blitro\b/i.test(name) ? 'litro' : 'unidade';
    if (inConsignment) consignmentCount += 1;
    r.items.push({
      product_name: name, unit, keg_liters: isKeg ? liters : '', quantity: String(row.qty), unit_price: String(row.unit), line_total: String(row.total)
    });
    if (row.unitFixed) {
      r.warnings.push(`Item "${name}": valor unitário ajustado pelo total lido (R$ ${row.total.toFixed(2).replace('.', ',')} ÷ ${row.qty}). Confira.`);
    } else if (Math.abs(row.qty * row.unit - row.total) > 0.5) {
      r.warnings.push(`Item "${name}": quantidade × valor (R$ ${(row.qty * row.unit).toFixed(2).replace('.', ',')}) difere do total lido (R$ ${row.total.toFixed(2).replace('.', ',')}). Confira.`);
    }
  });

  // Pagamentos: linha "dd/mm/aa Pix R$ x" (pagamento já informado no orçamento) — entra como PREVISTO
  const methodOf = (text: string) => METHOD_MAP.find(([re]) => re.test(text))?.[1] ?? (text ? 'outro' : '');
  const formMethod = methodOf(lines.map((l) => l.match(/forma(?: de)? pagamento\s*:\s*(.+)/i)?.[1]).find(Boolean) ?? '');
  const payLine = lines.map((l) => l.match(/(\d{2}\/\d{2}\/\d{2,4})\s+(Pix|Boleto|Dinheiro|Cart[ãa]o[^R]*?|Transfer[êe]ncia|Cheque)\s+R\$(\d[\d.]*,\d{2})/i)).find(Boolean);
  const advance = findMoney(lines, /valor antecipado recebido|adiantamento recebido/i);
  const fromBudget = !!payLine || !!advance;
  if (payLine) {
    r.payments.push({ kind: 'entrada', amount: brMoneyDecimal(payLine[3]), due_date: brDateToIso(payLine[1]!), method: methodOf(payLine[2]!) });
  } else if (advance) {
    r.payments.push({ kind: 'entrada', amount: advance, due_date: '', method: formMethod });
  }
  if (!payLine && !advance) {
    const entrada = findMoney(lines, /entrada/i);
    if (entrada) r.payments.push({ kind: 'entrada', amount: entrada, due_date: '', method: formMethod });
  }

  const saldo = lines.map((l) => l.match(/saldo(?: total| devedor| a pagar| restante)?\s*:?\s*R\$(\d[\d.]*,\d{2})/i)?.[1]).find(Boolean);
  if (saldo) {
    const dueLine = lines.map((l) => l.match(/vencimento\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1]).find(Boolean);
    r.payments.push({ kind: 'saldo', amount: brMoneyDecimal(saldo), due_date: dueLine ? brDateToIso(dueLine) : '', method: formMethod });
  }
  // Conferências
  const itemsSum = r.items.reduce((s, i) => s + Number(i.line_total), 0);
  const expected = itemsSum - num2(r.discount_amount) + num2(r.surcharge_amount);
  const totalNumber = Number(r.total || 0);
  if (totalNumber && r.items.length && Math.abs(expected - totalNumber) > 0.5) {
    r.warnings.push(`Soma dos itens com desconto e acréscimo (R$ ${expected.toFixed(2).replace('.', ',')}) difere do total do pedido (R$ ${totalNumber.toFixed(2).replace('.', ',')}). Confira os itens.`);
  }
  if (consignmentCount) {
    r.warnings.push(`Inclui ${consignmentCount} item(ns) em consignação: valor estimado, definitivo conforme o consumo apurado.`);
  }
  if (fromBudget) {
    const paid = r.payments.find((p) => p.kind === 'entrada');
    if (paid) r.warnings.push(`Pagamento de R$ ${paid.amount.replace('.', ',')} informado no orçamento: entrou como previsto. Confirme na festa quando o valor estiver no extrato.`);
  }

  r.found = (Object.entries({
    'nome do cliente': r.client_name, telefone: r.client_phone, 'nome do evento': r.event_name, data: r.event_date,
    horário: r.event_time, endereço: r.address, total: r.total, produtos: r.items.length ? 'ok' : '', pagamentos: r.payments.length ? 'ok' : '',
    orçamento: orc ?? ''
  }) as [string, string][]).filter(([, v]) => v).map(([k]) => k);

  if (!r.items.length) r.warnings.push('Não identifiquei os produtos no PDF: preencha os itens manualmente.');
  if (!r.total) r.warnings.push('Total do pedido não encontrado: confira o valor.');
  return r;
}

function num2(v: string): number {
  return Number(v || 0);
}

function brMoneyDecimal(v: string | undefined): string {
  return v ? brNumber(v).toFixed(2) : '';
}

/** Interpreta a partir dos trechos com posição (preferido) ou do texto puro. */
export function parseFestaPdf(text: string, items: PdfTextItem[] = []): FestaExtraction {
  const lines = items.length ? linesFromItems(items) : text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return extractFestaFromLines(lines);
}

/** Converte "R$ 1.234,56" em centavos (para conferências no cliente). */
export function moneyToCents(v: string): Cents {
  return toCents(brMoneyToDecimal(v.replace(/[^\d.,]/g, '')));
}

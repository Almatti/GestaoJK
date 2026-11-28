/**
 * Importação de "Ordem de Serviço / Pedido" em PDF (modelo JK CHOPP). Interpreta o texto extraído do PDF.
 * Campos não encontrados ficam vazios; nada é inventado. Regras de negócio continuam no servidor.
 */

export interface OrderPdfItem {
  product: string;
  composition: string;
  unit: string;
  kegLiters: number | null;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface OrderPdf {
  orderNumber: string;
  orderDate: string;
  statusText: string;
  boletoCode: string;
  client: { name: string; document: string; phone: string; email: string; address: string };
  delivery: { address: string; date: string; time: string; contact: string };
  items: OrderPdfItem[];
  payment: { method: string; statusText: string; total: number | null; balance: number | null };
  warnings: string[];
}

const MONEY = '(\\d{1,3}(?:\\.\\d{3})*,\\d{2})';
const ACCENT_GLUE = /\s+(?=[çÇãõáéíóúâêôàÁÉÍÓÚÂÊÔÃÕ])/g;
const ACCENT_TAIL = /([çÇãõáéíóúâêôàÁÉÍÓÚÂÊÔÃÕ])\s+(?=[A-Za-zÀ-ÿ0-9])/g;

/** Corrige espaços que o extrator de PDF insere dentro de palavras acentuadas ("Ara ç atuba" → "Araçatuba"). */
export function fixSpacing(s: string): string {
  return s.replace(ACCENT_GLUE, '').replace(ACCENT_TAIL, '$1').replace(/\s+/g, ' ').trim();
}

/** Forma comparável de um rótulo: sem espaços e em maiúsculas (imune à separação de letras). */
export function squash(s: string): string {
  return s.replace(/\s+/g, '').toUpperCase();
}

function firstMatch(lines: string[], re: RegExp): string {
  for (const l of lines) {
    const m = l.match(re);
    if (m) return (m[1] ?? m[0]).trim();
  }
  return '';
}

/** Linha imediatamente após o rótulo (rótulo comparado sem espaços). */
function valueAfter(lines: string[], label: string): string {
  const key = squash(label);
  const i = lines.findIndex((l) => squash(l).includes(key));
  return i >= 0 && lines[i + 1] ? lines[i + 1]! : '';
}

/** "1.234,56" → 1234.56 */
function brMoneyToNumber(v: string): number {
  return Number(v.replace(/\./g, '').replace(',', '.'));
}

/** "30" ou "1,5" → número, ou null se não for número */
function brNumberOrNull(v: string): number | null {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function brDate(v: string): string {
  const m = v.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

function digits(v: string): string {
  return v.replace(/\D/g, '');
}

export function parseOrderPdfLines(rawLines: string[]): OrderPdf {
  const lines = rawLines.map(fixSpacing).filter(Boolean);
  const whole = squash(lines.join(' '));
  const warnings: string[] = [];

  const orderNumber = firstMatch(lines, /(PED-\d{6}-\d{5})/i).toUpperCase();
  const orderDate = brDate(firstMatch(lines, /Pedido\s*:\s*(\d{2}\/\d{2}\/\d{4})/i));
  const statusText = whole.includes('CONFIRMADO') ? 'Confirmado' : '';
  const boletoCode = whole.match(/C[ÓO]D\.?BOLETO(\d+)/)?.[1] ?? '';

  // Cliente
  const name = valueAfter(lines, 'NOME / RAZÃO SOCIAL') || valueAfter(lines, 'NOME / RAZAO SOCIAL');
  const clientBlock = Math.max(lines.findIndex((l) => squash(l).includes('DADOSDOCLIENTE')), 0);
  const cnpjRel = lines.slice(clientBlock).findIndex((l) => squash(l).startsWith('CNPJ'));
  const clientLine = cnpjRel >= 0 ? (lines[clientBlock + cnpjRel + 1] ?? '') : '';
  const document = digits(clientLine.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/)?.[0] ?? '');
  const phone = digits(clientLine.replace(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/, '').match(/\d{10,11}/)?.[0] ?? '');
  const email = valueAfter(lines, 'E-MAIL');
  const address = valueAfter(lines, 'ENDEREÇO CADASTRAL') || valueAfter(lines, 'ENDERECO CADASTRAL');

  // Entrega
  const deliveryAddress = valueAfter(lines, 'ENDEREÇO DE ENTREGA') || valueAfter(lines, 'ENDERECO DE ENTREGA');
  const deliveryRow = lines.find((l) => /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/.test(l) && /\d{2}\/\d{2}\/\d{4}/.test(l)) ?? '';
  const dt = deliveryRow.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/);
  const contactRaw = valueAfter(lines, 'CONTATO NO LOCAL');
  const contact = digits(contactRaw);

  // Itens: linhas com quantidade, unidade, litragem e dois valores em R$
  const start = lines.findIndex((l) => squash(l).includes('PRODUTOSVENDIDOS'));
  const end = lines.findIndex((l) => squash(l).includes('SUBTOTALDOSPRODUTOS'));
  const items: OrderPdfItem[] = [];
  const itemRe = new RegExp(
    `^(.*?)\\s+(\\d+(?:[.,]\\d+)?)\\s+(barril\\(is\\)|barril|barris|unidade|un|fardo|caixa|litro)s?\\b.*?(?:·\\s*(\\d+(?:[.,]\\d+)?)\\s*L\\b)?\\s+R\\$\\s*${MONEY}\\s+R\\$\\s*${MONEY}\\s*$`,
    'i'
  );
  if (start >= 0) {
    const stop = end > start ? end : lines.length;
    for (let i = start + 1; i < stop; i++) {
      const m = lines[i]!.match(itemRe);
      if (!m) continue;
      const product = m[1]!.trim();
      const composition = lines[i + 1] && !/R\$/.test(lines[i + 1]!) && !/Subtotal/i.test(lines[i + 1]!) ? lines[i + 1]! : '';
      const liters = m[4] ? brNumberOrNull(m[4]) : null;
      const quantity = brNumberOrNull(m[2]!) ?? 0;
      const unitPrice = brMoneyToNumber(m[5]!);
      const total = brMoneyToNumber(m[6]!);
      items.push({ product, composition, unit: m[3]!.toLowerCase().startsWith('barr') ? 'barril' : m[3]!.toLowerCase(), kegLiters: liters, quantity, unitPrice, total });
      if (Math.abs(quantity * unitPrice - total) > 0.5) {
        warnings.push(`Item "${product}": quantidade × valor difere do total (${quantity} × ${unitPrice} ≠ ${total}). Confira.`);
      }
    }
  }
  if (!items.length) warnings.push('Não identifiquei os produtos do pedido: preencha manualmente.');

  // Pagamento e totais
  const payLine = lines.find((l) => /AGUARDANDO|PAGO|PARCIAL|VENCID/i.test(l) && new RegExp(MONEY).test(l)) ?? '';
  const paymentMethod = payLine.replace(new RegExp(`.*${MONEY}\\s*`), '').replace(/\s+(AGUARDANDO.*|PAGO.*|PARCIAL.*|VENCID.*)$/i, '').trim();
  const paymentStatus = payLine.match(/(AGUARDANDO PAGAMENTO|PAGO|PARCIALMENTE PAGO|VENCIDO|PARCIAL)/i)?.[1] ?? '';
  const totalAfter = valueAfter(lines, 'TOTAL A PAGAR');
  const totalMatch = (totalAfter || lines.find((l) => /^R\$/.test(l)) || '').match(new RegExp(`R\\$\\s*${MONEY}`));
  const balanceAfter = valueAfter(lines, 'SALDO PENDENTE');
  const balanceMatch = balanceAfter.match(new RegExp(`R\\$\\s*${MONEY}`));

  const total = totalMatch ? brMoneyToNumber(totalMatch[1]!) : null;
  const balance = balanceMatch ? brMoneyToNumber(balanceMatch[1]!) : null;
  const itemsSum = items.reduce((s, i) => s + i.total, 0);
  if (total != null && items.length && Math.abs(itemsSum - total) > 0.5) {
    warnings.push(`Soma dos itens (R$ ${itemsSum.toFixed(2).replace('.', ',')}) difere do total a pagar (R$ ${total.toFixed(2).replace('.', ',')}).`);
  }
  if (!document) warnings.push('CNPJ do cliente não encontrado no PDF.');

  return {
    orderNumber,
    orderDate,
    statusText,
    boletoCode,
    client: { name, document, phone, email, address },
    delivery: { address: deliveryAddress, date: dt ? brDate(dt[1]!) : '', time: dt?.[2] ?? '', contact },
    items,
    payment: { method: paymentMethod, statusText: paymentStatus, total, balance },
    warnings
  };
}

export interface ParsedAddress { street: string; number: string; district: string; city: string; state: string; cep: string }

/** "Rua X, 684 · Bairro · Cidade/SP · CEP 16015525" → campos separados (o que não for reconhecido fica vazio). */
export function parseAddress(text: string): ParsedAddress {
  const parts = fixSpacing(text).split('·').map((p) => p.trim()).filter(Boolean);
  const empty: ParsedAddress = { street: '', number: '', district: '', city: '', state: '', cep: '' };
  if (!parts.length) return empty;
  const r: ParsedAddress = { ...empty };
  const head = parts[0]!.match(/^(.*?),\s*([\w/-]+)$/);
  if (head) {
    r.street = head[1]!.trim();
    r.number = head[2]!.trim();
  } else {
    r.street = parts[0]!;
  }
  for (const p of parts.slice(1)) {
    const cep = p.match(/CEP\s*(\d{5}-?\d{3}|\d{8})/i);
    const cityUf = p.match(/^(.+?)\s*\/\s*([A-Za-z]{2})$/);
    if (cep) r.cep = cep[1]!.replace(/\D/g, '');
    else if (cityUf) {
      r.city = cityUf[1]!.trim();
      r.state = cityUf[2]!.toUpperCase();
    } else if (!r.district) r.district = p;
  }
  return r;
}

/**
 * Leitura de boletos pelo padrão FEBRABAN (linha digitável ou código de barras), com conferência dos dígitos
 * verificadores. Nada é inventado: valor e vencimento vêm do próprio código; o que não estiver no código
 * (pagador, nosso número etc.) é lido do PDF quando possível ou digitado pelo usuário.
 *
 * - Boleto de cobrança bancária: linha com 47 dígitos / código de barras com 44 (começa pelo código do banco).
 * - Boleto de arrecadação/convênio (contas de consumo, tributos): 48 dígitos na linha, começa com 8.
 * - Fator de vencimento: dias desde 07/10/1997; a partir de 22/02/2025 o fator reiniciou em 1000
 *   (nova base 29/05/2022). Entre as duas datas possíveis, usa a mais próxima da data de referência.
 */
import { addDays, diffDays } from './dates';

export type BoletoKind = 'bancario' | 'arrecadacao';

export interface BoletoInfo {
  kind: BoletoKind;
  /** Código de barras (44 dígitos). */
  barcode: string;
  /** Linha digitável formatada. */
  digitableLine: string;
  /** Código do banco (bancário) ou do segmento (arrecadação). */
  bankCode: string;
  bankName: string | null;
  /** Valor em reais (null quando o boleto não traz valor no código). */
  amount: number | null;
  /** Vencimento AAAA-MM-DD (null quando não informado no código). */
  dueDate: string | null;
  /** Campo livre do banco (25 dígitos) — contém nosso número/carteira conforme o banco. */
  freeField: string;
}

export class BoletoError extends Error {}

/** Principais bancos (código de compensação → nome). Bancos não listados mostram apenas o código. */
export const BANKS: Record<string, string> = {
  '001': 'Banco do Brasil', '003': 'Banco da Amazônia', '004': 'Banco do Nordeste', '021': 'Banestes', '033': 'Santander',
  '037': 'Banpará', '041': 'Banrisul', '047': 'Banese', '070': 'BRB', '077': 'Banco Inter', '084': 'Uniprime', '085': 'Ailos',
  '097': 'Credisis', '104': 'Caixa Econômica Federal', '133': 'Cresol', '136': 'Unicred', '197': 'Stone', '208': 'BTG Pactual',
  '212': 'Banco Original', '218': 'BS2', '237': 'Bradesco', '246': 'ABC Brasil', '260': 'Nubank', '290': 'PagBank',
  '323': 'Mercado Pago', '336': 'C6 Bank', '341': 'Itaú', '380': 'PicPay', '389': 'Mercantil do Brasil', '403': 'Cora',
  '422': 'Safra', '633': 'Rendimento', '655': 'Votorantim', '707': 'Daycoval', '735': 'Neon', '739': 'Cetelem',
  '745': 'Citibank', '748': 'Sicredi', '756': 'Sicoob'
};

const digits = (s: string) => s.replace(/\D/g, '');

/** Módulo 10 (campos da linha digitável e arrecadação com identificador 6/7). */
export function mod10(num: string): number {
  let sum = 0;
  let w = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    let p = Number(num[i]) * w;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    sum += p;
    w = w === 2 ? 1 : 2;
  }
  const r = sum % 10;
  return r === 0 ? 0 : 10 - r;
}

/** Módulo 11 do código de barras bancário (pesos 2 a 9; resultados 0, 10 e 11 viram 1). */
export function mod11Bank(num: string): number {
  let sum = 0;
  let w = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    sum += Number(num[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const dv = 11 - (sum % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** Módulo 11 da arrecadação (identificador 8/9): restos 0 e 1 viram 0, resto 10 vira 1. */
function mod11Collection(num: string): number {
  let sum = 0;
  let w = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    sum += Number(num[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const r = sum % 11;
  if (r === 0 || r === 1) return 0;
  if (r === 10) return 1;
  return 11 - r;
}

const BASE_1997 = '1997-10-07';
const BASE_2022 = '2022-05-29'; // fator 1000 = 22/02/2025

/** Converte o fator de vencimento na data mais próxima da referência (cobre o reinício do fator em 2025). */
export function dueDateFromFactor(factor: number, refDate: string): string | null {
  if (!factor) return null;
  const a = addDays(BASE_1997, factor);
  const b = addDays(BASE_2022, factor);
  return Math.abs(diffDays(a, refDate)) <= Math.abs(diffDays(b, refDate)) ? a : b;
}

function formatBankLine(l: string): string {
  return `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`;
}

function bankFromBarcode(bar: string, refDate: string, line?: string): BoletoInfo {
  if (mod11Bank(bar.slice(0, 4) + bar.slice(5)) !== Number(bar[4])) throw new BoletoError('Dígito verificador do código de barras não confere. Confira os números digitados.');
  const free = bar.slice(19);
  const l = line ?? (() => {
    const f1 = bar.slice(0, 4) + free.slice(0, 5);
    const f2 = free.slice(5, 15);
    const f3 = free.slice(15, 25);
    return `${f1}${mod10(f1)}${f2}${mod10(f2)}${f3}${mod10(f3)}${bar[4]}${bar.slice(5, 19)}`;
  })();
  const cents = Number(bar.slice(9, 19));
  return {
    kind: 'bancario',
    barcode: bar,
    digitableLine: formatBankLine(l),
    bankCode: bar.slice(0, 3),
    bankName: BANKS[bar.slice(0, 3)] ?? null,
    amount: cents > 0 ? cents / 100 : null,
    dueDate: dueDateFromFactor(Number(bar.slice(5, 9)), refDate),
    freeField: free
  };
}

function collectionFromBarcode(bar: string, line?: string): BoletoInfo {
  const id = bar[2];
  const calc = id === '6' || id === '7' ? mod10 : id === '8' || id === '9' ? mod11Collection : null;
  if (!calc) throw new BoletoError('Código de arrecadação com identificador de valor inválido.');
  if (calc(bar.slice(0, 3) + bar.slice(4)) !== Number(bar[3])) throw new BoletoError('Dígito verificador do código de barras não confere. Confira os números digitados.');
  const l = line ?? [0, 11, 22, 33].map((i) => { const b = bar.slice(i, i + 11); return b + calc(b); }).join('');
  const realValue = id === '6' || id === '8';
  const cents = Number(bar.slice(4, 15));
  return {
    kind: 'arrecadacao',
    barcode: bar,
    digitableLine: [0, 12, 24, 36].map((i) => `${l.slice(i, i + 11)}-${l[i + 11]}`).join(' '),
    bankCode: bar.slice(1, 2),
    bankName: null,
    amount: realValue && cents > 0 ? cents / 100 : null,
    dueDate: null,
    freeField: bar.slice(15)
  };
}

/**
 * Lê uma linha digitável (47/48 dígitos) ou código de barras (44 dígitos), com ou sem pontos e espaços.
 * Lança BoletoError com mensagem em português quando o código é inválido.
 */
export function parseBoleto(input: string, refDate: string): BoletoInfo {
  const d = digits(input);
  if (d.length === 44) return d[0] === '8' ? collectionFromBarcode(d) : bankFromBarcode(d, refDate);
  if (d.length === 47) {
    const fields: [string, number][] = [[d.slice(0, 9), Number(d[9])], [d.slice(10, 20), Number(d[20])], [d.slice(21, 31), Number(d[31])]];
    fields.forEach(([f, dv], i) => { if (mod10(f) !== dv) throw new BoletoError(`O ${i + 1}º campo da linha digitável não confere (dígito verificador). Confira os números.`); });
    const bar = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
    return bankFromBarcode(bar, refDate, d);
  }
  if (d.length === 48 && d[0] === '8') {
    const blocks = [0, 12, 24, 36].map((i) => d.slice(i, i + 12));
    const bar = blocks.map((b) => b.slice(0, 11)).join('');
    const id = bar[2];
    const calc = id === '6' || id === '7' ? mod10 : mod11Collection;
    blocks.forEach((b, i) => { if (calc(b.slice(0, 11)) !== Number(b[11])) throw new BoletoError(`O ${i + 1}º bloco da linha digitável não confere (dígito verificador). Confira os números.`); });
    return collectionFromBarcode(bar, d);
  }
  throw new BoletoError('Informe a linha digitável (47 ou 48 números) ou o código de barras (44 números).');
}

/** Procura uma linha digitável válida dentro de um texto (ex.: texto extraído do PDF do boleto). */
export function findBoletoInText(text: string, refDate: string): BoletoInfo | null {
  const candidates = new Set<string>();
  // Linha digitável no formato impresso (com pontos/espaços entre os grupos)
  const printed = /\d{5}[.\s]?\d{5}\s*\d{5}[.\s]?\d{6}\s*\d{5}[.\s]?\d{6}\s*\d\s*\d{14}/g;
  for (const m of text.matchAll(printed)) candidates.add(digits(m[0]));
  const conv = /8\d{10}[-\s]?\d\s*\d{11}[-\s]?\d\s*\d{11}[-\s]?\d\s*\d{11}[-\s]?\d/g;
  for (const m of text.matchAll(conv)) candidates.add(digits(m[0]));
  // Sequências contínuas de dígitos (alguns PDFs juntam tudo)
  for (const m of digits(text.replace(/[^\d\s.-]/g, ' ')).matchAll(/\d{44,48}/g)) candidates.add(m[0]);
  for (const c of candidates) {
    for (const len of [47, 48, 44]) {
      if (c.length < len) continue;
      for (let i = 0; i + len <= c.length; i++) {
        try {
          return parseBoleto(c.slice(i, i + len), refDate);
        } catch {
          /* tenta a próxima posição */
        }
      }
    }
  }
  return null;
}

export interface BoletoPdfHints {
  documents: string[];
  ourNumber: string | null;
  documentNumber: string | null;
}

/** Extrai do texto do PDF informações que não estão no código: CPF/CNPJ citados, nosso número e nº do documento. */
export function extractBoletoHints(text: string): BoletoPdfHints {
  const flat = text.replace(/\s+/g, ' ');
  const documents = [...new Set([
    ...[...flat.matchAll(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g)].map((m) => digits(m[0])),
    ...[...flat.matchAll(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g)].map((m) => digits(m[0]))
  ])];
  const after = (label: RegExp) => {
    const m = label.exec(flat);
    return m ? (m[1] ?? '').trim() || null : null;
  };
  return {
    documents,
    ourNumber: after(/Nosso\s*N[úu]mero[:\s]*([0-9][0-9./-]{2,30}[0-9])/i),
    documentNumber: after(/N[úu]m(?:ero|\.)?\s*(?:do\s*)?Documento[:\s]*([0-9A-Z][0-9A-Z./-]{0,24})/i)
  };
}

/**
 * Geração de BR Code Pix ESTÁTICO (padrão EMV® QRCPS-MPM, Manual de Padrões para Iniciação do Pix — Banco Central).
 * Um QR estático NÃO confirma pagamento: a confirmação exige conferência no extrato/banco ou API Pix da instituição.
 * Cobranças dinâmicas (COB/COBV) exigem integração com a API Pix do PSP e não são simuladas aqui.
 */
const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`;

export function crc16ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const clean = (s: string, max: number) => stripAccents(s).replace(/[^A-Za-z0-9 .\-/@]/g, '').trim().slice(0, max);

export interface StaticPixInput {
  key: string;
  merchantName: string;
  merchantCity: string;
  amountCents?: number | null;
  txid?: string | null;
  description?: string | null;
}

export function buildStaticPix(i: StaticPixInput): string {
  const key = i.key.trim();
  if (!key) throw new Error('Chave Pix não configurada');
  const description = i.description ? clean(i.description, 40) : '';
  const mai = field('00', 'br.gov.bcb.pix') + field('01', key) + (description ? field('02', description) : '');
  if (mai.length > 99) throw new Error('Chave + descrição excedem o tamanho permitido');
  const txid = i.txid ? i.txid.replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***' : '***';
  let payload =
    field('00', '01') +
    field('26', mai) +
    field('52', '0000') +
    field('53', '986') +
    (i.amountCents && i.amountCents > 0 ? field('54', (i.amountCents / 100).toFixed(2)) : '') +
    field('58', 'BR') +
    field('59', clean(i.merchantName, 25) || 'N') +
    field('60', clean(i.merchantCity, 15) || 'N') +
    field('62', field('05', txid));
  payload += '6304';
  return payload + crc16ccitt(payload);
}

/** Valida a integridade (CRC) de um BR Code. */
export function isValidBrCode(code: string): boolean {
  if (code.length < 8 || code.slice(-8, -4) !== '6304') return false;
  return crc16ccitt(code.slice(0, -4)) === code.slice(-4).toUpperCase();
}

export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria';

export function detectPixKeyType(key: string): PixKeyType | null {
  const k = key.trim();
  if (/^\+55\d{10,11}$/.test(k)) return 'telefone';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)) return 'email';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return 'aleatoria';
  if (/^\d{11}$/.test(k)) return 'cpf';
  if (/^[0-9A-Z]{12}\d{2}$/.test(k)) return 'cnpj';
  return null;
}

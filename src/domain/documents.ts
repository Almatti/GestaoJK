/**
 * Validação de documentos brasileiros.
 * IMPORTANTE: validade matemática NÃO comprova existência, titularidade ou regularidade cadastral.
 */
export const onlyDigits = (v: string) => v.replace(/\D/g, '');
export const normalizeCnpj = (v: string) => v.toUpperCase().replace(/[^0-9A-Z]/g, '');

export function isValidCpf(input: string): boolean {
  const cpf = onlyDigits(input);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // sequências repetidas
  const digits = cpf.split('').map(Number);
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += digits[i]! * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === digits[9] && calc(10) === digits[10];
}

/** Valor de cada caractere no CNPJ alfanumérico: código ASCII − 48 ('0'..'9' → 0..9, 'A' → 17 … 'Z' → 42). */
const charValue = (c: string) => c.charCodeAt(0) - 48;

export function cnpjCheckDigits(base12: string): string {
  const base = normalizeCnpj(base12);
  if (!/^[0-9A-Z]{12}$/.test(base)) throw new Error('Base do CNPJ deve ter 12 caracteres alfanuméricos');
  const dv = (chars: string) => {
    const weights = chars.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = chars.split('').reduce((acc, c, i) => acc + charValue(c) * weights[i]!, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  const d2 = dv(base + d1);
  return `${d1}${d2}`;
}

/** Aceita CNPJ numérico tradicional e o CNPJ alfanumérico (Receita Federal, a partir de 07/2026). */
export function isValidCnpj(input: string): boolean {
  const cnpj = normalizeCnpj(input);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  return cnpjCheckDigits(cnpj.slice(0, 12)) === cnpj.slice(12);
}

export function isAlphanumericCnpj(input: string): boolean {
  return /[A-Z]/.test(normalizeCnpj(input));
}

export function formatCpf(v: string): string {
  const d = onlyDigits(v).slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function formatCnpj(v: string): string {
  const c = normalizeCnpj(v).slice(0, 14);
  const parts: [number, number, string][] = [[0, 2, ''], [2, 5, '.'], [5, 8, '.'], [8, 12, '/'], [12, 14, '-']];
  return parts.map(([a, b, sep]) => (c.length > a ? (a ? sep : '') + c.slice(a, b) : '')).join('');
}

export function formatDocument(v: string | null | undefined): string {
  if (!v) return '';
  const n = normalizeCnpj(v);
  return n.length <= 11 && /^\d+$/.test(n) ? formatCpf(n) : formatCnpj(n);
}

/** Telefone brasileiro: DDD (11–99) + 8 dígitos (fixo) ou 9 dígitos iniciando com 9 (celular). Aceita +55. */
export function isValidPhoneBR(input: string): boolean {
  let d = onlyDigits(input);
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return false;
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return false;
  if (d.length === 11 && d[2] !== '9') return false;
  return true;
}

/** Normaliza telefone para formato internacional E.164 sem '+' (ex.: 5511999998888). */
export function toE164BR(input: string): string | null {
  if (!isValidPhoneBR(input)) return null;
  let d = onlyDigits(input);
  if (!(d.length >= 12 && d.startsWith('55'))) d = `55${d}`;
  return d;
}

export function formatPhoneBR(input: string): string {
  let d = onlyDigits(input);
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return input;
}

export function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.trim());
}

export function isValidCep(input: string): boolean {
  return /^\d{8}$/.test(onlyDigits(input));
}

export const VERIFICATION_STATUS = {
  nao_verificado: 'Não verificado',
  formato_valido: 'Formato válido',
  conferencia_manual: 'Conferência manual registrada',
  verificado_fonte_oficial: 'Verificado em fonte oficial',
  divergencia: 'Divergência cadastral',
  consulta_indisponivel: 'Consulta indisponível'
} as const;
export type VerificationStatus = keyof typeof VERIFICATION_STATUS;

/** Status inicial de verificação calculado localmente (somente formato). */
export function initialVerificationStatus(document: string | null | undefined): VerificationStatus {
  if (!document) return 'nao_verificado';
  const n = normalizeCnpj(document);
  const valid = n.length === 11 ? isValidCpf(n) : isValidCnpj(n);
  return valid ? 'formato_valido' : 'nao_verificado';
}

/** Chave para detecção de duplicidade (documento normalizado). */
export function documentKey(document: string | null | undefined): string | null {
  if (!document) return null;
  const n = normalizeCnpj(document);
  return n.length ? n : null;
}

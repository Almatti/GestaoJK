/**
 * Modelos de mensagens e links oficiais de WhatsApp (wa.me / click-to-chat).
 * O app NUNCA automatiza o WhatsApp Web. Abrir a conversa ≠ envio confirmado.
 */
import { toE164BR } from './documents';

export const TEMPLATE_VARIABLES = [
  'NOME_CLIENTE',
  'NOME_EMPRESA',
  'VALOR_ORIGINAL',
  'VALOR_ATUALIZADO',
  'DATA_VENCIMENTO',
  'DIAS_ATRASO',
  'DATA_ENCAMINHAMENTO',
  'CHAVE_PIX',
  'LINHA_DIGITAVEL',
  'NUMERO_PEDIDO',
  'DATA_VISITA',
  'HORARIO_VISITA',
  'NOME_RESPONSAVEL',
  'DATA_ENTREGA',
  'CODIGO_PIX'
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateValues = Partial<Record<TemplateVariable, string | number | null | undefined>>;

export function extractVariables(body: string): string[] {
  return [...new Set([...body.matchAll(/\[([A-Z_]+)\]/g)].map((m) => m[1]!))];
}

export interface RenderResult {
  text: string;
  missing: string[];
  unknown: string[];
}

export function renderTemplate(body: string, values: TemplateValues): RenderResult {
  const missing: string[] = [];
  const unknown: string[] = [];
  const text = body.replace(/\[([A-Z_]+)\]/g, (full, name: string) => {
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(name)) {
      unknown.push(name);
      return full;
    }
    const v = values[name as TemplateVariable];
    if (v === null || v === undefined || v === '') {
      missing.push(name);
      return full;
    }
    return String(v);
  });
  return { text, missing: [...new Set(missing)], unknown: [...new Set(unknown)] };
}

/** Link oficial https://wa.me/<número>?text=<mensagem codificada>. Retorna null para telefone inválido. */
export function whatsappLink(phone: string, message: string): string | null {
  const e164 = toE164BR(phone);
  if (!e164) return null;
  return `https://wa.me/${e164}?text=${encodeURIComponent(message)}`;
}

export const MESSAGE_STATUS = {
  gerada: 'Mensagem gerada',
  aberta: 'Aberta no WhatsApp',
  envio_informado: 'Envio informado pelo usuário',
  entregue_api: 'Entrega confirmada pela API',
  falha: 'Falha',
  cancelada: 'Cancelada'
} as const;
export type MessageStatus = keyof typeof MESSAGE_STATUS;

const MESSAGE_TRANSITIONS: Record<MessageStatus, MessageStatus[]> = {
  gerada: ['aberta', 'envio_informado', 'cancelada', 'falha'],
  aberta: ['envio_informado', 'cancelada', 'falha', 'aberta'],
  envio_informado: ['entregue_api', 'falha'],
  entregue_api: [],
  falha: ['gerada', 'cancelada'],
  cancelada: []
};

export function canTransitionMessage(from: MessageStatus, to: MessageStatus): boolean {
  return MESSAGE_TRANSITIONS[from].includes(to);
}

/** Chave de idempotência para a fila: evita gerar a mesma mensagem duas vezes no mesmo dia. */
export function messageDedupKey(templateKey: string, entityType: string, entityId: string, isoDate: string): string {
  return `${templateKey}:${entityType}:${entityId}:${isoDate}`;
}

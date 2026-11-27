/**
 * As 6 situações de boleto usadas pela empresa (uma única, sem ambiguidade):
 * - Em aberto: dentro do prazo (inclui pagamento parcial ainda no prazo).
 * - Vencido: passou do vencimento e não foi pago (protesto apenas programado continua "Vencido").
 * - Protesto: está no cartório (encaminhado, em cartório, protestado ou aguardando anuência/cancelamento) e o
 *   valor NÃO foi recebido. Só se resolve pelo cartório, com carta de anuência.
 * - Pago/ainda em protesto: o valor foi recebido (ex.: Pix), mas o título continua no cartório — o cliente
 *   precisa ir ao cartório pagar as custas e dar baixa. Não cobrar de novo.
 * - Pago: recebido e sem pendência no cartório (protesto cancelado ou nunca enviado).
 * - Cancelado: boleto cancelado ou baixado sem pagamento, ou título cancelado.
 */
import type { ProtestStatus } from './collections';

export type BoletoStatusKey = 'em_aberto' | 'vencido' | 'protesto' | 'pago_em_protesto' | 'pago' | 'cancelado';

export const BOLETO_STATUS: Record<BoletoStatusKey, { label: string; tone: 'success' | 'info' | 'danger' | 'warning' | 'neutral'; help: string }> = {
  em_aberto: { label: 'Em aberto', tone: 'info', help: 'Boleto em aberto e dentro do prazo.' },
  vencido: { label: 'Vencido', tone: 'danger', help: 'Passou do vencimento e não foi pago. Multa e juros correndo pela regra de cobrança.' },
  protesto: { label: 'Protesto', tone: 'danger', help: 'No cartório: não dá mais para receber pelo banco. O cliente resolve pelo cartório, com a carta de anuência.' },
  pago_em_protesto: { label: 'Pago/ainda em protesto', tone: 'warning', help: 'Você recebeu (ex.: Pix), mas o título continua no cartório. O cliente precisa ir ao cartório pagar as custas e dar baixa. Não cobre de novo.' },
  pago: { label: 'Pago', tone: 'success', help: 'Recebido e sem pendência no cartório.' },
  cancelado: { label: 'Cancelado', tone: 'neutral', help: 'Boleto cancelado (ou baixado sem pagamento).' }
};

/** Etapas em que o título está no cartório (o banco já não resolve). */
export const IN_NOTARY: readonly ProtestStatus[] = ['encaminhado', 'em_cartorio', 'protestado', 'aguardando_anuencia', 'aguardando_cancelamento', 'cancelamento_solicitado'];

export interface BoletoStatusInput {
  boletoStatus: string; // registrado | liquidado | baixado | cancelado
  receivableStatus: string; // em_aberto | parcialmente_pago | pago | cancelado | renegociado
  dueDate: string;
  today: string;
  protest: ProtestStatus | null;
}

export function boletoStatus(i: BoletoStatusInput): BoletoStatusKey {
  const paid = i.receivableStatus === 'pago' || i.boletoStatus === 'liquidado';
  const inNotary = !!i.protest && IN_NOTARY.includes(i.protest);
  if (paid) return inNotary ? 'pago_em_protesto' : 'pago';
  if (i.boletoStatus === 'cancelado' || i.boletoStatus === 'baixado' || i.receivableStatus === 'cancelado' || i.receivableStatus === 'renegociado') return 'cancelado';
  if (inNotary) return 'protesto';
  return i.dueDate < i.today ? 'vencido' : 'em_aberto';
}

/**
 * Caminho de etapas para registrar que o cliente já deu baixa no cartório (cada passo é uma transição válida).
 * Antes do protesto lavrado = retirado; depois = protesto cancelado.
 */
export function notaryReleasePath(current: ProtestStatus): ProtestStatus[] {
  switch (current) {
    case 'encaminhado':
    case 'em_cartorio': return ['retirado'];
    case 'protestado': return ['aguardando_anuencia', 'aguardando_cancelamento', 'protesto_cancelado'];
    case 'aguardando_anuencia': return ['aguardando_cancelamento', 'protesto_cancelado'];
    case 'aguardando_cancelamento':
    case 'cancelamento_solicitado': return ['protesto_cancelado'];
    default: return [];
  }
}

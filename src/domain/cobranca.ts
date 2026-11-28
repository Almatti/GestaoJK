/**
 * Mensagens de COBRANÇA por situação do título. Não agradecem nem confirmam pagamento: cobram.
 * Quem não tem título em aberto nunca recebe mensagem desta tela.
 */
export type CobrancaStage = 'a_vencer' | 'vencido' | 'cartorio' | 'protestado';

export const COBRANCA_STAGE: Record<CobrancaStage, { label: string; tone: 'info' | 'danger' | 'warning'; help: string }> = {
  a_vencer: { label: 'A vencer', tone: 'info', help: 'Vence nos próximos dias: lembrar antes do vencimento.' },
  vencido: { label: 'Vencido', tone: 'danger', help: 'Passou do vencimento e não foi pago: cobrar com valor atualizado.' },
  cartorio: { label: 'Em cartório', tone: 'warning', help: 'Já encaminhado ao cartório: cliente regulariza com a carta de anuência.' },
  protestado: { label: 'Protestado', tone: 'danger', help: 'Protesto lavrado: cliente cancela o protesto pelo cartório, com a carta de anuência.' }
};

export interface CobrancaValues {
  nome: string;
  empresa: string;
  valor: string;
  valorAtualizado: string;
  vencimento: string;
  diasAtraso: number;
  linhaDigitavel?: string | null;
}

export function cobrancaMessage(stage: CobrancaStage, v: CobrancaValues): string {
  const linha = v.linhaDigitavel ? ` Linha digitável: ${v.linhaDigitavel}.` : '';
  switch (stage) {
    case 'a_vencer':
      return `Olá, ${v.nome}! Lembrete: o título de ${v.valor} vence em ${v.vencimento}.${linha} Qualquer dúvida, estamos à disposição. — ${v.empresa}`;
    case 'vencido':
      return `Olá, ${v.nome}. O título de ${v.valor}, vencido em ${v.vencimento} (${v.diasAtraso} dia(s) de atraso), continua em aberto. Valor atualizado com multa e juros: ${v.valorAtualizado}.${linha} Pedimos a regularização. — ${v.empresa}`;
    case 'cartorio':
      return `Olá, ${v.nome}. O título de ${v.valorAtualizado}, vencido em ${v.vencimento}, foi encaminhado ao cartório. Para regularizar, entre em contato conosco para receber a carta de anuência e providenciar o pagamento e a baixa no cartório. — ${v.empresa}`;
    case 'protestado':
      return `Olá, ${v.nome}. O título de ${v.valorAtualizado}, vencido em ${v.vencimento}, está protestado. Para cancelar o protesto, entre em contato conosco para receber a carta de anuência e providenciar o pagamento e a baixa no cartório. — ${v.empresa}`;
  }
}

/** Situação do título para cobrança. null = não entra na cobrança (pago, cancelado, sem saldo ou fora das listas). */
export function cobrancaStage(input: { open: boolean; dueDate: string; today: string; dueSoonDays: number; protest: string | null }): CobrancaStage | null {
  if (!input.open) return null;
  const p = input.protest ?? 'nao_encaminhado';
  if (p === 'protestado') return 'protestado';
  if (['encaminhado', 'em_cartorio', 'aguardando_anuencia', 'aguardando_cancelamento', 'cancelamento_solicitado'].includes(p)) return 'cartorio';
  if (input.dueDate < input.today) return 'vencido';
  const limit = new Date(`${input.today}T12:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + input.dueSoonDays);
  if (input.dueDate <= limit.toISOString().slice(0, 10)) return 'a_vencer';
  return null;
}

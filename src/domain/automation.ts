/**
 * Motor de automações: Gatilho → Condição → Ação.
 * Idempotência: cada efeito tem chave (regra + entidade + janela). Execuções repetidas não duplicam efeitos.
 * Execução real ocorre no servidor (função SQL run_automations agendada via pg_cron / Edge Function).
 */
export const AUTOMATION_TRIGGERS = {
  boleto_vencendo: 'Boleto próximo do vencimento',
  boleto_vencido: 'Boleto vencido',
  protesto_proximo: 'Prazo de protesto próximo',
  pagamento_recebido: 'Pagamento recebido',
  pedido_confirmado: 'Pedido confirmado',
  cliente_cadastrado: 'Cliente cadastrado',
  queda_consumo: 'Queda no consumo',
  estoque_minimo: 'Estoque abaixo do mínimo',
  equipamento_ocioso: 'Equipamento ocioso',
  manutencao_proxima: 'Manutenção próxima',
  tarefa_vencida: 'Tarefa vencida',
  reuniao_concluida: 'Reunião concluída',
  fim_do_mes: 'Final do mês',
  meta_nao_atingida: 'Meta não atingida'
} as const;
export type AutomationTrigger = keyof typeof AUTOMATION_TRIGGERS;

export const AUTOMATION_ACTIONS = {
  criar_notificacao: 'Criar notificação',
  criar_tarefa: 'Criar tarefa',
  gerar_mensagem: 'Gerar mensagem (fila WhatsApp)',
  criar_compromisso: 'Criar compromisso',
  solicitar_aprovacao: 'Solicitar aprovação',
  sugerir_compra: 'Sugerir compra'
} as const;
export type AutomationAction = keyof typeof AUTOMATION_ACTIONS;

export type Window = 'dia' | 'semana' | 'mes' | 'unico';

export function windowBucket(window: Window, isoDate: string): string {
  if (window === 'unico') return 'unico';
  if (window === 'mes') return isoDate.slice(0, 7);
  if (window === 'semana') {
    const d = new Date(`${isoDate}T00:00:00Z`);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day);
    return `S${d.toISOString().slice(0, 10)}`;
  }
  return isoDate;
}

export function idempotencyKey(ruleId: string, entityType: string, entityId: string, window: Window, isoDate: string): string {
  return `${ruleId}|${entityType}|${entityId}|${windowBucket(window, isoDate)}`;
}

export interface Candidate {
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
}

export interface Condition {
  field: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
  value: unknown;
}

export function matches(data: Record<string, unknown>, conditions: Condition[]): boolean {
  return conditions.every((c) => {
    const v = data[c.field];
    switch (c.op) {
      case 'eq':
        return v === c.value;
      case 'neq':
        return v !== c.value;
      case 'gt':
        return Number(v) > Number(c.value);
      case 'gte':
        return Number(v) >= Number(c.value);
      case 'lt':
        return Number(v) < Number(c.value);
      case 'lte':
        return Number(v) <= Number(c.value);
      case 'in':
        return Array.isArray(c.value) && c.value.includes(v);
    }
  });
}

export interface PlannedEffect {
  key: string;
  candidate: Candidate;
}

/** Retorna somente os efeitos que ainda não foram executados (chaves não presentes em `done`). */
export function planEffects(
  ruleId: string,
  window: Window,
  isoDate: string,
  candidates: Candidate[],
  conditions: Condition[],
  done: ReadonlySet<string>
): PlannedEffect[] {
  const seen = new Set<string>();
  const out: PlannedEffect[] = [];
  for (const c of candidates) {
    if (!matches(c.data, conditions)) continue;
    const key = idempotencyKey(ruleId, c.entityType, c.entityId, window, isoDate);
    if (done.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, candidate: c });
  }
  return out;
}

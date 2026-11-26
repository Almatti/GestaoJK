/** Leitura e validação do backup do MODO LOCAL para importação no servidor. */
export const LOCAL_DB_KEY = 'jk-local-db-v1';
export const IMPORTED_FLAG_KEY = 'jk-local-imported-at';
const FORMAT = 'jk-chopp-gestao/backup-local';

export type LocalTables = Record<string, Record<string, unknown>[]>;

/** Aceita o arquivo de backup ({format, data}) ou, com `raw = true`, o conteúdo bruto salvo no navegador. */
export function parseLocalBackup(text: string, raw = false): LocalTables {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Arquivo não é um backup válido do JK CHOPP GESTÃO.');
  }
  const obj = parsed as { format?: string; data?: unknown };
  const data = (raw ? parsed : obj.format === FORMAT ? obj.data : null) as LocalTables | null;
  if (!data || typeof data !== 'object' || !Array.isArray(data.customers)) throw new Error('Arquivo não é um backup válido do JK CHOPP GESTÃO.');
  return data;
}

const LABELS: [string, string][] = [
  ['customers', 'cliente(s)'], ['products', 'produto(s)'], ['orders', 'pedido(s)'], ['receivables', 'título(s) a receber'],
  ['payables', 'conta(s) a pagar'], ['payments', 'pagamento(s)'], ['equipment', 'equipamento(s)'], ['service_orders', 'OS'],
  ['tasks', 'tarefa(s)'], ['calendar_events', 'compromisso(s)']
];

export function summarizeBackup(data: LocalTables): { total: number; text: string } {
  const parts = LABELS.map(([k, label]) => [data[k]?.length ?? 0, label] as const).filter(([n]) => n > 0);
  return { total: parts.reduce((s, [n]) => s + n, 0), text: parts.map(([n, l]) => `• ${n} ${l}`).join('\n') || '• nenhum registro' };
}

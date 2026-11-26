/**
 * Configuração por variáveis de ambiente (ver .env.example).
 * Somente a chave PÚBLICA (anon/publishable) do Supabase vai para o frontend. Nunca a service_role.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const mode = (import.meta.env.VITE_APP_MODE as string | undefined) ?? 'auto';

export const env = {
  supabaseUrl: url ?? '',
  supabaseAnonKey: anonKey ?? '',
  /** 'demo' força o ambiente de demonstração (dados fictícios no navegador). */
  appMode: mode,
  isSupabaseConfigured: Boolean(url && anonKey),
  appName: 'JK CHOPP GESTÃO'
} as const;

/** URL absoluta de uma rota interna (considera o roteamento por hash usado na hospedagem estática). */
export function appUrl(path: string): string {
  if (import.meta.env.VITE_ROUTER === 'hash') return `${location.href.split('#')[0]}#${path}`;
  return `${location.origin}${path}`;
}

export type DataMode = 'supabase' | 'demo' | 'local' | 'unconfigured';

/**
 * 'local' = uso real sem servidor: dados da empresa salvos apenas neste navegador (sem dados fictícios),
 * com backup/restauração por arquivo e migração futura para o Supabase.
 */
export function resolveDataMode(): DataMode {
  if (env.appMode === 'demo') return 'demo';
  if (env.isSupabaseConfigured) return 'supabase';
  if (env.appMode === 'local') return 'local';
  try {
    if (localStorage.getItem('jk-local-enabled') === '1') return 'local';
    if (localStorage.getItem('jk-demo-enabled') === '1') return 'demo';
  } catch {
    /* armazenamento indisponível */
  }
  return 'unconfigured';
}

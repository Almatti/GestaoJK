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

export function resolveDataMode(): 'supabase' | 'demo' | 'unconfigured' {
  if (env.appMode === 'demo') return 'demo';
  if (env.isSupabaseConfigured) return 'supabase';
  try {
    if (localStorage.getItem('jk-demo-enabled') === '1') return 'demo';
  } catch {
    /* armazenamento indisponível */
  }
  return 'unconfigured';
}

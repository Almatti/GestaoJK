import { resolveDataMode } from '@/config/env';
import type { DataClient } from './types';
import { createSupabaseDataClient } from './supabaseClient';
import { createDemoDataClient } from './demo/client';

let instance: DataClient | null = null;

export function getDataClient(): DataClient {
  if (instance) return instance;
  const mode = resolveDataMode();
  if (mode === 'unconfigured') throw new Error('Supabase não configurado');
  instance = mode === 'supabase' ? createSupabaseDataClient() : createDemoDataClient(mode);
  return instance;
}

/** Para testes. */
export function setDataClient(c: DataClient | null) {
  instance = c;
}

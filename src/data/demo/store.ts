/**
 * AMBIENTE DE DEMONSTRAÇÃO — banco em memória persistido no navegador (localStorage), com dados FICTÍCIOS.
 * Nunca usado em produção. A fonte de verdade das regras em produção são as funções SQL do Supabase.
 */
import type { Row } from '../types';

const KEY = 'jk-demo-db-v1';
export type Tables = Record<string, Row[]>;

let db: Tables | null = null;

export function uid(): string {
  return crypto.randomUUID();
}

export function loadDb(seed: () => Tables): Tables {
  if (db) return db;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) db = JSON.parse(raw) as Tables;
  } catch {
    db = null;
  }
  if (!db) {
    db = seed();
    saveDb();
  }
  return db;
}

export function saveDb(): void {
  try {
    if (db) localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* sem armazenamento: mantém em memória */
  }
}

export function resetDb(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  db = null;
}

export function table(name: string): Row[] {
  if (!db) throw new Error('Demo DB não carregado');
  return (db[name] ??= []);
}

export const nowIso = () => new Date().toISOString();

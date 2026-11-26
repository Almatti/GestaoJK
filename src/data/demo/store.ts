/**
 * AMBIENTE DE DEMONSTRAÇÃO — banco em memória persistido no navegador (localStorage), com dados FICTÍCIOS.
 * Nunca usado em produção. A fonte de verdade das regras em produção são as funções SQL do Supabase.
 */
import type { Row } from '../types';

let KEY = 'jk-demo-db-v1';

/** Chave de armazenamento: 'jk-demo-db-v1' (demonstração) ou 'jk-local-db-v1' (uso real local). */
export function setStoreKey(k: string) {
  KEY = k;
}

export function exportDb(): Tables {
  if (!db) throw new Error('Banco local não carregado');
  return structuredClone(db);
}

/** Substitui todo o banco local pelo conteúdo de um backup. */
export function importDb(data: Tables) {
  db = structuredClone(data);
  saveDb();
}

/** Tamanho aproximado ocupado (bytes). */
export function dbSize(): number {
  try {
    return (localStorage.getItem(KEY) ?? '').length * 2;
  } catch {
    return 0;
  }
}
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
  if (!db) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    // Não silenciar no modo local: o usuário precisa saber que o dado NÃO foi gravado.
    throw new Error('Não foi possível salvar no armazenamento deste navegador (espaço cheio ou bloqueado). Faça um backup em Administração → Backups.');
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

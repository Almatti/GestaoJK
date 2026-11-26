export type Row = Record<string, unknown> & { id?: string };

export type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is' | 'ilike' | 'not_in';
export interface Filter {
  column: string;
  op: FilterOp;
  value: unknown;
}

export interface ListOptions {
  /** Sintaxe PostgREST. Para relações use SEMPRE a forma alias:tabela(colunas), onde alias + "_id" é a FK. */
  select?: string;
  filters?: Filter[];
  search?: { columns: string[]; term: string };
  order?: { column: string; ascending?: boolean }[];
  range?: [number, number];
  count?: boolean;
}

export interface ListResult<T> {
  rows: T[];
  count: number | null;
}

export interface SessionUser {
  id: string;
  email: string;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  role: import('@/domain/permissions').Role;
  active: boolean;
  preferences: Record<string, unknown>;
}

export interface AuthAdapter {
  getUser(): Promise<SessionUser | null>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  onChange(cb: (user: SessionUser | null) => void): () => void;
}

export interface StorageAdapter {
  upload(path: string, file: File): Promise<void>;
  signedUrl(path: string, expiresInSeconds?: number): Promise<string>;
}

export interface DataClient {
  mode: 'supabase' | 'demo';
  list<T = Row>(table: string, opts?: ListOptions): Promise<ListResult<T>>;
  get<T = Row>(table: string, id: string, select?: string): Promise<T | null>;
  insert<T = Row>(table: string, values: Row | Row[]): Promise<T>;
  update<T = Row>(table: string, id: string, values: Row, idColumn?: string): Promise<T>;
  remove(table: string, id: string): Promise<void>;
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>;
  invoke<T = unknown>(edgeFunction: string, body: unknown): Promise<T>;
  auth: AuthAdapter;
  storage: StorageAdapter;
}

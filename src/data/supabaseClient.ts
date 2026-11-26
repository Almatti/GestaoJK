import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/config/env';
import type { DataClient, ListOptions, Row } from './types';

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  return client;
}

function check<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}

const escapeLike = (v: string) => v.replace(/[%_,()]/g, ' ');

export function createSupabaseDataClient(): DataClient {
  const sb = supabase();
  return {
    mode: 'supabase',
    async list<T>(table: string, opts: ListOptions = {}) {
      let q = sb.from(table).select(opts.select ?? '*', { count: opts.count ? 'exact' : undefined });
      for (const f of opts.filters ?? []) {
        if (f.value === undefined || f.value === '') continue;
        if (f.op === 'in') q = q.in(f.column, f.value as unknown[]);
        else if (f.op === 'not_in') q = q.not(f.column, 'in', `(${(f.value as unknown[]).join(',')})`);
        else if (f.op === 'is') q = q.is(f.column, f.value as null);
        else q = q.filter(f.column, f.op, f.value as string);
      }
      if (opts.search?.term.trim()) {
        const term = escapeLike(opts.search.term.trim());
        q = q.or(opts.search.columns.map((c) => `${c}.ilike.%${term}%`).join(','));
      }
      for (const o of opts.order ?? []) q = q.order(o.column, { ascending: o.ascending ?? true, nullsFirst: false });
      if (opts.range) q = q.range(opts.range[0], opts.range[1]);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as T[], count: count ?? null };
    },
    async get<T>(table: string, id: string, select = '*') {
      return check(await sb.from(table).select(select).eq('id', id).maybeSingle()) as T | null;
    },
    async insert<T>(table: string, values: Row | Row[]) {
      const res = await sb.from(table).insert(values).select();
      return (check(res) as T[])[0] as T;
    },
    async update<T>(table: string, id: string, values: Row, idColumn = 'id') {
      return check(await sb.from(table).update(values).eq(idColumn, id).select().single()) as T;
    },
    async remove(table: string, id: string) {
      check(await sb.from(table).delete().eq('id', id));
    },
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      return check(await sb.rpc(fn, args)) as T;
    },
    async invoke<T>(fn: string, body: unknown) {
      const { data, error } = await sb.functions.invoke(fn, { body: body as Record<string, unknown> });
      if (error) throw error;
      return data as T;
    },
    auth: {
      async getUser() {
        const { data } = await sb.auth.getSession();
        const u = data.session?.user;
        return u ? { id: u.id, email: u.email ?? '' } : null;
      },
      async signIn(email, password) {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha inválidos.' : error.message);
      },
      async signOut() {
        await sb.auth.signOut();
      },
      async resetPassword(email) {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/redefinir-senha` });
        if (error) throw error;
      },
      async updatePassword(password) {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
      },
      onChange(cb) {
        const { data } = sb.auth.onAuthStateChange((_e, session) => cb(session?.user ? { id: session.user.id, email: session.user.email ?? '' } : null));
        return () => data.subscription.unsubscribe();
      }
    },
    storage: {
      async upload(path, file) {
        const { error } = await sb.storage.from('documentos').upload(path, file, { upsert: false });
        if (error) throw error;
      },
      async signedUrl(path, expires = 300) {
        const { data, error } = await sb.storage.from('documentos').createSignedUrl(path, expires);
        if (error) throw error;
        return data.signedUrl;
      }
    }
  };
}

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { getDataClient } from './client';
import type { ListOptions, ListResult, Row } from './types';

export const db = () => getDataClient();

export function useList<T = Row>(table: string, opts: ListOptions = {}, extra?: Partial<UseQueryOptions<ListResult<T>>>) {
  return useQuery<ListResult<T>>({ queryKey: [table, 'list', opts], queryFn: () => db().list<T>(table, opts), ...extra });
}

export function useRecord<T = Row>(table: string, id: string | undefined, select?: string) {
  return useQuery<T | null>({ queryKey: [table, 'one', id, select], queryFn: () => db().get<T>(table, id!, select), enabled: !!id });
}

export function useRpc<T>(fn: string, args: Record<string, unknown>, enabled = true) {
  return useQuery<T>({ queryKey: ['rpc', fn, args], queryFn: () => db().rpc<T>(fn, args), enabled });
}

/** Invalida tudo após mutações que afetam vários módulos (uma informação alimenta todos os módulos). */
export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useSave(table: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: Row }) => (id ? db().update(table, id, values) : db().insert(table, values)),
    onSuccess: invalidate
  });
}

export function useRpcMutation<TArgs extends Record<string, unknown>, TResult = unknown>(fn: string) {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (args: TArgs) => db().rpc<TResult>(fn, args), onSuccess: invalidate });
}

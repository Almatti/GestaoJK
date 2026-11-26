import { useState } from 'react';
import { useList } from '@/data/hooks';
import type { Row } from '@/data/types';
import { PageHeader, Card } from '@/components/ui/Layout';
import { Badge, EmptyState, LoadingBlock } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Overlay';
import { formatDateTimeBR } from '@/domain/dates';

const TABLES = ['customers', 'orders', 'receivables', 'payables', 'payments', 'boletos', 'protest_records', 'partner_ledger', 'equipment', 'service_orders', 'products', 'commercial_conditions', 'customer_product_prices', 'collection_rules', 'settings', 'profiles', 'financial_transactions'];

/** Trilha de auditoria (somente leitura). Documentos pessoais são mascarados nos registros. */
export function AuditPage() {
  const [table, setTable] = useState('');
  const [action, setAction] = useState('');
  const [open, setOpen] = useState<Row | null>(null);
  const q = useList<Row>('audit_logs', { filters: [...(table ? [{ column: 'table_name', op: 'eq' as const, value: table }] : []), ...(action ? [{ column: 'action', op: 'eq' as const, value: action }] : [])], order: [{ column: 'occurred_at', ascending: false }], range: [0, 299] });
  const profiles = useList<Row>('profiles', { select: 'id,full_name,email' });
  const who = (id: unknown) => { const p = profiles.data?.rows.find((x) => x.id === id); return p ? String(p.full_name || p.email) : id ? 'Usuário' : 'Sistema'; };
  return (
    <div className="animate-fade-in">
      <PageHeader title="Auditoria" subtitle="Registro imutável de inclusões, alterações e justificativas (estornos, exceções de margem, renegociações)." />
      <div className="card mb-4 flex flex-wrap gap-2 p-3">
        <select aria-label="Tabela" className="input h-10 w-auto py-0 text-sm" value={table} onChange={(e) => setTable(e.target.value)}><option value="">Todas as tabelas</option>{TABLES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <select aria-label="Ação" className="input h-10 w-auto py-0 text-sm" value={action} onChange={(e) => setAction(e.target.value)}><option value="">Todas as ações</option><option value="insert">Inclusão</option><option value="update">Alteração</option><option value="delete">Exclusão</option></select>
      </div>
      {q.isLoading ? <Card opaque><LoadingBlock /></Card> : (q.data?.rows ?? []).length === 0 ? <Card><EmptyState title="Sem registros" /></Card> : (
        <div className="surface overflow-x-auto rounded-[var(--radius-card)]">
          <table className="w-full min-w-[720px] text-sm"><thead className="bg-cream-100 text-left text-xs uppercase text-cocoa-700"><tr><th className="px-4 py-3">Quando</th><th className="px-4 py-3">Quem</th><th className="px-4 py-3">Tabela</th><th className="px-4 py-3">Ação</th><th className="px-4 py-3">Justificativa</th></tr></thead>
            <tbody>{q.data!.rows.map((a) => (
              <tr key={String(a.id)} className="cursor-pointer border-t border-tangerine-100 hover:bg-cream-100/60" onClick={() => setOpen(a)}>
                <td className="px-4 py-2.5 text-xs">{formatDateTimeBR(a.occurred_at as string)}</td><td className="px-4 py-2.5">{who(a.user_id)}</td><td className="px-4 py-2.5">{String(a.table_name)}</td>
                <td className="px-4 py-2.5"><Badge tone={a.action === 'delete' ? 'danger' : a.action === 'insert' ? 'success' : 'info'}>{String(a.action)}</Badge></td><td className="px-4 py-2.5 text-xs">{String(a.reason ?? '')}</td>
              </tr>))}</tbody></table>
        </div>
      )}
      {open && (
        <Modal open onClose={() => setOpen(null)} title="Detalhe da auditoria" size="lg">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div><p className="label">Antes</p><pre className="max-h-96 overflow-auto rounded-xl bg-cream-100 p-3 text-xs">{JSON.stringify(open.old_data, null, 2)}</pre></div>
            <div><p className="label">Depois</p><pre className="max-h-96 overflow-auto rounded-xl bg-cream-100 p-3 text-xs">{JSON.stringify(open.new_data, null, 2)}</pre></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

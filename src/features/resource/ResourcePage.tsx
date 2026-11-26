import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { clsx } from 'clsx';
import { Archive, ArrowDownUp, ChevronLeft, ChevronRight, Download, LayoutGrid, Plus, Rows3, Search, FileSpreadsheet, Printer, Pencil, Trash2 } from 'lucide-react';
import { useList, useSave, db, useInvalidateAll } from '@/data/hooks';
import type { Filter, Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, ErrorState, LoadingBlock, friendlyError } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/Layout';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { formatCell } from '@/lib/format';
import { exportCsv, exportExcel, exportPdf } from '@/lib/export';
import { ResourceForm } from './ResourceForm';
import type { ColumnDef, ResourceDef } from './types';

const PAGE = 25;

function usePersisted<T extends string>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T) ?? initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* ignore */
    }
  }, [key, v]);
  return [v, setV] as const;
}

export function renderCell(def: ResourceDef, c: ColumnDef, row: Row): ReactNode {
  if (c.render) return c.render(row);
  if (def.status && c.key === def.status.column) {
    const s = def.status.map[String(row[c.key])];
    return s ? <Badge tone={s.tone}>{s.label}</Badge> : formatCell(row[c.key]);
  }
  const v = c.key.includes('.') ? c.key.split('.').reduce<unknown>((o, k) => (o as Row | null)?.[k], row) : row[c.key];
  return formatCell(v, c.format);
}

export function ResourcePage({ def, headerExtra, toolbarExtra }: { def: ResourceDef; headerExtra?: ReactNode; toolbarExtra?: ReactNode }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(0);
  const [order, setOrder] = useState(def.defaultOrder ?? [{ column: 'created_at', ascending: false }]);
  const [filterValues, setFilterValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((def.filters ?? []).map((f) => [f.column, params.get(f.column) ?? '']))
  );
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = usePersisted<'table' | 'cards'>(`jk-view:${def.table}`, 'table');
  const [editing, setEditing] = useState<Row | null>(null);
  const [formOpen, setFormOpen] = useState(params.get('novo') === '1');
  const [archiving, setArchiving] = useState<Row | null>(null);
  const save = useSave(def.table);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(term);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [term]);

  const filters: Filter[] = useMemo(() => {
    const f: Filter[] = [...(def.baseFilters ?? [])];
    for (const [column, value] of Object.entries(filterValues)) if (value) f.push({ column, op: 'eq', value });
    if (def.archive && !showArchived) f.push({ column: def.archive.column, op: 'neq', value: def.archive.value });
    return f;
  }, [def, filterValues, showArchived]);

  const opts = { select: def.select, filters, search: { columns: def.searchColumns, term: debounced }, order, range: [page * PAGE, page * PAGE + PAGE - 1] as [number, number], count: true };
  const q = useList<Row>(def.table, opts);
  const rows = q.data?.rows ?? [];
  const total = q.data?.count ?? 0;
  const canCreate = can(def.resource, 'create') && (def.fields.length > 0 || !!def.renderForm);
  const canEdit = can(def.resource, 'edit');

  const openRow = (r: Row) => {
    if (def.rowLink) navigate(def.rowLink(r));
    else if (canEdit) {
      setEditing(r);
      setFormOpen(true);
    }
  };

  const toggleSort = (col: string) =>
    setOrder((o) => (o[0]?.column === col ? [{ column: col, ascending: !o[0].ascending }] : [{ column: col, ascending: true }]));

  const doExport = async (kind: 'csv' | 'xls' | 'pdf') => {
    try {
      const all = await db().list<Row>(def.table, { ...opts, range: [0, 4999] });
      const cols = def.columns.map((c) => ({ key: c.key, label: c.label, format: c.format, value: c.exportValue ?? (def.status?.column === c.key ? (r: Row) => def.status!.map[String(r[c.key])]?.label ?? r[c.key] : undefined) }));
      const name = `${def.title.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}`;
      if (kind === 'csv') exportCsv(name, all.rows, cols);
      else if (kind === 'xls') exportExcel(name, all.rows, cols);
      else exportPdf(def.title, all.rows, cols);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  const doArchive = async () => {
    if (!archiving || !def.archive) return;
    try {
      await save.mutateAsync({ id: String(archiving[def.idColumn ?? 'id']), values: { [def.archive.column]: def.archive.value } });
      toast(`${def.singular} arquivado(a). O histórico foi preservado.`);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
    setArchiving(null);
  };

  const doDelete = async (r: Row) => {
    if (!confirm(`Excluir este registro de ${def.singular.toLowerCase()}?`)) return;
    try {
      await db().remove(def.table, String(r.id));
      invalidate();
      toast('Registro excluído.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={def.title}
        subtitle={def.subtitle}
        actions={
          <>
            {headerExtra}
            {can(def.resource, 'export') && (
              <div className="flex gap-1">
                <Button variant="secondary" size="sm" icon={<Download className="size-4" />} onClick={() => doExport('csv')} title="Exportar CSV">CSV</Button>
                <Button variant="secondary" size="sm" icon={<FileSpreadsheet className="size-4" />} onClick={() => doExport('xls')} title="Exportar Excel">Excel</Button>
                <Button variant="secondary" size="sm" icon={<Printer className="size-4" />} onClick={() => doExport('pdf')} title="Imprimir / PDF">PDF</Button>
              </div>
            )}
            {canCreate && <Button icon={<Plus className="size-4" />} onClick={() => { setEditing(null); setFormOpen(true); }}>Novo(a) {def.singular.toLowerCase()}</Button>}
          </>
        }
      />

      <div className="card mb-4 flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-cocoa-700" aria-hidden />
          <input className="input pl-10" placeholder={`Buscar em ${def.title.toLowerCase()}…`} value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Buscar" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(def.filters ?? []).map((f) => (
            <select key={f.column} aria-label={f.label} className="input h-11 w-auto py-0 pr-8 text-sm" value={filterValues[f.column] ?? ''}
              onChange={(e) => { setFilterValues((s) => ({ ...s, [f.column]: e.target.value })); setPage(0); const p = new URLSearchParams(params); if (e.target.value) p.set(f.column, e.target.value); else p.delete(f.column); setParams(p, { replace: true }); }}>
              <option value="">{f.label}: todos</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ))}
          {def.archive && (
            <label className="flex items-center gap-2 rounded-full bg-white/60 px-3 py-2 text-sm">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-[var(--color-tangerine-800)]" /> Arquivados
            </label>
          )}
          {toolbarExtra}
          <div className="flex rounded-full bg-white/60 p-1" role="group" aria-label="Visualização">
            <button className={clsx('rounded-full p-2', view === 'table' && 'bg-white shadow')} aria-pressed={view === 'table'} aria-label="Tabela" onClick={() => setView('table')}><Rows3 className="size-4" /></button>
            <button className={clsx('rounded-full p-2', view === 'cards' && 'bg-white shadow')} aria-pressed={view === 'cards'} aria-label="Cards" onClick={() => setView('cards')}><LayoutGrid className="size-4" /></button>
          </div>
        </div>
      </div>

      {q.isLoading ? (
        <div className="surface rounded-[var(--radius-card)] p-4"><LoadingBlock rows={6} /></div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title={debounced || Object.values(filterValues).some(Boolean) ? 'Nenhum resultado para os filtros aplicados' : `Nenhum(a) ${def.singular.toLowerCase()} cadastrado(a)`}
            description={def.emptyHint ?? 'Os registros aparecerão aqui assim que forem cadastrados.'}
            action={canCreate && !debounced ? <Button icon={<Plus className="size-4" />} onClick={() => { setEditing(null); setFormOpen(true); }}>Cadastrar {def.singular.toLowerCase()}</Button> : undefined}
          />
        </div>
      ) : view === 'cards' ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <li key={String(r[def.idColumn ?? 'id'])}>
              <button onClick={() => openRow(r)} className="card card-sm block w-full text-left transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
                <p className="font-display font-bold">{def.cardTitle ? def.cardTitle(r) : renderCell(def, def.columns[0]!, r)}</p>
                {def.cardSubtitle && <p className="mt-0.5 text-sm text-cocoa-700">{def.cardSubtitle(r)}</p>}
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  {def.columns.slice(1, 5).map((c) => (
                    <div key={c.key} className="min-w-0"><dt className="text-xs text-cocoa-700">{c.label}</dt><dd className="num truncate">{renderCell(def, c, r)}</dd></div>
                  ))}
                </dl>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="surface overflow-hidden rounded-[var(--radius-card)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-cocoa-700">
                <tr>
                  {def.columns.map((c) => (
                    <th key={c.key} scope="col" className={clsx('px-4 py-3 font-semibold', c.align === 'right' && 'text-right', c.hideOnMobile && 'hidden md:table-cell')}
                      aria-sort={order[0]?.column === c.key ? (order[0].ascending ? 'ascending' : 'descending') : undefined}>
                      {c.sortable === false || c.render ? c.label : (
                        <button className="inline-flex items-center gap-1 hover:text-tangerine-900" onClick={() => toggleSort(c.key)}>{c.label}<ArrowDownUp className="size-3" aria-hidden /></button>
                      )}
                    </th>
                  ))}
                  <th className="w-px px-2"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={String(r[def.idColumn ?? 'id'])} className="cursor-pointer border-t border-tangerine-100 transition-colors hover:bg-cream-100/70" onClick={() => openRow(r)}>
                    {def.columns.map((c) => (
                      <td key={c.key} className={clsx('px-4 py-3 align-middle', c.align === 'right' && 'num text-right', c.hideOnMobile && 'hidden md:table-cell')}>{renderCell(def, c, r)}</td>
                    ))}
                    <td className="whitespace-nowrap px-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {def.rowActions?.(r)}
                        {canEdit && def.rowLink && <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => { setEditing(r); setFormOpen(true); }} icon={<Pencil className="size-4" />} />}
                        {def.archive && can(def.resource, 'archive') && r[def.archive.column] !== def.archive.value && (
                          <Button variant="ghost" size="icon" aria-label="Arquivar" title="Arquivar" onClick={() => setArchiving(r)} icon={<Archive className="size-4" />} />
                        )}
                        {def.allowDelete && canEdit && <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => doDelete(r)} icon={<Trash2 className="size-4" />} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {total > PAGE && (
        <div className="mt-4 flex items-center justify-between text-sm text-cocoa-700">
          <span className="num">{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} de {total}</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} icon={<ChevronLeft className="size-4" />}>Anterior</Button>
            <Button variant="secondary" size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Próxima<ChevronRight className="size-4" /></Button>
          </div>
        </div>
      )}

      {(() => {
        const close = () => { setFormOpen(false); if (params.get('novo')) { const p = new URLSearchParams(params); p.delete('novo'); setParams(p, { replace: true }); } };
        return def.renderForm ? def.renderForm({ row: editing, open: formOpen, onClose: close }) : <ResourceForm def={def} row={editing} open={formOpen} onClose={close} />;
      })()}
      <ConfirmDialog open={!!archiving} title={`Arquivar ${def.singular.toLowerCase()}?`} message="O registro deixa de aparecer nas listas, mas todo o histórico é preservado e pode ser consultado em “Arquivados”."
        confirmLabel="Arquivar" onConfirm={doArchive} onCancel={() => setArchiving(null)} loading={save.isPending} />
    </div>
  );
}

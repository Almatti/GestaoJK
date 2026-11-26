import { useState } from 'react';
import { useParams } from 'react-router';
import { PackageCheck, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { useList, useRecord, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, LoadingBlock, friendlyError, ErrorState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Overlay';
import { SelectInput, TextInput } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { PURCHASE_STATUS } from '@/features/resource/definitions';
import { formatReais, formatNumber } from '@/domain/money';

export function PurchaseDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const p = useRecord<Row>('purchases', id, '*,supplier:suppliers(name)');
  const items = useList<Row>('purchase_items', { select: '*,stock_item:stock_items(name,unit_cost)', filters: [{ column: 'purchase_id', op: 'eq', value: id }] });
  const stock = useList<Row>('stock_items', { filters: [{ column: 'status', op: 'eq', value: 'ativo' }], order: [{ column: 'name' }], range: [0, 999] });
  const quotes = useList<Row>('purchase_quotes', { select: '*,supplier:suppliers(name)', filters: [{ column: 'purchase_id', op: 'eq', value: id }], order: [{ column: 'total' }] });
  const suppliers = useList<Row>('suppliers', { filters: [{ column: 'status', op: 'eq', value: 'ativo' }] });
  const [n, setN] = useState({ item: '', qty: '1', cost: '', lot: '', exp: '' });
  const [q, setQ] = useState({ supplier: '', total: '', lead: '' });
  const [receiving, setReceiving] = useState(false);

  if (p.isLoading) return <Card opaque><LoadingBlock /></Card>;
  if (p.isError) return <ErrorState error={p.error} />;
  if (!p.data) return <Card><EmptyState title="Compra não encontrada" /></Card>;
  const pu = p.data;
  const draft = ['solicitada', 'cotacao'].includes(String(pu.status));
  const total = (items.data?.rows ?? []).reduce((s, i) => s + Number(i.quantity) * Number(i.unit_cost), 0);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      invalidate();
      toast(msg);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  // Impacto nas margens: compara custo cotado com custo atual do item.
  const costDiff = (i: Row) => { const cur = Number((i.stock_item as Row | null)?.unit_cost ?? 0); return cur ? ((Number(i.unit_cost) - cur) / cur) * 100 : null; };

  return (
    <div className="animate-fade-in">
      <PageHeader breadcrumbs={[{ label: 'Compras', to: '/compras' }, { label: `Nº ${String(pu.number)}` }]} title={`Compra nº ${String(pu.number)}`} subtitle={<span className="flex items-center gap-2"><Badge tone="info">{PURCHASE_STATUS[pu.status as keyof typeof PURCHASE_STATUS]}</Badge>{String((pu.supplier as Row | null)?.name ?? 'Fornecedor não definido')}</span>}
        actions={<>
          {draft && can('estoque', 'edit') && <Button variant="secondary" icon={<CheckCircle2 className="size-4" />} onClick={() => act(() => db().update('purchases', String(pu.id), { status: 'aprovada', total }), 'Compra aprovada.')}>Aprovar</Button>}
          {['aprovada', 'pedido_enviado', 'recebida_parcial'].includes(String(pu.status)) && can('estoque', 'edit') && <Button icon={<PackageCheck className="size-4" />} onClick={() => setReceiving(true)}>Registrar recebimento</Button>}
        </>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card opaque className="lg:col-span-2" title={`Itens · total ${formatReais(total)}`}>
          {(items.data?.rows ?? []).length === 0 ? <EmptyState title="Sem itens" /> : (
            <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-cocoa-700"><tr><th className="py-2">Item</th><th className="text-right">Qtd.</th><th className="text-right">Recebido</th><th className="text-right">Custo unit.</th><th className="text-right">Variação</th><th /></tr></thead>
              <tbody>{items.data!.rows.map((i) => { const d = costDiff(i); return (
                <tr key={String(i.id)} className="border-t border-tangerine-100"><td className="py-2">{String((i.stock_item as Row | null)?.name ?? '')}</td><td className="num text-right">{formatNumber(Number(i.quantity))}</td><td className="num text-right">{formatNumber(Number(i.received_quantity))}</td><td className="num text-right">{formatReais(i.unit_cost as number)}</td>
                  <td className="num text-right">{d === null ? '—' : <span className={d > 0 ? 'text-danger-700' : 'text-success-700'}>{d > 0 ? '+' : ''}{d.toFixed(1)}%</span>}</td>
                  <td>{draft && <Button size="icon" variant="ghost" aria-label="Remover" icon={<Trash2 className="size-4" />} onClick={() => act(() => db().remove('purchase_items', String(i.id)), 'Item removido.')} />}</td></tr>); })}</tbody></table>
          )}
          {(items.data?.rows ?? []).some((i) => (costDiff(i) ?? 0) > 0) && <div className="mt-3"><Alert tone="warning">Há aumento de custo em relação ao custo atual. Revise preços e margens dos produtos afetados.</Alert></div>}
          {draft && can('estoque', 'edit') && (
            <div className="mt-4 grid grid-cols-2 items-end gap-2 sm:grid-cols-6">
              <SelectInput wrapperClassName="col-span-2" label="Item" placeholder="Selecione…" value={n.item} onChange={(e) => setN((s) => ({ ...s, item: e.target.value }))} options={(stock.data?.rows ?? []).map((s) => ({ value: String(s.id), label: String(s.name) }))} />
              <TextInput label="Qtd." type="number" value={n.qty} onChange={(e) => setN((s) => ({ ...s, qty: e.target.value }))} />
              <TextInput label="Custo unit." type="number" step="0.01" value={n.cost} onChange={(e) => setN((s) => ({ ...s, cost: e.target.value }))} />
              <TextInput label="Lote" value={n.lot} onChange={(e) => setN((s) => ({ ...s, lot: e.target.value }))} />
              <Button icon={<Plus className="size-4" />} disabled={!n.item} onClick={() => act(() => db().insert('purchase_items', { purchase_id: pu.id, stock_item_id: n.item, quantity: Number(n.qty), unit_cost: Number(n.cost || 0), lot_code: n.lot || null, expires_at: n.exp || null }), 'Item adicionado.').then(() => setN({ item: '', qty: '1', cost: '', lot: '', exp: '' }))}>Adicionar</Button>
            </div>
          )}
        </Card>
        <Card opaque title="Cotações (comparação de fornecedores)">
          {(quotes.data?.rows ?? []).length === 0 ? <p className="text-sm text-cocoa-700">Nenhuma cotação.</p> : (
            <ul className="space-y-2 text-sm">{quotes.data!.rows.map((x, i) => <li key={String(x.id)} className="flex items-center justify-between gap-2 rounded-xl bg-cream-100 p-2"><span>{String((x.supplier as Row | null)?.name ?? '')}{i === 0 && <Badge className="ml-2" tone="success">Menor preço</Badge>}</span><span className="num">{formatReais(x.total as number)}{x.lead_time_days ? ` · ${String(x.lead_time_days)}d` : ''}</span></li>)}</ul>
          )}
          {draft && can('estoque', 'edit') && (
            <div className="mt-3 space-y-2">
              <SelectInput label="Fornecedor" placeholder="Selecione…" value={q.supplier} onChange={(e) => setQ((s) => ({ ...s, supplier: e.target.value }))} options={(suppliers.data?.rows ?? []).map((s) => ({ value: String(s.id), label: String(s.name) }))} />
              <div className="grid grid-cols-2 gap-2"><TextInput label="Total (R$)" type="number" step="0.01" value={q.total} onChange={(e) => setQ((s) => ({ ...s, total: e.target.value }))} /><TextInput label="Prazo (dias)" type="number" value={q.lead} onChange={(e) => setQ((s) => ({ ...s, lead: e.target.value }))} /></div>
              <Button size="sm" variant="soft" disabled={!q.supplier || !q.total} onClick={() => act(() => db().insert('purchase_quotes', { purchase_id: pu.id, supplier_id: q.supplier, total: Number(q.total), lead_time_days: q.lead ? Number(q.lead) : null }).then(() => db().update('purchases', String(pu.id), { status: 'cotacao' })), 'Cotação registrada.')}>Adicionar cotação</Button>
            </div>
          )}
        </Card>
      </div>
      {receiving && <ReceiveDialog purchaseId={String(pu.id)} items={items.data?.rows ?? []} onClose={() => setReceiving(false)} />}
    </div>
  );
}

function ReceiveDialog({ purchaseId, items, onClose }: { purchaseId: string; items: Row[]; onClose: () => void }) {
  const pending = items.filter((i) => Number(i.received_quantity) < Number(i.quantity));
  const [q, setQ] = useState<Record<string, string>>(Object.fromEntries(pending.map((i) => [String(i.id), String(Number(i.quantity) - Number(i.received_quantity))])));
  const [div, setDiv] = useState('');
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const submit = async () => {
    try {
      const payload = Object.entries(q).filter(([, v]) => Number(v) > 0).map(([item_id, v]) => ({ item_id, quantity: Number(v) }));
      const r = await db().rpc<{ received_value: number; complete: boolean }>('receive_purchase', { p_purchase: purchaseId, p_items: payload });
      if (div) await db().update('purchases', purchaseId, { divergences: div });
      invalidate();
      toast(`Recebimento registrado: entrada no estoque e conta a pagar de ${formatReais(r?.received_value ?? 0)}.`);
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  return (
    <Modal open onClose={onClose} title="Registrar recebimento" size="md" footer={<Button onClick={submit}>Confirmar recebimento</Button>}>
      <div className="space-y-3">
        {pending.map((i) => <TextInput key={String(i.id)} label={`${String((i.stock_item as Row | null)?.name ?? '')} (pendente ${Number(i.quantity) - Number(i.received_quantity)})`} type="number" value={q[String(i.id)] ?? ''} onChange={(e) => setQ((s) => ({ ...s, [String(i.id)]: e.target.value }))} />)}
        <TextInput label="Divergências (opcional)" value={div} onChange={(e) => setDiv(e.target.value)} />
        <p className="text-xs text-cocoa-700">Recebimento parcial é permitido. Cada recebimento gera a conta a pagar correspondente.</p>
      </div>
    </Modal>
  );
}

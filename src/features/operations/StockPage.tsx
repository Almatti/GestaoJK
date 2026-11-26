import { useState } from 'react';
import { ArrowDownUp, Lightbulb } from 'lucide-react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card, Tabs } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, LoadingBlock, friendlyError, Alert } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Overlay';
import { SelectInput, TextInput } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { ResourcePage } from '@/features/resource/ResourcePage';
import { stockItemsDef, STOCK_KIND } from '@/features/resource/definitions';
import { suggestPurchase } from '@/domain/inventory';
import { formatNumber } from '@/domain/money';
import { formatDateBR, formatDateTimeBR, addDays, todaySP } from '@/domain/dates';

const MOVE_TYPES = [['entrada', 'Entrada'], ['saida', 'Saída'], ['devolucao', 'Devolução'], ['perda', 'Perda'], ['vencimento', 'Vencimento'], ['consumo_interno', 'Consumo interno'], ['ajuste', 'Ajuste (+/−)'], ['inventario', 'Inventário (diferença)']].map(([value, label]) => ({ value: value!, label: label! }));
const NEG = ['saida', 'perda', 'vencimento', 'consumo_interno'];

export function StockPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'posicao' | 'movimentos' | 'lotes' | 'itens'>('posicao');
  const [moving, setMoving] = useState<Row | null>(null);
  const pos = useList<Row>('stock_positions', { order: [{ column: 'name' }], range: [0, 999] });
  const moves = useList<Row>('inventory_movements', { select: '*,stock_item:stock_items(name)', order: [{ column: 'created_at', ascending: false }], range: [0, 199] }, { enabled: tab === 'movimentos' });
  const lots = useList<Row>('lot_balances', { order: [{ column: 'expires_at' }], range: [0, 499] }, { enabled: tab === 'lotes' });
  const history = useList<Row>('inventory_movements', { filters: [{ column: 'movement_type', op: 'eq', value: 'saida' }, { column: 'created_at', op: 'gte', value: addDays(todaySP(), -60) }], range: [0, 9999] });

  const suggestion = (p: Row) => suggestPurchase({ history: (history.data?.rows ?? []).filter((m) => m.stock_item_id === p.stock_item_id).map((m) => ({ date: String(m.created_at), quantity: Math.abs(Number(m.quantity)) })), historyDays: 60, leadTimeDays: 5, coverageDays: 14, available: Number(p.available), futureReservations: 0, minimum: Number(p.min_quantity) });

  return (
    <div className="animate-fade-in">
      <PageHeader title="Estoque" subtitle="Baseado em movimentações rastreáveis. Disponível = físico − reservado. Líquido e recipientes retornáveis controlados separadamente. Saídas seguem FEFO." />
      <Tabs tabs={[{ key: 'posicao', label: 'Posição' }, { key: 'movimentos', label: 'Movimentações' }, { key: 'lotes', label: 'Lotes e validade' }, { key: 'itens', label: 'Itens' }]} value={tab} onChange={setTab} />
      {tab === 'posicao' && (pos.isLoading ? <Card opaque><LoadingBlock /></Card> : (pos.data?.rows ?? []).length === 0 ? <Card><EmptyState title="Nenhum item de estoque" description="Cadastre itens na aba Itens (barris por produto/tamanho, cilindros, peças…)." /></Card> : (
        <div className="surface overflow-x-auto rounded-[var(--radius-card)]">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-cream-100 text-left text-xs uppercase text-cocoa-700"><tr><th className="px-4 py-3">Item</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3 text-right">Físico</th><th className="px-4 py-3 text-right">Reservado</th><th className="px-4 py-3 text-right">Disponível</th><th className="px-4 py-3 text-right">Mínimo</th><th className="px-4 py-3">Situação</th><th className="px-4 py-3" /></tr></thead>
            <tbody>{pos.data!.rows.map((p) => { const low = Number(p.min_quantity) > 0 && Number(p.available) <= Number(p.min_quantity); const sug = low ? suggestion(p) : 0; return (
              <tr key={String(p.stock_item_id)} className="border-t border-tangerine-100">
                <td className="px-4 py-3 font-medium">{String(p.name)}{p.returnable ? <Badge className="ml-2" tone="info">Retornável</Badge> : null}</td>
                <td className="px-4 py-3">{STOCK_KIND[p.kind as keyof typeof STOCK_KIND]}</td>
                <td className="num px-4 py-3 text-right">{formatNumber(Number(p.physical))}</td>
                <td className="num px-4 py-3 text-right">{formatNumber(Number(p.reserved))}</td>
                <td className="num px-4 py-3 text-right font-semibold">{formatNumber(Number(p.available))}</td>
                <td className="num px-4 py-3 text-right">{formatNumber(Number(p.min_quantity))}</td>
                <td className="px-4 py-3">{low ? <span className="flex flex-col gap-1"><Badge tone="danger">Abaixo do mínimo</Badge>{sug > 0 && <span className="flex items-center gap-1 text-xs text-cocoa-700"><Lightbulb className="size-3" />Sugestão de compra: {sug}</span>}</span> : <Badge tone="success">OK</Badge>}</td>
                <td className="px-4 py-3">{can('estoque', 'create') && <Button size="sm" variant="soft" icon={<ArrowDownUp className="size-4" />} onClick={() => setMoving(p)}>Movimentar</Button>}</td>
              </tr>); })}</tbody>
          </table>
        </div>
      ))}
      {tab === 'movimentos' && (
        <Card opaque>{(moves.data?.rows ?? []).length === 0 ? <EmptyState title="Sem movimentações" /> : (
          <ul className="divide-y divide-tangerine-100 text-sm">{moves.data!.rows.map((m) => (
            <li key={String(m.id)} className="flex flex-wrap items-center gap-3 py-2.5"><span className="w-36 text-xs text-cocoa-700">{formatDateTimeBR(m.created_at as string)}</span><Badge tone={Number(m.quantity) > 0 ? 'success' : 'warning'}>{String(m.movement_type)}</Badge><span className="flex-1">{String((m.stock_item as Row | null)?.name ?? '')}</span><span className="num font-semibold">{Number(m.quantity) > 0 ? '+' : ''}{formatNumber(Number(m.quantity))}</span><span className="w-full text-xs text-cocoa-700 sm:w-auto">{String(m.notes ?? m.ref_type ?? '')}</span></li>))}</ul>
        )}</Card>
      )}
      {tab === 'lotes' && (
        <Card opaque>{(lots.data?.rows ?? []).length === 0 ? <EmptyState title="Sem lotes cadastrados" description="Lotes são criados nas entradas com código de lote e validade (ex.: recebimento de compras)." /> : (
          <ul className="divide-y divide-tangerine-100 text-sm">{lots.data!.rows.filter((l) => Number(l.quantity) > 0).map((l) => { const exp = l.expires_at as string | null; const near = exp && exp <= addDays(todaySP(), 15); return (
            <li key={String(l.lot_id)} className="flex items-center gap-3 py-2.5"><span className="flex-1">Lote {String(l.lot_code)}</span><span className="num">{formatNumber(Number(l.quantity))}</span><span>{exp ? formatDateBR(exp) : 'sem validade'}</span>{near && <Badge tone={exp! < todaySP() ? 'danger' : 'warning'}>{exp! < todaySP() ? 'Vencido' : 'Próximo do vencimento'}</Badge>}</li>); })}</ul>
        )}</Card>
      )}
      {tab === 'itens' && <ResourcePage def={stockItemsDef} />}
      {moving && <MoveDialog item={moving} onClose={() => setMoving(null)} />}
    </div>
  );
}

function MoveDialog({ item, onClose }: { item: Row; onClose: () => void }) {
  const [v, setV] = useState({ type: 'entrada', quantity: '', lot: '', expires: '', cost: '', notes: '' });
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const submit = async () => {
    let q = Number(v.quantity);
    if (!q) return toast('Informe a quantidade.', 'warning');
    if (NEG.includes(v.type)) q = -Math.abs(q);
    if (['entrada', 'devolucao'].includes(v.type)) q = Math.abs(q);
    try {
      let lotId: string | null = null;
      if (v.lot) {
        const existing = await db().list<Row>('inventory_lots', { filters: [{ column: 'stock_item_id', op: 'eq', value: item.stock_item_id }, { column: 'lot_code', op: 'eq', value: v.lot }] });
        lotId = String(existing.rows[0]?.id ?? (await db().insert<Row>('inventory_lots', { stock_item_id: item.stock_item_id, lot_code: v.lot, expires_at: v.expires || null })).id);
      }
      await db().insert('inventory_movements', { stock_item_id: item.stock_item_id, lot_id: lotId, movement_type: v.type, quantity: q, unit_cost: v.cost ? Number(v.cost) : null, notes: v.notes || null });
      invalidate();
      toast('Movimentação registrada.');
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  return (
    <Modal open onClose={onClose} title="Movimentar estoque" description={`${String(item.name)} · disponível ${formatNumber(Number(item.available))}`} size="sm" footer={<Button onClick={submit}>Registrar</Button>}>
      <div className="grid grid-cols-2 gap-3">
        <SelectInput wrapperClassName="col-span-2" label="Tipo" options={MOVE_TYPES} value={v.type} onChange={(e) => setV((s) => ({ ...s, type: e.target.value }))} />
        <TextInput label="Quantidade" type="number" step="any" value={v.quantity} onChange={(e) => setV((s) => ({ ...s, quantity: e.target.value }))} hint={['ajuste', 'inventario'].includes(v.type) ? 'Use negativo para reduzir' : undefined} />
        <TextInput label="Custo unitário (R$)" type="number" step="0.01" value={v.cost} onChange={(e) => setV((s) => ({ ...s, cost: e.target.value }))} />
        <TextInput label="Lote" value={v.lot} onChange={(e) => setV((s) => ({ ...s, lot: e.target.value }))} />
        <TextInput label="Validade" type="date" value={v.expires} onChange={(e) => setV((s) => ({ ...s, expires: e.target.value }))} />
        <TextInput wrapperClassName="col-span-2" label="Observação" value={v.notes} onChange={(e) => setV((s) => ({ ...s, notes: e.target.value }))} />
      </div>
      <div className="mt-3"><Alert tone="info">O banco impede estoque físico negativo, inclusive sob uso simultâneo.</Alert></div>
    </Modal>
  );
}

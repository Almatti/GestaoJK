import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Printer } from 'lucide-react';
import { db, useInvalidateAll, useRpc } from '@/data/hooks';
import { PageHeader, Card, Stat } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, ErrorState, LoadingBlock, friendlyError } from '@/components/ui/Feedback';
import { Checkbox, SelectInput, TextInput } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthContext';
import { addDays, formatDateBR, todaySP } from '@/domain/dates';
import { formatNumber } from '@/domain/money';
import { planningGroups, type PlanningRow } from '@/domain/festas';
import { printEventChecklist, printPurchaseList } from './festaPdf';
import { FestasDataNotice, num } from './shared';

export function FestasPlanningPage() {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const { can } = useAuth();
  const [from, setFrom] = useState(todaySP());
  const [to, setTo] = useState(addDays(todaySP(), 30));
  const [eventId, setEventId] = useState('');
  const canEdit = can('festas', 'edit');
  const rpc = useRpc<PlanningRow[]>('festa_planning', { p_from: from, p_to: to }, from <= to);
  const rows = useMemo(() => (rpc.data ?? []).map((r) => ({ ...r, quantity: Number(r.quantity), purchased_qty: Number(r.purchased_qty), keg_liters: r.keg_liters == null ? null : Number(r.keg_liters) })), [rpc.data]);
  const groups = useMemo(() => planningGroups(rows), [rows]);
  const events = useMemo(() => {
    const seen = new Map<string, { id: string; code: string; name: string; date: string | null }>();
    for (const r of rows) if (!seen.has(r.event_id)) seen.set(r.event_id, { id: r.event_id, code: r.event_code, name: r.event_name ?? r.event_code, date: r.event_date });
    return [...seen.values()];
  }, [rows]);

  const totals = useMemo(() => ({
    liters: groups.reduce((s, g) => s + (g.liters ?? 0), 0),
    missing: groups.reduce((s, g) => s + g.missing, 0),
    items: rows.length,
    checked: rows.filter((r) => r.checked_at).length
  }), [groups, rows]);

  const patch = async (r: PlanningRow, values: Record<string, unknown>) => {
    try {
      await db().update('festa_items', r.item_id, values);
      invalidate();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  const printEvent = async () => {
    if (!eventId) return toast('Escolha a festa para imprimir o checklist.', 'warning');
    try {
      const ev = await db().get<Record<string, unknown>>('festa_events_view', eventId);
      if (!ev) return toast('Festa não encontrada.', 'danger');
      const items = rows.filter((r) => r.event_id === eventId);
      printEventChecklist({
        code: String(ev.code), name: String(ev.event_name ?? ''), client: String(ev.client_name ?? ''), phone: String(ev.client_phone ?? ''),
        date: String(ev.event_date ?? ''), time: String(ev.event_time ?? '').slice(0, 5), address: String(ev.address ?? ''), notes: String(ev.notes ?? '')
      }, items.map((i) => ({ product: i.product_name ?? '', unit: i.unit, keg_liters: i.keg_liters, quantity: i.quantity, notes: '' })));
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  return (
    <>
      <PageHeader title="Compras e checklist de festas" subtitle="Consolida os pedidos das festas do período: o que comprar, quanto já foi comprado e o que falta."
        breadcrumbs={[{ label: 'Festas', to: '/festas' }, { label: 'Compras e checklist' }]}
        actions={<Button icon={<Printer className="size-4" />} disabled={!groups.length} onClick={() => printPurchaseList({ from, to, groups })}>Imprimir lista de compras</Button>} />
      <FestasDataNotice />

      <Card>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <TextInput label="Início do período" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextInput label="Fim do período" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {[7, 15, 30].map((d) => <Button key={d} size="sm" variant="secondary" onClick={() => { setFrom(todaySP()); setTo(addDays(todaySP(), d)); }}>{d} dias</Button>)}
          </div>
        </div>
        {from > to && <div className="mt-3"><Alert tone="warning">A data inicial é posterior à final.</Alert></div>}
      </Card>

      {rpc.error ? <ErrorState error={rpc.error} /> : rpc.isLoading ? <LoadingBlock rows={5} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Festas no período" value={events.length} />
            <Stat label="Litros necessários" value={`${formatNumber(totals.liters, 1)} L`} hint="Somente barris com litragem" />
            <Stat label="Ainda a comprar" value={formatNumber(totals.missing, 1)} hint="Necessário − comprado" tone={totals.missing > 0 ? 'down' : 'up'} />
            <Stat label="Itens conferidos" value={`${totals.checked}/${totals.items}`} />
          </div>

          <Card title="Consolidado por produto e litragem">
            {groups.length === 0 ? <EmptyState title="Nenhum item de festa no período" description="Ajuste o período ou cadastre festas com produtos." /> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
                <thead><tr className="border-b border-tangerine-100 text-left text-xs uppercase tracking-wide text-cocoa-700">
                  <th className="py-2 pr-2">Produto</th><th className="py-2 pr-2 text-right">Litragem</th><th className="py-2 pr-2 text-right">Necessário</th>
                  <th className="py-2 pr-2 text-right">Total de litros</th><th className="py-2 pr-2 text-right">Comprado</th><th className="py-2 pr-2 text-right">Ainda necessário</th><th className="py-2">Eventos</th>
                </tr></thead>
                <tbody>{groups.map((g) => (
                  <tr key={g.key} className="border-b border-tangerine-100/60 align-top">
                    <td className="py-2 pr-2 font-semibold text-cocoa-900">{g.product}<div className="text-xs font-normal text-cocoa-700">{g.itemCount} item(ns) · separados {g.separatedCount} · conferidos {g.checkedCount}</div></td>
                    <td className="py-2 pr-2 text-right">{g.kegLiters ? `${formatNumber(g.kegLiters)} L` : '—'}</td>
                    <td className="py-2 pr-2 text-right">{formatNumber(g.quantity, 1)} {g.unit === 'barril' ? 'barril(is)' : g.unit}</td>
                    <td className="py-2 pr-2 text-right">{g.liters != null ? `${formatNumber(g.liters, 1)} L` : '—'}</td>
                    <td className="py-2 pr-2 text-right">{formatNumber(g.purchased, 1)}</td>
                    <td className="py-2 pr-2 text-right font-semibold">{g.missing > 0 ? <span className="text-danger-700">{formatNumber(g.missing, 1)}</span> : <span className="text-success-700">0</span>}</td>
                    <td className="py-2 text-xs">{g.events.map((e) => <div key={e.id}><Link className="font-semibold text-tangerine-900 hover:underline" to={`/festas/${e.id}`}>{e.code}</Link> · {e.name} · {formatDateBR(e.date ?? '')} · {formatNumber(e.quantity, 1)}</div>)}</td>
                  </tr>))}</tbody>
              </table></div>)}
          </Card>

          <Card title="Checklist interativo" action={<span className="text-xs text-cocoa-700">Marque ao comprar, separar e conferir</span>}>
            {rows.length === 0 ? <p className="text-sm text-cocoa-700">Nenhum item para conferir no período.</p> : (
              <div className="space-y-4">{events.map((ev) => (
                <div key={ev.id}>
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <Link to={`/festas/${ev.id}`} className="font-semibold text-tangerine-900 hover:underline">{ev.code} · {ev.name}</Link>
                    <span className="text-xs text-cocoa-700">{formatDateBR(ev.date ?? '')}</span>
                  </div>
                  <div className="space-y-2">{rows.filter((r) => r.event_id === ev.id).map((r) => (
                    <div key={r.item_id} className="grid items-center gap-2 rounded-control border border-tangerine-100 bg-white/70 p-2 md:grid-cols-[1fr_auto_auto_auto_auto]">
                      <div className="text-sm"><span className="font-semibold text-cocoa-900">{r.product_name || 'Sem nome'}</span>
                        <span className="text-cocoa-700"> · {formatNumber(r.quantity, 1)} {r.unit === 'barril' ? 'barril(is)' : r.unit}{r.keg_liters ? ` de ${formatNumber(r.keg_liters)} L` : ''}</span></div>
                      <label className="flex items-center gap-2 text-xs text-cocoa-700">Comprado
                        <input type="number" min={0} step="0.5" defaultValue={r.purchased_qty} disabled={!canEdit} aria-label={`Quantidade comprada de ${r.product_name ?? ''}`}
                          onBlur={(e) => { const q = num(e.target.value); if (q !== r.purchased_qty) patch(r, { purchased_qty: q }); }}
                          className="w-20 rounded-control border border-tangerine-200 bg-white px-2 py-1 text-right" /></label>
                      <Checkbox label="Comprado" disabled={!canEdit} checked={!!r.purchased_at} onChange={() => patch(r, { purchased_at: r.purchased_at ? null : new Date().toISOString() })} />
                      <Checkbox label="Separado" disabled={!canEdit} checked={!!r.separated_at} onChange={() => patch(r, { separated_at: r.separated_at ? null : new Date().toISOString() })} />
                      <Checkbox label="Conferido" disabled={!canEdit} checked={!!r.checked_at} onChange={() => patch(r, { checked_at: r.checked_at ? null : new Date().toISOString() })} />
                    </div>))}</div>
                </div>))}</div>)}
          </Card>

          <Card title="Checklist individual do evento (impressão)">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-72 flex-1"><SelectInput label="Festa" value={eventId} onChange={(e) => setEventId(e.target.value)} placeholder="Escolha a festa"
                options={events.map((e) => ({ value: e.id, label: `${e.code} · ${e.name} · ${formatDateBR(e.date ?? '')}` }))} /></div>
              <Button variant="secondary" icon={<Printer className="size-4" />} disabled={!eventId} onClick={printEvent}>Imprimir checklist</Button>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

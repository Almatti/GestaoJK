import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { MapPin, Navigation, Play, CheckCircle2, AlertTriangle, Plus } from 'lucide-react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card, Tabs } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, LoadingBlock, friendlyError } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Overlay';
import { TextInput, TextArea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { ResourcePage } from '@/features/resource/ResourcePage';
import { ResourceForm } from '@/features/resource/ResourceForm';
import { vehiclesDef, opts } from '@/features/resource/definitions';
import type { ResourceDef } from '@/features/resource/types';
import { addDays, formatDateBR, periodFor, todaySP, weekday } from '@/domain/dates';

const KIND = { entrega: 'Entrega', recolhimento: 'Recolhimento', instalacao: 'Instalação', retirada: 'Retirada', visita: 'Visita' };
const STATUS_TONE = { programada: 'info', em_rota: 'warning', concluida: 'success', tentativa_falha: 'danger', cancelada: 'neutral' } as const;
const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const deliveryDef: ResourceDef = {
  table: 'deliveries', title: 'Entregas', singular: 'Programação logística', resource: 'logistica', searchColumns: [], columns: [],
  fields: [
    { name: 'kind', label: 'Tipo', type: 'select', options: opts(KIND), required: true, defaultValue: 'entrega' },
    { name: 'customer_id', label: 'Cliente', type: 'ref', ref: { table: 'customers', label: 'name' } },
    { name: 'scheduled_date', label: 'Data', type: 'date', required: true, defaultValue: todaySP() },
    { name: 'scheduled_time', label: 'Horário', type: 'time' },
    { name: 'address', label: 'Endereço', type: 'text', wide: true },
    { name: 'city', label: 'Cidade', type: 'text' }, { name: 'region', label: 'Região / rota', type: 'text' },
    { name: 'driver_id', label: 'Motorista / técnico', type: 'ref', ref: { table: 'profiles', label: 'full_name' } },
    { name: 'vehicle_id', label: 'Veículo', type: 'ref', ref: { table: 'vehicles', label: 'plate' } },
    { name: 'full_kegs', label: 'Barris cheios', type: 'number', min: 0, defaultValue: 0 },
    { name: 'empty_kegs', label: 'Barris vazios', type: 'number', min: 0, defaultValue: 0 },
    { name: 'cylinders', label: 'Cilindros', type: 'number', min: 0, defaultValue: 0 },
    { name: 'notes', label: 'Observações', type: 'textarea' }
  ]
};

/** Programação logística sem dependência de APIs pagas de mapas (abre o app de navegação do dispositivo). */
export function LogisticsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'dia' | 'semana' | 'mes' | 'veiculos'>('dia');
  const [date, setDate] = useState(todaySP());
  const [group, setGroup] = useState<'city' | 'region' | 'kind'>('city');
  const [event, setEvent] = useState<{ d: Row; kind: 'falha' | 'concluir' } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const range = tab === 'dia' ? { start: date, end: date } : tab === 'semana' ? periodFor('semana', date) : periodFor('mes', date);
  const q = useList<Row>('deliveries', { select: '*,customer:customers(name,trade_name,city,whatsapp),vehicle:vehicles(plate)', filters: [{ column: 'scheduled_date', op: 'gte', value: range.start }, { column: 'scheduled_date', op: 'lte', value: range.end }, { column: 'status', op: 'neq', value: 'cancelada' }], order: [{ column: 'scheduled_date' }, { column: 'scheduled_time' }], range: [0, 999] }, { enabled: tab !== 'veiculos' });
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);

  const conflicts = useMemo(() => {
    const c = new Set<string>();
    const byKey = new Map<string, Row[]>();
    for (const d of rows) {
      for (const k of [d.vehicle_id && `v:${d.vehicle_id}`, d.driver_id && `p:${d.driver_id}`].filter(Boolean) as string[]) {
        const key = `${k}:${d.scheduled_date}:${String(d.scheduled_time ?? '').slice(0, 5)}`;
        byKey.set(key, [...(byKey.get(key) ?? []), d]);
      }
      for (const eq of (d.equipment_ids as string[] | null) ?? []) {
        const key = `e:${eq}:${d.scheduled_date}`;
        byKey.set(key, [...(byKey.get(key) ?? []), d]);
      }
    }
    for (const list of byKey.values()) if (list.length > 1 && list.some((x) => x.scheduled_time)) list.forEach((x) => c.add(String(x.id)));
    return c;
  }, [rows]);

  const grouped = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const d of rows) {
      const key = group === 'kind' ? KIND[d.kind as keyof typeof KIND] : String(d[group] ?? (d.customer as Row | null)?.city ?? 'Sem cidade');
      m.set(key, [...(m.get(key) ?? []), d]);
    }
    return [...m.entries()].sort();
  }, [rows, group]);

  const update = async (d: Row, values: Row) => {
    try {
      await db().update('deliveries', String(d.id), values);
      if (values.status === 'concluida' && d.order_id && d.kind === 'entrega') await db().rpc('set_order_status', { p_order: d.order_id, p_status: 'entregue' }).catch(() => undefined);
      invalidate();
      toast('Registro logístico atualizado.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  const navUrl = (d: Row) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(String(d.address ?? ''))}`;
  const wazeUrl = (d: Row) => `https://waze.com/ul?q=${encodeURIComponent(String(d.address ?? ''))}&navigate=yes`;

  const card = (d: Row) => (
    <li key={String(d.id)} className="rounded-2xl border border-tangerine-100 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[d.status as keyof typeof STATUS_TONE]}>{String(d.status)}</Badge>
        <span className="font-semibold">{KIND[d.kind as keyof typeof KIND]}</span>
        <span className="text-sm">{String((d.customer as Row | null)?.trade_name ?? (d.customer as Row | null)?.name ?? '—')}</span>
        {conflicts.has(String(d.id)) && <Badge tone="danger">Conflito de recurso</Badge>}
        <span className="num ml-auto text-sm text-cocoa-700">{tab !== 'dia' ? `${formatDateBR(d.scheduled_date as string)} ` : ''}{String(d.scheduled_time ?? '').slice(0, 5)}</span>
      </div>
      <p className="mt-1 flex items-center gap-1 text-sm text-cocoa-700"><MapPin className="size-3.5" />{String(d.address ?? 'Endereço não informado')}</p>
      <p className="mt-1 text-xs text-cocoa-700">Barris cheios {String(d.full_kegs ?? 0)} · vazios {String(d.empty_kegs ?? 0)} · cilindros {String(d.cylinders ?? 0)}{(d.vehicle as Row | null) ? ` · veículo ${String((d.vehicle as Row).plate)}` : ''}{d.order_id ? ' · ' : ''}{d.order_id ? <Link className="underline" to={`/pedidos/${d.order_id}`}>pedido</Link> : null}</p>
      {d.occurrence ? <p className="mt-1 text-xs text-danger-700">Ocorrência: {String(d.occurrence)}</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {d.address ? <><a href={navUrl(d)} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost" icon={<Navigation className="size-4" />}>Maps</Button></a><a href={wazeUrl(d)} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost">Waze</Button></a></> : null}
        {can('logistica', 'edit') && d.status === 'programada' && <Button size="sm" variant="soft" icon={<Play className="size-4" />} onClick={() => update(d, { status: 'em_rota', departed_at: new Date().toISOString() })}>Saída</Button>}
        {can('logistica', 'edit') && ['programada', 'em_rota'].includes(String(d.status)) && <>
          <Button size="sm" icon={<CheckCircle2 className="size-4" />} onClick={() => setEvent({ d, kind: 'concluir' })}>Concluir</Button>
          <Button size="sm" variant="ghost" icon={<AlertTriangle className="size-4" />} onClick={() => setEvent({ d, kind: 'falha' })}>Tentativa/ocorrência</Button>
        </>}
      </div>
    </li>
  );

  return (
    <div className="animate-fade-in">
      <PageHeader title="Logística" subtitle="Entregas, recolhimentos, instalações e visitas. Rastreamento por registros (saída, chegada, conclusão), sem GPS em tempo real."
        actions={can('logistica', 'create') && <Button icon={<Plus className="size-4" />} onClick={() => setNewOpen(true)}>Programar</Button>} />
      <Tabs tabs={[{ key: 'dia', label: 'Dia' }, { key: 'semana', label: 'Semana' }, { key: 'mes', label: 'Mês' }, { key: 'veiculos', label: 'Veículos' }]} value={tab} onChange={setTab} />
      {tab === 'veiculos' ? <ResourcePage def={vehiclesDef} /> : (
        <>
          <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
            <Button size="sm" variant="secondary" onClick={() => setDate(addDays(date, tab === 'dia' ? -1 : tab === 'semana' ? -7 : -30))}>‹</Button>
            <input type="date" aria-label="Data" className="input h-10 w-auto py-0" value={date} onChange={(e) => setDate(e.target.value)} />
            <Button size="sm" variant="secondary" onClick={() => setDate(addDays(date, tab === 'dia' ? 1 : tab === 'semana' ? 7 : 30))}>›</Button>
            <Button size="sm" variant="ghost" onClick={() => setDate(todaySP())}>Hoje</Button>
            <span className="text-sm text-cocoa-700">{tab === 'dia' ? `${WEEK[weekday(date)]}, ${formatDateBR(date)}` : `${formatDateBR(range.start)} a ${formatDateBR(range.end)}`}</span>
            <select aria-label="Agrupar por" className="input ml-auto h-10 w-auto py-0 text-sm" value={group} onChange={(e) => setGroup(e.target.value as typeof group)}>
              <option value="city">Agrupar por cidade</option><option value="region">Agrupar por região/rota</option><option value="kind">Agrupar por tipo</option>
            </select>
          </div>
          {conflicts.size > 0 && <div className="mb-4"><Alert tone="danger" title="Conflitos detectados">Veículo, motorista ou equipamento alocado em compromissos simultâneos. Revise a programação.</Alert></div>}
          {q.isLoading ? <Card opaque><LoadingBlock /></Card> : rows.length === 0 ? <Card><EmptyState title="Nada programado neste período" /></Card> : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {grouped.map(([k, list]) => (
                <Card key={k} title={`${k} · ${list.length}`}><ul className="space-y-2">{list.map(card)}</ul></Card>
              ))}
            </div>
          )}
        </>
      )}
      {event && <EventDialog ev={event} onClose={() => setEvent(null)} onSave={(v) => { update(event.d, v); setEvent(null); }} />}
      <ResourceForm def={deliveryDef} row={null} open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function EventDialog({ ev, onClose, onSave }: { ev: { d: Row; kind: 'falha' | 'concluir' }; onClose: () => void; onSave: (v: Row) => void }) {
  const [receiver, setReceiver] = useState('');
  const [text, setText] = useState('');
  const [km, setKm] = useState('');
  return (
    <Modal open onClose={onClose} title={ev.kind === 'concluir' ? 'Concluir atendimento' : 'Registrar tentativa/ocorrência'} size="sm"
      footer={<Button onClick={() => onSave(ev.kind === 'concluir' ? { status: 'concluida', completed_at: new Date().toISOString(), arrived_at: ev.d.arrived_at ?? new Date().toISOString(), receiver_name: receiver || null, occurrence: text || null, distance_km: km ? Number(km) : null } : { status: 'tentativa_falha', occurrence: text })}>Salvar</Button>}>
      <div className="space-y-3">
        {ev.kind === 'concluir' && <TextInput label="Recebido por (aceite do cliente)" value={receiver} onChange={(e) => setReceiver(e.target.value)} />}
        {ev.kind === 'concluir' && <TextInput label="Quilometragem (km)" type="number" value={km} onChange={(e) => setKm(e.target.value)} />}
        <TextArea label={ev.kind === 'concluir' ? 'Observações' : 'Descrição da ocorrência'} value={text} onChange={(e) => setText(e.target.value)} />
        <p className="text-xs text-cocoa-700">Fotos e comprovantes podem ser anexados no pedido correspondente.</p>
      </div>
    </Modal>
  );
}

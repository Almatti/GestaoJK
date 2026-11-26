import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import QRCode from 'qrcode';
import { MoveRight, Printer, Wrench } from 'lucide-react';
import { useList, useRecord, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card, KeyValue } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, LoadingBlock, friendlyError, ErrorState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Overlay';
import { SelectInput, TextInput } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { EQUIPMENT_STATUS, maintenanceDue, type EquipmentStatus } from '@/domain/equipment';
import { EQUIPMENT_TONE } from '@/features/resource/definitions';
import { formatDateBR, formatDateTimeBR, todaySP, diffDays } from '@/domain/dates';
import { formatReais } from '@/domain/money';
import { printDocument, escHtml } from '@/lib/export';
import { Attachments } from '@/components/ui/Attachments';
import { appUrl } from '@/config/env';

/** Ficha patrimonial. O QR Code aponta para esta página, que exige login e permissão. */
export function EquipmentDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const e = useRecord<Row>('equipment', id, '*,type:equipment_types(name),customer:customers(name,trade_name)');
  const moves = useList<Row>('equipment_movements', { select: '*,customer:customers(name,trade_name)', filters: [{ column: 'equipment_id', op: 'eq', value: id }], order: [{ column: 'moved_at', ascending: false }] });
  const sos = useList<Row>('service_orders', { select: '*,service:services(name)', filters: [{ column: 'equipment_id', op: 'eq', value: id }], order: [{ column: 'created_at', ascending: false }] });
  const reservations = useList<Row>('equipment_reservations', { select: '*,customer:customers(name)', filters: [{ column: 'equipment_id', op: 'eq', value: id }, { column: 'status', op: 'eq', value: 'ativa' }] });
  const [qr, setQr] = useState('');
  const [moving, setMoving] = useState(false);
  const url = appUrl(`/equipamentos/${id}`);
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: '#69351F', light: '#FFFFFF' } }).then(setQr);
  }, [url]);
  if (e.isLoading) return <Card opaque><LoadingBlock /></Card>;
  if (e.isError) return <ErrorState error={e.error} />;
  if (!e.data) return <Card><EmptyState title="Equipamento não encontrado" /></Card>;
  const eq = e.data;
  const cu = eq.customer as Row | null;
  const status = eq.status as EquipmentStatus;
  const san = maintenanceDue(eq.next_sanitization_at as string | null, todaySP());
  const man = maintenanceDue(eq.next_maintenance_at as string | null, todaySP());

  const printLabel = () => printDocument(`Etiqueta ${eq.asset_code}`, `<div style="display:flex;gap:16px;align-items:center;border:2px solid #a63900;border-radius:16px;padding:16px;width:420px"><img src="${qr}" width="140" height="140"/><div><h1 style="margin:0">${escHtml(String(eq.asset_code))}</h1><p>JK CHOPP — Patrimônio</p><p>${escHtml(String((eq.type as Row | null)?.name ?? ''))} ${escHtml(String(eq.serial_number ?? ''))}</p><p style="font-size:10px">Leitura exige acesso autorizado ao sistema.</p></div></div>`);

  return (
    <div className="animate-fade-in">
      <PageHeader breadcrumbs={[{ label: 'Equipamentos', to: '/equipamentos' }, { label: String(eq.asset_code) }]} title={`${String(eq.asset_code)} · ${String((eq.type as Row | null)?.name ?? '')}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={EQUIPMENT_TONE[status]}>{EQUIPMENT_STATUS[status]}</Badge>desde {formatDateTimeBR(eq.custody_since as string)} ({diffDays(String(eq.custody_since).slice(0, 10), todaySP())} dias)</span>}
        actions={<>
          {can('tecnico', 'create') && <Link to={`/ordens-de-servico?novo=1&equipamento=${eq.id}`}><Button variant="secondary" icon={<Wrench className="size-4" />}>Nova OS</Button></Link>}
          {can('equipamentos', 'edit') && <Button icon={<MoveRight className="size-4" />} onClick={() => setMoving(true)}>Registrar movimentação</Button>}
        </>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card opaque className="lg:col-span-2" title="Onde está e com quem">
          <KeyValue items={[
            ['Situação', EQUIPMENT_STATUS[status]], ['Localização', String(eq.location)], ['Cliente responsável', cu ? <Link className="underline" to={`/clientes/${eq.customer_id}`}>{String(cu.trade_name ?? cu.name)}</Link> : '—'],
            ['Desde', formatDateTimeBR(eq.custody_since as string)], ['Marca / modelo', [eq.brand, eq.model].filter(Boolean).join(' ')], ['Número de série', eq.serial_number as string],
            ['Propriedade', String(eq.ownership)], ['Aquisição', `${formatDateBR(eq.acquired_at as string)} · ${formatReais(eq.acquisition_value as number)}`], ['Garantia até', formatDateBR(eq.warranty_until as string)],
            ['Última assepsia', formatDateBR(eq.last_sanitization_at as string)], ['Próxima assepsia', <span key="s">{formatDateBR(eq.next_sanitization_at as string)} {san === 'atrasada' ? <Badge tone="danger">Atrasada</Badge> : san === 'proxima' ? <Badge tone="warning">Próxima</Badge> : null}</span>],
            ['Última manutenção', formatDateBR(eq.last_maintenance_at as string)], ['Próxima manutenção', <span key="m">{formatDateBR(eq.next_maintenance_at as string)} {man === 'atrasada' ? <Badge tone="danger">Atrasada</Badge> : man === 'proxima' ? <Badge tone="warning">Próxima</Badge> : null}</span>]
          ]} />
          {(reservations.data?.rows ?? []).length > 0 && <div className="mt-4"><p className="label">Reservas ativas</p><ul className="text-sm">{reservations.data!.rows.map((r) => <li key={String(r.id)}>{String((r.customer as Row | null)?.name ?? '')}: {formatDateTimeBR(r.starts_at as string)} → {r.ends_at ? formatDateTimeBR(r.ends_at as string) : 'indeterminado'}</li>)}</ul></div>}
        </Card>
        <Card title="QR Code patrimonial" action={<Button size="sm" variant="ghost" icon={<Printer className="size-4" />} onClick={printLabel}>Etiqueta</Button>}>
          {qr && <img src={qr} alt={`QR Code do equipamento ${String(eq.asset_code)}`} className="mx-auto rounded-2xl bg-white p-2" width={220} height={220} />}
          <p className="mt-2 text-center text-xs text-cocoa-700">Ao escanear, a ficha abre somente para usuários autenticados e autorizados.</p>
        </Card>
        <Card opaque className="lg:col-span-2" title="Histórico de custódia e movimentações">
          {(moves.data?.rows ?? []).length === 0 ? <EmptyState title="Sem movimentações registradas" /> : (
            <ol className="space-y-3 border-l-2 border-tangerine-200 pl-4">{moves.data!.rows.map((m) => (
              <li key={String(m.id)} className="relative"><span className="absolute -left-[23px] top-1.5 size-3 rounded-full bg-tangerine-700" aria-hidden />
                <p className="text-xs text-cocoa-700">{formatDateTimeBR(m.moved_at as string)}</p>
                <p className="text-sm">{EQUIPMENT_STATUS[m.from_status as EquipmentStatus] ?? '—'} → <strong>{EQUIPMENT_STATUS[m.to_status as EquipmentStatus]}</strong>{(m.customer as Row | null) ? ` · ${String((m.customer as Row).trade_name ?? (m.customer as Row).name)}` : ''}{m.reason ? ` · ${String(m.reason)}` : ''}</p></li>))}</ol>
          )}
        </Card>
        <Card opaque title="Ordens de serviço">
          {(sos.data?.rows ?? []).length === 0 ? <p className="text-sm text-cocoa-700">Nenhuma OS.</p> : (
            <ul className="space-y-2 text-sm">{sos.data!.rows.map((s) => <li key={String(s.id)}><Link className="hover:underline" to={`/ordens-de-servico/${s.id}`}>OS {String(s.number)} · {String((s.service as Row | null)?.name ?? '')}</Link> <Badge tone={s.status === 'concluida' ? 'success' : 'info'}>{String(s.status)}</Badge></li>)}</ul>
          )}
        </Card>
        <div className="lg:col-span-3"><Attachments entityType="equipment" entityId={String(eq.id)} title="Fotos, notas fiscais e documentos" /></div>
      </div>
      {moving && <MoveDialog eq={eq} onClose={() => setMoving(false)} />}
    </div>
  );
}

function MoveDialog({ eq, onClose }: { eq: Row; onClose: () => void }) {
  const customers = useList<Row>('customers', { select: 'id,name,trade_name', filters: [{ column: 'status', op: 'eq', value: 'ativo' }], order: [{ column: 'name' }], range: [0, 1999] });
  const [v, setV] = useState({ status: 'em_ponto_fixo', customer: String(eq.customer_id ?? ''), location: '', reason: '' });
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const needsCustomer = ['instalado', 'em_ponto_fixo', 'em_evento', 'aguardando_recolhimento'].includes(v.status);
  const submit = async () => {
    if (needsCustomer && !v.customer) return toast('Selecione o cliente responsável.', 'warning');
    try {
      await db().rpc('move_equipment', { p_equipment: eq.id, p_to_status: v.status, p_customer: needsCustomer ? v.customer : null, p_location: v.location || null, p_reason: v.reason || null });
      invalidate();
      toast('Movimentação registrada no histórico de custódia.');
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  return (
    <Modal open onClose={onClose} title="Registrar movimentação" size="sm" footer={<Button onClick={submit}>Registrar</Button>}>
      <div className="space-y-3">
        <SelectInput label="Nova situação" options={Object.entries(EQUIPMENT_STATUS).map(([value, label]) => ({ value, label }))} value={v.status} onChange={(e) => setV((s) => ({ ...s, status: e.target.value }))} />
        {needsCustomer && <SelectInput label="Cliente responsável" placeholder="Selecione…" options={(customers.data?.rows ?? []).map((c) => ({ value: String(c.id), label: String(c.trade_name ?? c.name) }))} value={v.customer} onChange={(e) => setV((s) => ({ ...s, customer: e.target.value }))} />}
        <TextInput label="Localização (opcional)" value={v.location} onChange={(e) => setV((s) => ({ ...s, location: e.target.value }))} placeholder="depósito, oficina, cliente…" />
        <TextInput label="Motivo" value={v.reason} onChange={(e) => setV((s) => ({ ...s, reason: e.target.value }))} />
        <p className="text-xs text-cocoa-700">Instalação em ponto fixo agenda automaticamente a próxima assepsia.</p>
      </div>
    </Modal>
  );
}

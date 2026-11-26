import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { CalendarClock, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { useList, useRecord, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card, KeyValue } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, LoadingBlock, friendlyError, ErrorState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Overlay';
import { SelectInput, TextArea, TextInput, Checkbox } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { formatReais, formatNumber } from '@/domain/money';
import { formatDateBR, todaySP } from '@/domain/dates';
import { SO_STATUS } from './ServiceOrdersPage';
import { Attachments } from '@/components/ui/Attachments';
import { WhatsAppButton } from '@/features/finance/WhatsAppButton';

interface CheckItem { text: string; done: boolean }

export function ServiceOrderDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const so = useRecord<Row>('service_orders', id, '*,customer:customers(id,name,trade_name,whatsapp,phone),service:services(name,checklist,category),equipment:equipment(id,asset_code)');
  const items = useList<Row>('service_order_items', { select: '*,stock_item:stock_items(name)', filters: [{ column: 'service_order_id', op: 'eq', value: id }] });
  const stock = useList<Row>('stock_positions', { order: [{ column: 'name' }], range: [0, 999] });
  const [checklist, setChecklist] = useState<CheckItem[]>([]);
  const [diag, setDiag] = useState('');
  const [work, setWork] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [part, setPart] = useState({ item: '', qty: '1' });
  const [schedule, setSchedule] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  useEffect(() => {
    if (!so.data) return;
    const s = so.data;
    const svc = s.service as Row | null;
    const stored = (s.checklist as CheckItem[] | null) ?? [];
    setChecklist(stored.length ? stored : ((svc?.checklist as string[] | null) ?? []).map((t) => ({ text: String(t), done: false })));
    setDiag(String(s.diagnosis ?? ''));
    setWork(String(s.work_done ?? ''));
    setAcceptance(String(s.customer_acceptance ?? ''));
  }, [so.data]);

  if (so.isLoading) return <Card opaque><LoadingBlock /></Card>;
  if (so.isError) return <ErrorState error={so.error} />;
  if (!so.data) return <Card><EmptyState title="OS não encontrada" /></Card>;
  const s = so.data;
  const cu = s.customer as Row | null;
  const done = s.status === 'concluida' || s.status === 'cancelada';
  const editable = !done && can('tecnico', 'edit');

  const saveProgress = async (extra: Row = {}) => {
    try {
      await db().update('service_orders', String(s.id), { checklist, diagnosis: diag || null, work_done: work || null, customer_acceptance: acceptance || null, ...extra });
      invalidate();
      toast('OS atualizada.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  const addPart = async () => {
    const si = stock.data?.rows.find((x) => x.stock_item_id === part.item);
    if (!si || !(Number(part.qty) > 0)) return;
    try {
      await db().insert('service_order_items', { service_order_id: s.id, stock_item_id: part.item, quantity: Number(part.qty), unit_cost: 0 });
      invalidate();
      setPart({ item: '', qty: '1' });
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  const finalize = async () => {
    try {
      await db().update('service_orders', String(s.id), { checklist, diagnosis: diag || null });
      await db().rpc('finalize_service_order', { p_so: s.id, p_work_done: work || null, p_acceptance: acceptance || null });
      invalidate();
      toast('OS concluída: estoque, patrimônio, agenda e financeiro atualizados.');
      setFinalizing(false);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader breadcrumbs={[{ label: 'Ordens de serviço', to: '/ordens-de-servico' }, { label: `OS ${String(s.number)}` }]} title={`OS nº ${String(s.number)} · ${String((s.service as Row | null)?.name ?? '')}`}
        subtitle={<Badge tone={s.status === 'concluida' ? 'success' : s.status === 'cancelada' ? 'neutral' : 'info'}>{SO_STATUS[s.status as keyof typeof SO_STATUS]}</Badge>}
        actions={<>
          {cu && (cu.whatsapp || cu.phone) && s.scheduled_date ? <WhatsAppButton phone={String(cu.whatsapp ?? cu.phone)} templateKey={(s.service as Row | null)?.category === 'assepsia' ? 'assepsia' : 'visita_tecnica'} values={{ NOME_CLIENTE: String(cu.trade_name ?? cu.name), DATA_VISITA: formatDateBR(s.scheduled_date as string), HORARIO_VISITA: String(s.scheduled_time ?? '').slice(0, 5) }} customerId={String(cu.id)} refType="service_order" refId={String(s.id)} /> : null}
          {editable && <Button variant="secondary" icon={<CalendarClock className="size-4" />} onClick={() => setSchedule(true)}>Agendar</Button>}
          {editable && <Button icon={<CheckCircle2 className="size-4" />} onClick={() => setFinalizing(true)}>Finalizar OS</Button>}
        </>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card opaque className="lg:col-span-2" title="Execução">
          <div className="space-y-4">
            <div>
              <p className="label">Checklist</p>
              {checklist.length === 0 && <p className="text-sm text-cocoa-700">Sem checklist para este serviço.</p>}
              {checklist.map((c, i) => <Checkbox key={i} label={c.text} disabled={!editable} checked={c.done} onChange={(e) => setChecklist((l) => l.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} />)}
              {editable && <button className="mt-1 text-sm font-semibold text-tangerine-900 underline" onClick={() => { const t = prompt('Novo item do checklist'); if (t) setChecklist((l) => [...l, { text: t, done: false }]); }}>+ Adicionar item</button>}
            </div>
            <TextArea label="Diagnóstico" disabled={!editable} value={diag} onChange={(e) => setDiag(e.target.value)} />
            <TextArea label="Serviço executado" disabled={!editable} value={work} onChange={(e) => setWork(e.target.value)} />
            <TextInput label="Aceite do cliente (nome de quem recebeu)" disabled={!editable} value={acceptance} onChange={(e) => setAcceptance(e.target.value)} />
            {editable && <Button variant="secondary" onClick={() => saveProgress({ status: s.status === 'aberta' || s.status === 'agendada' ? 'em_execucao' : s.status })}>Salvar andamento</Button>}
          </div>
        </Card>
        <div className="space-y-4">
          <Card opaque title="Dados">
            <KeyValue items={[['Cliente', cu ? <Link className="underline" to={`/clientes/${cu.id}`}>{String(cu.trade_name ?? cu.name)}</Link> : '—'], ['Equipamento', (s.equipment as Row | null) ? <Link className="underline" to={`/equipamentos/${(s.equipment as Row).id}`}>{String((s.equipment as Row).asset_code)}</Link> : '—'],
              ['Data', `${formatDateBR(s.scheduled_date as string)} ${String(s.scheduled_time ?? '').slice(0, 5)}`], ['Prioridade', String(s.priority)], ['Gratuito', s.is_free ? 'Sim (incluso)' : 'Não'], ['Valor a cobrar', formatReais(s.charged_amount as number)], ['Custo', formatReais(s.cost as number)], ['Motivo', s.reason as string]]} />
          </Card>
          <Card opaque title="Peças e materiais">
            {(items.data?.rows ?? []).length === 0 ? <p className="text-sm text-cocoa-700">Nenhuma peça.</p> : (
              <ul className="mb-3 space-y-1 text-sm">{items.data!.rows.map((it) => <li key={String(it.id)} className="flex items-center gap-2"><span className="flex-1">{String((it.stock_item as Row | null)?.name ?? '')}</span><span className="num">{formatNumber(Number(it.quantity))}</span>{editable && <Button size="icon" variant="ghost" aria-label="Remover" onClick={async () => { await db().remove('service_order_items', String(it.id)); invalidate(); }} icon={<Trash2 className="size-4" />} />}</li>)}</ul>
            )}
            {editable && (
              <div className="flex items-end gap-2">
                <SelectInput wrapperClassName="flex-1" label="Item" placeholder="Selecione…" value={part.item} onChange={(e) => setPart((p) => ({ ...p, item: e.target.value }))} options={(stock.data?.rows ?? []).filter((x) => ['peca', 'limpeza', 'insumo', 'gas', 'outro'].includes(String(x.kind))).map((x) => ({ value: String(x.stock_item_id), label: `${String(x.name)} (disp. ${formatNumber(Number(x.available))})` }))} />
                <TextInput wrapperClassName="w-20" label="Qtd." type="number" value={part.qty} onChange={(e) => setPart((p) => ({ ...p, qty: e.target.value }))} />
                <Button size="icon" aria-label="Adicionar peça" icon={<Plus className="size-4" />} onClick={addPart} />
              </div>
            )}
          </Card>
        </div>
        <div className="lg:col-span-3"><Attachments entityType="service_order" entityId={String(s.id)} title="Fotos de antes e depois" /></div>
      </div>
      {schedule && <ScheduleDialog id={String(s.id)} onClose={() => setSchedule(false)} />}
      <Modal open={finalizing} onClose={() => setFinalizing(false)} title="Finalizar OS" size="sm" footer={<><Button variant="secondary" onClick={() => setFinalizing(false)}>Voltar</Button><Button onClick={finalize}>Finalizar</Button></>}>
        <div className="space-y-3 text-sm">
          <p>Serão executados em uma transação: baixa das peças no estoque (FEFO), atualização do histórico do equipamento (assepsia/manutenção), conclusão na agenda e {s.is_free || !Number(s.charged_amount) ? 'nenhuma cobrança (gratuito)' : `geração de cobrança de ${formatReais(s.charged_amount as number)}`}.</p>
          {checklist.some((c) => !c.done) && <Alert tone="warning">Há itens do checklist não marcados.</Alert>}
        </div>
      </Modal>
    </div>
  );
}

function ScheduleDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState(todaySP());
  const [t, setT] = useState('09:00');
  const toast = useToast();
  const invalidate = useInvalidateAll();
  return (
    <Modal open onClose={onClose} title="Agendar visita" size="sm" footer={<Button onClick={async () => { try { await db().rpc('schedule_service_order', { p_so: id, p_date: d, p_time: t }); invalidate(); toast('Visita agendada e incluída na agenda.'); onClose(); } catch (e) { toast(friendlyError(e), 'danger'); } }}>Agendar</Button>}>
      <div className="grid grid-cols-2 gap-3"><TextInput label="Data" type="date" value={d} onChange={(e) => setD(e.target.value)} /><TextInput label="Horário" type="time" value={t} onChange={(e) => setT(e.target.value)} /></div>
    </Modal>
  );
}

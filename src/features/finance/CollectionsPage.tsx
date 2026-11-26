import { useState } from 'react';
import { Play, ExternalLink, CheckCheck, XCircle, Copy, Settings2 } from 'lucide-react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card, Tabs } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, LoadingBlock, friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { MESSAGE_STATUS, whatsappLink, type MessageStatus } from '@/domain/messages';
import { formatDateBR, todaySP, formatDateTimeBR } from '@/domain/dates';
import type { Tone } from '@/domain/collections';
import { CollectionRulesForm } from './CollectionRulesForm';

const TONE: Record<MessageStatus, Tone> = { gerada: 'info', aberta: 'warning', envio_informado: 'success', entregue_api: 'success', falha: 'danger', cancelada: 'neutral' };

/** Fila diária de mensagens prontas (WhatsApp por link oficial) e regras de cobrança. */
export function CollectionsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [tab, setTab] = useState<'fila' | 'historico' | 'regras'>('fila');
  const [running, setRunning] = useState(false);
  const queue = useList<Row>('message_queue', { select: '*,customer:customers(name,trade_name)', filters: tab === 'fila' ? [{ column: 'status', op: 'in', value: ['gerada', 'aberta'] }] : [{ column: 'status', op: 'not_in', value: ['gerada', 'aberta'] }], order: [{ column: 'scheduled_for', ascending: tab === 'fila' }], range: [0, 299] });

  const setStatus = async (m: Row, status: MessageStatus, extra: Row = {}) => {
    try {
      await db().update('message_queue', String(m.id), { status, ...extra });
      invalidate();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  const run = async () => {
    setRunning(true);
    try {
      const r = await db().rpc<{ effects?: number; skipped?: string }>('run_automations', { p_day: todaySP() });
      invalidate();
      toast(r?.skipped ? `Execução ignorada: ${r.skipped}` : `${r?.effects ?? 0} novo(s) efeito(s) gerado(s). Execuções repetidas não duplicam mensagens.`);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
    setRunning(false);
  };

  const rows = queue.data?.rows ?? [];
  return (
    <div className="animate-fade-in">
      <PageHeader title="Cobranças" subtitle="Mensagens geradas automaticamente pelas regras (1 dia antes, no dia, após o vencimento, antes do protesto). O envio é confirmado por você."
        actions={can('automacoes', 'edit') && <Button icon={<Play className="size-4" />} loading={running} onClick={run}>Gerar fila agora</Button>} />
      <Tabs tabs={[{ key: 'fila', label: 'Fila do dia', count: tab === 'fila' ? rows.length : undefined }, { key: 'historico', label: 'Histórico' }, { key: 'regras', label: 'Regras de cobrança' }]} value={tab} onChange={setTab} />
      {tab === 'regras' ? <CollectionRulesForm /> : queue.isLoading ? <Card opaque><LoadingBlock /></Card> : rows.length === 0 ? (
        <Card><EmptyState title={tab === 'fila' ? 'Nenhuma mensagem pendente' : 'Sem histórico'} description="As automações rodam diariamente no servidor (pg_cron). Você também pode gerar a fila manualmente." /></Card>
      ) : (
        <div className="space-y-3">
          {tab === 'fila' && <Alert tone="info">“Abrir WhatsApp” não equivale a envio. Depois de enviar, clique em “Informar envio”. Mensagens de títulos quitados são canceladas automaticamente.</Alert>}
          {rows.map((m) => {
            const c = m.customer as Row | null;
            const link = m.phone ? whatsappLink(String(m.phone), String(m.body)) : null;
            return (
              <Card key={String(m.id)} opaque>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={TONE[m.status as MessageStatus]}>{MESSAGE_STATUS[m.status as MessageStatus]}</Badge>
                  <span className="font-semibold">{String(c?.trade_name ?? c?.name ?? 'Sem cliente')}</span>
                  <span className="text-xs text-cocoa-700">{String(m.template_key ?? 'livre')} · {formatDateBR(m.scheduled_for as string)}</span>
                  {m.reported_sent_at ? <span className="ml-auto text-xs text-cocoa-700">Informado em {formatDateTimeBR(m.reported_sent_at as string)}</span> : null}
                  {m.cancel_reason ? <span className="ml-auto text-xs text-cocoa-700">{String(m.cancel_reason)}</span> : null}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{String(m.body)}</p>
                {tab === 'fila' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" icon={<Copy className="size-4" />} onClick={() => navigator.clipboard.writeText(String(m.body)).then(() => toast('Mensagem copiada.'))}>Copiar</Button>
                    <Button size="sm" variant="secondary" icon={<ExternalLink className="size-4" />} disabled={!link} title={!link ? 'Telefone inválido' : undefined} onClick={() => { window.open(link!, '_blank', 'noopener'); setStatus(m, 'aberta', { opened_at: new Date().toISOString() }); }}>Abrir WhatsApp</Button>
                    <Button size="sm" icon={<CheckCheck className="size-4" />} disabled={m.status !== 'aberta'} onClick={() => setStatus(m, 'envio_informado', { reported_sent_at: new Date().toISOString() })}>Informar envio</Button>
                    <Button size="sm" variant="ghost" icon={<XCircle className="size-4" />} onClick={() => setStatus(m, 'cancelada', { cancel_reason: 'Cancelada pelo usuário' })}>Cancelar</Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-4 flex items-center gap-1 text-xs text-cocoa-700"><Settings2 className="size-3.5" /> WhatsApp Business Platform (entrega confirmada por API) é opcional e depende de contratação — veja Integrações.</p>
    </div>
  );
}

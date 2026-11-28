import { useMemo, useState } from 'react';
import { ExternalLink, Copy, Phone, Play, Share2 } from 'lucide-react';
import { sharePdfWithMessage } from '@/lib/shareBoleto';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card, Tabs } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, LoadingBlock, friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { whatsappLink } from '@/domain/messages';
import { formatDateBR, todaySP } from '@/domain/dates';
import { formatReais, toCents } from '@/domain/money';
import { calculateCharges, chargeRulesFromRow } from '@/domain/collections';
import { cobrancaMessage, cobrancaStage, COBRANCA_STAGE, type CobrancaStage } from '@/domain/cobranca';
import { useProtestMap } from './ReceivableStatusBadge';
import { CollectionRulesForm } from './CollectionRulesForm';

type Tab = CobrancaStage | 'regras';
const TABS: [Tab, string][] = [['vencido', 'Vencidos'], ['a_vencer', 'A vencer'], ['cartorio', 'Em cartório'], ['protestado', 'Protestados'], ['regras', 'Regras de cobrança']];

/** Cobrança: quem cobrar hoje, separado por situação. Abrir o WhatsApp não é envio; o registro é manual. */
export function CollectionsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [tab, setTab] = useState<Tab>('vencido');
  const [running, setRunning] = useState(false);
  const runRules = async () => {
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
  const recv = useList<Row>('receivables_view', { filters: [{ column: 'status', op: 'in', value: ['em_aberto', 'parcialmente_pago'] }], order: [{ column: 'due_date' }], range: [0, 4999] });
  const protests = useProtestMap();
  const boletos = useList<Row>('boletos', { select: 'id,receivable_id,digitable_line,status', filters: [{ column: 'status', op: 'eq', value: 'registrado' }], range: [0, 4999] });
  const pdfs = useList<Row>('attachments', { select: 'entity_id,storage_path,file_name,created_at', filters: [{ column: 'entity_type', op: 'eq', value: 'boleto' }, { column: 'archived_at', op: 'is', value: null }], order: [{ column: 'created_at', ascending: false }], range: [0, 4999] });
  // PDF mais recente de cada boleto (por id do boleto).
  const pdfByBoleto = useMemo(() => new Map<string, { storage_path: string; file_name: string }>((pdfs.data?.rows ?? []).map((a) => [String(a.entity_id), { storage_path: String(a.storage_path), file_name: String(a.file_name ?? 'boleto.pdf') }])), [pdfs.data]);
  const boletoByReceivable = useMemo(() => new Map((boletos.data?.rows ?? []).map((b) => [String(b.receivable_id), String(b.id)])), [boletos.data]);
  const settings = useList<Row>('settings', { range: [0, 499] });
  const holidays = useList<Row>('holidays', { select: 'day', range: [0, 1999] });
  const rules = useList<Row>('collection_rules', { range: [0, 499] });
  const company = useList<Row>('company', {});
  const today = todaySP();
  const dueSoon = Number(settings.data?.rows.find((s) => s.key === 'finance.due_soon_days')?.value ?? 7);
  const holidaySet = useMemo(() => new Set((holidays.data?.rows ?? []).map((h) => String(h.day))), [holidays.data]);
  const lineByReceivable = useMemo(() => new Map((boletos.data?.rows ?? []).map((b) => [String(b.receivable_id), String(b.digitable_line ?? '')])), [boletos.data]);
  const empresa = String(company.data?.rows[0]?.trade_name ?? 'JK CHOPP');

  const items = useMemo(() => (recv.data?.rows ?? []).map((r) => {
    const stage = cobrancaStage({ open: true, dueDate: String(r.due_date), today, dueSoonDays: dueSoon, protest: protests.get(String(r.id)) ?? null });
    if (!stage) return null;
    const outstanding = toCents(Number(r.outstanding ?? 0));
    const rule = (r.collection_rule_snapshot as Row | null) ?? rules.data?.rows.find((x) => !x.customer_id) ?? null;
    const ch = calculateCharges(outstanding, String(r.due_date), today, chargeRulesFromRow(rule), holidaySet);
    const total = ch.total;
    const nome = String(r.customer_trade_name ?? r.customer_name ?? '');
    const phone = String(r.customer_whatsapp ?? r.customer_phone ?? '');
    const values = { nome, empresa, valor: formatReais(outstanding / 100), valorAtualizado: formatReais(total / 100), vencimento: formatDateBR(String(r.due_date)), diasAtraso: ch.daysLate, linhaDigitavel: lineByReceivable.get(String(r.id)) || null };
    const boletoId = boletoByReceivable.get(String(r.id));
    const pdf = boletoId ? pdfByBoleto.get(boletoId) ?? null : null;
    return { r, stage, phone, total, daysLate: ch.daysLate, text: cobrancaMessage(stage, values), nome, pdf };
  }).filter((x): x is NonNullable<typeof x> => x !== null), [recv.data, protests, today, dueSoon, holidaySet, lineByReceivable, empresa, rules.data, boletoByReceivable, pdfByBoleto]);

  const sharePdf = async (x: (typeof items)[number]) => {
    if (!x.pdf) return toast('Este boleto não tem PDF anexado.', 'warning');
    try {
      const r = await sharePdfWithMessage({ storagePath: x.pdf.storage_path, fileName: x.pdf.file_name, text: x.text, phone: x.phone });
      if (r === 'downloaded') toast('PDF baixado. Anexe-o na conversa do WhatsApp que acabou de abrir.', 'warning');
      if (r === 'shared') toast('Se a mensagem não vier junto com o PDF, cole-a na conversa: ela foi copiada.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  const byStage = (s: CobrancaStage) => items.filter((x) => x.stage === s).sort((a, b) => String(a.r.due_date).localeCompare(String(b.r.due_date)));
  const counts: Record<string, number> = { vencido: byStage('vencido').length, a_vencer: byStage('a_vencer').length, cartorio: byStage('cartorio').length, protestado: byStage('protestado').length };
  const list = tab === 'regras' ? [] : byStage(tab);

  const registerCharge = async (x: (typeof items)[number]) => {
    try {
      await db().insert('customer_interactions', { customer_id: x.r.customer_id, kind: 'cobranca', summary: `Cobrança (${COBRANCA_STAGE[x.stage].label}) — ${String(x.r.description)} — saldo ${formatReais(Number(x.r.outstanding))}` });
      invalidate();
      toast('Cobrança registrada no histórico do cliente.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Cobranças" subtitle="Quem cobrar hoje: vencidos, a vencer, em cartório e protestados. Valores com multa e juros pela regra do título."
        actions={can('automacoes', 'edit') && <Button icon={<Play className="size-4" />} loading={running} onClick={runRules}>Gerar fila agora</Button>} />
      <Tabs tabs={TABS.map(([k, label]) => ({ key: k, label, count: k === 'regras' ? undefined : counts[k] }))} value={tab} onChange={(k) => setTab(k as Tab)} />
      {tab === 'regras' ? <CollectionRulesForm /> : recv.isLoading ? <Card opaque><LoadingBlock /></Card> : list.length === 0 ? (
        <Card><EmptyState title={`Nenhum título em "${COBRANCA_STAGE[tab as CobrancaStage].label}"`} description={COBRANCA_STAGE[tab as CobrancaStage].help} /></Card>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-cocoa-700">{COBRANCA_STAGE[tab as CobrancaStage].help}</p>
          {list.map((x) => {
            const link = x.phone ? whatsappLink(x.phone, x.text) : null;
            return (
              <Card key={String(x.r.id)} opaque>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={COBRANCA_STAGE[x.stage].tone}>{COBRANCA_STAGE[x.stage].label}</Badge>
                  <span className="font-semibold">{x.nome || 'Sem nome'}</span>
                  <span className="text-xs text-cocoa-700">{String(x.r.description)}</span>
                  <span className="ml-auto text-sm font-semibold num">{formatReais(x.total / 100)}</span>
                </div>
                <p className="mt-1 text-xs text-cocoa-700">
                  Vencimento {formatDateBR(String(x.r.due_date))}
                  {x.daysLate > 0 ? ` · ${x.daysLate} dia(s) de atraso (multa e juros inclusos)` : ' · ainda não venceu'}
                  {x.phone ? '' : ' · sem WhatsApp cadastrado'}
                </p>
                <p className="mt-2 whitespace-pre-wrap rounded-xl bg-cream-100 p-2 text-sm">{x.text}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" icon={<Share2 className="size-4" />} disabled={!x.pdf} title={!x.pdf ? 'Anexe o PDF do boleto para enviar' : undefined} onClick={() => sharePdf(x)}>Enviar PDF + cobrança</Button>
                  <Button size="sm" variant="secondary" icon={<Copy className="size-4" />} onClick={() => navigator.clipboard.writeText(x.text).then(() => toast('Mensagem copiada.'))}>Copiar</Button>
                  <Button size="sm" variant="secondary" icon={<ExternalLink className="size-4" />} disabled={!link} title={!link ? 'Cadastre o WhatsApp do cliente' : undefined} onClick={() => window.open(link!, '_blank', 'noopener')}>Abrir WhatsApp</Button>
                  {x.phone && <Button size="sm" variant="ghost" icon={<Phone className="size-4" />} onClick={() => window.open(`tel:${x.phone.replace(/\D/g, '')}`)}>Ligar</Button>}
                  {can('cobranca', 'create') && <Button size="sm" variant="soft" onClick={() => registerCharge(x)}>Registrar cobrança feita</Button>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

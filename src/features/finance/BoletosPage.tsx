import { useEffect, useRef, useState } from 'react';
import { Plus, Copy, ScanLine, FileUp, Search, Download, CheckCircle2, Landmark, Ban, Archive, RotateCcw, CalendarClock, Wrench } from 'lucide-react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, LoadingBlock, friendlyError } from '@/components/ui/Feedback';
import { Attachments } from '@/components/ui/Attachments';
import { ReceiptDialog, METHODS } from './ReceiptDialog';
import { ProtestDialog } from './ProtestsPage';
import { useProtestMap } from './ReceivableStatusBadge';
import { PROTEST_STATUS, type ProtestStatus } from '@/domain/collections';
import { BOLETO_STATUS, boletoStatus, notaryReleasePath, type BoletoStatusKey } from '@/domain/boletoStatus';
import { Modal } from '@/components/ui/Overlay';
import { SelectInput, TextInput } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { formatReais } from '@/domain/money';
import { addDays, diffDays, formatDateBR, nextBusinessDay, todaySP } from '@/domain/dates';
import { BANKS, BoletoError, extractBoletoHints, findBoletoInText, parseBoleto, type BoletoInfo } from '@/domain/boleto';
import { formatDocument } from '@/domain/documents';
import { calculateCharges, chargeRulesFromRow, plannedProtestDate } from '@/domain/collections';
import { toCents } from '@/domain/money';
import { extractPdf } from '@/lib/pdfText';

type BoletoFilter = 'todos' | BoletoStatusKey;
const FILTERS: [BoletoFilter, string][] = [['todos', 'Todos'], ['em_aberto', 'Em aberto'], ['vencido', 'Vencido'], ['protesto', 'Protesto'], ['pago_em_protesto', 'Pago/ainda em protesto'], ['pago', 'Pago'], ['cancelado', 'Cancelado']];
const METHOD_LABEL: Record<string, string> = { pix: 'Pix', boleto: 'boleto', dinheiro: 'dinheiro', cartao_credito: 'cartão de crédito', cartao_debito: 'cartão de débito', transferencia: 'transferência', cheque: 'cheque', cartorio: 'no cartório', outro: 'outra forma' };

/** Uma das 6 situações + detalhe (forma de pagamento, dias de atraso, etapa no cartório). */
function boletoSituation(b: Row, r: Row | undefined, protest: ProtestStatus, holidays: ReadonlySet<string> = new Set()) {
  // Vencimento em fim de semana/feriado pode ser pago no próximo dia útil sem atraso.
  const due = nextBusinessDay(String(b.due_date ?? r?.due_date ?? ''), holidays);
  const key = boletoStatus({ boletoStatus: String(b.status), receivableStatus: String(r?.status ?? 'em_aberto'), dueDate: due, today: todaySP(), protest: protest === 'nao_encaminhado' ? null : protest });
  const def = BOLETO_STATUS[key];
  const extra: string[] = [];
  if ((key === 'pago' || key === 'pago_em_protesto') && r?.payment_method) extra.push(`recebido via ${METHOD_LABEL[String(r.payment_method)] ?? String(r.payment_method)}`);
  if (key === 'vencido') extra.push(`${diffDays(due, todaySP())} dia(s) de atraso`);
  if (key === 'em_aberto' && r?.status === 'parcialmente_pago') extra.push('pagamento parcial');
  if ((key === 'protesto' || key === 'pago_em_protesto') && protest) extra.push(`cartório: ${PROTEST_STATUS[protest]}`);
  if (key === 'cancelado' && b.status === 'baixado') extra.push('baixado no banco sem pagamento');
  return { key, label: def.label, tone: def.tone, detail: `${def.help}${extra.length ? ` (${extra.join(' · ')})` : ''}`, sub: extra.join(' · ') };
}

/** Boletos emitidos no banco e cadastrados no sistema. Sem integração bancária, NADA é emitido pelo sistema. */
export function BoletosPage() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [filter, setFilter] = useState<BoletoFilter>('todos');
  const [q, setQ] = useState('');
  const boletos = useList<Row>('boletos', { order: [{ column: 'due_date' }], range: [0, 1999] });
  const recv = useList<Row>('receivables_view', { range: [0, 4999] });
  const pdfs = useList<Row>('attachments', { select: 'entity_id', filters: [{ column: 'entity_type', op: 'eq', value: 'boleto' }, { column: 'archived_at', op: 'is', value: null }], range: [0, 4999] });
  const protests = useProtestMap();
  const holidaysQ = useList<Row>('holidays', { select: 'day', range: [0, 1999] });
  const hol = new Set((holidaysQ.data?.rows ?? []).map((h) => String(h.day)));
  const byId = new Map((recv.data?.rows ?? []).map((r) => [String(r.id), r]));
  const withPdf = new Set((pdfs.data?.rows ?? []).map((a) => String(a.entity_id)));
  const toast = useToast();
  const rows = (boletos.data?.rows ?? []).map((b) => {
    const r = byId.get(String(b.receivable_id));
    return { b, r, s: boletoSituation(b, r, protests.get(String(b.receivable_id)) ?? 'nao_encaminhado', hol) };
  });
  const term = q.trim().toLowerCase();
  const visible = rows.filter(({ b, r, s }) => (filter === 'todos' || s.key === filter) && (!term || [b.document_number, b.your_number, b.our_number, b.digitable_line, r?.customer_name, r?.customer_trade_name].some((x) => String(x ?? '').toLowerCase().includes(term))));
  const count = (k: BoletoFilter) => (k === 'todos' ? rows.length : rows.filter((x) => x.s.key === k).length);
  const current = rows.find((x) => String(x.b.id) === detail);
  return (
    <div className="animate-fade-in">
      <PageHeader title="Boletos" subtitle="Boletos emitidos no banco: códigos, PDF, pagamento, atraso, cancelamento e protesto em um só lugar."
        actions={can('cobranca', 'create') && <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Cadastrar boleto</Button>} />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-cocoa-700" aria-hidden />
          <input className="input w-full pl-9" placeholder="Buscar por nº do documento, seu número, nosso número, linha ou cliente" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar boleto" />
        </div>
      </div>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold ${filter === k ? 'border-tangerine-600 bg-tangerine-600 text-white' : 'border-tangerine-200 bg-white/70 text-cocoa-800'}`}>
            {label} <span className="opacity-75">({count(k)})</span>
          </button>
        ))}
      </div>
      {boletos.isLoading ? <Card opaque><LoadingBlock /></Card> : visible.length === 0 ? <Card><EmptyState title={rows.length ? 'Nenhum boleto neste filtro' : 'Nenhum boleto cadastrado'} /></Card> : (
        <div className="surface overflow-x-auto rounded-[var(--radius-card)]">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-cream-100 text-left text-xs uppercase text-cocoa-700"><tr><th className="px-4 py-3">Código</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Nosso nº</th><th className="px-4 py-3">Vencimento</th><th className="px-4 py-3 text-right">Valor</th><th className="px-4 py-3 text-right">Saldo</th><th className="px-4 py-3">Protesto previsto</th><th className="px-4 py-3">Situação</th><th className="px-4 py-3" /></tr></thead>
            <tbody>{visible.map(({ b, r, s }) => (
              <tr key={String(b.id)} className="cursor-pointer border-t border-tangerine-100 hover:bg-cream-100/60" onClick={() => setDetail(String(b.id))}>
                <td className="px-4 py-3"><span className="font-semibold">{b.document_number ? `Nº ${String(b.document_number)}` : '—'}</span>{b.your_number ? <span className="block text-xs text-cocoa-700">Seu nº {String(b.your_number)}</span> : null}</td>
                <td className="px-4 py-3">{String(r?.customer_trade_name ?? r?.customer_name ?? '—')}</td>
                <td className="whitespace-nowrap px-4 py-3">{String(b.our_number ?? '—')}<span className="block text-xs text-cocoa-700">Banco {String(b.bank_code ?? '—')}{b.wallet ? ` · cart. ${String(b.wallet)}` : ''}</span></td>
                <td className="whitespace-nowrap px-4 py-3">{formatDateBR(b.due_date as string)}</td>
                <td className="num whitespace-nowrap px-4 py-3 text-right">{formatReais(b.original_amount as number)}</td>
                <td className="num whitespace-nowrap px-4 py-3 text-right">{formatReais(r?.outstanding as number)}{(() => { const c = updatedCharges(b, r, hol); return c && c.total > c.principal ? <span className="block text-xs font-semibold text-red-700" title={`Multa ${formatReais(c.fine / 100)} + juros ${formatReais(c.interest / 100)} (${c.daysLate} dia(s))`}>Atualizado {formatReais(c.total / 100)}</span> : null; })()}</td>
                <td className="whitespace-nowrap px-4 py-3">{b.planned_protest_date ? formatDateBR(b.planned_protest_date as string) : '—'}</td>
                <td className="px-4 py-3"><span title={s.detail}><Badge tone={s.tone}>{s.label}</Badge></span>{s.sub ? <span className="mt-1 block text-xs text-cocoa-700">{s.sub}</span> : null}</td>
                <td className="whitespace-nowrap px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  {b.digitable_line ? <Button size="sm" variant="ghost" icon={<Copy className="size-4" />} onClick={() => navigator.clipboard.writeText(String(b.digitable_line)).then(() => toast('Linha digitável copiada.'))}>Linha</Button> : null}
                  {withPdf.has(String(b.id)) && <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={() => void downloadBoletoPdf(String(b.id), toast)}>PDF</Button>}
                  <Button size="sm" variant="soft" onClick={() => setDetail(String(b.id))}>Gerenciar</Button>
                </td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {open && <BoletoForm onClose={() => setOpen(false)} />}
      {current && <BoletoDetail b={current.b} r={current.r} situation={current.s} onClose={() => setDetail(null)} />}
    </div>
  );
}

/** Multa e juros de hoje pela regra gravada no título (snapshot), somente para boleto ativo e título em aberto. */
function updatedCharges(b: Row, r: Row | undefined, holidays: ReadonlySet<string>) {
  if (!r || b.status !== 'registrado' || !['em_aberto', 'parcialmente_pago'].includes(String(r.status))) return null;
  const outstanding = toCents(Number(r.outstanding ?? 0));
  if (outstanding <= 0) return null;
  return calculateCharges(outstanding, String(r.due_date), todaySP(), chargeRulesFromRow(r.collection_rule_snapshot as Row | null), holidays);
}

/** Baixa o PDF mais recente anexado ao boleto (link temporário e privado). */
async function downloadBoletoPdf(boletoId: string, toast: (m: string, t?: 'success' | 'warning' | 'danger' | 'info' | 'neutral') => void) {
  try {
    const { rows } = await db().list<Row>('attachments', { filters: [{ column: 'entity_type', op: 'eq', value: 'boleto' }, { column: 'entity_id', op: 'eq', value: boletoId }, { column: 'archived_at', op: 'is', value: null }], order: [{ column: 'created_at', ascending: false }], range: [0, 0] });
    if (!rows[0]) return toast('Nenhum PDF anexado a este boleto.', 'warning');
    const url = await db().storage.signedUrl(String(rows[0].storage_path), 300);
    const blob = await (await fetch(url)).blob();
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: String(rows[0].file_name ?? 'boleto.pdf') });
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    toast(friendlyError(e), 'danger');
  }
}

/** Gestão do boleto: dados, PDF, pagamento, cancelamento/baixa e protesto. */
function BoletoDetail({ b, r, situation, onClose }: { b: Row; r?: Row; situation: ReturnType<typeof boletoSituation>; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const protest = useList<Row>('protest_records', { filters: [{ column: 'receivable_id', op: 'eq', value: b.receivable_id }] });
  const pRow = protest.data?.rows[0];
  // Protesto "não encaminhado" (ex.: desfeito por correção) equivale a não ter protesto.
  const p = pRow && pRow.status !== 'nao_encaminhado' ? pRow : undefined;
  const [receipt, setReceipt] = useState(false);
  const [protestOpen, setProtestOpen] = useState(false);
  const [statusAction, setStatusAction] = useState<'cancelado' | 'baixado' | 'registrado' | null>(null);
  const [reason, setReason] = useState('');
  const [cancelTitle, setCancelTitle] = useState(false);
  const active = b.status === 'registrado';
  const holidaysQ = useList<Row>('holidays', { select: 'day', range: [0, 1999] });
  const holidayDays = new Set((holidaysQ.data?.rows ?? []).map((h) => String(h.day)));
  const open = r && ['em_aberto', 'parcialmente_pago'].includes(String(r.status));

  const changeStatus = async () => {
    try {
      await db().rpc('set_boleto_status', { p_boleto: b.id, p_status: statusAction, p_reason: reason, p_cancel_receivable: cancelTitle });
      invalidate();
      toast(statusAction === 'registrado' ? 'Boleto reativado.' : statusAction === 'baixado' ? 'Boleto baixado.' : cancelTitle ? 'Boleto e título cancelados.' : 'Boleto cancelado.');
      setStatusAction(null);
      setReason('');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  const [fixOpen, setFixOpen] = useState(false);
  const [fix, setFix] = useState<{ action: '' | 'desfazer_protesto' | 'forma_pagamento' | 'estornar_pagamento'; reason: string; method: string }>({ action: '', reason: '', method: 'boleto' });
  const paidSomething = Number(r?.paid_amount ?? 0) > 0;
  const fixOptions = [
    ...(p ? [{ value: 'desfazer_protesto', label: 'Desfazer protesto lançado por engano (volta a não ter protesto)' }] : []),
    ...(paidSomething ? [{ value: 'forma_pagamento', label: 'Corrigir a forma de recebimento (ex.: Pix → boleto)' }, { value: 'estornar_pagamento', label: 'Estornar pagamento lançado por engano (volta a ficar em aberto/vencido)' }] : [])
  ];
  const applyFix = async () => {
    if (!fix.action) return toast('Escolha o que corrigir.', 'warning');
    if (!fix.reason.trim()) return toast('Informe o motivo da correção.', 'warning');
    try {
      await db().rpc('correct_boleto', { p_boleto: b.id, p_action: fix.action, p_reason: fix.reason, p_method: fix.action === 'forma_pagamento' ? fix.method : null });
      invalidate();
      toast(fix.action === 'desfazer_protesto' ? 'Protesto desfeito. A situação foi recalculada.' : fix.action === 'forma_pagamento' ? 'Forma de recebimento corrigida.' : 'Pagamento estornado. O boleto voltou a ficar em aberto.');
      setFixOpen(false);
      setFix({ action: '', reason: '', method: 'boleto' });
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  const [inNotary, setInNotary] = useState(false);
  const [notary, setNotary] = useState({ stage: 'em_cartorio' as 'em_cartorio' | 'protestado', office: '', protocol: '', date: '' });
  /** Registra um título que já foi ao cartório (pelo banco), mesmo que já esteja pago — passa pelas etapas válidas. */
  const registerInNotary = async () => {
    try {
      let rec = pRow;
      if (!rec) rec = await db().insert<Row>('protest_records', { receivable_id: b.receivable_id, boleto_id: b.id, status: 'programado', planned_date: b.planned_protest_date ?? null });
      const id = String(rec.id);
      await db().update('protest_records', id, { status: 'encaminhado', notary_office: notary.office || null, protocol_number: notary.protocol || null, notes: 'Título já encaminhado ao cartório (registrado no sistema)' });
      await db().update('protest_records', id, notary.stage === 'protestado'
        ? { status: 'protestado', protested_at: notary.date || todaySP() }
        : { status: 'em_cartorio' });
      invalidate();
      setInNotary(false);
      toast(r?.status === 'pago' ? 'Cartório registrado. O boleto aparece como "Pago, mas ainda em protesto" até o cliente resolver no cartório.' : 'Cartório registrado no boleto.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  /** Cliente já deu baixa no cartório: avança as etapas válidas até "Protesto cancelado" (ou "Retirado"). */
  const releaseNotary = async () => {
    if (!p) return;
    const path = notaryReleasePath(p.status as ProtestStatus);
    if (!path.length) return;
    if (!confirm('Confirmar que o título já saiu do cartório (cliente pagou as custas e deu baixa)?')) return;
    try {
      for (const st of path) await db().update('protest_records', String(p.id), { status: st, notes: 'Baixa no cartório confirmada', ...(st === 'protesto_cancelado' || st === 'retirado' ? { cancellation_requested_at: todaySP() } : {}) });
      invalidate();
      toast(r?.status === 'pago' ? 'Baixa no cartório registrada. O boleto agora aparece como "Pago".' : 'Baixa no cartório registrada.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  const scheduleProtest = async () => {
    try {
      await db().insert('protest_records', { receivable_id: b.receivable_id, boleto_id: b.id, status: 'programado', planned_date: b.planned_protest_date ?? null });
      invalidate();
      toast('Encaminhamento a protesto programado (data interna). Abra "Protesto" para encaminhar ao cartório.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  return (
    <Modal open onClose={onClose} drawer title={`Boleto ${b.document_number ? `nº ${String(b.document_number)}` : String(b.our_number ?? '')}`}>
      <div className="space-y-4">
        <Alert tone={situation.tone === 'neutral' ? 'info' : situation.tone} title={situation.label}>{situation.detail}</Alert>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div className="col-span-2"><dt className="text-xs text-cocoa-700">Cliente</dt><dd className="font-semibold">{String(r?.customer_trade_name ?? r?.customer_name ?? '—')}</dd></div>
          <div><dt className="text-xs text-cocoa-700">Nº do documento</dt><dd>{String(b.document_number ?? '—')}</dd></div>
          <div><dt className="text-xs text-cocoa-700">Seu número</dt><dd>{String(b.your_number ?? '—')}</dd></div>
          <div><dt className="text-xs text-cocoa-700">Nosso número</dt><dd>{String(b.our_number ?? '—')}</dd></div>
          <div><dt className="text-xs text-cocoa-700">Banco / carteira</dt><dd>{String(b.bank_code ?? '—')}{BANKS[String(b.bank_code)] ? ` (${BANKS[String(b.bank_code)]})` : ''}{b.wallet ? ` · ${String(b.wallet)}` : ''}</dd></div>
          <div><dt className="text-xs text-cocoa-700">Emissão</dt><dd>{formatDateBR(b.issue_date as string)}</dd></div>
          <div><dt className="text-xs text-cocoa-700">Vencimento</dt><dd>{formatDateBR(b.due_date as string)}</dd></div>
          <div><dt className="text-xs text-cocoa-700">Valor</dt><dd className="num">{formatReais(b.original_amount as number)}</dd></div>
          <div><dt className="text-xs text-cocoa-700">Saldo do título</dt><dd className="num">{formatReais(r?.outstanding as number)}</dd></div>
          {(() => {
            const c = updatedCharges(b, r, holidayDays);
            const rr = chargeRulesFromRow(r?.collection_rule_snapshot as Row | null);
            return (
              <div className="col-span-2 rounded-xl bg-cream-100 p-2">
                <dt className="text-xs text-cocoa-700">Multa e juros (regra do título: multa {rr.finePercent}% + juros {rr.interestPercent}% {rr.interestPeriod === 'mensal' ? 'a.m.' : 'a.d.'}{rr.graceDays ? `, carência ${rr.graceDays} dia(s)` : ''})</dt>
                <dd>{c && c.daysLate > 0
                  ? <span className="num">{c.daysLate} dia(s) de atraso · multa {formatReais(c.fine / 100)} · juros {formatReais(c.interest / 100)} · <strong>total hoje {formatReais(c.total / 100)}</strong></span>
                  : 'Sem encargos hoje (não vencido ou já quitado).'}</dd>
              </div>
            );
          })()}
          <div><dt className="text-xs text-cocoa-700">Protesto previsto (interno)</dt><dd>{b.planned_protest_date ? formatDateBR(b.planned_protest_date as string) : '—'}</dd></div>
          <div><dt className="text-xs text-cocoa-700">Título</dt><dd>{String(r?.description ?? '—')}</dd></div>
          {b.digitable_line ? <div className="col-span-2"><dt className="text-xs text-cocoa-700">Linha digitável</dt><dd className="flex items-center gap-2 break-all font-mono text-xs">{String(b.digitable_line)}<Button size="sm" variant="ghost" icon={<Copy className="size-4" />} onClick={() => navigator.clipboard.writeText(String(b.digitable_line)).then(() => toast('Linha digitável copiada.'))}>Copiar</Button></dd></div> : null}
        </dl>

        <div className="flex flex-wrap gap-2">
          {open && (can('financeiro', 'create') || can('cobranca', 'edit')) && <Button icon={<CheckCircle2 className="size-4" />} onClick={() => setReceipt(true)}>Registrar pagamento</Button>}
          {p && situation.key === 'pago_em_protesto' && notaryReleasePath(p.status as ProtestStatus).length > 0 && can('cobranca', 'edit') && <Button icon={<CheckCircle2 className="size-4" />} onClick={releaseNotary}>Cliente deu baixa no cartório</Button>}
          {p ? <Button variant="secondary" icon={<Landmark className="size-4" />} onClick={() => setProtestOpen(true)}>{situation.key === 'pago_em_protesto' || situation.key === 'protesto' ? 'Cartório / carta de anuência' : `Protesto: ${PROTEST_STATUS[p.status as ProtestStatus]}`}</Button>
            : <>
              {active && open && can('cobranca', 'create') && <Button variant="secondary" icon={<CalendarClock className="size-4" />} onClick={scheduleProtest}>Programar protesto</Button>}
              {b.status !== 'cancelado' && can('cobranca', 'create') && <Button variant="secondary" icon={<Landmark className="size-4" />} onClick={() => setInNotary(true)}>Já está no cartório</Button>}
            </>}
          {active && (can('cobranca', 'cancel') || can('financeiro', 'cancel')) && <>
            <Button variant="ghost" icon={<Ban className="size-4" />} onClick={() => setStatusAction('cancelado')}>Cancelar boleto</Button>
            <Button variant="ghost" icon={<Archive className="size-4" />} onClick={() => setStatusAction('baixado')} title="Somente quando o boleto foi retirado do banco SEM pagamento">Baixar no banco (sem pagamento)</Button>
          </>}
          {(b.status === 'cancelado' || b.status === 'baixado') && (can('cobranca', 'cancel') || can('financeiro', 'cancel')) && <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setStatusAction('registrado')}>Reativar boleto</Button>}
          {fixOptions.length > 0 && (can('cobranca', 'approve') || can('financeiro', 'edit') || can('admin', 'edit')) && <Button variant="ghost" icon={<Wrench className="size-4" />} onClick={() => setFixOpen((x) => !x)}>Corrigir situação</Button>}
        </div>
        {situation.key === 'pago_em_protesto' && p && (
          <Alert tone="warning" title="O que fazer">
            1) Não cobre de novo nem cancele o boleto. 2) Em "Cartório / carta de anuência", gere a carta de anuência e entregue ao cliente.
            3) O cliente vai ao cartório, paga as custas e dá baixa. 4) Quando ele confirmar, toque em "Cliente deu baixa no cartório" — o boleto passa para "Pago".
          </Alert>
        )}
        {situation.key === 'protesto' && (
          <Alert tone="danger" title="No cartório">
            Não dá mais para receber pelo banco. Se o cliente te pagar (ex.: Pix), use "Registrar pagamento" — o boleto vai para "Pago/ainda em protesto" e ele precisa da carta de anuência para dar baixa no cartório.
          </Alert>
        )}

        {fixOpen && (
          <div className="space-y-2 rounded-2xl border border-tangerine-200 bg-white/70 p-3">
            <p className="text-sm font-semibold">Corrigir situação lançada por engano</p>
            <p className="text-xs text-cocoa-700">A correção fica registrada na auditoria com o motivo e o seu usuário. Nada é apagado: o histórico mostra o que foi corrigido.{b.status === 'cancelado' || b.status === 'baixado' ? ' Para desfazer um cancelamento, use "Reativar boleto".' : ''}</p>
            <SelectInput label="O que corrigir" placeholder="Selecione…" value={fix.action} onChange={(e) => setFix((s) => ({ ...s, action: e.target.value as typeof s.action }))} options={fixOptions} />
            {fix.action === 'forma_pagamento' && <SelectInput label="Forma correta" value={fix.method} onChange={(e) => setFix((s) => ({ ...s, method: e.target.value }))} options={METHODS} />}
            {fix.action === 'estornar_pagamento' && <Alert tone="warning">O pagamento será estornado no financeiro (entra como estorno no caixa) e o boleto volta a ficar em aberto ou vencido.</Alert>}
            <TextInput label="Motivo (obrigatório)" value={fix.reason} onChange={(e) => setFix((s) => ({ ...s, reason: e.target.value }))} placeholder="Ex.: lancei o protesto no boleto errado" />
            <div className="flex gap-2"><Button size="sm" onClick={applyFix}>Aplicar correção</Button><Button size="sm" variant="secondary" onClick={() => setFixOpen(false)}>Voltar</Button></div>
          </div>
        )}
        {inNotary && (
          <div className="space-y-2 rounded-2xl border border-tangerine-100 bg-white/60 p-3">
            <p className="text-sm font-semibold">Registrar que o título está no cartório</p>
            <p className="text-xs text-cocoa-700">Use quando o banco já enviou o boleto ao cartório. Se o cliente já pagou (ex.: Pix), registre o pagamento também — o boleto fica como "Pago, mas ainda em protesto" até ele resolver no cartório.</p>
            <SelectInput label="Etapa atual no cartório" value={notary.stage} onChange={(e) => setNotary((s) => ({ ...s, stage: e.target.value as 'em_cartorio' | 'protestado' }))}
              options={[{ value: 'em_cartorio', label: 'Em cartório (ainda não protestado)' }, { value: 'protestado', label: 'Já protestado' }]} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <TextInput label="Cartório (opcional)" value={notary.office} onChange={(e) => setNotary((s) => ({ ...s, office: e.target.value }))} />
              <TextInput label="Protocolo (opcional)" value={notary.protocol} onChange={(e) => setNotary((s) => ({ ...s, protocol: e.target.value }))} />
              {notary.stage === 'protestado' && <TextInput label="Data do protesto" type="date" value={notary.date} onChange={(e) => setNotary((s) => ({ ...s, date: e.target.value }))} />}
            </div>
            <div className="flex gap-2"><Button size="sm" onClick={registerInNotary}>Registrar</Button><Button size="sm" variant="secondary" onClick={() => setInNotary(false)}>Voltar</Button></div>
          </div>
        )}
        {statusAction && (
          <div className="space-y-2 rounded-2xl border border-tangerine-100 bg-white/60 p-3">
            <p className="text-sm font-semibold">{statusAction === 'cancelado' ? 'Cancelar boleto' : statusAction === 'baixado' ? 'Baixar boleto (retirado do banco sem pagamento)' : 'Reativar boleto'}</p>
            <TextInput label="Motivo (fica registrado na auditoria)" required value={reason} onChange={(e) => setReason(e.target.value)} />
            {statusAction === 'cancelado' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cancelTitle} onChange={(e) => setCancelTitle(e.target.checked)} /> Cancelar também o título (a conta a receber deixa de existir para cobrança)</label>}
            <div className="flex gap-2"><Button size="sm" onClick={changeStatus} disabled={!reason.trim()}>Confirmar</Button><Button size="sm" variant="secondary" onClick={() => setStatusAction(null)}>Voltar</Button></div>
          </div>
        )}

        <Attachments entityType="boleto" entityId={String(b.id)} title="PDF do boleto e comprovantes" />
      </div>
      {receipt && r && <ReceiptDialog receivable={r} open onClose={() => { setReceipt(false); invalidate(); }} />}
      {protestOpen && p && <ProtestDialog protest={p} receivable={r} onClose={() => setProtestOpen(false)} />}
    </Modal>
  );
}

const NEW_TITLE = '__novo__';
type BoletoFields = Record<'document_number' | 'our_number' | 'your_number' | 'bank_code' | 'wallet' | 'barcode' | 'digitable_line' | 'issue_date' | 'due_date' | 'original_amount' | 'planned_protest_date', string>;

function BoletoForm({ onClose }: { onClose: () => void }) {
  const customers = useList<Row>('customers', { select: 'id,name,trade_name,document', filters: [{ column: 'status', op: 'neq', value: 'arquivado' }], order: [{ column: 'name' }], range: [0, 4999] });
  const company = useList<Row>('company', {});
  const [customerId, setCustomerId] = useState('');
  const recv = useList<Row>('receivables_view', {
    filters: [{ column: 'status', op: 'in', value: ['em_aberto', 'parcialmente_pago'] }, ...(customerId ? [{ column: 'customer_id', op: 'eq' as const, value: customerId }] : [])],
    order: [{ column: 'due_date' }], range: [0, 999]
  });
  const activeBoletos = useList<Row>('boletos', { select: 'receivable_id,status', filters: [{ column: 'status', op: 'neq', value: 'cancelado' }], range: [0, 4999] });
  const withBoleto = new Set((activeBoletos.data?.rows ?? []).map((b) => String(b.receivable_id)));
  const titles = (recv.data?.rows ?? []).filter((r) => !withBoleto.has(String(r.id)));
  const [receivableId, setReceivableId] = useState(NEW_TITLE);
  const [description, setDescription] = useState('');
  const [v, setV] = useState<BoletoFields>({ document_number: '', our_number: '', your_number: '', bank_code: '', wallet: '', barcode: '', digitable_line: '', issue_date: todaySP(), due_date: '', original_amount: '', planned_protest_date: '' });
  const [code, setCode] = useState('');
  const [read, setRead] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState<'pdf' | 'save' | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const rules = useList<Row>('collection_rules', { range: [0, 499] });
  const holidayRows = useList<Row>('holidays', { select: 'day', range: [0, 1999] });
  const [protestTouched, setProtestTouched] = useState(false);
  // Regra vigente: a específica do cliente (se houver) ou a global.
  const today = todaySP();
  const vigente = (r: Row) => String(r.valid_from ?? '') <= today && (!r.valid_to || String(r.valid_to) >= today);
  const rule = (rules.data?.rows ?? []).filter(vigente).sort((a, b) => String(b.valid_from).localeCompare(String(a.valid_from)))
    .find((r) => customerId && r.customer_id === customerId) ?? (rules.data?.rows ?? []).filter((r) => !r.customer_id && vigente(r))[0];
  const protestRule = rule ? { protestAfterDays: Number(rule.protest_after_days ?? 0), protestDayCount: (rule.protest_day_count === 'uteis' ? 'uteis' : 'corridos') as 'uteis' | 'corridos' } : null;
  const holidaySet = new Set((holidayRows.data?.rows ?? []).map((h) => String(h.day)));
  // Vencimento automático: emissão + N dias corridos (Configurações → Parâmetros → Financeiro).
  const settingsRows = useList<Row>('settings', { range: [0, 499] });
  const dueDays = Number(settingsRows.data?.rows.find((x) => x.key === 'boletos.due_days_after_issue')?.value ?? 5);
  const [dueSource, setDueSource] = useState<'regra' | 'codigo' | 'manual'>('regra');
  const ruleDue = v.issue_date ? addDays(v.issue_date, dueDays) : '';
  useEffect(() => {
    if (dueSource === 'regra' && ruleDue) setV((s) => (s.due_date === ruleDue ? s : { ...s, due_date: ruleDue }));
  }, [ruleDue, dueSource]);
  const charges = rule ? chargeRulesFromRow(rule) : null;
  const suggestedProtest = v.due_date && protestRule ? plannedProtestDate(v.due_date, protestRule, holidaySet) : null;
  useEffect(() => {
    if (!protestTouched) setV((s) => ({ ...s, planned_protest_date: suggestedProtest ?? '' }));
  }, [suggestedProtest, protestTouched]);
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const set = (k: keyof BoletoFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  /** Preenche os campos com o que o código do boleto informa (banco, valor, vencimento, linha e código de barras). */
  const apply = (b: BoletoInfo, origin: string) => {
    setV((s) => ({
      ...s, bank_code: b.kind === 'bancario' ? b.bankCode : s.bank_code, digitable_line: b.digitableLine, barcode: b.barcode,
      due_date: b.dueDate ?? s.due_date, original_amount: b.amount != null ? b.amount.toFixed(2) : s.original_amount,
      // Carteira e nosso número vêm do campo livre do código (layout do banco); prevalecem sobre o texto do PDF.
      wallet: b.wallet ?? s.wallet, our_number: b.ourNumber ?? s.our_number
    }));
    setCode(b.digitableLine);
    if (b.dueDate) setDueSource('codigo');
    const missing = [b.amount == null && 'valor', !b.dueDate && 'vencimento'].filter(Boolean).join(' e ');
    setRead({ tone: missing ? 'warning' : 'success', text: `${origin}: ${b.kind === 'bancario' ? `banco ${b.bankCode}${b.bankName ? ` (${b.bankName})` : ''}` : 'boleto de arrecadação/convênio'}${b.amount != null ? ` · ${formatReais(b.amount)}` : ''}${b.dueDate ? ` · vence ${formatDateBR(b.dueDate)}` : ''}.${missing ? ` O código não traz ${missing}: preencha abaixo.` : ''}` });
  };

  const readCode = (text = code) => {
    if (!text.trim()) return;
    try {
      apply(parseBoleto(text, todaySP()), 'Boleto lido');
    } catch (e) {
      setRead({ tone: 'danger', text: e instanceof BoletoError ? e.message : 'Não foi possível ler o código.' });
    }
  };

  const importPdf = async (file: File) => {
    if (file.size > 15 * 1024 * 1024) return toast('PDF maior que 15 MB.', 'danger');
    setBusy('pdf');
    try {
      // Android (Chrome) recusa reenviar arquivos vindos de Downloads/Drive/WhatsApp depois de lidos
      // (ERR_UPLOAD_FILE_CHANGED). Copiamos o conteúdo para a memória uma única vez e usamos a cópia.
      const copy = new File([await file.arrayBuffer()], file.name, { type: file.type || 'application/pdf' });
      file = copy;
      const { text, items } = await extractPdf(copy);
      const b = findBoletoInText(text, todaySP());
      setPdf(file);
      if (!b) {
        setRead({ tone: 'warning', text: text.trim() ? 'Não encontrei a linha digitável no PDF. Digite ou cole a linha acima — o arquivo será anexado ao boleto.' : 'Este PDF é uma imagem (sem texto). Digite ou cole a linha digitável acima — o arquivo será anexado ao boleto.' });
      } else {
        apply(b, 'PDF lido');
      }
      const hints = extractBoletoHints(text, items);
      setV((s) => ({
        ...s, our_number: b?.ourNumber ?? (hints.ourNumber || s.our_number), wallet: b?.wallet ?? (hints.wallet || s.wallet),
        document_number: hints.documentNumber || s.document_number, your_number: hints.yourNumber || s.your_number,
        issue_date: hints.issueDate || s.issue_date
      }));
      const found = [hints.documentNumber && 'nº do documento', hints.yourNumber && 'seu número', hints.issueDate && 'data do documento'].filter(Boolean);
      const notFound = [!hints.documentNumber && 'nº do documento', !hints.yourNumber && 'seu número'].filter(Boolean);
      if (found.length || notFound.length) toast(`${found.length ? `Lido do PDF: ${found.join(', ')}.` : ''}${notFound.length ? ` Não encontrado no PDF: ${notFound.join(', ')} — preencha se o boleto tiver.` : ''}`.trim(), notFound.length ? 'warning' : 'success');
      // Pagador: o CPF/CNPJ do boleto que não é o da própria empresa (beneficiária) e que existe no cadastro.
      const own = String(company.data?.rows[0]?.document ?? '');
      const match = (customers.data?.rows ?? []).find((c) => c.document && hints.documents.includes(String(c.document)) && String(c.document) !== own);
      if (match && !customerId) {
        setCustomerId(String(match.id));
        setReceivableId(NEW_TITLE);
        toast(`Cliente identificado no PDF: ${String(match.trade_name ?? match.name)}.`);
      } else if (!match && hints.documents.some((d) => d !== own)) {
        toast('O pagador do PDF não está cadastrado. Cadastre o cliente em Clientes ou selecione outro.', 'warning');
      }
    } catch (e) {
      setRead({ tone: 'danger', text: `Não foi possível ler o PDF (${friendlyError(e)}). Digite a linha digitável.` });
    }
    setBusy(null);
  };

  const submit = async () => {
    const isNew = receivableId === NEW_TITLE;
    if (!customerId && isNew) return toast('Selecione o cliente do boleto.', 'warning');
    if (!v.due_date || !(Number(v.original_amount) > 0)) return toast('Preencha vencimento e valor (ou leia o boleto pela linha digitável/PDF).', 'warning');
    setBusy('save');
    try {
      let filePath = '';
      let pdfWarning = '';
      if (pdf && db().mode === 'supabase') {
        // O boleto é salvo mesmo se o envio do PDF falhar (rede instável); o PDF pode ser anexado depois.
        const path = `boleto/${crypto.randomUUID()}-${pdf.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-80)}`;
        try {
          await Promise.race([db().storage.upload(path, pdf), new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), 45_000))]);
          filePath = path;
        } catch (e) {
          pdfWarning = ` O PDF não foi enviado (${friendlyError(e)}): abra o boleto em "Gerenciar" e anexe novamente.`;
        }
      }
      const r = await db().rpc<{ boleto_id: string; receivable_created: boolean }>('create_boleto', {
        p_customer: customerId || null, p_receivable: isNew ? null : receivableId, p_description: description || null,
        p_boleto: { ...v, file_path: filePath }
      });
      if (filePath && pdf) {
        await db().insert('attachments', { entity_type: 'boleto', entity_id: r.boleto_id, storage_path: filePath, file_name: pdf.name, mime_type: pdf.type || 'application/pdf', size_bytes: pdf.size, category: 'boleto' });
      }
      invalidate();
      toast(`${r.receivable_created ? 'Boleto cadastrado e conta a receber criada.' : 'Boleto cadastrado e vinculado ao título.'}${pdfWarning}`, pdfWarning ? 'warning' : 'success');
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
    setBusy(null);
  };

  const customerOptions = (customers.data?.rows ?? []).map((c) => ({ value: String(c.id), label: `${String(c.trade_name ?? c.name)}${c.document ? ` — ${formatDocument(String(c.document))}` : ''}` }));
  return (
    <Modal open onClose={onClose} title="Cadastrar boleto emitido" drawer footer={<Button onClick={submit} loading={busy === 'save'}>Salvar</Button>}>
      <div className="space-y-4">
        <div className="rounded-2xl border border-tangerine-100 bg-white/60 p-3">
          <p className="mb-2 text-sm font-semibold">Ler o boleto</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <TextInput wrapperClassName="flex-1" label="Linha digitável ou código de barras" inputMode="numeric" value={code}
              onChange={(e) => { setCode(e.target.value); const d = e.target.value.replace(/\D/g, ''); if ([44, 47, 48].includes(d.length)) readCode(e.target.value); }}
              onBlur={() => readCode()} placeholder="Cole ou digite os números" />
            <div className="flex gap-2">
              <Button variant="soft" icon={<ScanLine className="size-4" />} onClick={() => readCode()}>Ler</Button>
              <input ref={pdfInput} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importPdf(f); }} />
              <Button variant="secondary" icon={<FileUp className="size-4" />} loading={busy === 'pdf'} onClick={() => pdfInput.current?.click()}>Importar PDF</Button>
            </div>
          </div>
          {read && <div className="mt-2"><Alert tone={read.tone}>{read.text}</Alert></div>}
          {pdf && <p className="mt-2 text-xs text-cocoa-700">Arquivo: {pdf.name}{db().mode === 'supabase' ? ' — será anexado ao boleto.' : ' — anexos ficam disponíveis com o servidor configurado.'}</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SelectInput wrapperClassName="sm:col-span-2" label="Cliente (pagador)" required placeholder={customers.isLoading ? 'Carregando…' : 'Selecione…'} value={customerId}
            onChange={(e) => { setCustomerId(e.target.value); setReceivableId(NEW_TITLE); }} options={customerOptions}
            hint={customerOptions.length === 0 ? 'Nenhum cliente cadastrado. Cadastre o cliente em Clientes antes do boleto.' : 'Cliente não aparece? Cadastre em Clientes e volte aqui.'} />
          <SelectInput wrapperClassName="sm:col-span-2" label="Título (conta a receber)" value={receivableId}
            onChange={(e) => {
              const id = e.target.value;
              setReceivableId(id);
              const r = titles.find((x) => String(x.id) === id);
              if (r) {
                if (!customerId) setCustomerId(String(r.customer_id));
                if (dueSource === 'regra' && r.due_date) setDueSource('manual');
                setV((s) => ({ ...s, due_date: dueSource === 'regra' ? String(r.due_date ?? s.due_date) : s.due_date || String(r.due_date ?? ''), original_amount: s.original_amount || String(r.outstanding ?? '') }));
              }
            }}
            options={[{ value: NEW_TITLE, label: '➕ Criar novo título com os dados deste boleto' },
              ...titles.map((r) => ({ value: String(r.id), label: `${customerId ? '' : `${String(r.customer_trade_name ?? r.customer_name)} — `}${String(r.description)} · vence ${formatDateBR(r.due_date as string)} (${formatReais(r.outstanding as number)})` }))]}
            hint={receivableId === NEW_TITLE ? 'A conta a receber será criada automaticamente com o valor e o vencimento do boleto.' : 'O boleto será vinculado a este título já existente.'} />
          {receivableId === NEW_TITLE && <TextInput wrapperClassName="sm:col-span-2" label="Descrição do título (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Pedido nº 120 — chopp evento 12/12" />}
          <TextInput label="Banco (código)" value={v.bank_code} onChange={set('bank_code')} hint={v.bank_code && BANKS[v.bank_code] ? BANKS[v.bank_code] : undefined} />
          <TextInput label="Carteira" value={v.wallet} onChange={set('wallet')} />
          <TextInput label="Número do documento" value={v.document_number} onChange={set('document_number')} />
          <TextInput label="Seu número" value={v.your_number} onChange={set('your_number')} />
          <TextInput label="Nosso número" value={v.our_number} onChange={set('our_number')} />
          <TextInput label="Emissão" type="date" value={v.issue_date} onChange={set('issue_date')} hint={`O vencimento é preenchido com ${dueDays} dia(s) corridos após a emissão.`} />
          <TextInput label="Vencimento" type="date" required value={v.due_date}
            onChange={(e) => { setDueSource('manual'); setV((s) => ({ ...s, due_date: e.target.value })); }}
            hint={dueSource === 'regra' ? `Automático: emissão + ${dueDays} dia(s) corridos.`
              : dueSource === 'codigo' ? `Lido do código do boleto.${ruleDue && v.due_date !== ruleDue ? ` Atenção: pela regra (emissão + ${dueDays}) seria ${formatDateBR(ruleDue)} — confira com o banco.` : ''}`
              : `Alterado manualmente.${ruleDue && v.due_date !== ruleDue ? ` Pela regra seria ${formatDateBR(ruleDue)}.` : ''}`} />
          <TextInput label="Valor original (R$)" type="number" step="0.01" required value={v.original_amount} onChange={set('original_amount')} />
          <TextInput label="Encaminhamento a protesto previsto (data interna)" type="date" value={v.planned_protest_date}
            onChange={(e) => { setProtestTouched(true); setV((s) => ({ ...s, planned_protest_date: e.target.value })); }}
            hint={protestRule && protestRule.protestAfterDays > 0
              ? `Calculado: ${protestRule.protestAfterDays} dia(s) ${protestRule.protestDayCount === 'uteis' ? 'úteis' : 'corridos'} após o vencimento (regra de cobrança${rule?.customer_id ? ' do cliente' : ''}${protestRule.protestDayCount === 'uteis' ? ', sem fins de semana e feriados cadastrados' : ''}). Não é a data efetiva do protesto.${protestTouched && suggestedProtest && v.planned_protest_date !== suggestedProtest ? ` Sugerido: ${formatDateBR(suggestedProtest)}.` : ''}`
              : 'Sem prazo de protesto na regra de cobrança (Financeiro → Cobranças). Não é a data efetiva do protesto.'} />
          {charges && <p className="text-xs text-cocoa-700 sm:col-span-2">Após o vencimento: multa de {charges.finePercent}% + juros de {charges.interestPercent}% {charges.interestPeriod === 'mensal' ? 'ao mês (pro rata dia)' : 'ao dia'}{charges.graceDays ? `, após ${charges.graceDays} dia(s) de carência` : ''} — regra de cobrança{rule?.customer_id ? ' do cliente' : ''}, gravada no título e calculada automaticamente.</p>}
          <TextInput wrapperClassName="sm:col-span-2" label="Linha digitável" value={v.digitable_line} onChange={set('digitable_line')} />
          <TextInput wrapperClassName="sm:col-span-2" label="Código de barras" value={v.barcode} onChange={set('barcode')} />
        </div>
      </div>
    </Modal>
  );
}

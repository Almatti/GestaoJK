import { useState } from 'react';
import { FileText, Gavel, Plus } from 'lucide-react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, LoadingBlock, friendlyError } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Overlay';
import { SelectInput, TextArea, TextInput } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { PROTEST_STATUS, PROTEST_TRANSITIONS, combinedStatus, type FinancialStatus, type ProtestStatus } from '@/domain/collections';
import { formatReais } from '@/domain/money';
import { formatDateBR, todaySP } from '@/domain/dates';
import { formatDocument } from '@/domain/documents';
import { printDocument, escHtml } from '@/lib/export';
import { exportCsv } from '@/lib/export';

export function ProtestsPage() {
  const { can } = useAuth();
  const q = useList<Row>('protest_records', { order: [{ column: 'created_at', ascending: false }], range: [0, 999] });
  const recv = useList<Row>('receivables_view', { range: [0, 9999] });
  const byId = new Map((recv.data?.rows ?? []).map((r) => [String(r.id), r]));
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const rows = (q.data?.rows ?? []).map((p) => ({ p, r: byId.get(String(p.receivable_id)) }));
  const pendingPaid = rows.filter(({ p, r }) => r?.status === 'pago' && ['encaminhado', 'em_cartorio', 'protestado', 'aguardando_anuencia', 'aguardando_cancelamento', 'cancelamento_solicitado'].includes(String(p.status)));

  return (
    <div className="animate-fade-in">
      <PageHeader title="Protestos e anuências" subtitle="Situação cartorária acompanhada separadamente da situação financeira (Lei nº 9.492/1997). Encaminhamento exige autorização."
        actions={<>
          <Button variant="secondary" size="sm" onClick={() => exportCsv('pendencias-cartorarias', rows.map(({ p, r }) => ({ cliente: r?.customer_name, titulo: r?.description, valor: r?.amount, situacao_financeira: r?.financial_status, situacao_cartoraria: PROTEST_STATUS[p.status as ProtestStatus], cartorio: p.notary_office, protocolo: p.protocol_number })), [{ key: 'cliente', label: 'Cliente' }, { key: 'titulo', label: 'Título' }, { key: 'valor', label: 'Valor', format: 'money' }, { key: 'situacao_financeira', label: 'Situação financeira' }, { key: 'situacao_cartoraria', label: 'Situação cartorária' }, { key: 'cartorio', label: 'Cartório' }, { key: 'protocolo', label: 'Protocolo' }])}>Relatório CSV</Button>
          {can('cobranca', 'create') && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Novo acompanhamento</Button>}
        </>} />
      {pendingPaid.length > 0 && <div className="mb-4"><Alert tone="warning" title={`${pendingPaid.length} título(s) pago(s) com pendência cartorária`}>Não cobrar novamente. Gere a declaração de anuência e acompanhe o cancelamento do protesto.</Alert></div>}
      {q.isLoading ? <Card opaque><LoadingBlock /></Card> : rows.length === 0 ? <Card><EmptyState icon={<Gavel className="size-7" />} title="Nenhum título em acompanhamento cartorário" /></Card> : (
        <div className="surface overflow-x-auto rounded-[var(--radius-card)]">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-cream-100 text-left text-xs uppercase text-cocoa-700"><tr><th className="px-4 py-3">Cliente / título</th><th className="px-4 py-3 text-right">Valor</th><th className="px-4 py-3">Vencimento</th><th className="px-4 py-3">Encaminh. previsto</th><th className="px-4 py-3">Cartório / protocolo</th><th className="px-4 py-3">Situação combinada</th><th className="px-4 py-3" /></tr></thead>
            <tbody>{rows.map(({ p, r }) => { const s = combinedStatus((r?.financial_status as FinancialStatus) ?? 'em_aberto', p.status as ProtestStatus, r?.payment_method === 'pix' ? 'Pix' : null); return (
              <tr key={String(p.id)} className="border-t border-tangerine-100">
                <td className="px-4 py-3"><p className="font-semibold">{String(r?.customer_trade_name ?? r?.customer_name ?? '—')}</p><p className="text-xs text-cocoa-700">{String(r?.description ?? '')}</p></td>
                <td className="num px-4 py-3 text-right">{formatReais(r?.amount as number)}</td>
                <td className="px-4 py-3">{formatDateBR(r?.due_date as string)}</td>
                <td className="px-4 py-3">{formatDateBR(p.planned_date as string)}</td>
                <td className="px-4 py-3">{String(p.notary_office ?? '—')}<span className="block text-xs text-cocoa-700">{String(p.protocol_number ?? '')}</span></td>
                <td className="px-4 py-3"><span title={s.detail}><Badge tone={s.tone}>{s.label}</Badge></span><span className="mt-1 block text-xs text-cocoa-700">Cartorária: {PROTEST_STATUS[p.status as ProtestStatus]}</span></td>
                <td className="px-4 py-3"><Button size="sm" variant="soft" onClick={() => setEditing(p)}>Gerenciar</Button></td>
              </tr>); })}</tbody>
          </table>
        </div>
      )}
      {editing && <ProtestDialog protest={editing} receivable={byId.get(String(editing.receivable_id))} onClose={() => setEditing(null)} />}
      {creating && <NewProtestDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewProtestDialog({ onClose }: { onClose: () => void }) {
  const recv = useList<Row>('receivables_view', { filters: [{ column: 'financial_status', op: 'in', value: ['vencido', 'parcialmente_pago'] }], range: [0, 999] });
  const [id, setId] = useState('');
  const [date, setDate] = useState('');
  const toast = useToast();
  const invalidate = useInvalidateAll();
  return (
    <Modal open onClose={onClose} title="Programar encaminhamento a protesto" size="sm" footer={<Button disabled={!id} onClick={async () => { try { await db().insert('protest_records', { receivable_id: id, status: 'programado', planned_date: date || null }); invalidate(); toast('Encaminhamento programado (data interna).'); onClose(); } catch (e) { toast(friendlyError(e), 'danger'); } }}>Programar</Button>}>
      <div className="space-y-3">
        <SelectInput label="Título vencido" placeholder="Selecione…" value={id} onChange={(e) => setId(e.target.value)} options={(recv.data?.rows ?? []).map((r) => ({ value: String(r.id), label: `${String(r.customer_trade_name ?? r.customer_name)} — ${formatReais(r.outstanding as number)}` }))} />
        <TextInput label="Data interna prevista" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <p className="text-xs text-cocoa-700">O envio efetivo ao cartório exige permissão de aprovação.</p>
      </div>
    </Modal>
  );
}

export function ProtestDialog({ protest, receivable, onClose }: { protest: Row; receivable?: Row; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const history = useList<Row>('protest_status_history', { filters: [{ column: 'protest_id', op: 'eq', value: protest.id }], order: [{ column: 'changed_at' }] });
  const boleto = useList<Row>('boletos', { filters: [{ column: 'receivable_id', op: 'eq', value: protest.receivable_id }] });
  const company = useList<Row>('company', {});
  const customer = useList<Row>('customers', { filters: [{ column: 'id', op: 'eq', value: receivable?.customer_id }] }, { enabled: !!receivable });
  const templates = useList<Row>('document_templates', { filters: [{ column: 'key', op: 'eq', value: 'anuencia' }] });
  const status = protest.status as ProtestStatus;
  const [next, setNext] = useState<ProtestStatus | ''>('');
  const [f, setF] = useState({ notary_office: String(protest.notary_office ?? ''), protocol_number: String(protest.protocol_number ?? ''), protested_at: String(protest.protested_at ?? ''), fees_informed: String(protest.fees_informed ?? ''), notes: '' });

  const save = async () => {
    try {
      const values: Row = { notary_office: f.notary_office || null, protocol_number: f.protocol_number || null, protested_at: f.protested_at || null, fees_informed: f.fees_informed ? Number(f.fees_informed) : null, notes: f.notes || null };
      if (next) values.status = next;
      if (next === 'aguardando_anuencia') values.anuence_authorized = true;
      if (next === 'cancelamento_solicitado') values.cancellation_requested_at = todaySP();
      await db().update('protest_records', String(protest.id), values);
      invalidate();
      toast('Acompanhamento atualizado.');
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  const generateAnuence = async () => {
    const co = company.data?.rows[0] ?? {};
    const cu = customer.data?.rows[0] ?? {};
    const b = boleto.data?.rows[0] ?? {};
    const addr = co.address as Record<string, string> | null;
    const body = String(templates.data?.rows[0]?.body ?? 'Modelo de anuência não encontrado (document_templates.anuencia).');
    const map: Record<string, string> = {
      NOME_EMPRESA: String(co.legal_name ?? ''), DOCUMENTO_EMPRESA: formatDocument(co.document as string) || '[CNPJ DA EMPRESA]', ENDERECO_EMPRESA: addr ? Object.values(addr).filter(Boolean).join(', ') : '[ENDEREÇO]',
      CIDADE_EMPRESA: addr?.city ?? '[CIDADE]', NOME_CLIENTE: String(cu.name ?? receivable?.customer_name ?? ''), DOCUMENTO_CLIENTE: formatDocument(cu.document as string) || '[DOCUMENTO]',
      NUMERO_DOCUMENTO: String(b.document_number ?? receivable?.description ?? ''), SEU_NUMERO: String(b.your_number ?? '—'), NOSSO_NUMERO: String(b.our_number ?? '—'),
      DATA_EMISSAO: formatDateBR((b.issue_date ?? receivable?.issue_date) as string), DATA_VENCIMENTO: formatDateBR(receivable?.due_date as string), VALOR_ORIGINAL: formatReais((b.original_amount ?? receivable?.amount) as number),
      CARTORIO: f.notary_office || '—', PROTOCOLO: f.protocol_number || '—', DATA_ATUAL: new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'long', year: 'numeric' })
    };
    const text = body.replace(/\[([A-Z_]+)\]/g, (m, k: string) => map[k] ?? m);
    try {
      await db().insert('anuence_documents', { protest_id: protest.id, generated_text: text });
      printDocument('Declaração de anuência', `<div class="doc">${escHtml(text)}</div>`);
      invalidate();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  const options = PROTEST_TRANSITIONS[status].filter((s) => s !== 'encaminhado' || can('cobranca', 'approve'));
  return (
    <Modal open onClose={onClose} drawer title="Acompanhamento cartorário" description={`${String(receivable?.customer_name ?? '')} · ${String(receivable?.description ?? '')}`}
      footer={<>{receivable?.status === 'pago' && <Button variant="secondary" icon={<FileText className="size-4" />} onClick={generateAnuence}>Gerar declaração de anuência (PDF)</Button>}{can('cobranca', 'edit') && <Button onClick={save}>Salvar</Button>}</>}>
      <div className="space-y-4">
        <Alert tone="info" title={`Situação cartorária: ${PROTEST_STATUS[status]}`}>Situação financeira: {String(receivable?.financial_status ?? '—')}. A data interna de encaminhamento não é a data efetiva do protesto. A declaração não contém assinatura digital — imprima, assine e anexe a versão assinada.</Alert>
        <SelectInput label="Próxima situação" placeholder="Manter" value={next} onChange={(e) => setNext(e.target.value as ProtestStatus)} options={options.map((s) => ({ value: s, label: PROTEST_STATUS[s] }))} hint={!can('cobranca', 'approve') ? 'Encaminhamento ao cartório exige permissão de aprovação.' : undefined} />
        <div className="grid grid-cols-2 gap-3">
          <TextInput label="Cartório" value={f.notary_office} onChange={(e) => setF((s) => ({ ...s, notary_office: e.target.value }))} />
          <TextInput label="Protocolo" value={f.protocol_number} onChange={(e) => setF((s) => ({ ...s, protocol_number: e.target.value }))} />
          <TextInput label="Data efetiva do protesto" type="date" value={f.protested_at} onChange={(e) => setF((s) => ({ ...s, protested_at: e.target.value }))} />
          <TextInput label="Custas informadas (R$)" type="number" step="0.01" value={f.fees_informed} onChange={(e) => setF((s) => ({ ...s, fees_informed: e.target.value }))} />
        </div>
        <TextArea label="Providência / observação" value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} />
        <div>
          <p className="label">Histórico</p>
          <ol className="space-y-1 text-sm">{(history.data?.rows ?? []).map((h) => <li key={String(h.id)} className="flex justify-between gap-2"><span>{PROTEST_STATUS[h.to_status as ProtestStatus]}{h.notes ? ` — ${String(h.notes)}` : ''}</span><span className="text-xs text-cocoa-700">{formatDateBR(String(h.changed_at).slice(0, 10))}</span></li>)}</ol>
        </div>
      </div>
    </Modal>
  );
}

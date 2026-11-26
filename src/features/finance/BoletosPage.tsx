import { useEffect, useRef, useState } from 'react';
import { Plus, Copy, ScanLine, FileUp } from 'lucide-react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, LoadingBlock, friendlyError } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Overlay';
import { SelectInput, TextInput } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { formatReais } from '@/domain/money';
import { formatDateBR, todaySP } from '@/domain/dates';
import { ReceivableStatusBadge } from './ReceivableStatusBadge';
import { BANKS, BoletoError, extractBoletoHints, findBoletoInText, parseBoleto, type BoletoInfo } from '@/domain/boleto';
import { formatDocument } from '@/domain/documents';
import { plannedProtestDate } from '@/domain/collections';
import { extractPdfText } from '@/lib/pdfText';

/** Boletos emitidos no banco e cadastrados manualmente. Sem integração bancária, NADA é emitido pelo sistema. */
export function BoletosPage() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const boletos = useList<Row>('boletos', { order: [{ column: 'due_date' }], range: [0, 499] });
  const recv = useList<Row>('receivables_view', { range: [0, 4999] });
  const byId = new Map((recv.data?.rows ?? []).map((r) => [String(r.id), r]));
  const toast = useToast();
  return (
    <div className="animate-fade-in">
      <PageHeader title="Boletos" subtitle="Cadastro de boletos já emitidos no banco. Emissão, baixa e consulta automáticas dependem da integração bancária (pendente de credenciais)."
        actions={can('cobranca', 'create') && <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Cadastrar boleto</Button>} />
      <div className="mb-4"><Alert tone="info" title="Integração bancária não configurada">A importação de retorno CNAB/OFX está em Conciliação. Configure o banco em Administração → Integrações quando houver credenciais.</Alert></div>
      {boletos.isLoading ? <Card opaque><LoadingBlock /></Card> : (boletos.data?.rows ?? []).length === 0 ? <Card><EmptyState title="Nenhum boleto cadastrado" /></Card> : (
        <div className="surface overflow-x-auto rounded-[var(--radius-card)]">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-cream-100 text-left text-xs uppercase text-cocoa-700"><tr><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Nosso nº</th><th className="px-4 py-3">Vencimento</th><th className="px-4 py-3 text-right">Valor original</th><th className="px-4 py-3 text-right">Saldo</th><th className="px-4 py-3">Encaminhamento previsto</th><th className="px-4 py-3">Situação</th><th className="px-4 py-3" /></tr></thead>
            <tbody>{boletos.data!.rows.map((b) => { const r = byId.get(String(b.receivable_id)); return (
              <tr key={String(b.id)} className="border-t border-tangerine-100">
                <td className="px-4 py-3">{String(r?.customer_trade_name ?? r?.customer_name ?? '—')}</td>
                <td className="px-4 py-3">{String(b.our_number ?? '—')}<span className="block text-xs text-cocoa-700">Banco {String(b.bank_code ?? '—')}</span></td>
                <td className="px-4 py-3">{formatDateBR(b.due_date as string)}</td>
                <td className="num px-4 py-3 text-right">{formatReais(b.original_amount as number)}</td>
                <td className="num px-4 py-3 text-right">{formatReais(r?.outstanding as number)}</td>
                <td className="px-4 py-3">{b.planned_protest_date ? `${formatDateBR(b.planned_protest_date as string)} (interna)` : '—'}</td>
                <td className="px-4 py-3">{r ? <ReceivableStatusBadge receivableId={String(r.id)} financialStatus={String(r.financial_status)} /> : '—'}</td>
                <td className="px-4 py-3">{b.digitable_line ? <Button size="sm" variant="ghost" icon={<Copy className="size-4" />} onClick={() => navigator.clipboard.writeText(String(b.digitable_line)).then(() => toast('Linha digitável copiada.'))}>Linha</Button> : null}</td>
              </tr>); })}</tbody>
          </table>
        </div>
      )}
      {open && <BoletoForm onClose={() => setOpen(false)} />}
    </div>
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
      const text = await extractPdfText(file);
      const b = findBoletoInText(text, todaySP());
      setPdf(file);
      if (!b) {
        setRead({ tone: 'warning', text: text.trim() ? 'Não encontrei a linha digitável no PDF. Digite ou cole a linha acima — o arquivo será anexado ao boleto.' : 'Este PDF é uma imagem (sem texto). Digite ou cole a linha digitável acima — o arquivo será anexado ao boleto.' });
      } else {
        apply(b, 'PDF lido');
      }
      const hints = extractBoletoHints(text);
      setV((s) => ({ ...s, our_number: b?.ourNumber ?? (s.our_number || hints.ourNumber || ''), wallet: b?.wallet ?? (s.wallet || hints.wallet || ''), document_number: s.document_number || hints.documentNumber || '' }));
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
      if (pdf && db().mode === 'supabase') {
        filePath = `boleto/${crypto.randomUUID()}-${pdf.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-80)}`;
        await db().storage.upload(filePath, pdf);
      }
      const r = await db().rpc<{ boleto_id: string; receivable_created: boolean }>('create_boleto', {
        p_customer: customerId || null, p_receivable: isNew ? null : receivableId, p_description: description || null,
        p_boleto: { ...v, file_path: filePath }
      });
      if (filePath && pdf) {
        await db().insert('attachments', { entity_type: 'boleto', entity_id: r.boleto_id, storage_path: filePath, file_name: pdf.name, mime_type: pdf.type || 'application/pdf', size_bytes: pdf.size, category: 'boleto' });
      }
      invalidate();
      toast(r.receivable_created ? 'Boleto cadastrado e conta a receber criada.' : 'Boleto cadastrado e vinculado ao título.');
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
                setV((s) => ({ ...s, due_date: s.due_date || String(r.due_date ?? ''), original_amount: s.original_amount || String(r.outstanding ?? '') }));
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
          <TextInput label="Emissão" type="date" value={v.issue_date} onChange={set('issue_date')} />
          <TextInput label="Vencimento" type="date" required value={v.due_date} onChange={set('due_date')} />
          <TextInput label="Valor original (R$)" type="number" step="0.01" required value={v.original_amount} onChange={set('original_amount')} />
          <TextInput label="Encaminhamento a protesto previsto (data interna)" type="date" value={v.planned_protest_date}
            onChange={(e) => { setProtestTouched(true); setV((s) => ({ ...s, planned_protest_date: e.target.value })); }}
            hint={protestRule && protestRule.protestAfterDays > 0
              ? `Calculado: ${protestRule.protestAfterDays} dia(s) ${protestRule.protestDayCount === 'uteis' ? 'úteis' : 'corridos'} após o vencimento (regra de cobrança${rule?.customer_id ? ' do cliente' : ''}${protestRule.protestDayCount === 'uteis' ? ', sem fins de semana e feriados cadastrados' : ''}). Não é a data efetiva do protesto.${protestTouched && suggestedProtest && v.planned_protest_date !== suggestedProtest ? ` Sugerido: ${formatDateBR(suggestedProtest)}.` : ''}`
              : 'Sem prazo de protesto na regra de cobrança (Financeiro → Cobranças). Não é a data efetiva do protesto.'} />
          <TextInput wrapperClassName="sm:col-span-2" label="Linha digitável" value={v.digitable_line} onChange={set('digitable_line')} />
          <TextInput wrapperClassName="sm:col-span-2" label="Código de barras" value={v.barcode} onChange={set('barcode')} />
        </div>
      </div>
    </Modal>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { FileUp, Plus, Save, Trash2, X } from 'lucide-react';
import { db, useInvalidateAll, useList, useRecord } from '@/data/hooks';
import type { Row } from '@/data/types';
import { PageHeader, Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, LoadingBlock, ErrorState, friendlyError } from '@/components/ui/Feedback';
import { Attachments } from '@/components/ui/Attachments';
import { SelectInput, TextArea, TextInput } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthContext';
import { centsToDecimal, formatReais, toCents } from '@/domain/money';
import { todaySP } from '@/domain/dates';
import { FESTA_METHODS, FESTA_PAYMENT_KINDS, FESTA_UNITS, extractFestaFromLines, festaMissingFields, festaTotals, itemTotalCents, parseFestaPdf, scheduleError, type FestaExtraction } from '@/domain/festas';
import { extractPdf } from '@/lib/pdfText';
import { ocrPdfLines } from '@/lib/ocr';
import { FestasDataNotice, attachFile, num, sha256Hex } from './shared';

interface Header {
  client_name: string; client_phone: string; event_name: string; event_date: string; event_time: string; address: string; notes: string;
  discount_amount: string; surcharge_amount: string;
}
interface ItemState {
  key: string; id?: string; product_name: string; unit: string; keg_liters: string; quantity: string; unit_price: string;
  discount_amount: string; surcharge_amount: string; notes: string;
}
interface PayState {
  key: string; id?: string; kind: string; description: string; amount: string; due_date: string; method: string; notes: string;
}
interface PdfState { file: File; name: string; sha: string; extraction: FestaExtraction }

const emptyHeader: Header = { client_name: '', client_phone: '', event_name: '', event_date: '', event_time: '', address: '', notes: '', discount_amount: '', surcharge_amount: '' };
const newItem = (): ItemState => ({ key: crypto.randomUUID(), product_name: '', unit: 'barril', keg_liters: '', quantity: '', unit_price: '', discount_amount: '', surcharge_amount: '', notes: '' });
const newPay = (): PayState => ({ key: crypto.randomUUID(), kind: 'parcela', description: '', amount: '', due_date: '', method: 'pix', notes: '' });
const cents = (v: string) => toCents(num(v));

export function FestaFormPage({ mode }: { mode: 'novo' | 'editar' | 'importar' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const { can } = useAuth();
  const isEdit = mode === 'editar' && !!id;
  const festa = useRecord<Row>('festa_events_view', isEdit ? id : undefined);
  const items = useList<Row>('festa_items', { filters: [{ column: 'event_id', op: 'eq', value: id ?? '' }, { column: 'archived_at', op: 'is', value: null }], order: [{ column: 'position' }], range: [0, 499] }, { enabled: isEdit });
  const pays = useList<Row>('festa_payments', { filters: [{ column: 'event_id', op: 'eq', value: id ?? '' }, { column: 'status', op: 'eq', value: 'previsto' }], order: [{ column: 'due_date' }], range: [0, 199] }, { enabled: isEdit });
  const products = useList<Row>('products', { select: 'id,name', order: [{ column: 'name' }], range: [0, 499] });

  const [header, setHeader] = useState<Header>(emptyHeader);
  const [itemsState, setItems] = useState<ItemState[]>([newItem()]);
  const [pays_, setPays] = useState<PayState[]>([]);
  const [pdf, setPdf] = useState<PdfState | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!isEdit);
  const [received, setReceived] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // Edição: carrega a festa uma vez.
  useEffect(() => {
    if (!isEdit || loaded || !festa.data || !items.data || !pays.data) return;
    const f = festa.data;
    setHeader({
      client_name: String(f.client_name ?? ''), client_phone: String(f.client_phone ?? ''), event_name: String(f.event_name ?? ''),
      event_date: String(f.event_date ?? ''), event_time: String(f.event_time ?? '').slice(0, 5), address: String(f.address ?? ''),
      notes: String(f.notes ?? ''), discount_amount: centsToDecimal(cents(String(f.discount_amount ?? 0))), surcharge_amount: centsToDecimal(cents(String(f.surcharge_amount ?? 0)))
    });
    setItems(items.data.rows.length ? items.data.rows.map((r) => ({
      key: String(r.id), id: String(r.id), product_name: String(r.product_name ?? ''), unit: String(r.unit ?? 'barril'), keg_liters: r.keg_liters == null ? '' : String(r.keg_liters),
      quantity: String(r.quantity ?? ''), unit_price: centsToDecimal(cents(String(r.unit_price ?? 0))), discount_amount: centsToDecimal(cents(String(r.discount_amount ?? 0))),
      surcharge_amount: centsToDecimal(cents(String(r.surcharge_amount ?? 0))), notes: String(r.notes ?? '')
    })) : [newItem()]);
    setPays(pays.data.rows.map((r) => ({ key: String(r.id), id: String(r.id), kind: String(r.kind ?? 'parcela'), description: String(r.description ?? ''),
      amount: centsToDecimal(cents(String(r.amount ?? 0))), due_date: String(r.due_date ?? ''), method: String(r.method ?? 'pix'), notes: String(r.notes ?? '') })));
    setReceived(Number(f.received ?? 0));
    setLoaded(true);
  }, [isEdit, loaded, festa.data, items.data, pays.data]);

  const totals = useMemo(() => {
    const itemTotals = itemsState.map((i) => itemTotalCents({ quantity: num(i.quantity), unitPriceCents: cents(i.unit_price), discountCents: cents(i.discount_amount), surchargeCents: cents(i.surcharge_amount) }));
    return festaTotals(itemTotals, cents(header.discount_amount), cents(header.surcharge_amount));
  }, [itemsState, header.discount_amount, header.surcharge_amount]);
  const scheduled = useMemo(() => pays_.reduce((s, p) => s + cents(p.amount), 0), [pays_]);
  const receivedCents = toCents(received);
  const planError = scheduleError({ totalCents: totals.totalCents, receivedCents, scheduledCents: scheduled });
  const missing = festaMissingFields({ client_name: header.client_name, client_phone: header.client_phone, event_name: header.event_name, event_date: header.event_date, event_time: header.event_time, address: header.address });

  const setH = (k: keyof Header) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setHeader((h) => ({ ...h, [k]: e.target.value }));
  const setI = (key: string, k: keyof ItemState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, [k]: e.target.value } : i)));
  const setP = (key: string, k: keyof PayState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setPays((list) => list.map((p) => (p.key === key ? { ...p, [k]: e.target.value } : p)));

  /** Lê o PDF: prévia com os dados extraídos. Campos não encontrados ficam em branco. */
  const onFile = async (file: File) => {
    if (!file) return;
    if (file.type && file.type !== 'application/pdf') return toast('Envie um arquivo PDF.', 'danger');
    if (file.size > 15 * 1024 * 1024) return toast('PDF maior que 15 MB.', 'danger');
    setReading(true);
    setDuplicate(null);
    try {
      // Cópia em memória: evita falhas de leitura de arquivo em celulares (arquivo alterado durante o envio).
      const bytes = await file.arrayBuffer();
      const copy = new File([bytes], file.name, { type: 'application/pdf' });
      const sha = await sha256Hex(bytes);
      // Checagem antecipada (o banco também impede o duplicado ao salvar). Falha de consulta não impede a leitura.
      try {
        const dup = await db().list<Row>('festa_events', { select: 'id,code', filters: [{ column: 'source_sha256', op: 'eq', value: sha }] });
        if (dup.rows.length) setDuplicate(String(dup.rows[0]!.code ?? 'já cadastrada'));
      } catch {
        /* segue: o salvamento verifica no servidor */
      }
      const { text, items: pdfItems } = await extractPdf(copy, 5);
      const hasText = text.replace(/\s+/g, '').length >= 40;
      let ex: FestaExtraction;
      if (hasText) {
        ex = parseFestaPdf(text, pdfItems);
      } else {
        // PDF digitalizado (imagem): reconhecimento de texto no próprio aparelho.
        setProgress('Arquivo digitalizado: reconhecendo o texto…');
        const lines = await ocrPdfLines(copy, 2, setProgress);
        ex = extractFestaFromLines(lines);
        ex.warnings.unshift('PDF digitalizado (imagem): os dados foram reconhecidos automaticamente. Confira todos os valores antes de salvar.');
      }
      setProgress(null);
      setPdf({ file: copy, name: file.name, sha, extraction: ex });
      setHeader((h) => ({
        client_name: ex.client_name || h.client_name, client_phone: ex.client_phone || h.client_phone, event_name: ex.event_name || h.event_name,
        event_date: ex.event_date || h.event_date, event_time: ex.event_time || h.event_time, address: ex.address || h.address, notes: ex.notes || h.notes,
        discount_amount: ex.discount_amount || h.discount_amount, surcharge_amount: ex.surcharge_amount || h.surcharge_amount
      }));
      if (ex.items.length) setItems(ex.items.map((i) => ({ ...newItem(), product_name: i.product_name, unit: i.unit, keg_liters: i.keg_liters, quantity: i.quantity, unit_price: i.unit_price })));
      if (ex.payments.length) setPays(ex.payments.map((p) => ({ ...newPay(), kind: p.kind, amount: p.amount, due_date: p.due_date, method: p.method || 'pix' })));
      toast(ex.warnings.length ? 'PDF lido. Confira os avisos antes de salvar.' : 'PDF lido. Confira os dados antes de salvar.', ex.warnings.length ? 'warning' : undefined);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
    setReading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const save = async () => {
    if (duplicate) return toast('Este PDF já foi importado. Não é possível salvar de novo.', 'danger');
    if (planError) return toast(planError, 'danger');
    if (itemsState.some((i) => num(i.quantity) < 0 || num(i.unit_price) < 0)) return toast('Quantidades e valores não podem ser negativos.', 'danger');
    setSaving(true);
    try {
      const r = await db().rpc<{ id: string; code: string }>('festa_save', {
        p_id: isEdit ? id : null,
        p_event: {
          ...header, discount_amount: String(num(header.discount_amount)), surcharge_amount: String(num(header.surcharge_amount)),
          ...(pdf ? { source_sha256: pdf.sha, source_file_name: pdf.name, source_extraction: pdf.extraction } : {})
        },
        p_items: itemsState.filter((i) => i.product_name.trim() || num(i.quantity) || num(i.unit_price)).map((i) => ({
          id: i.id ?? null, product_name: i.product_name, unit: i.unit, keg_liters: i.keg_liters ? String(num(i.keg_liters)) : null,
          quantity: String(num(i.quantity)), unit_price: String(num(i.unit_price)), discount_amount: String(num(i.discount_amount)),
          surcharge_amount: String(num(i.surcharge_amount)), notes: i.notes
        })),
        p_payments: pays_.filter((p) => num(p.amount) > 0).map((p) => ({ id: p.id ?? null, kind: p.kind, description: p.description, amount: String(num(p.amount)), due_date: p.due_date || null, method: p.method || null, notes: p.notes }))
      });
      if (pdf) await attachFile('festa', r.id, pdf.file);
      invalidate();
      toast(isEdit ? 'Festa atualizada.' : `Festa ${r.code} cadastrada.`);
      navigate(`/festas/${r.id}`);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
    setSaving(false);
  };

  if (isEdit && (festa.isLoading || items.isLoading || pays.isLoading)) return <LoadingBlock rows={6} />;
  if (isEdit && (festa.error || items.error || pays.error)) return <ErrorState error={festa.error ?? items.error ?? pays.error} />;
  if (isEdit && festa.data && festa.data.ops_status === 'cancelado') {
    return <Alert tone="danger" title="Festa cancelada">Festas canceladas não podem ser editadas. <Link className="font-semibold underline" to={`/festas/${id}`}>Voltar à festa</Link></Alert>;
  }

  const title = mode === 'importar' ? 'Importar pedido em PDF' : isEdit ? 'Editar festa' : 'Nova festa';
  const canSave = db().mode === 'supabase' && can('festas', isEdit ? 'edit' : 'create') && !duplicate && !saving && !reading && !planError;

  return (
    <>
      <PageHeader title={title} subtitle={mode === 'importar' ? 'Os dados lidos aparecem para conferência. Campos não encontrados ficam em branco.' : 'Cadastro independente: não usa a base de clientes.'}
        breadcrumbs={[{ label: 'Festas', to: '/festas' }, { label: title }]}
        actions={<><Button variant="secondary" onClick={() => navigate(isEdit ? `/festas/${id}` : '/festas')} icon={<X className="size-4" />}>Cancelar</Button>
          <Button onClick={save} loading={saving} disabled={!canSave} icon={<Save className="size-4" />}>{isEdit ? 'Salvar alterações' : 'Salvar festa'}</Button></>} />
      <FestasDataNotice />

      {mode === 'importar' && <Card title="PDF do pedido">
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="sr-only" id="festa-pdf" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <label htmlFor="festa-pdf" className="inline-flex cursor-pointer items-center gap-2 rounded-control bg-tangerine-700 px-4 py-2.5 text-sm font-semibold text-white shadow-soft hover:bg-tangerine-800">
            <FileUp className="size-4" />{pdf ? 'Trocar PDF' : 'Escolher PDF do pedido'}
          </label>
          {reading && <span className="text-sm text-cocoa-700">{progress ?? 'Lendo o PDF no seu aparelho…'}</span>}
          {pdf && !reading && <span className="text-sm text-cocoa-700">{pdf.name}</span>}
        </div>
        <p className="mt-3 text-xs text-cocoa-700">O arquivo é lido no próprio navegador e guardado como anexo da festa. Nenhum conteúdo é enviado a terceiros.</p>
        {duplicate && <div className="mt-3"><Alert tone="danger" title="PDF já importado">Este pedido já está cadastrado (festa {duplicate}). Não é possível importar de novo.</Alert></div>}
        {pdf && <div className="mt-3 space-y-2">
          <Alert tone={pdf.extraction.warnings.length ? 'warning' : 'success'} title={pdf.extraction.warnings.length ? 'Confira antes de salvar' : 'Dados lidos'}>
            {pdf.extraction.found.length ? <>Localizados: {pdf.extraction.found.join(', ')}.</> : 'Nenhum campo reconhecido: preencha manualmente.'}
          </Alert>
          {pdf.extraction.warnings.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-warning-700">{pdf.extraction.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        </div>}
      </Card>}

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card title="Cliente e evento">
            <div className="grid gap-3 md:grid-cols-2">
              <TextInput label="Nome do cliente" value={header.client_name} onChange={setH('client_name')} />
              <TextInput label="Telefone / WhatsApp" value={header.client_phone} onChange={setH('client_phone')} inputMode="tel" />
              <TextInput label="Nome ou identificação do evento" value={header.event_name} onChange={setH('event_name')} placeholder="Ex.: Aniversário da Ana" />
              <div className="grid grid-cols-2 gap-3">
                <TextInput label="Data" type="date" value={header.event_date} onChange={setH('event_date')} />
                <TextInput label="Horário" type="time" value={header.event_time} onChange={setH('event_time')} />
              </div>
              <TextInput label="Endereço do evento" className="md:col-span-2" value={header.address} onChange={setH('address')} />
              <TextArea label="Observações gerais" className="md:col-span-2" value={header.notes} onChange={setH('notes')} />
            </div>
            {missing.length > 0 && <p className="mt-3 text-xs text-warning-700">Cadastro incompleto (faltam: {missing.join(', ')}). Você pode salvar assim; os lembretes avisarão.</p>}
          </Card>

          <Card title="Produtos e quantidades" action={<Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setItems((l) => [...l, newItem()])}>Adicionar</Button>}>
            <datalist id="festa-products">{(products.data?.rows ?? []).map((p) => <option key={String(p.id)} value={String(p.name ?? '')} />)}</datalist>
            <div className="space-y-3">
              {itemsState.map((i, idx) => {
                const line = itemTotalCents({ quantity: num(i.quantity), unitPriceCents: cents(i.unit_price), discountCents: cents(i.discount_amount), surchargeCents: cents(i.surcharge_amount) });
                return (
                  <div key={i.key} className="grid gap-2 rounded-card-sm border border-tangerine-100 bg-white/70 p-3 md:grid-cols-12">
                    <div className="md:col-span-4"><TextInput label={`Produto ${idx + 1}`} list="festa-products" value={i.product_name} onChange={setI(i.key, 'product_name')} /></div>
                    <div className="md:col-span-2"><SelectInput label="Unidade" value={i.unit} onChange={setI(i.key, 'unit')} options={FESTA_UNITS.map((u) => ({ value: u.value, label: u.label }))} /></div>
                    <div className="md:col-span-2"><TextInput label="Litragem (L)" inputMode="decimal" value={i.keg_liters} onChange={setI(i.key, 'keg_liters')} disabled={i.unit !== 'barril'} /></div>
                    <div className="md:col-span-2"><TextInput label="Quantidade" inputMode="decimal" value={i.quantity} onChange={setI(i.key, 'quantity')} /></div>
                    <div className="md:col-span-2"><TextInput label="Valor unitário (R$)" inputMode="decimal" value={i.unit_price} onChange={setI(i.key, 'unit_price')} /></div>
                    <div className="md:col-span-2"><TextInput label="Desconto (R$)" inputMode="decimal" value={i.discount_amount} onChange={setI(i.key, 'discount_amount')} /></div>
                    <div className="md:col-span-2"><TextInput label="Acréscimo (R$)" inputMode="decimal" value={i.surcharge_amount} onChange={setI(i.key, 'surcharge_amount')} /></div>
                    <div className="flex items-end justify-between gap-2 md:col-span-4">
                      <span className="text-sm text-cocoa-700">Total do item: <strong className="text-cocoa-900">{formatReais(line / 100)}</strong></span>
                      <Button size="sm" variant="ghost" aria-label="Remover item" icon={<Trash2 className="size-4" />} onClick={() => setItems((l) => (l.length > 1 ? l.filter((x) => x.key !== i.key) : [newItem()]))} />
                    </div>
                  </div>);
              })}
            </div>
          </Card>

          <Card title="Pagamentos previstos" action={<Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setPays((l) => [...l, newPay()])}>Adicionar</Button>}>
            <p className="mb-3 text-xs text-cocoa-700">Previsto não é recebido. Cada pagamento só entra como recebido quando for confirmado na festa (com a conferência no extrato).</p>
            {pays_.length === 0 ? <p className="text-sm text-cocoa-700">Nenhum pagamento previsto. Você pode registrar depois, na tela da festa.</p> : (
              <div className="space-y-3">{pays_.map((p) => (
                <div key={p.key} className="grid gap-2 rounded-card-sm border border-tangerine-100 bg-white/70 p-3 md:grid-cols-12">
                  <div className="md:col-span-2"><SelectInput label="Tipo" value={p.kind} onChange={setP(p.key, 'kind')} options={FESTA_PAYMENT_KINDS.map((k) => ({ value: k.value, label: k.label }))} /></div>
                  <div className="md:col-span-3"><TextInput label="Descrição" value={p.description} onChange={setP(p.key, 'description')} /></div>
                  <div className="md:col-span-2"><TextInput label="Valor (R$)" inputMode="decimal" value={p.amount} onChange={setP(p.key, 'amount')} /></div>
                  <div className="md:col-span-2"><TextInput label="Vencimento" type="date" value={p.due_date} onChange={setP(p.key, 'due_date')} /></div>
                  <div className="md:col-span-2"><SelectInput label="Forma prevista" value={p.method} onChange={setP(p.key, 'method')} options={FESTA_METHODS.map((m) => ({ value: m.value, label: m.label }))} /></div>
                  <div className="flex items-end justify-end md:col-span-1"><Button size="sm" variant="ghost" aria-label="Remover pagamento" icon={<Trash2 className="size-4" />} onClick={() => setPays((l) => l.filter((x) => x.key !== p.key))} /></div>
                </div>))}</div>)}
          </Card>

          {isEdit && id && <Attachments entityType="festa" entityId={id} title="PDF original e anexos" canRemove={can('festas', 'edit')} />}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Card title="Resumo">
            <dl className="space-y-2 text-sm">
              <Row2 k="Itens" v={formatReais(totals.itemsCents / 100)} />
              <Row2 k="Desconto geral" v={`− ${formatReais(cents(header.discount_amount) / 100)}`} />
              <Row2 k="Acréscimo geral" v={`+ ${formatReais(cents(header.surcharge_amount) / 100)}`} />
              <div className="flex justify-between border-t border-tangerine-100 pt-2 text-base"><dt className="font-semibold">Total da festa</dt><dd className="font-display text-lg font-extrabold text-tangerine-900">{formatReais(totals.totalCents / 100)}</dd></div>
              {isEdit && <Row2 k="Já recebido (confirmado)" v={formatReais(receivedCents / 100)} />}
              <Row2 k="Previsto em pagamentos" v={formatReais(scheduled / 100)} />
              <Row2 k="Saldo a prever" v={formatReais(Math.max(totals.totalCents - receivedCents - scheduled, 0) / 100)} />
            </dl>
            {planError && <div className="mt-3"><Alert tone="danger">{planError}</Alert></div>}
          </Card>
          <Card title="Descontos e acréscimos gerais">
            <div className="grid gap-3">
              <TextInput label="Desconto geral (R$)" inputMode="decimal" value={header.discount_amount} onChange={setH('discount_amount')} />
              <TextInput label="Acréscimo geral (R$)" inputMode="decimal" value={header.surcharge_amount} onChange={setH('surcharge_amount')} />
            </div>
          </Card>
          <p className="text-xs text-cocoa-700">Data de hoje: {todaySP()}. Após salvar, a festa gera automaticamente o título a receber no financeiro (origem Festas).</p>
        </aside>
      </div>
    </>
  );
}

function Row2({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><dt className="text-cocoa-700">{k}</dt><dd className="font-semibold text-cocoa-900">{v}</dd></div>;
}

export function FestaNovoPage() {
  return <FestaFormPage mode="novo" />;
}
export function FestaEditarPage() {
  return <FestaFormPage mode="editar" />;
}
export function FestaImportarPage() {
  return <FestaFormPage mode="importar" />;
}

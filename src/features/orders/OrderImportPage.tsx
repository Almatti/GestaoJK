import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { FileUp, Save, X } from 'lucide-react';
import { db, useInvalidateAll, useList } from '@/data/hooks';
import type { Row } from '@/data/types';
import { PageHeader, Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, LoadingBlock, friendlyError } from '@/components/ui/Feedback';
import { Checkbox, SelectInput, TextArea, TextInput } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthContext';
import { attachFile } from '@/features/festas/shared';
import { extractPdf } from '@/lib/pdfText';
import { ocrPdfLines } from '@/lib/ocr';
import { linesFromItems } from '@/domain/festas';
import { parseAddress, parseOrderPdfLines, type OrderPdf } from '@/domain/orderImport';
import { formatReais } from '@/domain/money';
import { formatDateBR } from '@/domain/dates';

interface ItemForm { product_id: string; keg_size_id: string; quantity: string; unit_price: string; liters: string; label: string; composition: string }

const digitsOnly = (v: string) => v.replace(/\D/g, '');
const paymentKey = (text: string) =>
  /boleto/i.test(text) ? 'boleto' : /pix/i.test(text) ? 'pix' : /dinheiro/i.test(text) ? 'dinheiro' : /cart/i.test(text) ? 'cartao' : text.trim().toLowerCase();

export function OrderImportPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const { can } = useAuth();
  const [parsed, setParsed] = useState<OrderPdf | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [client, setClient] = useState({ mode: 'novo' as 'novo' | 'existente', id: '', name: '', document: '', phone: '', email: '', street: '', number: '', district: '', city: '', state: '', cep: '' });
  const [delivery, setDelivery] = useState({ date: '', time: '', address: '', contact: '' });
  const [payment, setPayment] = useState('');
  const [items, setItems] = useState<ItemForm[]>([]);
  const [boletoId, setBoletoId] = useState('');
  const [confirmNow, setConfirmNow] = useState(false);
  const [notes, setNotes] = useState('');

  const products = useList<Row>('products', { select: 'id,name,sku', order: [{ column: 'name' }], range: [0, 499] });
  const kegs = useList<Row>('keg_sizes', { select: 'id,liters,label', filters: [{ column: 'active', op: 'eq', value: true }], order: [{ column: 'liters' }], range: [0, 99] });
  const openBoletos = useList<Row>('boletos', {
    select: 'id,document_number,original_amount,status,receivable_id,receivable:receivables(customer_id,order_id,status,paid_amount,amount,due_date)',
    filters: [{ column: 'status', op: 'eq', value: 'registrado' }], range: [0, 999]
  });
  const doc = digitsOnly(client.document);
  const existing = useList<Row>('customers', { select: 'id,name,document', filters: [{ column: 'document', op: 'eq', value: doc }] }, { enabled: doc.length === 14 });

  // Ao ler o PDF: preenche o cliente, a entrega, os itens e o pagamento a partir do documento
  const apply = (p: OrderPdf) => {
    setParsed(p);
    const addr = parseAddress(p.client.address);
    setClient((c) => ({ ...c, name: p.client.name, document: p.client.document, phone: p.client.phone, email: p.client.email,
      street: addr.street, number: addr.number, district: addr.district, city: addr.city, state: addr.state, cep: addr.cep }));
    setDelivery({ date: p.delivery.date, time: p.delivery.time, address: p.delivery.address, contact: p.delivery.contact });
    setPayment(p.payment.method);
    setNotes([p.orderNumber && `Importado do PDF ${p.orderNumber}`, p.statusText && `situação no PDF: ${p.statusText}`,
      p.delivery.contact && `contato no local: ${p.delivery.contact}`, p.boletoCode && `boleto no PDF: ${p.boletoCode}`].filter(Boolean).join(' · '));
    setItems(p.items.map((i) => ({ product_id: '', keg_size_id: '', quantity: String(i.quantity), unit_price: String(i.unitPrice), liters: i.kegLiters == null ? '' : String(i.kegLiters), label: i.product, composition: i.composition })));
    setBoletoId('');
  };

  const onFile = async (f: File) => {
    if (f.type && f.type !== 'application/pdf') return toast('Envie um arquivo PDF.', 'danger');
    setReading(true);
    try {
      const bytes = await f.arrayBuffer();
      const copy = new File([bytes], f.name, { type: 'application/pdf' });
      setFile(copy);
      const { text, items: pdfItems } = await extractPdf(copy, 3);
      let lines: string[];
      if (text.replace(/\s+/g, '').length >= 40) {
        lines = linesFromItems(pdfItems);
      } else {
        setProgress('PDF digitalizado: reconhecendo o texto…');
        lines = await ocrPdfLines(copy, 2, setProgress);
      }
      setProgress(null);
      const result = parseOrderPdfLines(lines);
      apply(result);
      if (!result.orderNumber) toast('Número do pedido não encontrado no PDF. Confira o documento.', 'warning');
      else toast(result.warnings.length ? 'PDF lido. Confira os avisos antes de salvar.' : 'PDF lido. Confira os dados e salve.', result.warnings.length ? 'warning' : undefined);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
    setReading(false);
  };

  // Vincula produto e litragem por sugestão (nome do produto e litragem); o operador confirma
  useEffect(() => {
    if (!products.data || !kegs.data || !items.length) return;
    setItems((list) => list.map((it) => {
      if (it.product_id) return it;
      const word = it.composition.split(/[·/]/)[0]?.trim().toLowerCase() ?? '';
      const prod = (products.data!.rows).find((p) => word && String(p.name).toLowerCase().includes(word))
        ?? (products.data!.rows).find((p) => String(p.name).toLowerCase().includes(it.label.toLowerCase()));
      const keg = (kegs.data!.rows).find((k) => it.liters && Number(k.liters) === Number(it.liters));
      return { ...it, product_id: prod ? String(prod.id) : '', keg_size_id: keg ? String(keg.id) : '' };
    }));
  }, [products.data, kegs.data, items.length]);

  // Cliente já cadastrado pelo CNPJ
  useEffect(() => {
    const found = existing.data?.rows?.[0];
    if (found) setClient((c) => ({ ...c, mode: 'existente', id: String(found.id) }));
    else if (doc.length === 14) setClient((c) => (c.mode === 'existente' ? { ...c, mode: 'novo', id: '' } : c));
  }, [existing.data, doc]);

  // Boletos em aberto do cliente escolhido (sem pedido ligado); o nº do boleto do PDF é sugerido
  const customerBoletos = useMemo(() => {
    const cid = client.mode === 'existente' ? client.id : '';
    return (openBoletos.data?.rows ?? []).filter((b) => {
      const r = b.receivable as Row | null | undefined;
      return !!r && !!cid && String(r.customer_id) === cid && !r.order_id && ['em_aberto', 'parcialmente_pago'].includes(String(r.status)) && Number(r.paid_amount ?? 0) === 0;
    });
  }, [openBoletos.data, client]);
  useEffect(() => {
    if (!parsed?.boletoCode || boletoId) return;
    const b = customerBoletos.find((x) => String(x.document_number ?? '') === parsed.boletoCode);
    if (b) setBoletoId(String(b.id));
  }, [customerBoletos, parsed, boletoId]);

  const total = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0);
  const itemsReady = items.length > 0 && items.every((i) => i.product_id && Number(i.quantity) > 0 && Number(i.unit_price) >= 0 && Number(i.liters || 1) > 0);
  const clientReady = client.mode === 'existente' ? !!client.id : client.name.trim().length > 1 && doc.length === 14;
  const selectedBoleto = customerBoletos.find((b) => String(b.id) === boletoId);
  const boletoMismatch = selectedBoleto ? Math.abs(Number(selectedBoleto.original_amount ?? 0) - total) > 0.01 : false;
  const canSave = can('pedidos', 'create') && !!parsed?.orderNumber && itemsReady && clientReady && !boletoMismatch && !saving && !reading;

  const save = async () => {
    if (!parsed) return;
    setSaving(true);
    try {
      const dup = await db().list<Row>('orders', { select: 'id,number', filters: [{ column: 'external_ref', op: 'eq', value: parsed.orderNumber }] });
      if (dup.rows.length) throw new Error(`Este pedido (${parsed.orderNumber}) já foi importado: pedido nº ${String(dup.rows[0]!.number)}.`);

      let customerId = client.id;
      if (client.mode === 'novo') {
        const created = await db().insert<Row>('customers', {
          person_type: 'PJ', name: client.name.trim(), document: doc, phone: digitsOnly(client.phone) || null, email: client.email || null,
          street: client.street || null, number: client.number || null, district: client.district || null, city: client.city || null,
          state: client.state || null, cep: digitsOnly(client.cep) || null, status: 'ativo'
        });
        customerId = String(created.id);
      }

      const kegLiters = (k: string) => Number(k || 0) || 1;
      const r = await db().rpc<{ order_id: string; number: number }>('import_order_pdf', {
        p: {
          customer_id: customerId, external_ref: parsed.orderNumber, order_date: parsed.orderDate || null,
          delivery_date: delivery.date || null, delivery_time: delivery.time || null, delivery_address: delivery.address || null,
          payment_method: paymentKey(payment) || null, notes, boleto_id: boletoId || null,
          items: items.map((i) => ({ product_id: i.product_id, keg_size_id: i.keg_size_id || null, quantity: Number(i.quantity), liters_per_unit: kegLiters(i.liters), unit_price: Number(i.unit_price) }))
        }
      });
      if (file) await attachFile('order', r.order_id, file);
      let confirmation = '';
      if (confirmNow) {
        try {
          await db().rpc('confirm_order', { p_order: r.order_id });
          confirmation = ' e confirmado';
        } catch (e) {
          confirmation = ` (não foi possível confirmar agora: ${friendlyError(e)})`;
        }
      }
      invalidate();
      toast(`Pedido nº ${r.number} importado${confirmation}.`, confirmation.includes('não') ? 'warning' : undefined);
      navigate(`/pedidos/${r.order_id}`);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
    setSaving(false);
  };

  return (
    <>
      <PageHeader title="Importar pedido em PDF" subtitle="Anexe o PDF do pedido: os dados são lidos e você confere, vincula o cliente e o boleto (se já existir) e salva."
        breadcrumbs={[{ label: 'Pedidos', to: '/pedidos' }, { label: 'Importar PDF' }]}
        actions={<>
          <Button variant="secondary" icon={<X className="size-4" />} onClick={() => navigate('/pedidos')}>Cancelar</Button>
          <Button icon={<Save className="size-4" />} loading={saving} disabled={!canSave} onClick={save}>Salvar pedido</Button>
        </>} />

      <Card title="PDF do pedido">
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept="application/pdf,.pdf" className="sr-only" id="order-pdf" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <label htmlFor="order-pdf" className="inline-flex cursor-pointer items-center gap-2 rounded-control bg-tangerine-700 px-4 py-2.5 text-sm font-semibold text-white shadow-soft hover:bg-tangerine-800">
            <FileUp className="size-4" />{file ? 'Trocar PDF' : 'Escolher PDF do pedido'}
          </label>
          {reading && <span className="text-sm text-cocoa-700">{progress ?? 'Lendo o PDF no seu aparelho…'}</span>}
          {file && !reading && <span className="text-sm text-cocoa-700">{file.name}</span>}
        </div>
        {parsed && !reading && <div className="mt-3 space-y-2">
          <Alert tone={parsed.warnings.length ? 'warning' : 'success'} title={parsed.orderNumber ? `Pedido ${parsed.orderNumber}` : 'Pedido não identificado'}>
            {parsed.orderDate ? `Data do pedido ${formatDateBR(parsed.orderDate)}` : ''} {parsed.statusText ? `· situação no PDF: ${parsed.statusText}` : ''}
          </Alert>
          {parsed.warnings.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-warning-700">{parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        </div>}
      </Card>

      {reading && <LoadingBlock rows={4} />}

      {parsed && !reading && <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card title="Cliente">
            {client.mode === 'existente' ? (
              <Alert tone="success" title="Cliente já cadastrado (mesmo CNPJ)">{existing.data?.rows?.[0] ? String(existing.data.rows[0].name) : 'Cliente selecionado'}.
                <button type="button" className="ml-2 font-semibold underline" onClick={() => setClient((c) => ({ ...c, mode: 'novo', id: '' }))}>Cadastrar como novo</button></Alert>
            ) : (
              <Alert tone={doc.length === 14 ? 'info' : 'warning'} title={doc.length === 14 ? 'Cliente novo' : 'CNPJ não encontrado no PDF'}>
                Será cadastrado com os dados do PDF (ajuste se precisar).
              </Alert>
            )}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <TextInput label="Razão social / nome" value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} required />
              <TextInput label="CNPJ" value={client.document} onChange={(e) => setClient({ ...client, document: e.target.value })} required />
              <TextInput label="Telefone" value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value })} />
              <TextInput label="E-mail" value={client.email} onChange={(e) => setClient({ ...client, email: e.target.value })} />
              <TextInput label="Rua" value={client.street} onChange={(e) => setClient({ ...client, street: e.target.value })} />
              <TextInput label="Número" value={client.number} onChange={(e) => setClient({ ...client, number: e.target.value })} />
              <TextInput label="Bairro" value={client.district} onChange={(e) => setClient({ ...client, district: e.target.value })} />
              <TextInput label="Cidade" value={client.city} onChange={(e) => setClient({ ...client, city: e.target.value })} />
              <TextInput label="UF" maxLength={2} value={client.state} onChange={(e) => setClient({ ...client, state: e.target.value.toUpperCase() })} />
              <TextInput label="CEP" value={client.cep} onChange={(e) => setClient({ ...client, cep: e.target.value })} />
            </div>
          </Card>

          <Card title="Entrega e pagamento">
            <div className="grid gap-3 md:grid-cols-2">
              <TextInput label="Data da entrega" type="date" value={delivery.date} onChange={(e) => setDelivery({ ...delivery, date: e.target.value })} />
              <TextInput label="Horário da entrega" type="time" value={delivery.time} onChange={(e) => setDelivery({ ...delivery, time: e.target.value })} />
              <TextInput label="Endereço de entrega" className="md:col-span-2" value={delivery.address} onChange={(e) => setDelivery({ ...delivery, address: e.target.value })} />
              <TextInput label="Contato no local" value={delivery.contact} onChange={(e) => setDelivery({ ...delivery, contact: e.target.value })} />
              <TextInput label="Forma de pagamento (do PDF)" value={payment} onChange={(e) => setPayment(e.target.value)} />
              <TextArea label="Observações" className="md:col-span-2" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </Card>

          <Card title="Produtos">
            <div className="space-y-3">
              {items.map((it, idx) => (
                <div key={idx} className="grid gap-2 rounded-card-sm border border-tangerine-100 bg-white/70 p-3 md:grid-cols-12">
                  <div className="md:col-span-4"><p className="text-xs text-cocoa-700">No PDF</p><p className="text-sm font-semibold text-cocoa-900">{it.label}</p><p className="text-xs text-cocoa-700">{it.composition}</p></div>
                  <div className="md:col-span-3"><SelectInput label="Produto do cadastro" value={it.product_id} placeholder="Escolha o produto" onChange={(e) => setItems((l) => l.map((x, i) => i === idx ? { ...x, product_id: e.target.value } : x))}
                    options={(products.data?.rows ?? []).map((p) => ({ value: String(p.id), label: String(p.name) }))} /></div>
                  <div className="md:col-span-2"><SelectInput label="Litragem" value={it.keg_size_id} placeholder="—" onChange={(e) => setItems((l) => l.map((x, i) => i === idx ? { ...x, keg_size_id: e.target.value, liters: String(kegs.data?.rows.find((k) => String(k.id) === e.target.value)?.liters ?? '') } : x))}
                    options={(kegs.data?.rows ?? []).map((k) => ({ value: String(k.id), label: String(k.label) }))} /></div>
                  <div className="md:col-span-1"><TextInput label="Qtd." inputMode="decimal" value={it.quantity} onChange={(e) => setItems((l) => l.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} /></div>
                  <div className="md:col-span-2"><TextInput label="Valor unit. (R$)" inputMode="decimal" value={it.unit_price} onChange={(e) => setItems((l) => l.map((x, i) => i === idx ? { ...x, unit_price: e.target.value } : x))} /></div>
                </div>))}
            </div>
            <p className="mt-3 text-sm text-cocoa-700">Total do pedido: <strong className="text-cocoa-900">{formatReais(total)}</strong></p>
          </Card>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Card title="Boleto já gerado">
            {client.mode !== 'existente' ? <p className="text-sm text-cocoa-700">Para vincular um boleto, o cliente precisa estar cadastrado.</p>
              : customerBoletos.length === 0 ? <p className="text-sm text-cocoa-700">Nenhum boleto em aberto e sem pedido para este cliente. O pedido segue sem boleto.</p>
              : <div className="space-y-3">
                <SelectInput label="Boleto deste cliente" value={boletoId} placeholder="Sem boleto (não vincular)" onChange={(e) => setBoletoId(e.target.value)}
                  options={customerBoletos.map((b) => ({ value: String(b.id), label: `Nº ${String(b.document_number ?? '—')} · ${formatReais(Number(b.original_amount))}` }))} />
                {selectedBoleto && boletoMismatch && <Alert tone="danger">O valor do boleto ({formatReais(Number(selectedBoleto.original_amount))}) não confere com o total do pedido ({formatReais(total)}).</Alert>}
                {selectedBoleto && !boletoMismatch && <Alert tone="success">O boleto vira o título deste pedido. Não será gerada outra cobrança.</Alert>}
              </div>}
            {parsed.boletoCode && <p className="mt-3 text-xs text-cocoa-700">O PDF indica o boleto nº {parsed.boletoCode}.</p>}
          </Card>
          <Card title="Confirmação">
            <Checkbox label="Confirmar o pedido agora (reserva estoque e gera a cobrança, se não houver boleto)" checked={confirmNow} onChange={(e) => setConfirmNow(e.target.checked)} />
            <p className="mt-3 text-xs text-cocoa-700">Sem marcar, o pedido é salvo como orçamento e você confirma na tela do pedido.</p>
          </Card>
        </aside>
      </div>}
    </>
  );
}

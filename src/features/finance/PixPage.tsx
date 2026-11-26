import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, QrCode } from 'lucide-react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { PageHeader, Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { SelectInput, TextInput } from '@/components/ui/Form';
import { Alert, Badge, friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { buildStaticPix, detectPixKeyType } from '@/domain/pix';
import { formatReais, toCents } from '@/domain/money';
import { formatDateBR } from '@/domain/dates';
import { useAuth } from '@/features/auth/AuthContext';
import { WhatsAppButton } from './WhatsAppButton';

export function PixPage() {
  const { can } = useAuth();
  const company = useList<Row>('company', {});
  const co = company.data?.rows[0];
  const recv = useList<Row>('receivables_view', { filters: [{ column: 'status', op: 'in', value: ['em_aberto', 'parcialmente_pago'] }], order: [{ column: 'due_date' }], range: [0, 999] });
  const charges = useList<Row>('pix_charges', { order: [{ column: 'created_at', ascending: false }], range: [0, 49] });
  const [recvId, setRecvId] = useState('');
  const [amount, setAmount] = useState('');
  const [qr, setQr] = useState('');
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const r = recv.data?.rows.find((x) => x.id === recvId);

  const code = useMemo(() => {
    if (!co?.pix_key) return null;
    try {
      return buildStaticPix({ key: String(co.pix_key), merchantName: String(co.pix_merchant_name ?? co.trade_name ?? 'JK CHOPP'), merchantCity: String(co.pix_merchant_city ?? 'SAO PAULO'), amountCents: amount ? toCents(amount) : null, txid: r ? `JK${String(r.id).replace(/-/g, '').slice(0, 20)}` : null });
    } catch {
      return null;
    }
  }, [co, amount, r]);

  useEffect(() => {
    if (code) QRCode.toDataURL(code, { margin: 1, width: 260, color: { dark: '#69351F', light: '#FFFFFF' } }).then(setQr);
    else setQr('');
  }, [code]);

  const register = async () => {
    try {
      await db().insert('pix_charges', { receivable_id: recvId || null, kind: 'estatico', amount: amount ? Number(amount) : null, br_code: code, internal_due_date: r?.due_date ?? null, status: 'gerado' });
      invalidate();
      toast('Cobrança Pix registrada. A confirmação de pagamento é feita em Contas a receber após conferir o extrato.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Pix" subtitle="QR Code estático (BR Code) gerado localmente. Pagamento só é confirmado após conferência no extrato ou via API Pix da instituição (cobrança dinâmica — pendente de integração)." />
      {!co?.pix_key && <div className="mb-4"><Alert tone="warning" title="Chave Pix não configurada">Defina a chave Pix, o nome e a cidade do recebedor em Administração → Configurações → Empresa.</Alert></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card opaque className="lg:col-span-2" title="Gerar cobrança Pix">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectInput wrapperClassName="sm:col-span-2" label="Vincular a título (opcional)" placeholder="Sem vínculo" value={recvId}
              onChange={(e) => { setRecvId(e.target.value); const x = recv.data?.rows.find((y) => y.id === e.target.value); if (x) setAmount(Number(x.outstanding).toFixed(2)); }}
              options={(recv.data?.rows ?? []).map((x) => ({ value: String(x.id), label: `${String(x.customer_trade_name ?? x.customer_name)} — ${formatReais(x.outstanding as number)} — venc. ${formatDateBR(x.due_date as string)}` }))} />
            <TextInput label="Valor (R$)" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} hint="Vazio = pagador informa o valor" />
            <div className="text-sm"><p className="label">Chave</p><p className="break-all">{String(co?.pix_key ?? '—')} {co?.pix_key ? <Badge tone="info">{detectPixKeyType(String(co.pix_key)) ?? 'tipo não identificado'}</Badge> : null}</p></div>
          </div>
          {code && (
            <div className="mt-4 space-y-2">
              <p className="label">Pix copia e cola</p>
              <div className="break-all rounded-2xl bg-cream-100 p-3 font-mono text-xs">{code}</div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon={<Copy className="size-4" />} onClick={() => navigator.clipboard.writeText(code).then(() => toast('Código copiado.'))}>Copiar código</Button>
                {can('cobranca', 'create') && <Button icon={<QrCode className="size-4" />} onClick={register}>Registrar cobrança</Button>}
                {r && (r.customer_whatsapp || r.customer_phone) ? <WhatsAppButton phone={String(r.customer_whatsapp ?? r.customer_phone)} templateKey="pix_pendente" values={{ NOME_CLIENTE: String(r.customer_trade_name ?? r.customer_name), VALOR_ORIGINAL: formatReais(Number(amount)), CODIGO_PIX: code }} customerId={String(r.customer_id)} refType="receivable" refId={String(r.id)} /> : null}
              </div>
            </div>
          )}
        </Card>
        <Card title="QR Code">
          {qr ? <img src={qr} alt="QR Code Pix" className="mx-auto rounded-2xl bg-white p-2" width={260} height={260} /> : <p className="py-16 text-center text-sm text-cocoa-700">Configure a chave Pix para gerar.</p>}
          <p className="mt-3 text-xs text-cocoa-700">QR estático: não confirma pagamento automaticamente. Confira o crédito no banco antes de dar baixa.</p>
        </Card>
      </div>
      <Card opaque className="mt-4" title="Cobranças Pix registradas">
        {(charges.data?.rows ?? []).length === 0 ? <p className="text-sm text-cocoa-700">Nenhuma cobrança registrada.</p> : (
          <ul className="divide-y divide-tangerine-100 text-sm">{charges.data!.rows.map((c) => (
            <li key={String(c.id)} className="flex flex-wrap items-center gap-3 py-2"><Badge tone={c.status === 'confirmado' ? 'success' : c.status === 'cancelado' ? 'neutral' : 'warning'}>{String(c.status)}</Badge><span className="num">{c.amount ? formatReais(c.amount as number) : 'valor livre'}</span><span className="text-cocoa-700">{String(c.kind)}</span><span className="ml-auto text-xs text-cocoa-700">{formatDateBR(String(c.created_at).slice(0, 10))}</span></li>))}</ul>
        )}
      </Card>
    </div>
  );
}

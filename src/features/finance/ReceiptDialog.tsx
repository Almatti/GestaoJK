import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Overlay';
import { Button } from '@/components/ui/Button';
import { Checkbox, SelectInput, TextArea, TextInput } from '@/components/ui/Form';
import { Alert, friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { db, useInvalidateAll, useList } from '@/data/hooks';
import type { Row } from '@/data/types';
import { formatReais } from '@/domain/money';
import { todaySP } from '@/domain/dates';

export const METHODS = [['pix', 'Pix'], ['boleto', 'Boleto'], ['dinheiro', 'Dinheiro'], ['cartao_credito', 'Cartão de crédito'], ['cartao_debito', 'Cartão de débito'], ['transferencia', 'Transferência'], ['cheque', 'Cheque'], ['cartorio', 'Pago no cartório'], ['outro', 'Outro']].map(([value, label]) => ({ value: value!, label: label! }));

/** Registro de recebimento (total ou parcial) com encargos calculados no servidor. */
export function ReceiptDialog({ receivable, open, onClose }: { receivable: Row | null; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const accounts = useList<Row>('financial_accounts', { filters: [{ column: 'active', op: 'eq', value: true }] });
  const [charges, setCharges] = useState<{ days_late: number; fine: number; interest: number; total: number } | null>(null);
  const [v, setV] = useState({ amount: '', method: 'pix', paid_at: todaySP(), account: '', ref: '', verified: false, notes: '', applyCharges: true });
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open || !receivable) return;
    const outstanding = Number(receivable.amount) - Number(receivable.paid_amount);
    setV((s) => ({ ...s, amount: outstanding.toFixed(2), paid_at: todaySP(), ref: '', notes: '', verified: false }));
    db().rpc<{ days_late: number; fine: number; interest: number; total: number }[]>('receivable_charges', { p_receivable: receivable.id, p_ref: todaySP() })
      .then((r) => { const c = r?.[0] ?? null; setCharges(c); if (c && c.total > outstanding) setV((s) => ({ ...s, amount: Number(c.total).toFixed(2) })); })
      .catch(() => setCharges(null));
  }, [open, receivable]);

  if (!receivable) return null;
  const outstanding = Number(receivable.amount) - Number(receivable.paid_amount);
  const fine = v.applyCharges ? Number(charges?.fine ?? 0) : 0;
  const interest = v.applyCharges ? Number(charges?.interest ?? 0) : 0;

  const settled = outstanding <= 0 || receivable.status === 'pago';
  const submit = async () => {
    if (settled) return toast('Este título já está quitado: não há saldo para registrar.', 'warning');
    const amount = Number(v.amount);
    if (!(amount > 0)) return toast('Informe um valor válido.', 'warning');
    setBusy(true);
    try {
      const chargesPaid = Math.min(amount, fine + interest);
      const r = await db().rpc<{ status: string }>('register_receipt', {
        p_receivable: receivable.id, p_amount: amount, p_method: v.method, p_paid_at: v.paid_at, p_account: v.account || null, p_external_ref: v.ref || null,
        p_verified: v.verified, p_notes: v.notes || null, p_idempotency_key: key, p_fine: Math.min(fine, chargesPaid), p_interest: Math.max(0, chargesPaid - Math.min(fine, chargesPaid))
      });
      invalidate();
      toast(r?.status === 'pago' ? 'Título quitado. Lembretes financeiros interrompidos.' : 'Pagamento parcial registrado.');
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
    setBusy(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="Registrar recebimento" description={String(receivable.description)} size="md"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={busy} disabled={settled} onClick={submit}>Registrar</Button></>}>
      <div className="space-y-4">
        {settled && <Alert tone="success" title="Título já quitado">Não há saldo em aberto: o pagamento deste título já está registrado.</Alert>}
        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-cream-100 p-3 text-center text-sm">
          <div><p className="text-xs text-cocoa-700">Em aberto</p><p className="num font-bold">{formatReais(outstanding)}</p></div>
          <div><p className="text-xs text-cocoa-700">Multa + juros</p><p className="num font-bold">{formatReais(Number(charges?.fine ?? 0) + Number(charges?.interest ?? 0))}</p></div>
          <div><p className="text-xs text-cocoa-700">Dias de atraso</p><p className="num font-bold">{charges?.days_late ?? 0}</p></div>
        </div>
        {charges && charges.days_late > 0 && <Checkbox label="Cobrar multa e juros conforme regra vigente" hint="Multa única + juros simples pro rata. Valores configuráveis em Cobranças." checked={v.applyCharges} onChange={(e) => setV((s) => ({ ...s, applyCharges: e.target.checked, amount: (outstanding + (e.target.checked ? Number(charges.fine) + Number(charges.interest) : 0)).toFixed(2) }))} />}
        <div className="grid grid-cols-2 gap-3">
          <TextInput label="Valor recebido (R$)" type="number" step="0.01" className="num" value={v.amount} onChange={(e) => setV((s) => ({ ...s, amount: e.target.value }))} hint="Valor menor que o devido = pagamento parcial" />
          <SelectInput label="Forma" options={METHODS} value={v.method} onChange={(e) => setV((s) => ({ ...s, method: e.target.value }))} />
          <TextInput label="Data do pagamento" type="date" value={v.paid_at} onChange={(e) => setV((s) => ({ ...s, paid_at: e.target.value }))} />
          <SelectInput label="Conta de destino" placeholder="Padrão" options={(accounts.data?.rows ?? []).map((a) => ({ value: String(a.id), label: String(a.name) }))} value={v.account} onChange={(e) => setV((s) => ({ ...s, account: e.target.value }))} />
          <TextInput wrapperClassName="col-span-2" label="Referência (ID Pix E2E, nosso número…)" value={v.ref} onChange={(e) => setV((s) => ({ ...s, ref: e.target.value }))} />
        </div>
        <Checkbox label="Pagamento conferido no extrato/banco" hint="Comprovante enviado pelo cliente não confirma pagamento por si só." checked={v.verified} onChange={(e) => setV((s) => ({ ...s, verified: e.target.checked }))} />
        {!v.verified && <Alert tone="warning">Pagamento será registrado como <strong>não conferido</strong>. Concilie com o extrato depois.</Alert>}
        <TextArea label="Observações" value={v.notes} onChange={(e) => setV((s) => ({ ...s, notes: e.target.value }))} />
      </div>
    </Modal>
  );
}

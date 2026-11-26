import { useState } from 'react';
import { HandCoins } from 'lucide-react';
import { ResourcePage } from '@/features/resource/ResourcePage';
import { payablesDef } from '@/features/resource/definitions';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Overlay';
import { SelectInput, TextInput } from '@/components/ui/Form';
import { friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { db, useInvalidateAll, useList } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { formatReais } from '@/domain/money';
import { todaySP } from '@/domain/dates';
import { METHODS } from './ReceiptDialog';

export function PayablesPage() {
  const [paying, setPaying] = useState<Row | null>(null);
  const { can } = useAuth();
  const def = { ...payablesDef, rowActions: (r: Row) => (['em_aberto', 'parcialmente_pago'].includes(String(r.status)) && can('financeiro', 'edit') ? <Button size="sm" variant="soft" icon={<HandCoins className="size-4" />} onClick={() => setPaying(r)}>Pagar</Button> : null) };
  return (
    <>
      <ResourcePage def={def} />
      {paying && <PayDialog payable={paying} onClose={() => setPaying(null)} />}
    </>
  );
}

function PayDialog({ payable, onClose }: { payable: Row; onClose: () => void }) {
  const accounts = useList<Row>('financial_accounts', { filters: [{ column: 'active', op: 'eq', value: true }] });
  const outstanding = Number(payable.amount) - Number(payable.paid_amount);
  const [v, setV] = useState({ amount: outstanding.toFixed(2), method: 'pix', date: todaySP(), account: '' });
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const submit = async () => {
    try {
      await db().rpc('pay_payable', { p_payable: payable.id, p_amount: Number(v.amount), p_method: v.method, p_paid_at: v.date, p_account: v.account || null });
      invalidate();
      toast('Pagamento registrado.');
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  return (
    <Modal open onClose={onClose} title="Registrar pagamento" description={`${String(payable.description)} · em aberto ${formatReais(outstanding)}`} size="sm" footer={<Button onClick={submit}>Confirmar pagamento</Button>}>
      <div className="grid grid-cols-2 gap-3">
        <TextInput label="Valor (R$)" type="number" step="0.01" value={v.amount} onChange={(e) => setV((s) => ({ ...s, amount: e.target.value }))} />
        <SelectInput label="Forma" options={METHODS} value={v.method} onChange={(e) => setV((s) => ({ ...s, method: e.target.value }))} />
        <TextInput label="Data" type="date" value={v.date} onChange={(e) => setV((s) => ({ ...s, date: e.target.value }))} />
        <SelectInput label="Conta" placeholder="Padrão" options={(accounts.data?.rows ?? []).map((a) => ({ value: String(a.id), label: String(a.name) }))} value={v.account} onChange={(e) => setV((s) => ({ ...s, account: e.target.value }))} />
      </div>
    </Modal>
  );
}

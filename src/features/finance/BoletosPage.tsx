import { useState } from 'react';
import { Plus, Copy } from 'lucide-react';
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

function BoletoForm({ onClose }: { onClose: () => void }) {
  const recv = useList<Row>('receivables_view', { filters: [{ column: 'status', op: 'in', value: ['em_aberto', 'parcialmente_pago'] }], order: [{ column: 'due_date' }], range: [0, 999] });
  const [v, setV] = useState<Record<string, string>>({ receivable_id: '', document_number: '', our_number: '', your_number: '', bank_code: '', wallet: '', barcode: '', digitable_line: '', issue_date: todaySP(), due_date: '', original_amount: '', planned_protest_date: '' });
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const submit = async () => {
    if (!v.receivable_id || !v.due_date || !(Number(v.original_amount) > 0)) return toast('Preencha título, vencimento e valor.', 'warning');
    try {
      await db().insert('boletos', Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val === '' ? null : k === 'original_amount' ? Number(val) : val])));
      await db().update('receivables', v.receivable_id, { payment_method: 'boleto' });
      invalidate();
      toast('Boleto cadastrado.');
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  return (
    <Modal open onClose={onClose} title="Cadastrar boleto emitido" drawer footer={<Button onClick={submit}>Salvar</Button>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectInput wrapperClassName="sm:col-span-2" label="Título (conta a receber)" required placeholder="Selecione…" value={v.receivable_id}
          onChange={(e) => { const r = recv.data?.rows.find((x) => x.id === e.target.value); setV((s) => ({ ...s, receivable_id: e.target.value, due_date: String(r?.due_date ?? ''), original_amount: String(r?.outstanding ?? '') })); }}
          options={(recv.data?.rows ?? []).map((r) => ({ value: String(r.id), label: `${String(r.customer_trade_name ?? r.customer_name)} — ${String(r.description)} (${formatReais(r.outstanding as number)})` }))} />
        <TextInput label="Banco (código)" value={v.bank_code} onChange={set('bank_code')} />
        <TextInput label="Carteira" value={v.wallet} onChange={set('wallet')} />
        <TextInput label="Número do documento" value={v.document_number} onChange={set('document_number')} />
        <TextInput label="Seu número" value={v.your_number} onChange={set('your_number')} />
        <TextInput label="Nosso número" value={v.our_number} onChange={set('our_number')} />
        <TextInput label="Emissão" type="date" value={v.issue_date} onChange={set('issue_date')} />
        <TextInput label="Vencimento" type="date" required value={v.due_date} onChange={set('due_date')} />
        <TextInput label="Valor original (R$)" type="number" step="0.01" required value={v.original_amount} onChange={set('original_amount')} />
        <TextInput label="Encaminhamento a protesto previsto (data interna)" type="date" value={v.planned_protest_date} onChange={set('planned_protest_date')} hint="Não é a data efetiva do protesto." />
        <TextInput wrapperClassName="sm:col-span-2" label="Linha digitável" value={v.digitable_line} onChange={set('digitable_line')} />
        <TextInput wrapperClassName="sm:col-span-2" label="Código de barras" value={v.barcode} onChange={set('barcode')} />
      </div>
    </Modal>
  );
}

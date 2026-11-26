import { useState } from 'react';
import { Upload, Check } from 'lucide-react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { PageHeader, Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, friendlyError } from '@/components/ui/Feedback';
import { SelectInput } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { parseOfx, matchTransactions, type OfxTransaction } from '@/lib/ofx';
import { formatReais } from '@/domain/money';
import { formatDateBR } from '@/domain/dates';
import { useAuth } from '@/features/auth/AuthContext';

export function ReconciliationPage() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const accounts = useList<Row>('financial_accounts', { filters: [{ column: 'active', op: 'eq', value: true }] });
  const [account, setAccount] = useState('');
  const tx = useList<Row>('financial_transactions', { filters: [{ column: 'account_id', op: 'eq', value: account }], order: [{ column: 'occurred_on', ascending: false }], range: [0, 999] }, { enabled: !!account });
  const [ofx, setOfx] = useState<OfxTransaction[] | null>(null);

  const onFile = async (file: File) => {
    try {
      const parsed = parseOfx(await file.text());
      if (!parsed.length) return toast('Nenhuma transação encontrada no arquivo. Verifique se é um OFX válido.', 'warning');
      setOfx(parsed);
      toast(`${parsed.length} transações lidas do extrato.`);
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  const reconcile = async (t: Row, ref?: string) => {
    try {
      await db().update('financial_transactions', String(t.id), { reconciled: true, reconciled_at: new Date().toISOString(), bank_statement_ref: ref ?? null });
      if (t.payment_id) await db().update('payments', String(t.payment_id), { verified: true });
      invalidate();
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };
  const internal = (tx.data?.rows ?? []).map((t) => ({ id: String(t.id), amount: Number(t.amount), occurred_on: String(t.occurred_on), reconciled: Boolean(t.reconciled), row: t }));
  const matches = ofx ? matchTransactions(ofx, internal) : [];

  return (
    <div className="animate-fade-in">
      <PageHeader title="Conciliação bancária" subtitle="Importe o extrato OFX do banco e confirme a correspondência com os lançamentos internos. CNAB depende do layout do banco (pendente)." />
      <Card opaque className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <SelectInput wrapperClassName="min-w-64" label="Conta" placeholder="Selecione…" value={account} onChange={(e) => setAccount(e.target.value)} options={(accounts.data?.rows ?? []).map((a) => ({ value: String(a.id), label: String(a.name) }))} />
          <label className={`inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-tangerine-200 bg-white px-4 text-sm font-medium ${!account ? 'pointer-events-none opacity-50' : ''}`}>
            <Upload className="size-4" /> Importar OFX
            <input type="file" accept=".ofx,.OFX,text/plain" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </div>
      </Card>
      {!account ? <Card><EmptyState title="Selecione uma conta" /></Card> : ofx ? (
        <Card opaque title="Sugestões de conciliação">
          <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-cocoa-700"><tr><th className="py-2">Extrato</th><th className="text-right">Valor</th><th>Lançamento interno</th><th /></tr></thead>
            <tbody>{matches.map(({ ofx: o, match }) => (
              <tr key={o.fitId + o.date} className="border-t border-tangerine-100">
                <td className="py-2">{formatDateBR(o.date)} · {o.memo}</td><td className="num text-right">{formatReais(o.amount)}</td>
                <td>{match ? <span>{formatDateBR(match.occurred_on)} · {String(match.row.description ?? '')}</span> : <Badge tone="warning">Sem correspondência</Badge>}</td>
                <td>{match && can('financeiro', 'edit') && <Button size="sm" variant="soft" icon={<Check className="size-4" />} onClick={() => reconcile(match.row, o.fitId)}>Conciliar</Button>}</td>
              </tr>))}</tbody></table>
          <div className="mt-3"><Alert tone="info">Itens sem correspondência devem ser lançados manualmente (receita, despesa ou ajuste) antes de conciliar.</Alert></div>
        </Card>
      ) : (
        <Card opaque title="Lançamentos da conta">
          {(tx.data?.rows ?? []).length === 0 ? <EmptyState title="Sem lançamentos" /> : (
            <ul className="divide-y divide-tangerine-100 text-sm">{tx.data!.rows.map((t) => (
              <li key={String(t.id)} className="flex flex-wrap items-center gap-3 py-2"><span className="w-24">{formatDateBR(t.occurred_on as string)}</span><span className="flex-1">{String(t.description ?? t.kind)}</span><span className="num">{formatReais(t.amount as number)}</span>
                {t.reconciled ? <Badge tone="success">Conciliado</Badge> : can('financeiro', 'edit') ? <Button size="sm" variant="ghost" onClick={() => reconcile(t)}>Marcar conciliado</Button> : <Badge tone="warning">Pendente</Badge>}</li>))}</ul>
          )}
        </Card>
      )}
    </div>
  );
}

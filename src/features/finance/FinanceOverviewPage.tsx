import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeftRight } from 'lucide-react';
import { useList, useRpc, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader, Card, Stat, Tabs } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Overlay';
import { SelectInput, TextInput } from '@/components/ui/Form';
import { Alert, friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { ResourcePage } from '@/features/resource/ResourcePage';
import { costCentersDef, financialAccountsDef, financialCategoriesDef } from '@/features/resource/definitions';
import { formatReais } from '@/domain/money';
import { periodFor, todaySP } from '@/domain/dates';
import type { Metrics } from '@/features/dashboard/DashboardPage';

export function FinanceOverviewPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'visao' | 'contas' | 'categorias' | 'centros'>('visao');
  const p = periodFor('mes', todaySP());
  const m = useRpc<Metrics>('dashboard_metrics', { p_start: p.start, p_end: p.end });
  const balances = useList<Row>('account_balances', {});
  const [transfer, setTransfer] = useState(false);
  const d = m.data;
  return (
    <div className="animate-fade-in">
      <PageHeader title="Visão financeira" subtitle="Regime de caixa (recebido/pago) e competência (faturado) apresentados separadamente." actions={can('financeiro', 'edit') && <Button variant="secondary" icon={<ArrowLeftRight className="size-4" />} onClick={() => setTransfer(true)}>Transferência entre contas</Button>} />
      <Tabs tabs={[{ key: 'visao', label: 'Visão geral' }, { key: 'contas', label: 'Contas e caixas' }, { key: 'categorias', label: 'Categorias' }, { key: 'centros', label: 'Centros de custo' }]} value={tab} onChange={setTab} />
      {tab === 'visao' && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Saldo em contas" value={formatReais(d?.cash_balance)} to="/financeiro/fluxo-de-caixa" />
            <Stat label="Faturado no mês (competência)" value={formatReais(d?.revenue_billed)} to="/relatorios" />
            <Stat label="Recebido no mês (caixa)" value={formatReais(d?.revenue_received)} to="/financeiro/fluxo-de-caixa" />
            <Stat label="Pago no mês (caixa)" value={formatReais(d?.expenses_paid)} to="/financeiro/pagar" />
            <Stat label="A receber em aberto" value={formatReais(d?.receivable_open)} hint={`${formatReais(d?.receivable_overdue)} vencido`} tone="down" to="/financeiro/receber" />
            <Stat label="A pagar em aberto" value={formatReais(d?.payable_open)} hint={`${formatReais(d?.payable_overdue)} vencido`} to="/financeiro/pagar" />
            <Stat label="Em protesto" value={formatReais(d?.in_protest)} to="/financeiro/protestos" />
            <Stat label="Projeção 30 dias" value={formatReais(d?.cash_projection_30d)} to="/financeiro/fluxo-de-caixa" />
          </div>
          <Card opaque className="mt-4" title="Saldos por conta">
            <ul className="divide-y divide-tangerine-100 text-sm">{(balances.data?.rows ?? []).map((b) => (
              <li key={String(b.id)} className="flex items-center justify-between py-2.5"><span>{String(b.name)} <span className="text-xs text-cocoa-700">({String(b.kind)})</span></span><span className="num font-semibold">{formatReais(b.balance as number)}</span></li>))}</ul>
            {(balances.data?.rows ?? []).length === 0 && <Alert tone="info">Cadastre suas contas bancárias e caixas na aba “Contas e caixas”.</Alert>}
          </Card>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[['/financeiro/receber', 'Contas a receber'], ['/financeiro/boletos', 'Boletos'], ['/financeiro/pix', 'Pix'], ['/financeiro/cobrancas', 'Fila de cobrança'], ['/financeiro/protestos', 'Protestos'], ['/financeiro/conciliacao', 'Conciliação'], ['/relatorios', 'DRE e relatórios'], ['/financeiro/fluxo-de-caixa', 'Fluxo de caixa']].map(([to, l]) => (
              <Link key={to} to={to!} className="card card-sm text-center text-sm font-semibold hover:shadow-[var(--shadow-lift)]">{l}</Link>))}
          </div>
        </>
      )}
      {tab === 'contas' && <ResourcePage def={financialAccountsDef} />}
      {tab === 'categorias' && <ResourcePage def={financialCategoriesDef} />}
      {tab === 'centros' && <ResourcePage def={costCentersDef} />}
      {transfer && <TransferDialog accounts={balances.data?.rows ?? []} onClose={() => setTransfer(false)} />}
    </div>
  );
}

function TransferDialog({ accounts, onClose }: { accounts: Row[]; onClose: () => void }) {
  const [v, setV] = useState({ from: '', to: '', amount: '' });
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const opts = accounts.map((a) => ({ value: String(a.id), label: String(a.name) }));
  return (
    <Modal open onClose={onClose} title="Transferência interna" description="Não é receita nem despesa operacional." size="sm"
      footer={<Button onClick={async () => { try { await db().rpc('transfer_between_accounts', { p_from: v.from, p_to: v.to, p_amount: Number(v.amount) }); invalidate(); toast('Transferência registrada.'); onClose(); } catch (e) { toast(friendlyError(e), 'danger'); } }}>Transferir</Button>}>
      <div className="space-y-3">
        <SelectInput label="De" placeholder="Selecione…" options={opts} value={v.from} onChange={(e) => setV((s) => ({ ...s, from: e.target.value }))} />
        <SelectInput label="Para" placeholder="Selecione…" options={opts} value={v.to} onChange={(e) => setV((s) => ({ ...s, to: e.target.value }))} />
        <TextInput label="Valor (R$)" type="number" step="0.01" value={v.amount} onChange={(e) => setV((s) => ({ ...s, amount: e.target.value }))} />
      </div>
    </Modal>
  );
}

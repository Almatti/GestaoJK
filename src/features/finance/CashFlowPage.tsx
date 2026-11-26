import { useMemo, useState } from 'react';
import { Bar, ComposedChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { useList, useRpc } from '@/data/hooks';
import type { Row } from '@/data/types';
import { PageHeader, Card, Stat } from '@/components/ui/Layout';
import { Alert, LoadingBlock } from '@/components/ui/Feedback';
import { formatReais } from '@/domain/money';
import { addDays, formatDateBR, todaySP } from '@/domain/dates';

interface Day { day: string; realized_in: number; realized_out: number; expected_in: number; expected_out: number }

export function CashFlowPage() {
  const [start, setStart] = useState(addDays(todaySP(), -15));
  const [end, setEnd] = useState(addDays(todaySP(), 45));
  const q = useRpc<Day[]>('cash_flow', { p_start: start, p_end: end });
  const balances = useList<Row>('account_balances', {});
  const balance = (balances.data?.rows ?? []).reduce((s, b) => s + Number(b.balance), 0);
  const today = todaySP();

  const data = useMemo(() => {
    let running = balance;
    // saldo projetado a partir de hoje: saldo real + previstos futuros (recebíveis não são saldo disponível até serem recebidos)
    return (q.data ?? []).map((d) => {
      const isFuture = d.day > today;
      if (isFuture) running += Number(d.expected_in) - Number(d.expected_out);
      return { ...d, realized_in: Number(d.realized_in), realized_out: -Number(d.realized_out), expected_in: Number(d.expected_in), expected_out: -Number(d.expected_out), projected: d.day >= today ? running : null };
    });
  }, [q.data, balance, today]);

  const tot = (k: keyof Day) => (q.data ?? []).reduce((s, d) => s + Number(d[k]), 0);
  return (
    <div className="animate-fade-in">
      <PageHeader title="Fluxo de caixa" subtitle="Realizado (caixa) e previsto (vencimentos). Transferências internas não entram como receita/despesa."
        actions={<div className="flex gap-2"><input type="date" className="input h-10 w-auto py-0" aria-label="Início" value={start} onChange={(e) => setStart(e.target.value)} /><input type="date" className="input h-10 w-auto py-0" aria-label="Fim" value={end} onChange={(e) => setEnd(e.target.value)} /></div>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Saldo atual em contas" value={formatReais(balance)} />
        <Stat label="Entradas realizadas" value={formatReais(tot('realized_in'))} tone="up" />
        <Stat label="Saídas realizadas" value={formatReais(tot('realized_out'))} tone="down" />
        <Stat label="A receber no período" value={formatReais(tot('expected_in'))} hint="Previsão, não é saldo" />
        <Stat label="A pagar no período" value={formatReais(tot('expected_out'))} />
      </div>
      <Card title="Movimentação diária e saldo projetado">
        {q.isLoading ? <LoadingBlock /> : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} stackOffset="sign">
                <CartesianGrid strokeDasharray="3 6" stroke="#FFCC97" vertical={false} />
                <XAxis dataKey="day" tickFormatter={(d: string) => `${d.slice(8)}/${d.slice(5, 7)}`} tick={{ fontSize: 11, fill: '#92543A' }} axisLine={false} tickLine={false} minTickGap={16} />
                <YAxis tick={{ fontSize: 11, fill: '#92543A' }} axisLine={false} tickLine={false} width={70} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v, n) => [formatReais(Math.abs(Number(v))), String(n)]} labelFormatter={(d) => formatDateBR(String(d))} contentStyle={{ borderRadius: 14 }} />
                <Legend />
                <Bar dataKey="realized_in" name="Entradas realizadas" stackId="a" fill="#1e7a46" radius={[6, 6, 0, 0]} />
                <Bar dataKey="realized_out" name="Saídas realizadas" stackId="a" fill="#b3261e" />
                <Bar dataKey="expected_in" name="A receber" stackId="b" fill="#FFA95E" radius={[6, 6, 0, 0]} />
                <Bar dataKey="expected_out" name="A pagar" stackId="b" fill="#D64101" />
                <Line dataKey="projected" name="Saldo projetado" stroke="#69351F" strokeWidth={2.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
      <div className="mt-4"><Alert tone="info">A projeção soma ao saldo atual os vencimentos futuros previstos. Títulos vencidos e não pagos não entram na projeção até serem recebidos.</Alert></div>
    </div>
  );
}

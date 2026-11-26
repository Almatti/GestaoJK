import { useEffect, useState } from 'react';
import { useList, db, useInvalidateAll } from '@/data/hooks';
import type { Row } from '@/data/types';
import { Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Checkbox, SelectInput, TextInput } from '@/components/ui/Form';
import { Alert, friendlyError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthContext';

const FIELDS: [string, string, 'number' | 'select' | 'bool' | 'time', string?][] = [
  ['default_term_days', 'Prazo padrão dos boletos (dias)', 'number'],
  ['fine_percent', 'Multa moratória (% — aplicada uma única vez)', 'number', 'Ex.: até 2% em relações de consumo (CDC). Entre empresas, conforme contrato.'],
  ['interest_percent', 'Juros de mora (%)', 'number', 'Juros simples pro rata. Sem pactuação, aplica-se a taxa legal do Código Civil.'],
  ['interest_period', 'Período dos juros', 'select'],
  ['grace_days', 'Carência (dias sem encargos)', 'number'],
  ['due_date_handling', 'Vencimento em fim de semana/feriado', 'select'],
  ['protest_after_days', 'Dias após vencimento para encaminhar a protesto (0 = desligado)', 'number', 'Data interna de encaminhamento — não é a data efetiva do protesto.'],
  ['protest_day_count', 'Contagem do prazo de protesto', 'select'],
  ['remind_before_days', 'Lembrete antes do vencimento (dias)', 'number'],
  ['remind_on_due', 'Lembrete no dia do vencimento', 'bool'],
  ['remind_after_every_days', 'Repetir cobrança após vencimento a cada (dias)', 'number'],
  ['remind_before_protest_days', 'Aviso antes do encaminhamento a protesto (dias)', 'number'],
  ['notify_payment_confirmation', 'Mensagem de confirmação de pagamento', 'bool'],
  ['notification_time', 'Horário das notificações', 'time']
];
const OPTIONS: Record<string, { value: string; label: string }[]> = {
  interest_period: [{ value: 'mensal', label: 'Ao mês (pro rata dia)' }, { value: 'diario', label: 'Ao dia' }],
  due_date_handling: [{ value: 'proximo_dia_util', label: 'Prorrogar para o próximo dia útil' }, { value: 'manter', label: 'Manter a data' }],
  protest_day_count: [{ value: 'corridos', label: 'Dias corridos' }, { value: 'uteis', label: 'Dias úteis' }]
};

export function CollectionRulesForm() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const q = useList<Row>('collection_rules', { filters: [{ column: 'customer_id', op: 'is', value: null }], order: [{ column: 'valid_from', ascending: false }] });
  const current = q.data?.rows.find((r) => !r.valid_to) ?? q.data?.rows[0];
  const [v, setV] = useState<Row>({});
  useEffect(() => {
    if (current) setV(current);
  }, [current]);
  if (!current) return <Card opaque><p className="text-sm">Carregando…</p></Card>;

  const save = async () => {
    try {
      const values: Row = Object.fromEntries(FIELDS.map(([k, , t]) => [k, t === 'number' ? Number(v[k] ?? 0) : v[k]]));
      await db().update('collection_rules', String(current.id), values);
      invalidate();
      toast('Regras atualizadas. Novos lançamentos usarão estas condições; títulos existentes mantêm a regra original.');
    } catch (e) {
      toast(friendlyError(e), 'danger');
    }
  };

  return (
    <Card opaque title="Regra global de cobrança">
      <Alert tone="warning" title="Validação jurídica">Percentuais variam conforme contrato, Código Civil e CDC. Os valores iniciais são zero até que a administração os defina. Cada título guarda a regra vigente no lançamento.</Alert>
      <fieldset disabled={!can('cobranca', 'edit')} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FIELDS.map(([k, label, t, hint]) => t === 'bool' ? (
          <Checkbox key={k} label={label} checked={Boolean(v[k])} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.checked }))} />
        ) : t === 'select' ? (
          <SelectInput key={k} label={label} options={OPTIONS[k]!} value={String(v[k] ?? '')} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))} />
        ) : (
          <TextInput key={k} label={label} hint={hint} type={t} step="any" value={String(v[k] ?? '')} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))} />
        ))}
      </fieldset>
      {can('cobranca', 'edit') && <div className="mt-4"><Button onClick={save}>Salvar regras</Button></div>}
      <p className="mt-3 text-xs text-cocoa-700">Regras específicas por cliente podem ser cadastradas na tabela collection_rules (customer_id) e prevalecem sobre a global.</p>
    </Card>
  );
}

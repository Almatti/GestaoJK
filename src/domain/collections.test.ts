import { allocatePayment, applyPayment, calculateCharges, canTransitionProtest, combinedStatus, daysLate, deriveFinancialStatus, plannedProtestDate, type ChargeRules } from './collections';

const rules: ChargeRules = { finePercent: 2, interestPercent: 1, interestPeriod: 'mensal', graceDays: 0, dueDateHandling: 'proximo_dia_util', protestAfterDays: 5, protestDayCount: 'uteis' };

describe('juros e multa', () => {
  it('sem encargos dentro do vencimento', () => {
    expect(calculateCharges(100000, '2026-11-10', '2026-11-10', rules).total).toBe(100000);
  });
  it('multa única + juros simples pro rata', () => {
    const c = calculateCharges(100000, '2026-11-10', '2026-11-25', rules); // 15 dias
    expect(c.daysLate).toBe(15);
    expect(c.fine).toBe(2000);
    expect(c.interest).toBe(500); // 1%/30 × 15 = 0,5%
    expect(c.total).toBe(102500);
  });
  it('multa NÃO é recorrente: 90 dias continua 2%', () => {
    const c = calculateCharges(100000, '2026-08-01', '2026-10-30', rules);
    expect(c.fine).toBe(2000);
    expect(c.interest).toBe(3000);
  });
  it('vencimento no sábado é prorrogado para segunda', () => {
    // 2026-11-14 é sábado
    expect(daysLate('2026-11-14', '2026-11-16', rules)).toBe(0);
    expect(daysLate('2026-11-14', '2026-11-17', rules)).toBe(3);
    expect(daysLate('2026-11-14', '2026-11-16', { dueDateHandling: 'manter' })).toBe(2);
  });
  it('respeita feriados', () => {
    expect(daysLate('2026-11-20', '2026-11-23', rules, new Set(['2026-11-20']))).toBe(0);
  });
  it('data interna de protesto em dias úteis', () => {
    expect(plannedProtestDate('2026-11-13', rules)).toBe('2026-11-20');
    expect(plannedProtestDate('2026-11-13', { protestAfterDays: 0, protestDayCount: 'corridos' })).toBeNull();
  });
});

describe('situação financeira x cartorária', () => {
  it('deriva status financeiro', () => {
    const t = '2026-11-26';
    expect(deriveFinancialStatus({ amountCents: 100, paidCents: 0, due: '2026-12-30' }, t)).toBe('em_aberto');
    expect(deriveFinancialStatus({ amountCents: 100, paidCents: 0, due: '2026-11-28' }, t)).toBe('a_vencer');
    expect(deriveFinancialStatus({ amountCents: 100, paidCents: 0, due: '2026-11-20' }, t)).toBe('vencido');
    expect(deriveFinancialStatus({ amountCents: 100, paidCents: 40, due: '2026-11-20' }, t)).toBe('parcialmente_pago');
    expect(deriveFinancialStatus({ amountCents: 100, paidCents: 100, due: '2026-11-20' }, t)).toBe('pago');
    expect(deriveFinancialStatus({ amountCents: 100, paidCents: 0, due: '2026-11-20', cancelled: true }, t)).toBe('cancelado');
  });
  it('Cenário 3: pago via Pix mas ainda em protesto interrompe lembretes e mantém pendência', () => {
    const s = combinedStatus('pago', 'protestado', 'Pix');
    expect(s.label).toBe('Pago via Pix, mas ainda em protesto');
    expect(s.financialSettled).toBe(true);
    expect(s.cartorialPending).toBe(true);
    expect(s.sendFinancialReminders).toBe(false);
  });
  it('vencido continua recebendo lembretes', () => {
    expect(combinedStatus('vencido', 'nao_encaminhado').sendFinancialReminders).toBe(true);
    expect(combinedStatus('vencido', 'em_cartorio').cartorialPending).toBe(true);
  });
  it('transições cartorárias válidas', () => {
    expect(canTransitionProtest('protestado', 'aguardando_anuencia')).toBe(true);
    expect(canTransitionProtest('protesto_cancelado', 'protestado')).toBe(false);
  });
});

describe('pagamentos', () => {
  it('parcial e excedente', () => {
    expect(applyPayment(10000, 0, 4000)).toEqual({ appliedCents: 4000, newPaidCents: 4000, outstandingCents: 6000, overpaymentCents: 0 });
    expect(applyPayment(10000, 4000, 7000).overpaymentCents).toBe(1000);
    expect(() => applyPayment(10000, 0, 0)).toThrow();
  });
  it('aloca do mais antigo para o mais novo', () => {
    const r = allocatePayment([
      { id: 'b', due: '2026-11-20', outstandingCents: 5000 },
      { id: 'a', due: '2026-10-20', outstandingCents: 3000 }
    ], 6000);
    expect(r.allocations).toEqual([{ id: 'a', cents: 3000 }, { id: 'b', cents: 3000 }]);
    expect(r.remainderCents).toBe(0);
  });
});

describe('data prevista de encaminhamento a protesto', () => {
  it('3 dias úteis após o vencimento (pula fim de semana e feriado)', async () => {
    const { plannedProtestDate } = await import('./collections');
    expect(plannedProtestDate('2026-12-01', { protestAfterDays: 3, protestDayCount: 'uteis' })).toBe('2026-12-04');
    expect(plannedProtestDate('2026-12-03', { protestAfterDays: 3, protestDayCount: 'uteis' })).toBe('2026-12-08');
    expect(plannedProtestDate('2026-12-23', { protestAfterDays: 3, protestDayCount: 'uteis' }, new Set(['2026-12-25']))).toBe('2026-12-29');
    expect(plannedProtestDate('2026-12-01', { protestAfterDays: 3, protestDayCount: 'corridos' })).toBe('2026-12-04');
    expect(plannedProtestDate('2026-12-01', { protestAfterDays: 0, protestDayCount: 'uteis' })).toBeNull();
  });
});

describe('multa e juros pela regra salva no título', () => {
  it('converte a regra do banco e calcula encargos (multa 4% + juros 3% a.m.)', async () => {
    const { chargeRulesFromRow, calculateCharges } = await import('./collections');
    const rules = chargeRulesFromRow({ fine_percent: '4', interest_percent: '3', interest_period: 'mensal', grace_days: 0, due_date_handling: 'proximo_dia_util', protest_after_days: 3, protest_day_count: 'uteis' });
    expect(rules).toMatchObject({ finePercent: 4, interestPercent: 3, protestDayCount: 'uteis' });
    const c = calculateCharges(10000, '2026-12-01', '2026-12-11', rules);
    expect(c.daysLate).toBe(10);
    expect(c.fine).toBe(400);
    expect(c.interest).toBe(100); // 3%/30 × 10 dias × R$ 100,00
    expect(c.total).toBe(10500);
    expect(chargeRulesFromRow(null).finePercent).toBe(0);
  });
});

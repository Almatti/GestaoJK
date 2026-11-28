import { cobrancaMessage, cobrancaStage } from './cobranca';

const base = { open: true, dueDate: '2026-12-10', today: '2026-12-01', dueSoonDays: 7, protest: null };

describe('cobrança por situação', () => {
  it('a vencer: vence nos próximos dias', () => {
    expect(cobrancaStage({ ...base, dueDate: '2026-12-05' })).toBe('a_vencer');
    expect(cobrancaStage({ ...base, dueDate: '2026-12-20' })).toBeNull();
  });
  it('vencido: passou do vencimento sem protesto (inclusive protesto só programado)', () => {
    expect(cobrancaStage({ ...base, dueDate: '2026-11-20' })).toBe('vencido');
    expect(cobrancaStage({ ...base, dueDate: '2026-11-20', protest: 'programado' })).toBe('vencido');
  });
  it('em cartório e protestado', () => {
    expect(cobrancaStage({ ...base, dueDate: '2026-11-20', protest: 'em_cartorio' })).toBe('cartorio');
    expect(cobrancaStage({ ...base, dueDate: '2026-11-20', protest: 'aguardando_anuencia' })).toBe('cartorio');
    expect(cobrancaStage({ ...base, dueDate: '2026-11-20', protest: 'protestado' })).toBe('protestado');
  });
  it('pago, cancelado ou sem saldo não entram na cobrança', () => {
    expect(cobrancaStage({ ...base, open: false, dueDate: '2026-11-20', protest: 'protestado' })).toBeNull();
  });
  it('mensagens cobram, não agradecem nem confirmam pagamento', () => {
    const v = { nome: 'Bar X', empresa: 'JK', valor: 'R$ 100,00', valorAtualizado: 'R$ 105,00', vencimento: '01/12/2026', diasAtraso: 10, linhaDigitavel: null };
    for (const st of ['a_vencer', 'vencido', 'cartorio', 'protestado'] as const) {
      const m = cobrancaMessage(st, v);
      expect(m).not.toMatch(/recebemos|obrigad|confirmamos o recebimento|agradec/i);
    }
    expect(cobrancaMessage('vencido', v)).toContain('R$ 105,00');
  });
});

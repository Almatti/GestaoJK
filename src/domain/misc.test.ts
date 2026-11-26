import { buildStaticPix, crc16ccitt, isValidBrCode, detectPixKeyType } from './pix';
import { renderTemplate, whatsappLink, canTransitionMessage, extractVariables } from './messages';
import { evaluateHealth } from './health';
import { computeNewCredits, settle, type PartnerRule, type PartnerOrder } from './partners';
import { allocateFEFO, InsufficientStockError, suggestPurchase, canReserve, stockPosition } from './inventory';
import { findReservationConflict, maintenanceDue } from './equipment';
import { planEffects, idempotencyKey } from './automation';
import { canTransitionOrder, orderTotals, splitInstallments } from './orders';
import { can, permissionRows } from './permissions';
import { addBusinessDays, formatDateBR, parseDateBR, periodFor, previousPeriod, todaySP } from './dates';

describe('Pix BR Code estático', () => {
  it('reproduz o exemplo do manual do Banco Central (CRC 1D3D)', () => {
    const code = buildStaticPix({ key: '123e4567-e12b-12d1-a456-426655440000', merchantName: 'Fulano de Tal', merchantCity: 'BRASILIA' });
    expect(code).toBe('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D');
    expect(isValidBrCode(code)).toBe(true);
  });
  it('inclui valor e remove acentos', () => {
    const code = buildStaticPix({ key: 'financeiro@jkchopp.com.br', merchantName: 'JK Chopp Distribuição', merchantCity: 'São Paulo', amountCents: 12550, txid: 'PED-123' });
    expect(code).toContain('540512550'.replace('540512550', '5406125.50'));
    expect(code).toContain('JK Chopp Distribuicao');
    expect(code).toContain('0506PED123');
    expect(isValidBrCode(code)).toBe(true);
    expect(isValidBrCode(code.slice(0, -1) + '0')).toBe(code.endsWith('0'));
  });
  it('crc conhecido e tipo de chave', () => {
    expect(crc16ccitt('123456789')).toBe('29B1');
    expect(detectPixKeyType('+5511987654321')).toBe('telefone');
    expect(detectPixKeyType('11222333000181')).toBe('cnpj');
  });
});

describe('mensagens e WhatsApp', () => {
  it('renderiza variáveis e aponta faltantes', () => {
    const r = renderTemplate('Olá [NOME_CLIENTE], vence em [DATA_VENCIMENTO] o valor [VALOR_ORIGINAL]. [XYZ]', { NOME_CLIENTE: 'Bar do Zé', VALOR_ORIGINAL: 'R$ 10,00' });
    expect(r.text).toBe('Olá Bar do Zé, vence em [DATA_VENCIMENTO] o valor R$ 10,00. [XYZ]');
    expect(r.missing).toEqual(['DATA_VENCIMENTO']);
    expect(r.unknown).toEqual(['XYZ']);
    expect(extractVariables('[A_B] [A_B] [C]')).toEqual(['A_B', 'C']);
  });
  it('gera link wa.me codificado e recusa telefone inválido', () => {
    expect(whatsappLink('(11) 98765-4321', 'Olá & até já?')).toBe('https://wa.me/5511987654321?text=Ol%C3%A1%20%26%20at%C3%A9%20j%C3%A1%3F');
    expect(whatsappLink('123', 'x')).toBeNull();
  });
  it('abrir conversa não equivale a envio confirmado pela API', () => {
    expect(canTransitionMessage('gerada', 'entregue_api')).toBe(false);
    expect(canTransitionMessage('aberta', 'envio_informado')).toBe(true);
  });
});

describe('saúde comercial', () => {
  const orders = (dates: string[], liters: number) => dates.map((date) => ({ date, liters }));
  it('Cenário 6 / exemplo do documento: meta 2 barris/semana, consumo 2 barris/mês ⇒ crítico + baixa rotatividade', () => {
    const r = evaluateHealth({
      today: '2026-11-26', customerSince: '2026-01-10', expectedLitersPerWeek: 100,
      orders: orders(['2026-11-05', '2026-11-20', '2026-10-01', '2026-10-15', '2026-10-20'], 50)
    });
    expect(r.level).toBe('critico');
    expect(r.lowRotation).toBe(true);
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.factors.some((f) => f.key === 'meta')).toBe(true);
  });
  it('cliente novo não é classificado como crítico', () => {
    const r = evaluateHealth({ today: '2026-11-26', customerSince: '2026-11-15', expectedLitersPerWeek: 100, orders: orders(['2026-11-20'], 10) });
    expect(r.level).toBe('sem_historico');
  });
  it('inativo após limite', () => {
    const r = evaluateHealth({ today: '2026-11-26', customerSince: '2025-01-01', expectedLitersPerWeek: 50, orders: orders(['2026-08-01', '2026-07-01'], 50) });
    expect(r.level).toBe('inativo');
  });
  it('excelente quando supera meta', () => {
    const r = evaluateHealth({ today: '2026-11-26', customerSince: '2025-01-01', expectedLitersPerWeek: 50, orders: orders(['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24', '2026-10-20', '2026-10-13', '2026-10-06'], 60) });
    expect(r.level).toBe('excelente');
  });
});

describe('parceiros', () => {
  const rule: PartnerRule = { percentEvent: 10, percentFixed: 5, fixedPerOrderCents: 0, eligibility: 'entregue', offsetDebt: true };
  const o = (id: string, delivered: boolean, kind: PartnerOrder['kind'] = 'evento'): PartnerOrder => ({ id, kind, totalCents: 100000, confirmed: true, delivered, fullyPaid: false, cancelled: false });
  it('Cenário 7: crédito elegível sem abatimento duplicado', () => {
    const orders = [o('p1', true), o('p2', false), o('p3', true, 'ponto_fixo')];
    const first = computeNewCredits(orders, rule, new Set());
    expect(first).toEqual([{ orderId: 'p1', cents: 10000 }, { orderId: 'p3', cents: 5000 }]);
    const second = computeNewCredits(orders, rule, new Set(first.map((c) => c.orderId)));
    expect(second).toEqual([]);
    const s = settle({ openingDebtCents: 12000, newObligationsCents: 0, paymentsCents: 0, adjustmentsCents: 0, credits: first, offsetDebt: true });
    expect(s).toEqual({ totalCreditsCents: 15000, offsetCents: 12000, closingDebtCents: 0, creditPayableCents: 3000 });
  });
});

describe('estoque', () => {
  it('FEFO prioriza validade mais próxima e ignora vencidos', () => {
    const lots = [
      { id: 'L3', quantity: 5, expiresAt: null },
      { id: 'L2', quantity: 3, expiresAt: '2026-12-20' },
      { id: 'L1', quantity: 2, expiresAt: '2026-12-05' },
      { id: 'L0', quantity: 9, expiresAt: '2026-11-01' }
    ];
    expect(allocateFEFO(lots, 6, '2026-11-26')).toEqual([{ lotId: 'L1', quantity: 2 }, { lotId: 'L2', quantity: 3 }, { lotId: 'L3', quantity: 1 }]);
    expect(() => allocateFEFO(lots, 11, '2026-11-26')).toThrow(InsufficientStockError);
  });
  it('disponível = físico − reservado; impede reserva acima do disponível', () => {
    const pos = stockPosition(10, 7);
    expect(pos.available).toBe(3);
    expect(canReserve(pos, 3)).toBe(true);
    expect(canReserve(pos, 4)).toBe(false);
  });
  it('sugere compras', () => {
    expect(suggestPurchase({ history: [{ date: 'x', quantity: 30 }], historyDays: 30, leadTimeDays: 5, coverageDays: 10, available: 10, futureReservations: 4, minimum: 2 })).toBe(11);
  });
});

describe('equipamentos', () => {
  it('impede reservas simultâneas para clientes diferentes', () => {
    const existing = [{ id: 'r1', equipmentId: 'e1', customerId: 'c1', start: '2026-12-01', end: '2026-12-03', status: 'ativa' as const }];
    expect(findReservationConflict(existing, { equipmentId: 'e1', customerId: 'c2', start: '2026-12-02', end: '2026-12-04' })?.id).toBe('r1');
    expect(findReservationConflict(existing, { equipmentId: 'e1', customerId: 'c2', start: '2026-12-03', end: '2026-12-04' })).toBeNull();
    expect(findReservationConflict(existing, { equipmentId: 'e2', customerId: 'c2', start: '2026-12-02', end: null })).toBeNull();
  });
  it('manutenção', () => {
    expect(maintenanceDue('2026-11-20', '2026-11-26')).toBe('atrasada');
    expect(maintenanceDue('2026-11-30', '2026-11-26')).toBe('proxima');
    expect(maintenanceDue(null, '2026-11-26')).toBe('sem_agenda');
  });
});

describe('automações', () => {
  it('Cenário 8: mesma automação executada duas vezes não duplica efeitos', () => {
    const cands = [{ entityType: 'boleto', entityId: 'b1', data: { dias: 1 } }, { entityType: 'boleto', entityId: 'b2', data: { dias: 5 } }];
    const conds = [{ field: 'dias', op: 'lte' as const, value: 1 }];
    const first = planEffects('r1', 'dia', '2026-11-26', cands, conds, new Set());
    expect(first).toHaveLength(1);
    const second = planEffects('r1', 'dia', '2026-11-26', cands, conds, new Set(first.map((e) => e.key)));
    expect(second).toHaveLength(0);
    expect(planEffects('r1', 'dia', '2026-11-27', cands, conds, new Set(first.map((e) => e.key)))).toHaveLength(1);
    expect(idempotencyKey('r', 'x', '1', 'semana', '2026-11-26')).toBe(idempotencyKey('r', 'x', '1', 'semana', '2026-11-29'));
  });
});

describe('pedidos', () => {
  it('fluxo de status', () => {
    expect(canTransitionOrder('orcamento', 'confirmado')).toBe(true);
    expect(canTransitionOrder('entregue', 'confirmado')).toBe(false);
    expect(canTransitionOrder('finalizado', 'cancelado')).toBe(false);
  });
  it('totais e parcelas sem perder centavos', () => {
    const t = orderTotals([{ quantity: 2, litersPerUnit: 50, unitPriceCents: 75000, unitCostCents: 50000, discountCents: 1000 }]);
    expect(t).toMatchObject({ subtotal: 149000, cost: 100000, liters: 100, total: 149000 });
    expect(splitInstallments(10000, 3)).toEqual([3334, 3333, 3333]);
  });
});

describe('permissões', () => {
  it('Cenário 9 (camada de UI): técnico não acessa financeiro', () => {
    expect(can('tecnico', 'financeiro')).toBe(false);
    expect(can('tecnico', 'cobranca')).toBe(false);
    expect(can('tecnico', 'tecnico', 'create')).toBe(true);
    expect(can('admin', 'admin', 'approve')).toBe(true);
    expect(can('leitura', 'clientes', 'edit')).toBe(false);
    expect(permissionRows().length).toBeGreaterThan(50);
  });
});

describe('datas', () => {
  it('formatos e períodos', () => {
    expect(formatDateBR('2026-11-26')).toBe('26/11/2026');
    expect(parseDateBR('31/02/2026')).toBeNull();
    expect(parseDateBR('26/11/2026')).toBe('2026-11-26');
    expect(periodFor('mes', '2026-11-26')).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(periodFor('semana', '2026-11-26')).toEqual({ start: '2026-11-23', end: '2026-11-29' });
    expect(previousPeriod({ start: '2026-11-01', end: '2026-11-30' })).toEqual({ start: '2026-10-02', end: '2026-10-31' });
    expect(addBusinessDays('2026-11-27', 1)).toBe('2026-11-30');
    expect(todaySP(new Date('2026-11-27T02:00:00Z'))).toBe('2026-11-26');
  });
});

import { fromSPLocalInput, toSPLocalInput } from './dates';
describe('fuso São Paulo em datas com horário', () => {
  it('converte ida e volta', () => {
    expect(fromSPLocalInput('2026-11-26T09:30')).toBe('2026-11-26T12:30:00.000Z');
    expect(toSPLocalInput('2026-11-26T12:30:00.000Z')).toBe('2026-11-26T09:30');
  });
});

import { describe, expect, it } from 'vitest';
import {
  extractFestaFromLines, festaDueBalanceDate, festaFinancialStatus, festaMissingFields, festaTotals, itemTotalCents, linesFromItems,
  moneyToCents, parseFestaPdf, planningGroups, reminderDays, scheduleError, type PlanningRow
} from './festas';
import type { PdfTextItem } from './boleto';

describe('festas — totais', () => {
  it('item = quantidade × unitário − desconto + acréscimo, sem valor negativo', () => {
    expect(itemTotalCents({ quantity: 2, unitPriceCents: 40000 })).toBe(80000);
    expect(itemTotalCents({ quantity: 2.5, unitPriceCents: 40000, discountCents: 1000, surchargeCents: 500 })).toBe(99500);
    expect(itemTotalCents({ quantity: 1, unitPriceCents: 1000, discountCents: 5000 })).toBe(0);
  });

  it('total da festa = itens − desconto geral + acréscimo geral', () => {
    const t = festaTotals([80000, 15000], 1000, 500);
    expect(t.itemsCents).toBe(95000);
    expect(t.totalCents).toBe(94500);
  });
});

describe('festas — situação financeira (espelho da view)', () => {
  const base = { cancelled: false, totalCents: 94500, receivedCents: 0, dueBalanceDate: '2099-12-10', today: '2099-12-01' };
  it('pendente antes do vencimento e sem recebimentos', () => {
    expect(festaFinancialStatus(base)).toBe('pendente');
  });
  it('parcialmente pago quando há recebimento confirmado e saldo', () => {
    expect(festaFinancialStatus({ ...base, receivedCents: 20000 })).toBe('parcialmente_pago');
  });
  it('pago quando o recebido cobre o total', () => {
    expect(festaFinancialStatus({ ...base, receivedCents: 94500 })).toBe('pago');
  });
  it('vencido quando o saldo passou do vencimento', () => {
    expect(festaFinancialStatus({ ...base, today: '2100-01-01', receivedCents: 20000 })).toBe('vencido');
  });
  it('cancelado tem prioridade', () => {
    expect(festaFinancialStatus({ ...base, cancelled: true, receivedCents: 94500 })).toBe('cancelado');
  });
  it('vencimento do saldo é o maior vencimento previsto; sem previsão, a data da festa', () => {
    expect(festaDueBalanceDate(['2099-12-01', '2099-12-10', null], '2099-12-20')).toBe('2099-12-10');
    expect(festaDueBalanceDate([], '2099-12-20')).toBe('2099-12-20');
  });
  it('plano de pagamentos não pode exceder o total', () => {
    expect(scheduleError({ totalCents: 100, receivedCents: 40, scheduledCents: 60 })).toBeNull();
    expect(scheduleError({ totalCents: 100, receivedCents: 40, scheduledCents: 61 })).not.toBeNull();
  });
});

describe('festas — cadastro e lembretes', () => {
  it('lista os campos que faltam (alerta de cadastro incompleto)', () => {
    expect(festaMissingFields({ client_name: 'Ana', client_phone: '11999990000', event_name: 'Festa', event_date: '2099-12-10', event_time: '20:00', address: 'Rua A' })).toEqual([]);
    expect(festaMissingFields({ client_name: '', event_date: null })).toEqual(['nome do cliente', 'telefone', 'nome do evento', 'data', 'horário', 'endereço']);
  });
  it('prazos dos lembretes: valores válidos, ordenados e sem repetição; inválidos voltam ao padrão', () => {
    expect(reminderDays([3, 2, 0])).toEqual([3, 2, 0]);
    expect(reminderDays([0, 5, 3, 3, -1, 'x'])).toEqual([5, 3, 0]);
    expect(reminderDays('nada')).toEqual([3, 2, 0]);
    expect(reminderDays([])).toEqual([3, 2, 0]);
  });
});

describe('festas — planejamento de compras', () => {
  const row = (over: Partial<PlanningRow>): PlanningRow => ({
    item_id: 'i', event_id: 'e1', event_code: 'FST-00001', event_name: 'Festa A', client_name: null, event_date: '2099-12-10', event_time: null,
    product_name: 'Pilsen', unit: 'barril', keg_liters: 50, quantity: 2, purchased_qty: 0, separated_at: null, checked_at: null, purchased_at: null, ...over
  });

  it('consolida por produto e litragem, com litros, eventos e quantidade ainda necessária', () => {
    const groups = planningGroups([
      row({}),
      row({ item_id: 'j', event_id: 'e2', event_code: 'FST-00002', event_name: 'Festa B', event_date: '2099-12-12', quantity: 1, purchased_qty: 1, checked_at: '2099-12-01T10:00:00Z' }),
      row({ item_id: 'k', product_name: 'Pilsen', keg_liters: 30, quantity: 4 })
    ]);
    expect(groups).toHaveLength(2);
    const g50 = groups.find((g) => g.kegLiters === 50)!;
    expect(g50.quantity).toBe(3);
    expect(g50.liters).toBe(150);
    expect(g50.purchased).toBe(1);
    expect(g50.missing).toBe(2);
    expect(g50.events.map((e) => e.code)).toEqual(['FST-00001', 'FST-00002']);
    expect(g50.checkedCount).toBe(1);
    const g30 = groups.find((g) => g.kegLiters === 30)!;
    expect(g30.liters).toBe(120);
  });

  it('não calcula litros para itens que não são barril', () => {
    const [g] = planningGroups([row({ unit: 'unidade', keg_liters: null, product_name: 'Copo', quantity: 100 })]);
    expect(g!.liters).toBeNull();
    expect(g!.quantity).toBe(100);
  });
});

describe('festas — leitura do PDF do pedido', () => {
  const lines = [
    'Cliente: Maria Silva',
    'Telefone: (11) 98765-4321',
    'Evento: Aniversário da Ana',
    'Data do evento: 20/12/2026',
    'Horário: 20h30',
    'Endereço: Rua das Flores, 100',
    'Chopp Pilsen 50L 2 x R$ 400,00 R$ 800,00',
    'Copo descartável 100 x R$ 1,50 R$ 150,00',
    'Desconto: R$ 10,00',
    'Acréscimo: R$ 5,00',
    'Total do pedido: R$ 945,00',
    'Forma de pagamento: Pix',
    'Entrada: R$ 200,00',
    'Saldo: R$ 745,00',
    'Vencimento: 10/12/2026'
  ];

  it('preenche cliente, evento, datas, itens e pagamentos', () => {
    const r = parseFestaPdf(lines.join('\n'));
    expect(r.client_name).toBe('Maria Silva');
    expect(r.client_phone).toBe('(11) 98765-4321');
    expect(r.event_name).toBe('Aniversário da Ana');
    expect(r.event_date).toBe('2026-12-20');
    expect(r.event_time).toBe('20:30');
    expect(r.address).toBe('Rua das Flores, 100');
    expect(r.total).toBe('945.00');
    expect(r.discount_amount).toBe('10.00');
    expect(r.surcharge_amount).toBe('5.00');
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toEqual({ product_name: 'Chopp Pilsen 50L', unit: 'barril', keg_liters: '50', quantity: '2', unit_price: '400', line_total: '800' });
    expect(r.items[1]!.unit).toBe('unidade');
    expect(r.payments).toEqual([
      { kind: 'entrada', amount: '200.00', due_date: '', method: 'pix' },
      { kind: 'saldo', amount: '745.00', due_date: '2026-12-10', method: 'pix' }
    ]);
    expect(r.warnings).toEqual([]);
  });

  it('campos não encontrados ficam em branco e geram aviso (nada é inventado)', () => {
    const r = parseFestaPdf('Texto sem dados úteis');
    expect(r.client_name).toBe('');
    expect(r.event_date).toBe('');
    expect(r.items).toEqual([]);
    expect(r.warnings.some((w) => w.includes('produtos'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('Total'))).toBe(true);
  });

  it('avisa quando quantidade × valor não bate com o total da linha', () => {
    const r = parseFestaPdf('Chopp Pilsen 50L 2 x R$ 400,00 R$ 700,00');
    expect(r.items).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes('ajustado') || w.includes('difere'))).toBe(true);
  });

  it('reconstrói as linhas pela posição dos trechos', () => {
    const it = (str: string, x: number, y: number): PdfTextItem => ({ str, x, y, w: 10, h: 10, page: 1 });
    const items = [it('Telefone:', 40, 700), it('Cliente:', 10, 700), it('Maria', 60, 701), it('(11)', 80, 680), it('Total:', 10, 600), it('R$', 60, 600), it('945,00', 80, 600)];
    expect(linesFromItems(items)).toEqual(['Cliente: Telefone: Maria', '(11)', 'Total: R$ 945,00']);
  });

  it('converte valores em reais para centavos', () => {
    expect(moneyToCents('R$ 1.234,56')).toBe(123456);
    expect(moneyToCents('945,00')).toBe(94500);
  });
});

describe('festas — orçamento real digitalizado (texto reconhecido por OCR)', () => {
  // Texto reconhecido por OCR de um orçamento JK CHOPP (nome do cliente fictício). Inclui ruídos típicos do OCR.
  const OCR_LINES = [
  'EG Telefone: 18996305019 ORC-000004',
  'Email: central.jdkchopp(Ogmail.com',
  'CNPJ: 65.824.342/0001-71 Rascunho — Parcialmente pago',
  'Emissão: 26/11/2026',
  'CLIENTE EVENTO',
  'Nome: Cliente Exemplo Data: 28/11/2026',
  'ITENS',
  'MW ITENS DE VENDA',
  'Descrição / Composição otd. V. Unit. V. Emb. Total',
  'Original 600ml',
  '4 Caixas x 24 = 96 un. 96 R$ 10,00 R$ 240,00 R$ 960,00',
  '4x R$240,00',
  'Heineken 600ml',
  '4 Caixas x 24 = 96 un. 9% R$ 12,00 R$28800 —R$1.152,00',
  '4x R$288,00',
  'MN ITENS EM CONSIGNAÇÃO',
  'Descrição / Composição otd. V. Unit. V. Emb. Total',
  'Coca cola Original 2L',
  '6 un.',
  '6x R$13,00 6 R$13,00 - R$78,00',
  'Consignação — valor estimado. Definitivo conforme consumo apurado no fechamento.',
  'Coca cola Zero 2L',
  '6 un.',
  '6x R$13,00 6 R$13,00 - R$78,00',
  'Consignação — valor estimado. Definitivo conforme consumo apurado no fechamento.',
  'Guaraná Antártica 2L',
  'un 6 R$11,00 - R$ 66,00',
  '6x R$11,00',
  'Consignação — valor estimado. Definitivo conforme consumo apurado no fechamento.',
  'Água sem Gás 500ml',
  '10 Fardos x12= 120 un 120 R$200 — R$2400 — R$240,00',
  '120 x R$ 2,00',
  'Consignação — valor estimado. Definitivo conforme consumo apurado no fechamento.',
  'Subtotal venda: R$2.112,00 ADIANTAMENTO',
  'Consignação (estimado): R$ 462,00 Percentual exigido: 70%',
  'TOTAL ESTIMADO: R$ 2.574,00 Adiantamento originalmente exigido: R$ 1.801,80',
  'Valor antecipado recebido: R$ 1.800,00',
  'Restante do adiantamento: R$ 1,80',
  'PAGAMENTOS',
  '26/11/26 Pix R$ 1.800,00',
  'Total pago: R$ 1.800,00',
  'SALDO TOTAL: R$774,00',
  'DADOS PARA NOTA FISCAL',
  'CONDIÇÕES COMERCIAIS',
  'Os itens consignados serão cobrados conforme o consumo real. O valor adiantado será abatido do fechamento final. Produtos não consumidos deverão ser devolvidos',
  'conforme as condições combinadas.',
  'JK CHOPP Cliente Exemplo',
  ];

  it('lê cliente, data, número, itens (vendas e consignação), total e pagamentos', () => {
    const r = extractFestaFromLines(OCR_LINES);
    expect(r.client_name).toBe('Cliente Exemplo');
    expect(r.event_date).toBe('2026-11-28');
    expect(r.client_phone).toBe('');
    expect(r.notes).toContain('ORC-000004');
    expect(r.total).toBe('2574.00');
    expect(r.items.map((i) => i.product_name)).toEqual(['Original 600ml', 'Heineken 600ml', 'Coca cola Original 2L', 'Coca cola Zero 2L', 'Guaraná Antártica 2L', 'Água sem Gás 500ml']);
    expect(r.items.map((i) => [i.quantity, i.unit_price, i.line_total])).toEqual([
      ['96', '10', '960'], ['96', '12', '1152'], ['6', '13', '78'], ['6', '13', '78'], ['6', '11', '66'], ['120', '2', '240']
    ]);
    expect(r.items.every((i) => i.unit === 'unidade')).toBe(true);
    expect(r.payments).toEqual([
      { kind: 'entrada', amount: '1800.00', due_date: '2026-11-26', method: 'pix' },
      { kind: 'saldo', amount: '774.00', due_date: '', method: '' }
    ]);
    expect(r.warnings.some((w) => w.includes('consignação'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('previsto'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('Soma dos itens'))).toBe(false);
    expect(r.warnings.some((w) => w.includes('Água sem Gás'))).toBe(true);
  });
});

import { boletoStatus, notaryReleasePath, BOLETO_STATUS } from './boletoStatus';

const base = { boletoStatus: 'registrado', receivableStatus: 'em_aberto', dueDate: '2026-12-10', today: '2026-12-01', protest: null };

describe('as 6 situações do boleto', () => {
  it('Em aberto: dentro do prazo (inclusive no dia do vencimento e com pagamento parcial)', () => {
    expect(boletoStatus(base)).toBe('em_aberto');
    expect(boletoStatus({ ...base, today: '2026-12-10' })).toBe('em_aberto');
    expect(boletoStatus({ ...base, receivableStatus: 'parcialmente_pago' })).toBe('em_aberto');
  });
  it('Vencido: passou do vencimento sem pagamento (protesto só programado continua vencido)', () => {
    expect(boletoStatus({ ...base, today: '2026-12-11' })).toBe('vencido');
    expect(boletoStatus({ ...base, today: '2026-12-11', protest: 'programado' })).toBe('vencido');
    expect(boletoStatus({ ...base, today: '2026-12-11', protest: 'retirado' })).toBe('vencido');
  });
  it('Protesto: no cartório e não recebido', () => {
    for (const p of ['encaminhado', 'em_cartorio', 'protestado', 'aguardando_anuencia'] as const) expect(boletoStatus({ ...base, today: '2026-12-20', protest: p })).toBe('protesto');
  });
  it('Pago/ainda em protesto: recebido (ex.: Pix) com o título no cartório', () => {
    expect(boletoStatus({ ...base, receivableStatus: 'pago', protest: 'protestado' })).toBe('pago_em_protesto');
    expect(boletoStatus({ ...base, receivableStatus: 'pago', protest: 'cancelamento_solicitado' })).toBe('pago_em_protesto');
  });
  it('Pago: recebido sem pendência no cartório (ou depois da baixa no cartório)', () => {
    expect(boletoStatus({ ...base, receivableStatus: 'pago' })).toBe('pago');
    expect(boletoStatus({ ...base, boletoStatus: 'liquidado', receivableStatus: 'pago', protest: 'protesto_cancelado' })).toBe('pago');
    expect(boletoStatus({ ...base, receivableStatus: 'pago', protest: 'retirado' })).toBe('pago');
  });
  it('Cancelado: boleto cancelado/baixado ou título cancelado', () => {
    expect(boletoStatus({ ...base, boletoStatus: 'cancelado' })).toBe('cancelado');
    expect(boletoStatus({ ...base, boletoStatus: 'baixado', today: '2026-12-20' })).toBe('cancelado');
    expect(boletoStatus({ ...base, receivableStatus: 'cancelado' })).toBe('cancelado');
  });
  it('baixa no cartório segue etapas válidas', () => {
    expect(notaryReleasePath('protestado')).toEqual(['aguardando_anuencia', 'aguardando_cancelamento', 'protesto_cancelado']);
    expect(notaryReleasePath('em_cartorio')).toEqual(['retirado']);
    expect(notaryReleasePath('protesto_cancelado')).toEqual([]);
    expect(Object.keys(BOLETO_STATUS)).toHaveLength(6);
  });
});

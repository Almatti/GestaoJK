import { parseBoleto, findBoletoInText, extractBoletoHints, dueDateFromFactor, mod10, mod11Bank, BoletoError } from './boleto';
import { addDays, diffDays } from './dates';

/** Monta um código de barras bancário válido (dados fictícios) para os testes. */
function makeBarcode(bank: string, due: string, cents: number, free: string): string {
  const factor = String(Math.abs(diffDays(due, '2022-05-29'))).padStart(4, '0');
  const body = `${bank}9${factor}${String(cents).padStart(10, '0')}${free}`;
  return `${body.slice(0, 4)}${mod11Bank(body)}${body.slice(4)}`;
}

describe('boleto (FEBRABAN)', () => {
  const ref = '2026-11-26';
  const bar = makeBarcode('341', '2026-12-10', 150000, '1090000012345678901234567');

  it('fator de vencimento cobre o reinício de 22/02/2025', () => {
    expect(addDays('2022-05-29', 1000)).toBe('2025-02-22');
    expect(dueDateFromFactor(1000, '2000-07-01')).toBe('2000-07-03');
    expect(dueDateFromFactor(1000, '2025-03-01')).toBe('2025-02-22');
    expect(dueDateFromFactor(0, ref)).toBeNull();
  });

  it('lê valor, vencimento e banco pelo código de barras', () => {
    const b = parseBoleto(bar, ref);
    expect(b.kind).toBe('bancario');
    expect(b.bankCode).toBe('341');
    expect(b.bankName).toBe('Itaú');
    expect(b.amount).toBe(1500);
    expect(b.dueDate).toBe('2026-12-10');
    expect(b.freeField).toBe('1090000012345678901234567');
  });

  it('linha digitável ↔ código de barras (ida e volta), com ou sem pontuação', () => {
    const line = parseBoleto(bar, ref).digitableLine;
    expect(line).toMatch(/^\d{5}\.\d{5} \d{5}\.\d{6} \d{5}\.\d{6} \d \d{14}$/);
    const back = parseBoleto(line, ref);
    expect(back.barcode).toBe(bar);
    expect(parseBoleto(line.replace(/\D/g, ''), ref).amount).toBe(1500);
  });

  it('recusa linha com dígito errado, com mensagem clara', () => {
    const line = parseBoleto(bar, ref).digitableLine.replace(/\D/g, '');
    const wrong = line.slice(0, 2) + ((Number(line[2]) + 1) % 10) + line.slice(3);
    expect(() => parseBoleto(wrong, ref)).toThrow(BoletoError);
    expect(() => parseBoleto('123', ref)).toThrow(/47 ou 48 números/);
  });

  it('boleto sem valor no código', () => {
    expect(parseBoleto(makeBarcode('001', '2026-12-10', 0, '0000000000000000000000017'), ref).amount).toBeNull();
  });

  it('arrecadação/convênio (48 dígitos)', () => {
    const body = '826' + '00000012345' + '00012026121000000000000000000';
    expect(body).toHaveLength(43);
    const bar44 = body.slice(0, 3) + mod10(body) + body.slice(3);
    const b = parseBoleto(bar44, ref);
    expect(b.kind).toBe('arrecadacao');
    expect(b.amount).toBe(123.45);
    const line = b.digitableLine;
    expect(parseBoleto(line, ref).barcode).toBe(b.barcode);
  });

  it('encontra a linha digitável no texto do PDF e extrai pistas', () => {
    const line = parseBoleto(bar, ref).digitableLine;
    const text = `Beneficiário JK CHOPP LTDA 11.222.333/0001-81 Pagador BAR DO ZÉ 11.444.777/0001-61
      Nosso Número 109/00001234-5  Número do Documento NF1234  ${line}  Vencimento 10/12/2026`;
    expect(findBoletoInText(text, ref)?.amount).toBe(1500);
    const h = extractBoletoHints(text);
    expect(h.documents).toEqual(['11222333000181', '11444777000161']);
    expect(h.ourNumber).toBe('109/00001234-5');
    expect(h.documentNumber).toBe('NF1234');
    expect(findBoletoInText('sem código nenhum', ref)).toBeNull();
  });
});

describe('carteira e nosso número pelo código de barras', () => {
  const ref = '2026-11-26';
  const mk = (bank: string, free: string) => { const body = `${bank}9${'1656'}${'0000010000'}${free}`; return `${body.slice(0, 4)}${mod11Bank(body)}${body.slice(4)}`; };
  it('Sicoob: carteira 1 e nosso número com DV', () => {
    const b = parseBoleto(mk('756', '1' + '1234' + '01' + '7654321' + '00000078' + '001'), ref);
    expect(b.wallet).toBe('1');
    expect(b.ourNumber).toBe('0000007-8');
  });
  it('Itaú, Bradesco, Banco do Brasil, Santander, Caixa e Sicredi', () => {
    expect(parseBoleto(mk('341', '109' + '12345678' + '9' + '0001' + '12345' + '6' + '000'), ref)).toMatchObject({ wallet: '109', ourNumber: '109/12345678-9' });
    expect(parseBoleto(mk('237', '1234' + '09' + '12345678901' + '1234567' + '0'), ref)).toMatchObject({ wallet: '09', ourNumber: '12345678901' });
    expect(parseBoleto(mk('001', '000000' + '12345671234567890' + '17'), ref)).toMatchObject({ wallet: '17', ourNumber: '12345671234567890' });
    expect(parseBoleto(mk('033', '9' + '1234567' + '1234567890123' + '0' + '101'), ref)).toMatchObject({ wallet: '101', ourNumber: '1234567890123' });
    expect(parseBoleto(mk('104', '123456' + '7' + '000' + '1' + '000' + '4' + '000000123' + '5'), ref)).toMatchObject({ wallet: 'RG', ourNumber: '14000000000000123' });
    expect(parseBoleto(mk('748', '3' + '1' + '262012345' + '0700' + '01' + '12345' + '1' + '0' + '5'), ref)).toMatchObject({ wallet: '1', ourNumber: '26/201234-5' });
  });
  it('banco sem layout conhecido não inventa valores', () => {
    expect(parseBoleto(mk('077', '0'.repeat(25)), ref)).toMatchObject({ wallet: null, ourNumber: null });
  });
  it('carteira no texto do PDF', () => {
    expect(extractBoletoHints('Carteira 109 Espécie R$').wallet).toBe('109');
  });
});

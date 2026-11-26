import { centsToDecimal, formatBRL, mulCents, toCents } from './money';
describe('money', () => {
  it('converte sem erro de ponto flutuante', () => {
    expect(toCents(1.005)).toBe(101);
    expect(toCents('1.005')).toBe(101);
    expect(toCents('1.234,56')).toBe(123456);
    expect(toCents('0.1')).toBe(10);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(centsToDecimal(-1234)).toBe('-12.34');
    expect(mulCents(1999, 30)).toBe(59970);
  });
  it('formata BRL', () => expect(formatBRL(642800).replace(/\s/g, ' ')).toBe('R$ 6.428,00'));
});

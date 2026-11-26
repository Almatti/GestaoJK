import { cnpjCheckDigits, formatCnpj, formatCpf, isAlphanumericCnpj, isValidCep, isValidCnpj, isValidCpf, isValidEmail, isValidPhoneBR, toE164BR, initialVerificationStatus } from './documents';

describe('CPF', () => {
  it('aceita CPF com dígitos verificadores corretos', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
  });
  it('rejeita DV incorreto, tamanho errado e sequências repetidas', () => {
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('1234567890')).toBe(false);
    for (let d = 0; d <= 9; d++) expect(isValidCpf(String(d).repeat(11))).toBe(false);
  });
  it('formata', () => expect(formatCpf('52998224725')).toBe('529.982.247-25'));
});

describe('CNPJ numérico e alfanumérico', () => {
  it('valida CNPJ numérico tradicional', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });
  it('calcula DV do exemplo oficial alfanumérico 12.ABC.345/01DE-35', () => {
    expect(cnpjCheckDigits('12ABC34501DE')).toBe('35');
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpj('12abc34501de35')).toBe(true);
    expect(isValidCnpj('12.ABC.345/01DE-36')).toBe(false);
    expect(isAlphanumericCnpj('12ABC34501DE35')).toBe(true);
  });
  it('rejeita letras nos dígitos verificadores', () => {
    expect(isValidCnpj('12ABC34501DE3A')).toBe(false);
  });
  it('formata ambos', () => {
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatCnpj('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
  });
  it('status inicial reflete apenas o formato, nunca verificação oficial', () => {
    expect(initialVerificationStatus('11222333000181')).toBe('formato_valido');
    expect(initialVerificationStatus('11222333000182')).toBe('nao_verificado');
    expect(initialVerificationStatus(null)).toBe('nao_verificado');
  });
});

describe('contatos', () => {
  it('telefone BR', () => {
    expect(isValidPhoneBR('(11) 98765-4321')).toBe(true);
    expect(isValidPhoneBR('1132654321')).toBe(true);
    expect(isValidPhoneBR('(11) 88765-4321')).toBe(false);
    expect(isValidPhoneBR('123')).toBe(false);
    expect(toE164BR('+55 (11) 98765-4321')).toBe('5511987654321');
  });
  it('email e CEP', () => {
    expect(isValidEmail('financeiro@empresa.com.br')).toBe(true);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidCep('01310-100')).toBe(true);
    expect(isValidCep('0131010')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { parseAddress, parseOrderPdfLines } from './orderImport';

describe('pedido em PDF (ordem de serviço JK CHOPP)', () => {
  // Linhas extraídas do PDF (dados do cliente fictícios).
  const ORDER_LINES = [
  'V I A D O C L I E N T E',
  'ORDEM DE SERVI Ç O, COMODATO E',
  'JK CHOPP FORNECIMENTO',
  'CNPJ: 65824342000171 · Tel: 18996305019 PED-202611-00488',
  'central.jkchopp@gmail.com · R. Vasco da Gama, 426, Esplanada - Ara ç atuba, SP Pedido: 28/11/2026 · Emitida: 28/11/2026',
  'Con fi rmado',
  'DADOS DO CLIENTE',
  'NOME / RAZ Ã O SOCIAL',
  'Cliente Exemplo Ltda',
  'CNPJ TELEFONE',
  '11.222.333/0001-81 1830000000',
  'E-MAIL',
  'cliente@exemplo.com',
  'ENDERE Ç O CADASTRAL',
  'Rua Exemplo, 100 · Centro · Cidade/SP · CEP 00000000',
  'ENDERE Ç O DE ENTREGA',
  'Rua Exemplo, 100 — Cidade/SP',
  'INFORMA ÇÕ ES OPERACIONAIS',
  'DATA DO PEDIDO ENTREGA PREVISTA RECOLHA PREVISTA',
  '28/11/2026 28/11/2026 12:21 N ã o se aplica',
  'ENDERE Ç O DE ENTREGA',
  'Rua Exemplo, 100 — Cidade/SP',
  'CONTATO NO LOCAL',
  '18900000000',
  'PRODUTOS VENDIDOS',
  'PRODUTO / DESCRI ÇÃ O QTD / UNIDADE VLR. UNIT Á RIO VALOR TOTAL',
  'JK GOLD 1 barril(is) · 30L R$ 300,00 R$ 300,00',
  'Pilsen · 30L/barril · GOLD',
  'Subtotal dos produtos vendidos R$ 300,00',
  'RESUMO FINANCEIRO',
  'SUBTOTAL PRODUTOS FORMA DE PAGAMENTO STATUS FINANCEIRO',
  'R$ 300,00 Boleto AGUARDANDO PAGAMENTO',
  'TOTAL A PAGAR',
  'R$ 300,00',
  'SALDO PENDENTE',
  'R$ 300,00',
  'OBSERVA ÇÕ ES DE ENTREGA',
  'Os boletos possuem prazo de vencimento de 5 dias corridos a partir da data de emiss ã o. Em caso de atraso, a multa e os juros ser ã o aplicados a partir do',
  'primeiro dia ap ó s o vencimento. Ap ó s 3 dias corridos do vencimento, os boletos em aberto ser ã o enviados automaticamente para protesto em cart ó rio. C Ó D.',
  'BOLETO 72',
  'TERMO DE RESPONSABILIDADE E PAGAMENTO',
  'A presente Ordem formaliza o fornecimento dos produtos e servi ç os descritos, obrigando o CLIENTE ao pagamento dos valores e condi ç õ es acordadas.',
  'O CLIENTE declara receber os produtos conforme descritos e que a confer ê ncia foi realizada no ato da entrega. Qualquer diverg ê ncia dever á ser comunicada imediatamente ao entregador respons á vel.',
  'PAGAMENTO',
  'O pagamento dos produtos e servi ç os segue a condi çã o registrada no pedido. Na aus ê ncia de condi çã o espec í fi ca, o prazo ser á de 7 (sete) dias corridos a partir da entrega. Em casos de boleto,',
  'toler â ncia de 3 (tr ê s) dias corridos ap ó s o vencimento.',
  'Ao assinar, o CLIENTE declara estar ciente e de acordo com os produtos recebidos, valores, prazos e condi ç õ es aqui estabelecidas.',
  'Obs.: Chave Pix: (18) 99630-5019 BRUNA MATEUS DA SILVA DE ALMEIDA',
  'Assinatura do Cliente / Respons á vel Assinatura do Entregador / Representante JK CHOPP',
  'Nome: ______________________ Nome: ______________________',
  'CPF: ______________________',
  'Entrega: ____ / ____ / ________ à s ____:____',
  ];

  it('lê número, datas, cliente, entrega, produto, pagamento e totais', () => {
    const r = parseOrderPdfLines(ORDER_LINES);
    expect(r.orderNumber).toBe('PED-202611-00488');
    expect(r.orderDate).toBe('2026-11-28');
    expect(r.statusText).toBe('Confirmado');
    expect(r.boletoCode).toBe('72');
    expect(r.client.name).toBe('Cliente Exemplo Ltda');
    expect(r.client.document).toBe('11222333000181');
    expect(r.client.phone).toBe('1830000000');
    expect(r.client.email).toBe('cliente@exemplo.com');
    expect(r.delivery.date).toBe('2026-11-28');
    expect(r.delivery.time).toBe('12:21');
    expect(r.delivery.contact).toBe('18900000000');
    expect(r.items).toEqual([{ product: 'JK GOLD', composition: 'Pilsen · 30L/barril · GOLD', unit: 'barril', kegLiters: 30, quantity: 1, unitPrice: 300, total: 300 }]);
    expect(r.payment).toEqual({ method: 'Boleto', statusText: 'AGUARDANDO PAGAMENTO', total: 300, balance: 300 });
    expect(r.warnings).toEqual([]);
  });
});

describe('endereço do pedido', () => {
  it('separa rua, número, bairro, cidade/UF e CEP', () => {
    expect(parseAddress('Rua Exemplo, 100 · Centro · Cidade/SP · CEP 00000-000')).toEqual({ street: 'Rua Exemplo', number: '100', district: 'Centro', city: 'Cidade', state: 'SP', cep: '00000000' });
  });
  it('endereço sem formato padrão vai inteiro para a rua', () => {
    expect(parseAddress('Fazenda do Sítio km 3').street).toBe('Fazenda do Sítio km 3');
  });
});

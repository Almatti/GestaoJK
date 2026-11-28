-- Cobrança: a régua de cobrança não envia agradecimento/confirmação de pagamento.
-- 1) Desativa a regra "pagamento recebido" (confirmação de pagamento não faz parte da cobrança).
update public.automation_rules set active = false where trigger = 'pagamento_recebido';
-- 2) Modelo de regularização cartorária com texto de cobrança (sem "recebemos o pagamento").
update public.message_templates
   set body = 'Olá, [NOME_CLIENTE]. O título de [VALOR_ATUALIZADO], vencido em [DATA_VENCIMENTO], está em cartório. Para regularizar, entre em contato conosco para receber a carta de anuência e providenciar o pagamento e a baixa no cartório. — [NOME_EMPRESA]'
 where key = 'regularizacao_cartoraria';

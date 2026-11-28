-- Importação de pedido em PDF: orçamento, sem duplicidade, boleto existente vira o título (sem cobrança duplicada).
\set QUIET on
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

insert into products (name, sku, cost_per_unit, price_per_unit) values ('JK GOLD (teste import)', 'JKG-T30', 0, 300);
insert into keg_sizes (liters, label) values (30, '30 L') on conflict (liters) do nothing;
insert into customers (person_type, name, document, status) values ('PJ', 'Cliente Teste Importação', '55666777000181', 'ativo');
insert into customers (person_type, name, document, status) values ('PJ', 'Outro Cliente Importação', '88999000000198', 'ativo');

create temp table ctx as select
  (select id from products where sku = 'JKG-T30') as product,
  (select id from keg_sizes where liters = 30) as keg,
  (select id from customers where document = '55666777000181') as cust,
  (select id from customers where document = '88999000000198') as cust2;

-- Boleto nº 72 já gerado para o cliente (R$ 300)
create temp table bol as select create_boleto((select cust from ctx), null,
  '{"document_number":"72","issue_date":"2099-11-28","due_date":"2099-12-05","original_amount":"300"}'::jsonb, 'Boleto 72 (teste)') r;
create temp table bol2 as select create_boleto((select cust2 from ctx), null,
  '{"document_number":"73","issue_date":"2099-11-28","due_date":"2099-12-05","original_amount":"300"}'::jsonb, 'Boleto 73 (teste)') r;
select t_assert((select (r->>'receivable_created')::boolean from bol), 'boleto de teste criado com título');

-- 1) importação simples: orçamento com item e preço do PDF
create temp table imp1 as select import_order_pdf(jsonb_build_object(
  'customer_id', (select cust from ctx), 'external_ref', 'PED-TESTE-0001', 'order_date', '2099-11-28',
  'delivery_date', '2099-11-28', 'delivery_time', '12:21', 'delivery_address', 'Rua teste, 1',
  'payment_method', 'boleto', 'notes', 'Importado (teste)',
  'items', jsonb_build_array(jsonb_build_object('product_id', (select product from ctx), 'keg_size_id', (select keg from ctx),
            'quantity', 1, 'liters_per_unit', 30, 'unit_price', 300)))) r;
select t_assert((select (r->>'total')::numeric = 300 and r->>'status' = 'orcamento' from imp1), 'importa como orçamento com total do PDF');
select t_assert((select o.external_ref = 'PED-TESTE-0001' and o.delivery_time = time '12:21' and o.payment_method = 'boleto' from orders o where o.id = (select (r->>'order_id')::uuid from imp1)), 'guarda número do PDF, entrega e forma de pagamento');

-- 2) não importa o mesmo pedido de novo
select t_expect_error($$select import_order_pdf(jsonb_build_object('customer_id', (select cust from ctx), 'external_ref', 'PED-TESTE-0001', 'items', jsonb_build_array(jsonb_build_object('product_id', (select product from ctx), 'quantity', 1, 'unit_price', 300))))$$, 'impede importar o mesmo número de pedido duas vezes');

-- 3) boleto existente vira o título do pedido; confirmar não cria outro título
create temp table imp2 as select import_order_pdf(jsonb_build_object(
  'customer_id', (select cust from ctx), 'external_ref', 'PED-TESTE-0002', 'payment_method', 'boleto',
  'boleto_id', (select (r->>'boleto_id')::uuid from bol),
  'items', jsonb_build_array(jsonb_build_object('product_id', (select product from ctx), 'keg_size_id', (select keg from ctx),
            'quantity', 1, 'liters_per_unit', 30, 'unit_price', 300)))) r;
select t_assert((select (r->>'boleto_linked')::boolean from imp2), 'boleto vinculado ao pedido');
select t_assert((select count(*) = 1 from receivables where order_id = (select (r->>'order_id')::uuid from imp2) and status <> 'cancelado'), 'pedido com um único título (o do boleto)');
select confirm_order((select (r->>'order_id')::uuid from imp2));
select t_assert((select count(*) = 1 from receivables where order_id = (select (r->>'order_id')::uuid from imp2) and status <> 'cancelado'), 'confirmar não gera título duplicado com o boleto');
select t_assert((select status = 'confirmado' from orders where id = (select (r->>'order_id')::uuid from imp2)), 'pedido confirmado pelo fluxo normal');

-- 4) regras do vínculo
select t_expect_error($$select import_order_pdf(jsonb_build_object('customer_id', (select cust2 from ctx), 'external_ref', 'PED-TESTE-0003', 'boleto_id', (select (r->>'boleto_id')::uuid from bol), 'items', jsonb_build_array(jsonb_build_object('product_id', (select product from ctx), 'quantity', 1, 'unit_price', 300))))$$, 'boleto de outro cliente não é aceito');
select t_expect_error($$select import_order_pdf(jsonb_build_object('customer_id', (select cust from ctx), 'external_ref', 'PED-TESTE-0004', 'boleto_id', (select (r->>'boleto_id')::uuid from bol2), 'items', jsonb_build_array(jsonb_build_object('product_id', (select product from ctx), 'quantity', 2, 'unit_price', 300))))$$, 'valor do boleto precisa conferir com o total do pedido');
select t_expect_error($$select import_order_pdf(jsonb_build_object('customer_id', (select cust from ctx), 'external_ref', 'PED-TESTE-0005', 'items', '[]'::jsonb))$$, 'pedido sem produtos não é importado');

-- 5) sem permissão de pedidos: não importa (técnico)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select t_expect_error($$select import_order_pdf(jsonb_build_object('customer_id', (select cust from ctx), 'external_ref', 'PED-TESTE-0006', 'items', jsonb_build_array(jsonb_build_object('product_id', (select product from ctx), 'quantity', 1, 'unit_price', 300))))$$, 'usuário sem permissão de pedidos não importa');

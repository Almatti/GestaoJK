-- Importação do backup do modo local (fixture gerada pelo próprio modo local, dados fictícios).
\set QUIET on
\set backup `cat supabase/tests/fixtures/local_backup.json`
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select t_expect_error($$select import_local_backup('{}'::jsonb)$$, 'importação restrita a administradores');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
create temp table imp1 as select import_local_backup(:'backup'::jsonb) r;
select t_assert((select (r->>'imported_rows')::int > 0 from imp1), 'importação inseriu registros');
select t_assert(exists (select 1 from customers where name = 'Bar Teste Importação'), 'cliente importado');
select t_assert((select o.status = 'confirmado' and o.total = 2000 and o.total_cost = 1000 and o.number is not null from orders o join customers c on c.id = o.customer_id where c.name = 'Bar Teste Importação'),
  'pedido importado com status e totais preservados (número em uso recebe o próximo)');
select t_assert((select r.paid_amount = 500 and r.status = 'parcialmente_pago' and r.amount = 2000 from receivables r join customers c on c.id = r.customer_id where c.name = 'Bar Teste Importação'),
  'recebível parcialmente pago preservado (faturamento ≠ recebimento)');
select t_assert((select count(*) = 1 from payments p join customers c on c.id = p.customer_id where c.name = 'Bar Teste Importação'), 'pagamento importado');
select t_assert((select count(*) = 1 from order_items oi join products p on p.id = oi.product_id where p.sku = 'IMP-1' and oi.total = 2000), 'item com snapshot de preço preservado');
select t_assert((select t.parent_id is not null from tasks t where t.title = 'Subtarefa'), 'autorreferência (subtarefa) reconstituída');
select t_assert((select count(*) = 1 from financial_categories where name = 'Venda de chopp' and direction = 'receita'), 'categoria existente reaproveitada (sem duplicar)');
select t_assert((select count(*) = 1 from collection_rules where customer_id is null), 'regra global não duplicada');
select t_assert((select fine_percent = 2 and interest_percent = 1 from collection_rules where customer_id is null), 'regra global recebe valores do modo local');
select t_assert((select o.seller_id is null or o.seller_id = '00000000-0000-0000-0000-00000000000a' from orders o join customers c on c.id = o.customer_id where c.name = 'Bar Teste Importação'), 'usuário local vinculado ao administrador');
-- Triggers reativados após a importação
select t_expect_error($$insert into order_items (order_id, product_id, quantity, liters_per_unit, unit_price) select o.id, p.id, 1, 50, 10 from orders o join customers c on c.id = o.customer_id, products p where c.name = 'Bar Teste Importação' and p.sku = 'IMP-1'$$,
  'regras de negócio reativadas após importar (itens de pedido confirmado bloqueados)');
-- Idempotência
create temp table imp2 as select import_local_backup(:'backup'::jsonb) r;
select t_assert((select (r->>'imported_rows')::int = 0 from imp2), 'reimportar não duplica nada');
select t_assert((select count(*) = 1 from customers where name = 'Bar Teste Importação'), 'cliente continua único');
-- Numeração continua após o maior número importado
select t_assert(pg_sequence_last_value(pg_get_serial_sequence('public.orders','number')::regclass) >= (select max(number) from orders), 'numeração de pedidos continua após o maior número importado');
-- Mesmo CNPJ já cadastrado no servidor: reaproveita o cliente existente e religa os registros dependentes.
select import_local_backup('{"customers":[{"id":"9a000000-0000-4000-8000-000000000001","person_type":"PJ","name":"Duplicado","document":"11222333000181"}],
  "customer_interactions":[{"id":"9a000000-0000-4000-8000-000000000002","customer_id":"9a000000-0000-4000-8000-000000000001","kind":"sistema","summary":"Interação importada"}]}'::jsonb);
select t_assert(not exists (select 1 from customers where name = 'Duplicado'), 'cliente com CNPJ existente não é duplicado');
select t_assert((select c.document = '11222333000181' from customer_interactions i join customers c on c.id = i.customer_id where i.summary = 'Interação importada'),
  'registro dependente religado ao cliente existente');
reset role;
-- Endurecimento: funções internas não são chamáveis pela API
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select t_expect_error($$select consume_stock_fefo(gen_random_uuid(), 1, 'x', gen_random_uuid(), 'x')$$, 'consume_stock_fefo bloqueada para chamada direta');
select t_expect_error($$select recalc_order_totals(gen_random_uuid())$$, 'recalc_order_totals bloqueada para chamada direta');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select t_assert((select count(*) = 0 from receivable_charges((select id from receivables limit 1))), 'técnico não obtém encargos de títulos (RLS na função)');
reset role;

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
-- Campos em branco usam o padrão do banco (parceiro sem percentuais; reunião sem participantes nem parceiro)
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into partners (name, percent_event, percent_fixed, fixed_per_order, opening_debt, offset_debt) values ('Parceiro em branco', null, null, null, null, null);
select t_assert((select percent_event = 0 and percent_fixed = 0 and fixed_per_order = 0 and opening_debt = 0 and offset_debt from partners where name = 'Parceiro em branco'), 'parceiro com campos em branco salva com padrões');
update partners set percent_event = null where name = 'Parceiro em branco';
select t_assert((select percent_event = 0 from partners where name = 'Parceiro em branco'), 'apagar percentual na edição volta ao padrão');
insert into meetings (title, starts_at, participants, partner_id) values ('Reunião sem participantes', now(), null, null);
select t_assert((select participants = '{}' and partner_id is null from meetings where title = 'Reunião sem participantes'), 'reunião sem informar com quem é aceita');
select t_expect_error($$insert into partners (name) values (null)$$, 'campo obrigatório sem padrão continua exigido (nome)');
reset role;
-- Boleto: cria o título junto (cliente sem conta a receber) e vincula a título existente
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
create temp table bol1 as select create_boleto((select id from customers where name = 'Bar Teste Importação'), null,
  '{"due_date":"2026-12-10","original_amount":"1500","our_number":"BOL-T1","bank_code":"341","digitable_line":"34191.09008 00012.345673 89012.345671 1 16560000150000","document_number":"NF77"}'::jsonb) r;
select t_assert((select (r->>'receivable_created')::boolean from bol1), 'boleto sem título cria a conta a receber');
select t_assert((select rv.amount = 1500 and rv.due_date = '2026-12-10' and rv.payment_method = 'boleto' and rv.description like 'Boleto nº NF77%'
                 from receivables rv where rv.id = (select (r->>'receivable_id')::uuid from bol1)), 'título criado com valor, vencimento e forma de pagamento do boleto');
select t_assert(exists (select 1 from boletos where our_number = 'BOL-T1' and receivable_id = (select (r->>'receivable_id')::uuid from bol1)), 'boleto vinculado ao título');
select t_expect_error($$select create_boleto((select id from customers where name = 'Bar Teste Importação'), (select (r->>'receivable_id')::uuid from bol1), '{"due_date":"2026-12-10","original_amount":"1500","our_number":"BOL-T2","bank_code":"341"}'::jsonb)$$,
  'um título não recebe dois boletos ativos');
select t_expect_error($$select create_boleto(null, null, '{"due_date":"2026-12-10","original_amount":"10"}'::jsonb)$$, 'boleto exige cliente quando não há título');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select t_expect_error($$select create_boleto(null, null, '{"due_date":"2026-12-10","original_amount":"10"}'::jsonb)$$, 'técnico não cadastra boleto');
reset role;
-- Feriados e data prevista de protesto (3 dias úteis)
select t_assert((select count(*) >= 13 from holidays where extract(year from day) = 2026), 'feriados nacionais de 2026 cadastrados');
select t_assert(exists (select 1 from holidays where day = '2026-04-03') and exists (select 1 from holidays where day = '2026-02-17'), 'Sexta-feira Santa e Carnaval 2026 corretos');
update collection_rules set protest_after_days = 3, protest_day_count = 'uteis' where customer_id is null;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select t_assert(planned_protest_date((select id from customers where name = 'Bar Teste Importação'), '2026-12-01') = '2026-12-04', '3 dias úteis após 01/12/2026 = 04/12/2026');
select t_assert(planned_protest_date((select id from customers where name = 'Bar Teste Importação'), '2026-12-23') = '2026-12-29', 'pula fim de semana e Natal');
create temp table bol2 as select create_boleto((select id from customers where name = 'Bar Teste Importação'), null, '{"due_date":"2026-12-01","original_amount":"99","our_number":"BOL-T3","bank_code":"756"}'::jsonb) r;
select t_assert((select planned_protest_date = '2026-12-04' from boletos where our_number = 'BOL-T3'), 'boleto sem data de protesto recebe a data pela regra');
reset role;
-- Situação do boleto
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select t_expect_error($$select set_boleto_status((select id from boletos where our_number = 'BOL-T3'), 'cancelado', '')$$, 'cancelar exige motivo');
select set_boleto_status((select id from boletos where our_number = 'BOL-T3'), 'cancelado', 'Cliente devolveu a mercadoria', true);
select t_assert((select b.status = 'cancelado' and r.status = 'cancelado' from boletos b join receivables r on r.id = b.receivable_id where b.our_number = 'BOL-T3'), 'boleto e título cancelados com motivo');
select t_expect_error($$select set_boleto_status((select id from boletos where our_number = 'BOL-T3'), 'registrado', 'engano')$$, 'não reativa boleto de título cancelado');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select t_expect_error($$select set_boleto_status((select id from boletos where our_number = 'BOL-T1'), 'baixado', 'x')$$, 'técnico não altera situação do boleto');
reset role;

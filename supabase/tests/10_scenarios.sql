-- Testes integrados de banco: executados como usuários reais (papel authenticated + JWT simulado), com RLS ativo.
\set QUIET on
create or replace function public.t_assert(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FALHOU: %', msg; end if; raise notice 'ok - %', msg; end $$;
grant execute on function public.t_assert(boolean, text) to authenticated, anon;
create or replace function public.t_expect_error(sql text, msg text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'ok - % (erro esperado: %)', msg, left(sqlerrm, 90); return; end;
  raise exception 'FALHOU: % (era esperado um erro)', msg;
end $$;
grant execute on function public.t_expect_error(text, text) to authenticated, anon;

-- Usuários de teste (dados fictícios). O primeiro usuário vira administrador (bootstrap).
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-00000000000a', 'admin@teste.local'),
 ('00000000-0000-0000-0000-00000000000b', 'tecnico@teste.local'),
 ('00000000-0000-0000-0000-00000000000c', 'financeiro@teste.local'),
 ('00000000-0000-0000-0000-00000000000d', 'desconhecido@teste.local');
select t_assert((select role = 'admin' and active from profiles where email = 'admin@teste.local'), 'primeiro usuário é admin ativo');
select t_assert((select not active from profiles where email = 'desconhecido@teste.local'), 'cadastro sem convite fica inativo (sem cadastro público)');


-- ===================== como ADMIN =====================
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update profiles set role = 'tecnico', active = true where email = 'tecnico@teste.local';
update profiles set role = 'financeiro', active = true where email = 'financeiro@teste.local';
update company set pix_key = 'financeiro@jk.local', pix_merchant_name = 'JK CHOPP', pix_merchant_city = 'SAO PAULO';
insert into financial_accounts (name, kind, opening_balance) values ('Banco principal (teste)', 'banco', 1000);

-- Cenário 1: cliente + preço personalizado + pedido + reserva + recebível + entrega
insert into keg_sizes (liters, label) values (50, '50 L');
insert into products (name, sku, cost_per_unit, price_per_unit) values ('Chopp Pilsen (teste)', 'PIL-T', 10, 20);
insert into stock_items (name, kind, product_id, keg_size_id, min_quantity)
  select 'Barril Pilsen 50 L', 'chopp', p.id, k.id, 3 from products p, keg_sizes k where p.sku = 'PIL-T';
insert into inventory_lots (stock_item_id, lot_code, expires_at) select id, 'L1', current_date + 60 from stock_items where name = 'Barril Pilsen 50 L';
insert into inventory_movements (stock_item_id, lot_id, movement_type, quantity)
  select si.id, l.id, 'entrada', 10 from stock_items si join inventory_lots l on l.stock_item_id = si.id where si.name = 'Barril Pilsen 50 L';
select t_assert((select physical = 10 and available = 10 from stock_positions where name = 'Barril Pilsen 50 L'), 'estoque inicial 10');
select t_expect_error($$insert into inventory_movements (stock_item_id, movement_type, quantity) select id, 'saida', -11 from stock_items where name = 'Barril Pilsen 50 L'$$, 'impede estoque negativo');

select t_expect_error($$insert into customers (person_type, name, document) values ('PJ', 'X', '11222333000182')$$, 'CNPJ inválido rejeitado no servidor');
insert into customers (person_type, name, trade_name, document, segment, whatsapp, city, created_at)
  values ('PJ', 'Bar Teste Ltda', 'Bar do Teste', '11.222.333/0001-81', 'ponto_fixo', '11987654321', 'São Paulo', now() - interval '120 days');
insert into customers (person_type, name, document) values ('PJ', 'Empresa Alfanumérica', '12ABC34501DE35');
select t_assert((select verification_status = 'formato_valido' from customers where document = '11222333000181'), 'documento normalizado e marcado só como formato válido');
select t_expect_error($$insert into customers (person_type, name, document) values ('PJ', 'Duplicado', '11222333000181')$$, 'cadastro duplicado bloqueado');

select set_config('test.customer', (select id::text from customers where document = '11222333000181'), false);
insert into customer_product_prices (customer_id, product_id, price_per_liter)
  select current_setting('test.customer')::uuid, id, 18 from products where sku = 'PIL-T';
insert into commercial_conditions (customer_id, payment_term_days, expected_liters_per_week)
  values (current_setting('test.customer')::uuid, 14, 100);
select t_assert((select source = 'cliente_litro' and unit_price = 900 from resolve_price(current_setting('test.customer')::uuid,
  (select id from products where sku = 'PIL-T'), (select id from keg_sizes where liters = 50))), 'hierarquia de preço usa preço por litro do cliente');

insert into partners (name, percent_fixed, opening_debt, eligibility) values ('Parceiro Teste', 5, 50, 'entregue');
insert into orders (kind, customer_id, partner_id, delivery_date, installments, payment_method, order_date)
  values ('ponto_fixo', current_setting('test.customer')::uuid, (select id from partners where name = 'Parceiro Teste'), current_date + 1, 2, 'boleto', current_date);
select set_config('test.order', (select id::text from orders order by number desc limit 1), false);
insert into order_items (order_id, product_id, keg_size_id, quantity, liters_per_unit, unit_price, price_per_liter, price_source, unit_cost)
  select current_setting('test.order')::uuid, p.id, k.id, 2, 50, 900, 18, 'cliente_litro', 500 from products p, keg_sizes k where p.sku = 'PIL-T';
select t_assert((select total = 1800 and total_liters = 100 and total_cost = 1000 from orders where id = current_setting('test.order')::uuid), 'totais do pedido calculados no banco');
select confirm_order(current_setting('test.order')::uuid);
select t_assert((select count(*) = 2 and sum(amount) = 1800 from receivables where order_id = current_setting('test.order')::uuid), 'gerou 2 parcelas somando o total');
select t_assert((select reserved = 2 and available = 8 and physical = 10 from stock_positions where name = 'Barril Pilsen 50 L'), 'estoque reservado (físico 10, disponível 8)');
select t_assert((select count(*) = 1 from deliveries where order_id = current_setting('test.order')::uuid and kind = 'entrega'), 'entrega agendada');
select t_assert((select count(*) = 1 from tasks where ref_id = current_setting('test.order')::uuid), 'tarefa operacional gerada');
select confirm_order(current_setting('test.order')::uuid);
select t_assert((select count(*) = 2 from receivables where order_id = current_setting('test.order')::uuid), 'confirmar novamente não duplica receitas');
select t_expect_error($$update order_items set quantity = 5 where order_id = current_setting('test.order')::uuid$$, 'itens não podem mudar após confirmação');

-- Reserva acima do disponível falha
insert into orders (kind, customer_id) values ('avulso', current_setting('test.customer')::uuid);
select set_config('test.order2', (select id::text from orders order by number desc limit 1), false);
insert into order_items (order_id, product_id, keg_size_id, quantity, liters_per_unit, unit_price, unit_cost)
  select current_setting('test.order2')::uuid, p.id, k.id, 9, 50, 1500, 500 from products p, keg_sizes k where p.sku = 'PIL-T';
select t_expect_error($$select confirm_order(current_setting('test.order2')::uuid)$$, 'reserva acima do disponível é bloqueada');

-- Margem abaixo do mínimo exige justificativa
insert into orders (kind, customer_id) values ('avulso', current_setting('test.customer')::uuid);
select set_config('test.order3', (select id::text from orders order by number desc limit 1), false);
insert into order_items (order_id, product_id, keg_size_id, quantity, liters_per_unit, unit_price, unit_cost)
  select current_setting('test.order3')::uuid, p.id, k.id, 1, 50, 550, 500 from products p, keg_sizes k where p.sku = 'PIL-T';
select t_expect_error($$select confirm_order(current_setting('test.order3')::uuid)$$, 'margem abaixo de 20% sem justificativa é bloqueada');
select confirm_order(current_setting('test.order3')::uuid, '{}', 'Cliente estratégico — aprovado pela diretoria');
select t_assert((select margin_justification is not null and margin_approved_by is not null from orders where id = current_setting('test.order3')::uuid), 'exceção de margem registrada com aprovador');
select cancel_order(current_setting('test.order3')::uuid, 'Teste de cancelamento');
select t_assert((select status = 'cancelado' from receivables where order_id = current_setting('test.order3')::uuid), 'cancelamento cancela recebível em aberto');
select t_assert((select reserved = 2 from stock_positions where name = 'Barril Pilsen 50 L'), 'cancelamento libera reserva');

-- Cenário 2: boleto, lembrete, atraso, saldo atualizado, aviso de protesto
update collection_rules set fine_percent = 2, interest_percent = 1, interest_period = 'mensal', protest_after_days = 3,
       protest_day_count = 'corridos', due_date_handling = 'manter', remind_after_every_days = 3 where customer_id is null;
insert into receivables (customer_id, description, due_date, amount, collection_rule_snapshot)
  select current_setting('test.customer')::uuid, 'Título teste boleto', current_date + 1, 1000, to_jsonb(r) from effective_collection_rule(current_setting('test.customer')::uuid) r;
select set_config('test.recv', (select id::text from receivables where description = 'Título teste boleto'), false);
insert into boletos (receivable_id, our_number, bank_code, due_date, original_amount, digitable_line)
  values (current_setting('test.recv')::uuid, '123456', '001', current_date + 1, 1000, '00190.00009 01234.567891 23456.789012 1 99990000100000');
select run_automations(current_date);
select t_assert((select count(*) = 1 from message_queue where ref_id = current_setting('test.recv')::uuid and template_key = 'lembrete_vencimento'), 'lembrete 1 dia antes gerado');
select t_assert((select body like '%Bar do Teste%R$ 1.000,00%' from message_queue where ref_id = current_setting('test.recv')::uuid and template_key = 'lembrete_vencimento'), 'mensagem renderizada com variáveis');
-- Cenário 8: segunda execução no mesmo dia não duplica
select t_assert(((select run_automations(current_date))->>'effects')::int = 0, 'segunda execução no mesmo dia não gera efeitos');
select t_assert((select count(*) = 1 from message_queue where ref_id = current_setting('test.recv')::uuid and template_key = 'lembrete_vencimento'), 'mensagem não duplicada');
select run_automations(current_date + 2);
select t_assert((select count(*) = 1 from message_queue where ref_id = current_setting('test.recv')::uuid and template_key = 'boleto_vencido'), 'cobrança após vencimento gerada');
select t_assert((select status = 'programado' and planned_date = current_date + 4 from protest_records where receivable_id = current_setting('test.recv')::uuid), 'encaminhamento a protesto programado (data interna)');
select t_assert((select days_late = 15 and fine = 20 and interest = 5 and total = 1025 from receivable_charges(current_setting('test.recv')::uuid, current_date + 16)), 'multa única 2% + juros 1% a.m. pro rata');
select run_automations(current_date + 3);
select t_assert((select count(*) = 1 from message_queue where ref_id = current_setting('test.recv')::uuid and template_key = 'aviso_protesto'), 'aviso 1 dia antes do protesto');

-- ===================== como FINANCEIRO =====================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
-- Cenário 3: encaminha, protesta, recebe Pix, quita, interrompe lembretes, mantém pendência cartorária
update protest_records set status = 'encaminhado', notary_office = '1º Tabelionato (teste)' where receivable_id = current_setting('test.recv')::uuid;
update protest_records set status = 'em_cartorio', protocol_number = 'P-1' where receivable_id = current_setting('test.recv')::uuid;
update protest_records set status = 'protestado', protested_at = current_date where receivable_id = current_setting('test.recv')::uuid;
select t_expect_error($$update protest_records set status = 'nao_encaminhado' where receivable_id = current_setting('test.recv')::uuid$$, 'transição cartorária inválida bloqueada');
insert into message_queue (template_key, customer_id, body, ref_type, ref_id, dedup_key)
  values ('pagamento_atraso', current_setting('test.customer')::uuid, 'pendente', 'receivable', current_setting('test.recv')::uuid, 'teste-pendente');
select register_receipt(current_setting('test.recv')::uuid, 1025, 'pix', current_date, null, 'E2E-TESTE', true, 'Pix conferido no extrato', 'idem-1', 5, 20);
select t_assert((select status = 'pago' and paid_amount = 1000 and interest_amount = 5 and fine_amount = 20 from receivables where id = current_setting('test.recv')::uuid), 'título quitado (principal + encargos separados)');
select t_assert((select payment_method = 'pix' from receivables where id = current_setting('test.recv')::uuid), 'forma efetiva de pagamento registrada (Pix)');
select t_assert((select status = 'protestado' from protest_records where receivable_id = current_setting('test.recv')::uuid), 'situação cartorária mantida após pagamento');
select t_assert((select count(*) = 0 from message_queue where ref_id = current_setting('test.recv')::uuid and status in ('gerada','aberta')), 'lembretes financeiros pendentes cancelados');
select t_assert((select count(*) = 1 from notifications where dedup_key = 'paid_protest:' || current_setting('test.recv')), 'alerta de pendência cartorária criado');
select t_assert(((select register_receipt(current_setting('test.recv')::uuid, 1025, 'pix', current_date, null, null, true, null, 'idem-1'))->>'duplicate')::boolean, 'pagamento idempotente (mesma chave não duplica)');
select run_automations(current_date + 5);
select t_assert((select count(*) = 1 from message_queue where ref_id = current_setting('test.recv')::uuid and template_key = 'boleto_vencido'), 'nenhuma nova cobrança após quitação');
update protest_records set status = 'aguardando_anuencia', anuence_authorized = true where receivable_id = current_setting('test.recv')::uuid;
select t_assert((select count(*) = 5 from protest_status_history ph join protest_records pr on pr.id = ph.protest_id where pr.receivable_id = current_setting('test.recv')::uuid), 'histórico cartorário completo');

-- Pagamento parcial + estorno
select register_receipt((select id from receivables where order_id = current_setting('test.order')::uuid and installment_no = 1), 400, 'dinheiro');
select t_assert((select status = 'parcialmente_pago' and paid_amount = 400 from receivables where order_id = current_setting('test.order')::uuid and installment_no = 1), 'pagamento parcial');
select reverse_payment((select p.id from payments p join payment_allocations a on a.payment_id = p.id join receivables r on r.id = a.receivable_id
  where r.order_id = current_setting('test.order')::uuid), 'Lançado em duplicidade (teste)');
select t_assert((select status = 'em_aberto' and paid_amount = 0 from receivables where order_id = current_setting('test.order')::uuid and installment_no = 1), 'estorno reverte saldo');

-- Transferência interna não é receita
insert into financial_accounts (name, kind) values ('Caixa físico (teste)', 'caixa');
select transfer_between_accounts((select id from financial_accounts where name like 'Banco%'), (select id from financial_accounts where name like 'Caixa%'), 100);
select t_assert((select sum(realized_in) = 1025 from cash_flow(current_date, current_date)), 'transferência interna não conta como entrada e estorno é abatido');

-- ===================== como ADMIN =====================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
-- Cenário 4: instala equipamento em ponto fixo, movimentação e assepsia agendada
insert into equipment_types (name, sanitization_days, maintenance_days) values ('Chopeira (teste)', 15, 90);
insert into equipment (asset_code, type_id) select 'CHP-001', id from equipment_types where name = 'Chopeira (teste)';
select set_config('test.eq', (select id::text from equipment where asset_code = 'CHP-001'), false);
select move_equipment(current_setting('test.eq')::uuid, 'em_ponto_fixo', current_setting('test.customer')::uuid, null, 'Instalação');
select t_assert((select status = 'em_ponto_fixo' and customer_id = current_setting('test.customer')::uuid from equipment where id = current_setting('test.eq')::uuid), 'equipamento em ponto fixo sob custódia do cliente');
select t_assert((select count(*) = 1 from equipment_movements where equipment_id = current_setting('test.eq')::uuid), 'movimentação registrada');
select t_assert((select next_date = public.today_sp() + 15 from maintenance_schedules where equipment_id = current_setting('test.eq')::uuid and kind = 'assepsia'), 'assepsia agendada');
-- Reserva simultânea bloqueada
insert into equipment (asset_code, type_id) select 'CHP-002', id from equipment_types where name = 'Chopeira (teste)';
insert into equipment_reservations (equipment_id, customer_id, starts_at, ends_at)
  select id, current_setting('test.customer')::uuid, now() + interval '1 day', now() + interval '3 days' from equipment where asset_code = 'CHP-002';
select t_expect_error($$insert into equipment_reservations (equipment_id, customer_id, starts_at, ends_at)
  select id, (select id from customers where document = '12ABC34501DE35'), now() + interval '2 days', now() + interval '4 days' from equipment where asset_code = 'CHP-002'$$, 'mesmo equipamento não pode ser reservado simultaneamente');

-- Cenário 5: finaliza OS, consome peça, gera cobrança, atualiza histórico/agenda
insert into services (name, category, default_price) values ('Assepsia (teste)', 'assepsia', 150);
insert into stock_items (name, kind, unit_cost) values ('Kit limpeza (teste)', 'limpeza', 12);
insert into inventory_movements (stock_item_id, movement_type, quantity) select id, 'entrada', 5 from stock_items where name = 'Kit limpeza (teste)';
insert into service_orders (customer_id, equipment_id, service_id, charged_amount)
  select current_setting('test.customer')::uuid, current_setting('test.eq')::uuid, id, 150 from services where name = 'Assepsia (teste)';
select set_config('test.so', (select id::text from service_orders order by number desc limit 1), false);
insert into service_order_items (service_order_id, stock_item_id, quantity, unit_cost) select current_setting('test.so')::uuid, id, 1, 12 from stock_items where name = 'Kit limpeza (teste)';
select schedule_service_order(current_setting('test.so')::uuid, current_date, '10:00');
select finalize_service_order(current_setting('test.so')::uuid, 'Assepsia completa');
select finalize_service_order(current_setting('test.so')::uuid);
select t_assert((select physical = 4 from stock_positions where name = 'Kit limpeza (teste)'), 'peça consumida do estoque uma única vez');
select t_assert((select count(*) = 1 and sum(amount) = 150 from receivables where service_order_id = current_setting('test.so')::uuid), 'cobrança da OS gerada uma única vez');
select t_assert((select last_sanitization_at = current_date from equipment where id = current_setting('test.eq')::uuid), 'histórico patrimonial atualizado');
select t_assert((select status = 'concluido' from calendar_events where ref_type = 'service_order' and ref_id = current_setting('test.so')::uuid), 'agenda atualizada');

-- Entrega do pedido baixa o estoque (FEFO) e consome a reserva
select set_order_status(current_setting('test.order')::uuid, 'entregue');
select t_assert((select physical = 8 and reserved = 0 from stock_positions where name = 'Barril Pilsen 50 L'), 'entrega converte reserva em saída física');

-- Cenário 7: parceiro — crédito elegível e fechamento mensal sem duplicidade
select close_partner_month((select id from partners where name = 'Parceiro Teste'), date_trunc('month', current_date)::date);
select t_assert((select total_credits = 90 and offset_amount = 50 and closing_debt = 0 and credit_payable = 40 from partner_settlements), 'crédito 5% = 90, abate dívida de 50, sobra 40');
select t_expect_error($$select close_partner_month((select id from partners where name = 'Parceiro Teste'), date_trunc('month', current_date)::date)$$, 'fechamento do mesmo período não se repete');
select t_assert((select count(*) = 1 from partner_ledger where entry_type = 'credito'), 'um único crédito por pedido');

-- Cenário 6 (servidor): queda de consumo gera alerta comercial
select run_automations(current_date + 6);
select t_assert((select count(*) >= 1 from notifications where category = 'comercial' and ref_id = current_setting('test.customer')::uuid), 'alerta de baixa rotatividade gerado');

select t_assert((select (dashboard_metrics(current_date - 30, current_date) ? 'revenue_billed')), 'admin vê indicadores financeiros');

-- ===================== Cenário 9: TÉCNICO =====================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select t_assert((select count(*) = 0 from receivables), 'técnico não lê contas a receber (RLS)');
select t_assert((select count(*) = 0 from payments), 'técnico não lê pagamentos');
select t_assert((select count(*) = 0 from boletos), 'técnico não lê boletos');
select t_assert((select count(*) = 0 from financial_transactions), 'técnico não lê movimentações');
select t_assert((select count(*) = 0 from account_balances), 'técnico não lê saldos');
select t_assert((select count(*) >= 1 from service_orders), 'técnico lê ordens de serviço');
select t_assert((select not (dashboard_metrics(current_date - 30, current_date) ? 'revenue_billed')), 'dashboard sem bloco financeiro para técnico');
select t_expect_error($$select register_receipt((select id from receivables limit 1), 10, 'pix')$$, 'técnico não registra pagamento via RPC');
select t_expect_error($$select dre(current_date - 30, current_date)$$, 'técnico não acessa DRE');
select t_expect_error($$insert into receivables (customer_id, description, due_date, amount) values (current_setting('test.customer')::uuid, 'x', current_date, 1)$$, 'técnico não insere recebíveis');
select t_expect_error($$update profiles set role = 'admin' where id = auth.uid()$$, 'técnico não se promove a admin');
select t_assert((select count(*) = 0 from audit_logs), 'técnico não lê auditoria');

-- Usuário inativo não acessa nada
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
select t_assert((select count(*) = 0 from customers), 'usuário inativo não lê clientes');

-- Anônimo sem acesso
reset role;
set role anon;
select t_expect_error($$select count(*) from customers$$, 'anônimo sem acesso às tabelas');
reset role;
select t_assert((select count(*) > 0 from audit_logs where table_name = 'receivables'), 'alterações financeiras auditadas');
select t_assert((select count(*) = 0 from audit_logs where new_data ? 'document' and new_data->>'document' not like '***%'), 'documentos mascarados no log de auditoria');
select t_assert((select count(*) >= 1 from audit_logs where reason like 'Estorno:%'), 'estorno auditado com justificativa');
select t_assert((select count(*) >= 1 from audit_logs where reason like 'Exceção de margem:%'), 'exceção de margem auditada');
-- Segredos de integração inacessíveis a usuários (inclusive admin) via API
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select t_expect_error($$select * from integration_secrets$$, 'segredos de integração inacessíveis pela API (mesmo admin)');
reset role;

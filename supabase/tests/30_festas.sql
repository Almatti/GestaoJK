-- Módulo Festas: cadastro, itens, pagamentos, integração financeira, cancelamento, alertas e permissões.
-- Dados fictícios de teste. Datas futuras (2099) para não depender da data de execução.
\set QUIET on
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

-- 1) Cadastro com campos em branco e itens/pagamentos (valores como texto, como vêm da interface)
create temp table f1 as select festa_save(null,
  '{"client_name":"","client_phone":"","event_name":"Aniversário teste","event_date":"2099-12-10","event_time":"","address":"","discount_amount":"10","surcharge_amount":"5"}'::jsonb,
  '[{"product_name":"Pilsen 50 L","unit":"barril","keg_liters":50,"quantity":2,"unit_price":"400"},{"product_name":"Copo","unit":"unidade","quantity":100,"unit_price":"1.5"}]'::jsonb,
  '[{"kind":"entrada","amount":"200","due_date":"2099-12-01","method":"pix"},{"kind":"saldo","amount":"745","due_date":"2099-12-10","method":"pix"}]'::jsonb) r;
select t_assert((select (r->>'total')::numeric = 945 from f1), 'total = itens (950) − desconto (10) + acréscimo (5)');
select t_assert((select code like 'FST-%' from festa_events where id = (select (r->>'id')::uuid from f1)), 'código sequencial da festa');
select t_assert((select count(*) = 1 from receivables where festa_event_id = (select (r->>'id')::uuid from f1) and amount = 945 and customer_id is null), 'título financeiro criado sem cliente do CRM');
select t_assert((select c.name = 'Festas' from receivables r join financial_categories c on c.id = r.category_id where r.festa_event_id = (select (r->>'id')::uuid from f1)), 'título com categoria Festas (origem identificada)');
select t_assert((select financial_status = 'pendente' and outstanding = 945 from festa_events_view where id = (select (r->>'id')::uuid from f1)), 'situação inicial: pendente, saldo devedor = total');
select t_assert((select origin = 'festas' from receivables_view where festa_event_id = (select (r->>'id')::uuid from f1)), 'recebíveis mostram origem Festas');
create temp table ids as select (r->>'id')::uuid fid from f1;

-- 2) PDF duplicado é impedido
select festa_save(null, '{"event_name":"Importada","source_sha256":"abc123"}'::jsonb) from (select 1) x;
select t_expect_error($$select festa_save(null, '{"event_name":"Importada 2","source_sha256":"abc123"}'::jsonb)$$, 'impede importar o mesmo PDF duas vezes');

-- 3) Pagamentos previstos não são recebidos; confirmação exige conferência
select t_assert((select sum(amount) from festa_payments where event_id = (select fid from ids) and status = 'previsto') = 945, 'plano de pagamentos previsto (sem recebimento)');
select t_assert((select paid_amount = 0 from receivables where festa_event_id = (select fid from ids)), 'previsto não entra como recebido');
select t_expect_error($$select festa_payment_confirm((select id from festa_payments where event_id = (select fid from ids) and kind = 'entrada'), current_date, 'pix', null, null, null, false)$$, 'não confirma sem conferência no extrato');
select t_expect_error($$select festa_payment_add((select fid from ids), 'parcela', 'excesso', 1, '2099-12-20', 'pix', null)$$, 'impede plano de pagamento acima do total');

-- 4) Confirmação gera lançamento financeiro único (sem duplicar)
create temp table c1 as select festa_payment_confirm((select id from festa_payments where event_id = (select fid from ids) and kind = 'entrada'), '2099-12-01', 'pix', null, 'E2E-1', 'entrada conferida', true) r;
select t_assert((select paid_amount = 200 and status = 'parcialmente_pago' from receivables where festa_event_id = (select fid from ids)), 'confirmar entrada: recebido 200, parcialmente pago');
select t_assert((select count(*) = 1 from payments where idempotency_key like 'festa-pay:%' and amount = 200), 'um único pagamento no financeiro');
select t_assert((select count(*) = 1 from financial_transactions ft join payments p on p.id = ft.payment_id where p.amount = 200 and ft.kind = 'recebimento'), 'extrato do caixa registrado uma vez');
select t_assert((select financial_status = 'parcialmente_pago' and received = 200 from festa_events_view where id = (select fid from ids)), 'situação da festa: parcialmente pago');
select t_expect_error($$select festa_payment_confirm((select id from festa_payments where event_id = (select fid from ids) and kind = 'entrada'), current_date, 'pix', null, null, null, true)$$, 'confirmar duas vezes é bloqueado (sem duplicar)');
select t_expect_error($$insert into receivables (customer_id, description, due_date, amount) values (null, 'x', '2099-01-01', 1)$$, 'título sem cliente e sem festa não é permitido');
select t_expect_error($$select register_receipt((select id from receivables where festa_event_id = (select fid from ids)), 10, 'pix', current_date, null, null, true)$$, 'recebimento de festa só pela tela Festas');

-- 5) Correção de pagamento confirmado: estorna e registra de novo, sem duplicar
select festa_payment_correct((select id from festa_payments where event_id = (select fid from ids) and kind = 'entrada'), 180, '2099-12-01', 'dinheiro', null, 'valor digitado errado');
select t_assert((select paid_amount = 180 from receivables where festa_event_id = (select fid from ids)), 'correção: recebido passa a 180 (sem somar o valor antigo)');
select t_assert((select count(*) = 1 from payments p where p.direction = 'entrada' and p.reversed_at is null and p.amount = 180
  and exists (select 1 from payment_allocations pa where pa.payment_id = p.id and pa.receivable_id = (select id from receivables where festa_event_id = (select fid from ids)))), 'correção: apenas um lançamento ativo com o novo valor');
select t_assert((select count(*) = 1 from payments where reversed_at is not null and amount = 200), 'lançamento anterior estornado e preservado no histórico');

-- 6) Quitação: saldo previsto (745) + diferença (20) somam o total corrigido (180 + 745 + 20 = 945)
select festa_payment_confirm((select id from festa_payments where event_id = (select fid from ids) and kind = 'saldo'), '2099-12-10', 'pix', null, null, null, true);
select t_assert((select status = 'parcialmente_pago' and paid_amount = 925 from receivables where festa_event_id = (select fid from ids)), 'após o saldo: 925 recebidos, 20 ainda em aberto');
create temp table p20 as select festa_payment_add((select fid from ids), 'saldo', 'Diferença', 20, '2099-12-10', 'pix', null) pid;
select festa_payment_confirm((select pid from p20), '2099-12-10', 'pix', null, null, null, true);
select t_assert((select status = 'pago' and paid_amount = 945 from receivables where festa_event_id = (select fid from ids)), 'quitação: título pago (945 de 945)');
select t_assert((select financial_status = 'pago' and outstanding = 0 from festa_events_view where id = (select fid from ids)), 'situação da festa: pago, saldo zero');

-- 7) Não reduz o total abaixo do recebido
select t_expect_error($$select festa_save((select fid from ids), '{"client_name":"","discount_amount":"900","surcharge_amount":"0"}'::jsonb, (select jsonb_agg(jsonb_build_object('id', id, 'product_name', product_name, 'unit', unit, 'keg_liters', keg_liters, 'quantity', quantity, 'unit_price', unit_price)) from festa_items where event_id = (select fid from ids)), '[]'::jsonb)$$, 'total não pode ficar abaixo do já recebido');

-- 8) Permissões: técnico não acessa festas
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select t_expect_error($$select festa_save(null, '{"event_name":"Sem permissão"}'::jsonb)$$, 'técnico não cadastra festa (sem permissão)');
select t_assert((select count(*) = 0 from festa_events_view), 'técnico não enxerga festas (RLS)');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select t_assert((select count(*) >= 1 from festa_events_view), 'financeiro enxerga festas');
select t_assert(has_perm('festas', 'cancel'), 'financeiro pode cancelar festa (perfil com permissão)');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

-- 9) Cancelamento: bloqueado com pagamento confirmado; depois de estornar todos, cancela e libera o título
select t_expect_error($$select festa_cancel_event((select fid from ids), 'cancelamento com recebimento')$$, 'cancelar bloqueado enquanto houver pagamento confirmado');
create temp table est as select festa_payment_cancel(id, 'estorno para teste de cancelamento') r from festa_payments where event_id = (select fid from ids) and status = 'confirmado';
select t_assert((select count(*) = 3 from est), 'três pagamentos confirmados estornados (entrada corrigida, saldo e diferença)');
select t_assert((select count(*) = 0 from festa_payments where event_id = (select fid from ids) and status = 'confirmado') and (select count(*) >= 3 from festa_payments where event_id = (select fid from ids) and status = 'estornado'), 'estornos preservam o histórico (status estornado)');
select t_assert((select paid_amount = 0 from receivables where festa_event_id = (select fid from ids)), 'estorno zera o recebido do título');
create temp table fc as select festa_cancel_event((select fid from ids), 'evento desmarcado (teste)') r;
select t_assert((select ops_status = 'cancelado' from festa_events where id = (select fid from ids)), 'festa cancelada');
select t_assert((select status = 'cancelado' from receivables where festa_event_id = (select fid from ids)), 'título cancelado junto (sem excluir histórico)');
select t_assert((select financial_status = 'cancelado' from festa_events_view where id = (select fid from ids)), 'situação financeira da festa: cancelado');
select t_expect_error($$select festa_save((select fid from ids), '{"event_name":"Não deve editar"}'::jsonb)$$, 'festa cancelada não pode ser editada');
select t_expect_error($$select festa_set_ops_status((select fid from ids), 'em_preparacao')$$, 'status operacional não reabre festa cancelada');

-- 10) Status operacional em festa ativa (validação e cancelamento só por regra própria)
create temp table f2 as select festa_save(null, '{"client_name":"Cliente Alerta","client_phone":"(11) 99999-0000","event_name":"Festa alerta","event_date":"2099-12-20","event_time":"20:00","address":"Rua teste, 1"}'::jsonb,
  '[{"product_name":"Pilsen 30 L","unit":"barril","keg_liters":30,"quantity":1,"unit_price":"300"}]'::jsonb, '[]'::jsonb) r;
select festa_set_ops_status((select (r->>'id')::uuid from f2), 'em_preparacao');
select t_assert((select ops_status = 'em_preparacao' from festa_events where id = (select (r->>'id')::uuid from f2)), 'status operacional alterado');
select t_expect_error($$select festa_set_ops_status((select (r->>'id')::uuid from f2), 'cancelado')$$, 'cancelamento só pela regra própria');

-- 11) Planejamento consolida itens do período (somente festas ativas)
select t_assert((select count(*) = 1 from festa_planning('2099-12-19', '2099-12-21') where product_name = 'Pilsen 30 L' and keg_liters = 30), 'planejamento lista itens do período');
select t_assert((select count(*) = 0 from festa_planning('2099-12-01', '2099-12-11') where event_code = (select code from festa_events where id = (select fid from ids))), 'festa cancelada não entra no planejamento');

select t_assert(entity_resource('festa') = 'festas', 'anexos da festa usam a permissão de festas');

-- 12) Alertas automáticos: 3/2/0 dias, produtos não conferidos, cadastro incompleto; sem duplicar
create temp table f3 as select festa_save(null, '{"client_name":"Sem endereço","client_phone":"11999990000","event_name":"Festa incompleta","event_date":"2099-12-25"}'::jsonb,
  '[{"product_name":"Pilsen 50 L","unit":"barril","keg_liters":50,"quantity":1,"unit_price":"400"}]'::jsonb, '[]'::jsonb) r;
reset role;
create temp table al1 as select festa_generate_alerts('2099-12-17') n;
select t_assert((select n >= 2 from al1), 'alertas gerados (lembrete de 3 dias e produtos não conferidos)');
select t_assert((select count(*) = 1 from notifications where dedup_key = 'festa:' || (select (r->>'id')::uuid::text from f2) || ':lead:3'), 'lembrete 3 dias antes da festa');
select t_assert((select count(*) = 1 from notifications where dedup_key = 'festa:' || (select (r->>'id')::uuid::text from f2) || ':unchecked:' || to_char(date '2099-12-17', 'IYYY-IW')), 'produtos não conferidos avisados');
select t_assert((select count(*) = 1 from notifications where dedup_key = 'festa:' || (select (r->>'id')::uuid::text from f3) || ':incomplete' and body like '%endereço%' and body like '%horário%'), 'cadastro incompleto sinalizado com o que falta');
select t_assert((select count(*) = 0 from notifications where dedup_key = 'festa:' || (select (r->>'id')::uuid::text from f2) || ':incomplete'), 'cadastro completo não gera alerta de cadastro');
create temp table al2 as select festa_generate_alerts('2099-12-17') n;
select t_assert((select n = 0 from al2), 'repetir a execução não duplica alertas');
select t_assert((select value = '[3,2,0]'::jsonb from settings where key = 'festas.alert_days'), 'prazos dos lembretes configuráveis (padrão 3, 2 e no dia)');

-- Indicadores (calculados de dados reais), busca global e motor de automações no servidor.

create or replace view public.customer_consumption with (security_invoker = true) as
select c.id as customer_id, c.name, c.trade_name, c.segment, c.status, c.created_at::date as customer_since,
  max(o.order_date) as last_order_date,
  count(o.id) as orders_count,
  coalesce(sum(o.total_liters) filter (where o.order_date > public.today_sp() - 30), 0) as liters_30d,
  coalesce(sum(o.total_liters) filter (where o.order_date <= public.today_sp() - 30 and o.order_date > public.today_sp() - 60), 0) as liters_prev_30d,
  coalesce(sum(o.total), 0) as total_purchased,
  coalesce(sum(o.total_liters), 0) as total_liters,
  coalesce(sum(o.total) / nullif(count(o.id), 0), 0) as average_ticket,
  (select cc.expected_liters_per_week from public.commercial_conditions cc where cc.customer_id = c.id
     and public.today_sp() between cc.valid_from and coalesce(cc.valid_to, 'infinity') limit 1) as expected_liters_per_week,
  (select cc.expected_kegs_per_week from public.commercial_conditions cc where cc.customer_id = c.id
     and public.today_sp() between cc.valid_from and coalesce(cc.valid_to, 'infinity') limit 1) as expected_kegs_per_week,
  (select count(*) from public.equipment e where e.customer_id = c.id and e.status in ('em_ponto_fixo','instalado','em_evento')) as equipment_count
from public.customers c
left join public.orders o on o.customer_id = c.id and o.status not in ('orcamento','aguardando_confirmacao','cancelado')
group by c.id;

-- Dashboard: KPIs do período. Blocos financeiros só retornam para quem tem permissão financeira.
create or replace function public.dashboard_metrics(p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb := '{}'::jsonb; fin boolean := has_perm('financeiro','view') or has_perm('cobranca','view'); t date := public.today_sp();
begin
  if current_role_key() is null then raise exception 'Não autorizado' using errcode = '42501'; end if;
  res := jsonb_build_object(
    'period', jsonb_build_object('start', p_start, 'end', p_end),
    'orders_count', (select count(*) from orders where order_date between p_start and p_end and status not in ('orcamento','aguardando_confirmacao','cancelado')),
    'liters_sold', (select coalesce(sum(total_liters),0) from orders where order_date between p_start and p_end and status not in ('orcamento','aguardando_confirmacao','cancelado')),
    'kegs_sold', (select coalesce(sum(oi.quantity),0) from order_items oi join orders o on o.id = oi.order_id
                  where oi.keg_size_id is not null and o.order_date between p_start and p_end and o.status not in ('orcamento','aguardando_confirmacao','cancelado')),
    'active_customers', (select count(*) from customers where status = 'ativo'),
    'inactive_customers', (select count(*) from customer_consumption where status = 'ativo' and (last_order_date is null or last_order_date < t - 60) and customer_since < t - 30),
    'low_rotation_points', (select count(*) from customer_consumption where segment in ('ponto_fixo','ambos') and status = 'ativo'
                            and expected_liters_per_week > 0 and liters_30d < expected_liters_per_week / 7 * 30 * 0.85 and customer_since < t - 30),
    'healthy_points', (select count(*) from customer_consumption where segment in ('ponto_fixo','ambos') and status = 'ativo'
                            and expected_liters_per_week > 0 and liters_30d >= expected_liters_per_week / 7 * 30 * 0.85),
    'top_products', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select p.name, sum(oi.liters) liters, sum(oi.total) revenue from order_items oi join orders o on o.id = oi.order_id join products p on p.id = oi.product_id
        where o.order_date between p_start and p_end and o.status not in ('orcamento','aguardando_confirmacao','cancelado')
        group by p.name order by liters desc limit 5) x),
    'equipment', (select jsonb_build_object(
        'available', count(*) filter (where status = 'disponivel'),
        'external', count(*) filter (where status in ('instalado','em_ponto_fixo','em_evento','aguardando_recolhimento','em_transporte')),
        'maintenance', count(*) filter (where status in ('em_manutencao','em_higienizacao')),
        'idle', count(*) filter (where status = 'disponivel' and custody_since < now() - make_interval(days => coalesce((select (value)::text::int from settings where key='equipment.idle_days'), 15)))
      ) from equipment where status <> 'inativo'),
    'maintenance_due', (select count(*) from equipment where status <> 'inativo' and (next_maintenance_at <= t + 7 or next_sanitization_at <= t + 7)),
    'service_orders_open', (select count(*) from service_orders where status in ('aberta','agendada','em_execucao')),
    'deliveries_scheduled', (select count(*) from deliveries where status = 'programada' and scheduled_date between t and t + 7),
    'priority_tasks', (select count(*) from tasks where status in ('a_fazer','em_andamento') and priority in ('alta','urgente')),
    'overdue_tasks', (select count(*) from tasks where status in ('a_fazer','em_andamento') and due_date < t),
    'low_stock', (select count(*) from stock_positions where available <= min_quantity and min_quantity > 0),
    'daily_series', (select coalesce(jsonb_agg(x order by x.day), '[]'::jsonb) from (
        select d::date as day,
          coalesce((select sum(total_liters) from orders where order_date = d::date and status not in ('orcamento','aguardando_confirmacao','cancelado')), 0) as liters,
          case when fin then coalesce((select sum(total) from orders where order_date = d::date and status not in ('orcamento','aguardando_confirmacao','cancelado')), 0) end as revenue
        from generate_series(p_start, p_end, interval '1 day') d) x)
  );
  if fin then
    res := res || jsonb_build_object(
      'revenue_billed', (select coalesce(sum(total),0) from orders where order_date between p_start and p_end and status not in ('orcamento','aguardando_confirmacao','cancelado')),
      'cogs', (select coalesce(sum(total_cost),0) from orders where order_date between p_start and p_end and status not in ('orcamento','aguardando_confirmacao','cancelado')),
      'revenue_received', (select coalesce(sum(p.amount),0) from payments p where p.direction = 'entrada' and p.reversed_at is null and p.paid_at between p_start and p_end),
      'expenses_paid', (select coalesce(sum(p.amount),0) from payments p where p.direction = 'saida' and p.reversed_at is null and p.paid_at between p_start and p_end),
      'receivable_open', (select coalesce(sum(amount - paid_amount),0) from receivables where status in ('em_aberto','parcialmente_pago')),
      'receivable_overdue', (select coalesce(sum(amount - paid_amount),0) from receivables where status in ('em_aberto','parcialmente_pago') and due_date < t),
      'receivable_due_soon', (select coalesce(sum(amount - paid_amount),0) from receivables where status in ('em_aberto','parcialmente_pago') and due_date between t and t + 7),
      'payable_open', (select coalesce(sum(amount - paid_amount),0) from payables where status in ('em_aberto','parcialmente_pago')),
      'payable_overdue', (select coalesce(sum(amount - paid_amount),0) from payables where status in ('em_aberto','parcialmente_pago') and due_date < t),
      'in_protest', (select coalesce(sum(r.amount - r.paid_amount),0) from protest_records pr join receivables r on r.id = pr.receivable_id
                     where pr.status in ('encaminhado','em_cartorio','protestado')),
      'paid_with_cartorial_pending', (select count(*) from protest_records pr join receivables r on r.id = pr.receivable_id
                     where r.status = 'pago' and pr.status in ('encaminhado','em_cartorio','protestado','aguardando_anuencia','aguardando_cancelamento','cancelamento_solicitado')),
      'cash_balance', (select coalesce(sum(balance),0) from account_balances),
      'cash_projection_30d', (select coalesce(sum(balance),0) from account_balances)
          + (select coalesce(sum(amount - paid_amount),0) from receivables where status in ('em_aberto','parcialmente_pago') and due_date between t and t + 30)
          - (select coalesce(sum(amount - paid_amount),0) from payables where status in ('em_aberto','parcialmente_pago') and due_date between t and t + 30)
    );
  end if;
  return res;
end $$;

-- Fluxo de caixa por dia (realizado + previsto). Recebíveis NÃO entram como saldo disponível;
-- transferências internas são ignoradas e estornos abatem o lado (entrada/saída) do pagamento original.
create or replace function public.cash_flow(p_start date, p_end date) returns table (day date, realized_in numeric, realized_out numeric, expected_in numeric, expected_out numeric)
language sql stable security definer set search_path = public as $$
  select d::date,
    coalesce((select sum(t.amount) from financial_transactions t left join payments p on p.id = t.payment_id
              where t.occurred_on = d::date and (t.kind = 'recebimento' or (t.kind = 'estorno' and p.direction = 'entrada') or (t.kind = 'ajuste' and t.amount > 0))), 0),
    coalesce((select -sum(t.amount) from financial_transactions t left join payments p on p.id = t.payment_id
              where t.occurred_on = d::date and (t.kind = 'pagamento' or (t.kind = 'estorno' and p.direction = 'saida') or (t.kind = 'ajuste' and t.amount < 0))), 0),
    coalesce((select sum(amount - paid_amount) from receivables where due_date = d::date and status in ('em_aberto','parcialmente_pago')), 0),
    coalesce((select sum(amount - paid_amount) from payables where due_date = d::date and status in ('em_aberto','parcialmente_pago')), 0)
  from generate_series(p_start, p_end, interval '1 day') d
  where public.has_perm('financeiro','view')
$$;

-- DRE gerencial (competência). Não substitui demonstrações contábeis oficiais.
create or replace function public.dre(p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare gross numeric; deductions numeric; cogs numeric; services numeric; variable numeric; fixed numeric; fin_exp numeric; fin_inc numeric; tax_pct numeric;
begin
  perform require_perm('financeiro','view');
  select coalesce((value)::text::numeric, 0) into tax_pct from settings where key = 'commercial.sales_tax_percent';
  select coalesce(sum(total),0), coalesce(sum(total_cost),0) into gross, cogs from orders
   where coalesce(delivery_date, order_date) between p_start and p_end and status not in ('orcamento','aguardando_confirmacao','cancelado');
  select coalesce(sum(r.amount),0) into services from receivables r where r.service_order_id is not null and r.competence_date between p_start and p_end and r.status <> 'cancelado';
  deductions := round((gross + services) * coalesce(tax_pct,0) / 100, 2);
  select coalesce(sum(p.amount) filter (where c.dre_group = 'despesas_variaveis'),0),
         coalesce(sum(p.amount) filter (where c.dre_group = 'despesas_fixas'),0),
         coalesce(sum(p.amount) filter (where c.dre_group = 'despesas_financeiras'),0)
    into variable, fixed, fin_exp
    from payables p left join financial_categories c on c.id = p.category_id
   where p.competence_date between p_start and p_end and p.status <> 'cancelado';
  select coalesce(sum(interest_amount + fine_amount),0) into fin_inc from receivables where paid_at between p_start and p_end;
  return jsonb_build_object(
    'regime', 'competencia',
    'receita_bruta', gross + services, 'receita_produtos', gross, 'receita_servicos', services,
    'deducoes_estimadas', deductions, 'receita_liquida', gross + services - deductions,
    'cmv', cogs, 'lucro_bruto', gross + services - deductions - cogs,
    'despesas_variaveis', variable, 'margem_contribuicao', gross + services - deductions - cogs - variable,
    'despesas_fixas', fixed, 'resultado_operacional', gross + services - deductions - cogs - variable - fixed,
    'receitas_financeiras', fin_inc, 'despesas_financeiras', fin_exp,
    'resultado_gerencial', gross + services - deductions - cogs - variable - fixed + fin_inc - fin_exp,
    'aviso', 'DRE gerencial para apoio à decisão. Não substitui as demonstrações contábeis oficiais.');
end $$;

create or replace function public.kpi_value(p_metric text, p_start date, p_end date) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare m jsonb := dashboard_metrics(p_start, p_end);
begin
  return case p_metric
    when 'faturamento' then (m->>'revenue_billed')::numeric
    when 'recebimentos' then (m->>'revenue_received')::numeric
    when 'litros_vendidos' then (m->>'liters_sold')::numeric
    when 'pedidos' then (m->>'orders_count')::numeric
    when 'clientes_ativos' then (m->>'active_customers')::numeric
    when 'equipamentos_ociosos' then (m->'equipment'->>'idle')::numeric
    when 'inadimplencia_percent' then round((m->>'receivable_overdue')::numeric / nullif((m->>'receivable_open')::numeric, 0) * 100, 2)
    when 'margem_contribuicao_percent' then round(((m->>'revenue_billed')::numeric - (m->>'cogs')::numeric) / nullif((m->>'revenue_billed')::numeric, 0) * 100, 2)
    else null end;
end $$;

-- Busca global (security invoker: respeita RLS).
create or replace function public.global_search(p_query text) returns table (kind text, id uuid, title text, subtitle text, link text)
language sql stable security invoker set search_path = public, extensions as $$
  (select 'cliente', c.id, coalesce(c.trade_name, c.name), c.city, '/clientes/' || c.id from customers c
    where c.name ilike '%' || p_query || '%' or c.trade_name ilike '%' || p_query || '%' or c.document = upper(regexp_replace(p_query, '[^0-9A-Za-z]', '', 'g')) limit 8)
  union all
  (select 'pedido', o.id, 'Pedido nº ' || o.number, o.status, '/pedidos/' || o.id from orders o where o.number::text = p_query limit 3)
  union all
  (select 'equipamento', e.id, e.asset_code, coalesce(e.brand || ' ' || e.model, e.status), '/equipamentos/' || e.id from equipment e
    where e.asset_code ilike '%' || p_query || '%' or e.serial_number ilike '%' || p_query || '%' limit 5)
  union all
  (select 'produto', p.id, p.name, p.sku, '/produtos' from products p where p.name ilike '%' || p_query || '%' or p.sku ilike '%' || p_query || '%' limit 5)
  union all
  (select 'tarefa', t.id, t.title, t.status, '/tarefas' from tasks t where t.title ilike '%' || p_query || '%' limit 5)
$$;

-- ---------------------------------------------------------------------------
-- Motor de automações (idempotente). Executado por agendamento no servidor (pg_cron) ou manualmente.
-- ---------------------------------------------------------------------------
create or replace function public.automation_effect(p_rule uuid, p_window text, p_entity_type text, p_entity uuid, p_day date) returns boolean
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  k := p_rule || '|' || p_entity_type || '|' || p_entity || '|' ||
       case p_window when 'unico' then 'unico' when 'mes' then to_char(p_day, 'YYYY-MM')
                     when 'semana' then 'S' || date_trunc('week', p_day)::date else p_day::text end;
  insert into automation_executions (rule_id, idempotency_key, entity_type, entity_id) values (p_rule, k, p_entity_type, p_entity)
  on conflict (idempotency_key) do nothing;
  return found;
end $$;

create or replace function public.brl(v numeric) returns text language sql immutable as $$
  select 'R$ ' || replace(replace(replace(to_char(coalesce(v,0), 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.')
$$;

create or replace function public.render_message(p_template text, p_receivable uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare body text; r record; co company; ch record;
begin
  select mt.body into body from message_templates mt where mt.key = p_template and mt.active;
  if body is null then return null; end if;
  select * into co from company where id = 1;
  select rv.*, coalesce(c.trade_name, c.name) as cname, b.digitable_line, pr.planned_date as protest_date
    into r from receivables rv join customers c on c.id = rv.customer_id
    left join boletos b on b.receivable_id = rv.id and b.status <> 'cancelado'
    left join protest_records pr on pr.receivable_id = rv.id where rv.id = p_receivable;
  select * into ch from receivable_charges(p_receivable);
  body := replace(body, '[NOME_CLIENTE]', coalesce(r.cname, ''));
  body := replace(body, '[NOME_EMPRESA]', coalesce(co.trade_name, ''));
  body := replace(body, '[VALOR_ORIGINAL]', brl(r.amount - r.paid_amount));
  body := replace(body, '[VALOR_ATUALIZADO]', brl(coalesce(ch.total, r.amount - r.paid_amount)));
  body := replace(body, '[DATA_VENCIMENTO]', to_char(r.due_date, 'DD/MM/YYYY'));
  body := replace(body, '[DIAS_ATRASO]', coalesce(ch.days_late, 0)::text);
  body := replace(body, '[DATA_ENCAMINHAMENTO]', coalesce(to_char(r.protest_date, 'DD/MM/YYYY'), '—'));
  if co.pix_key is not null then body := replace(body, '[CHAVE_PIX]', co.pix_key); end if;
  if r.digitable_line is not null then body := replace(body, '[LINHA_DIGITAVEL]', r.digitable_line); end if;
  return body;
end $$;

create or replace function public.queue_receivable_message(p_rule automation_rules, p_tpl text, p_receivable uuid, p_customer uuid, p_phone text, p_day date)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not automation_effect(p_rule.id, p_rule.dedup_window, 'receivable', p_receivable, p_day) then return 0; end if;
  insert into message_queue (template_key, customer_id, phone, body, ref_type, ref_id, scheduled_for, dedup_key)
  values (p_tpl, p_customer, p_phone, render_message(p_tpl, p_receivable), 'receivable', p_receivable, p_day,
          p_tpl || ':receivable:' || p_receivable || ':' || case when p_rule.dedup_window = 'unico' then 'unico' else p_day::text end)
  on conflict (dedup_key) do nothing;
  return 1;
end $$;

create or replace function public.notify_once(p_rule automation_rules, p_entity_type text, p_entity uuid, p_day date,
  p_category text, p_priority text, p_title text, p_body text, p_link text, p_resource text, p_user uuid default null)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not automation_effect(p_rule.id, p_rule.dedup_window, p_entity_type, p_entity, p_day) then return 0; end if;
  insert into notifications (user_id, category, priority, title, body, link, ref_type, ref_id, target_resource, dedup_key)
  values (p_user, p_category, p_priority, p_title, p_body, p_link, p_entity_type, p_entity, p_resource,
          p_rule.id || ':' || p_entity || ':' || p_day)
  on conflict (dedup_key) do nothing;
  return 1;
end $$;

create or replace function public.run_automations(p_day date default public.today_sp()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rule automation_rules; r record; run_id uuid; n int := 0; days int; tpl text;
begin
  -- Executável pelo agendador (sem usuário) ou por usuário com permissão.
  if auth.uid() is not null and not has_perm('automacoes','edit') then raise exception 'Permissão negada' using errcode = '42501'; end if;
  -- Controle de concorrência: apenas uma execução por vez.
  if not pg_try_advisory_xact_lock(hashtext('run_automations')) then return jsonb_build_object('skipped', 'execução em andamento'); end if;
  insert into automation_runs (run_date) values (p_day) returning id into run_id;

  for rule in select * from automation_rules where active order by created_at loop
    begin
      days := coalesce((rule.action_config->>'days_before')::int, 0);
      tpl := rule.action_config->>'template';
      if rule.trigger = 'boleto_vencendo' then
        for r in select rv.id, rv.customer_id, coalesce(c.whatsapp, c.phone) phone from receivables rv join customers c on c.id = rv.customer_id
                 where rv.status in ('em_aberto','parcialmente_pago') and rv.due_date = p_day + days loop
          n := n + queue_receivable_message(rule, tpl, r.id, r.customer_id, r.phone, p_day);
        end loop;
      elsif rule.trigger = 'boleto_vencido' then
        for r in select rv.id, rv.customer_id, coalesce(c.whatsapp, c.phone) phone
                 from receivables rv join customers c on c.id = rv.customer_id
                 cross join lateral (select * from effective_collection_rule(rv.customer_id)) cr
                 where rv.status in ('em_aberto','parcialmente_pago') and rv.due_date < p_day
                   and ((p_day - rv.due_date) - 1) % greatest(cr.remind_after_every_days, 1) = 0 loop
          n := n + queue_receivable_message(rule, tpl, r.id, r.customer_id, r.phone, p_day);
        end loop;
      elsif rule.trigger = 'protesto_proximo' then
        for r in select rv.id, rv.customer_id, coalesce(c.whatsapp, c.phone) phone from protest_records pr
                 join receivables rv on rv.id = pr.receivable_id join customers c on c.id = rv.customer_id
                 where pr.status = 'programado' and pr.planned_date = p_day + days and rv.status in ('em_aberto','parcialmente_pago') loop
          if queue_receivable_message(rule, tpl, r.id, r.customer_id, r.phone, p_day) = 1 then
            n := n + 1;
            insert into notifications (category, priority, title, body, link, ref_type, ref_id, target_resource, dedup_key)
            values ('financeiro', 'alta', 'Encaminhamento a protesto programado', 'Título com encaminhamento previsto. Revise e autorize.', '/financeiro/protestos', 'receivable', r.id, 'cobranca', 'protest_soon:' || r.id || ':' || p_day)
            on conflict (dedup_key) do nothing;
          end if;
        end loop;
      elsif rule.trigger = 'pagamento_recebido' then
        for r in select rv.id, rv.customer_id, coalesce(c.whatsapp, c.phone) phone from receivables rv join customers c on c.id = rv.customer_id
                 cross join lateral (select * from effective_collection_rule(rv.customer_id)) cr
                 where rv.status = 'pago' and rv.paid_at between p_day - 1 and p_day and cr.notify_payment_confirmation loop
          n := n + queue_receivable_message(rule, tpl, r.id, r.customer_id, r.phone, p_day);
        end loop;
      elsif rule.trigger = 'estoque_minimo' then
        for r in select stock_item_id id, name, available, min_quantity from stock_positions where min_quantity > 0 and available <= min_quantity loop
          n := n + notify_once(rule, 'stock_item', r.id, p_day, 'operacional', 'alta', 'Estoque abaixo do mínimo',
                               format('%s: disponível %s (mínimo %s).', r.name, r.available, r.min_quantity), '/estoque', 'estoque');
        end loop;
      elsif rule.trigger = 'manutencao_proxima' then
        for r in select id, asset_code, least(next_maintenance_at, next_sanitization_at) d from equipment
                 where status <> 'inativo' and least(next_maintenance_at, next_sanitization_at) <= p_day + coalesce(nullif(days, 0), 7) loop
          n := n + notify_once(rule, 'equipment', r.id, p_day, 'tecnico', case when r.d < p_day then 'alta' else 'normal' end,
                               'Manutenção/assepsia próxima', format('Equipamento %s: previsto para %s.', r.asset_code, to_char(r.d, 'DD/MM/YYYY')), '/equipamentos/' || r.id, 'equipamentos');
        end loop;
      elsif rule.trigger = 'queda_consumo' then
        for r in select customer_id id, coalesce(trade_name, name) nm, liters_30d from customer_consumption
                 where status = 'ativo' and segment in ('ponto_fixo','ambos') and customer_since < p_day - 30
                   and ((expected_liters_per_week > 0 and liters_30d < expected_liters_per_week / 7 * 30 * 0.5)
                     or (liters_prev_30d > 0 and liters_30d < liters_prev_30d * 0.7)) loop
          n := n + notify_once(rule, 'customer', r.id, p_day, 'comercial', 'alta', 'Queda de consumo / baixa rotatividade',
                               format('%s consumiu %s L nos últimos 30 dias. Sugestão: contato comercial ou visita.', r.nm, r.liters_30d), '/clientes/' || r.id, 'clientes');
        end loop;
      elsif rule.trigger = 'tarefa_vencida' then
        for r in select id, title, assignee_id from tasks where status in ('a_fazer','em_andamento') and due_date < p_day loop
          n := n + notify_once(rule, 'task', r.id, p_day, 'administrativo', 'normal', 'Tarefa vencida', r.title, '/tarefas', 'organizacao', r.assignee_id);
        end loop;
      elsif rule.trigger = 'equipamento_ocioso' then
        for r in select id, asset_code from equipment where status = 'disponivel'
                 and custody_since < now() - make_interval(days => coalesce((select (value)::text::int from settings where key='equipment.idle_days'), 15)) loop
          n := n + notify_once(rule, 'equipment', r.id, p_day, 'operacional', 'baixa', 'Equipamento ocioso', format('%s está disponível e parado.', r.asset_code), '/equipamentos/' || r.id, 'equipamentos');
        end loop;
      end if;
      update automation_rules set last_run_at = now(), next_run_at = (p_day + 1)::timestamptz where id = rule.id;
    exception when others then
      insert into automation_executions (rule_id, idempotency_key, result, error)
      values (rule.id, rule.id || '|erro|' || p_day || '|' || clock_timestamp(), 'falha', sqlerrm);
    end;
  end loop;

  -- Programa encaminhamentos a protesto (data INTERNA) para boletos vencidos com regra configurada.
  insert into protest_records (receivable_id, boleto_id, status, planned_date)
  select rv.id, b.id, 'programado',
         case when cr.protest_day_count = 'uteis' then add_business_days(rv.due_date, cr.protest_after_days) else rv.due_date + cr.protest_after_days end
  from receivables rv join boletos b on b.receivable_id = rv.id and b.status = 'registrado'
  cross join lateral (select * from effective_collection_rule(rv.customer_id)) cr
  where rv.status in ('em_aberto','parcialmente_pago') and rv.due_date < p_day and cr.protest_after_days > 0
  on conflict (receivable_id) do nothing;

  update automation_runs set finished_at = now(), effects = n, status = 'concluida' where id = run_id;
  return jsonb_build_object('run_id', run_id, 'effects', n);
end $$;

-- Agendamento diário às 08:00 de São Paulo (11:00 UTC) quando pg_cron estiver disponível (Supabase).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('jk-run-automations', '0 11 * * *', 'select public.run_automations()');
    exception when others then raise notice 'pg_cron indisponível: %', sqlerrm;
    end;
  end if;
end $$;

-- Execução de funções: somente usuários autenticados (as funções verificam permissão internamente).
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;

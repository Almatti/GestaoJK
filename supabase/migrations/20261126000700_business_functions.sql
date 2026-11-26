-- Operações de negócio atômicas (RPC). Todas verificam permissão explicitamente (security definer + require_perm).

-- ---------------------------------------------------------------------------
-- Regra de cobrança vigente para um cliente
-- ---------------------------------------------------------------------------
create or replace function public.effective_collection_rule(p_customer uuid) returns public.collection_rules
language sql stable security definer set search_path = public as $$
  select * from collection_rules
  where (customer_id = p_customer or customer_id is null)
    and public.today_sp() >= valid_from and (valid_to is null or public.today_sp() <= valid_to)
  order by (customer_id is null), valid_from desc limit 1
$$;

create or replace function public.next_business_day(p date) returns date language plpgsql stable as $$
declare d date := p;
begin
  while extract(isodow from d) in (6, 7) or exists (select 1 from public.holidays h where h.day = d) loop d := d + 1; end loop;
  return d;
end $$;

create or replace function public.add_business_days(p date, n int) returns date language plpgsql stable as $$
declare d date := p; left_ int := n;
begin
  while left_ > 0 loop
    d := d + 1;
    if extract(isodow from d) not in (6, 7) and not exists (select 1 from public.holidays h where h.day = d) then left_ := left_ - 1; end if;
  end loop;
  return d;
end $$;

-- Encargos (multa única + juros simples pro rata) — espelha src/domain/collections.ts.
create or replace function public.receivable_charges(p_receivable uuid, p_ref date default public.today_sp())
returns table (days_late int, principal numeric, fine numeric, interest numeric, total numeric)
language plpgsql stable security definer set search_path = public as $$
declare r receivables; rule jsonb; eff date; late int; out_ numeric; daily numeric;
begin
  select * into r from receivables where id = p_receivable;
  if not found then return; end if;
  rule := coalesce(r.collection_rule_snapshot, to_jsonb(effective_collection_rule(r.customer_id)));
  out_ := greatest(r.amount - r.paid_amount, 0);
  eff := case when rule->>'due_date_handling' = 'proximo_dia_util' then next_business_day(r.due_date) else r.due_date end;
  late := case when p_ref <= eff then 0 else p_ref - r.due_date end;
  if late <= coalesce((rule->>'grace_days')::int, 0) or out_ = 0 then
    return query select late, out_, 0::numeric, 0::numeric, out_; return;
  end if;
  daily := coalesce((rule->>'interest_percent')::numeric, 0) / case when rule->>'interest_period' = 'diario' then 1 else 30 end;
  return query select late, out_,
    round(out_ * coalesce((rule->>'fine_percent')::numeric, 0) / 100, 2),
    round(out_ * daily * late / 100, 2),
    out_ + round(out_ * coalesce((rule->>'fine_percent')::numeric, 0) / 100, 2) + round(out_ * daily * late / 100, 2);
end $$;

-- ---------------------------------------------------------------------------
-- Confirmação de pedido: reserva estoque e equipamentos, gera recebíveis, agenda entrega, cria tarefas.
-- Idempotente: confirmar duas vezes não duplica efeitos.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_order(p_order uuid, p_equipment uuid[] default '{}', p_margin_justification text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders; it record; si_id uuid; avail numeric; min_margin numeric; v_term int; v_rule collection_rules;
        v_parcels numeric[]; v_n int; v_base numeric; v_rest numeric; v_due date; i int; eq uuid; created_recv int := 0;
begin
  perform require_perm('pedidos', 'edit');
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if o.status = 'cancelado' then raise exception 'Pedido cancelado não pode ser confirmado' using errcode = 'P0001'; end if;
  if o.status not in ('orcamento','aguardando_confirmacao') then
    return jsonb_build_object('order_id', o.id, 'status', o.status, 'already_confirmed', true);
  end if;
  if not exists (select 1 from order_items where order_id = o.id) then raise exception 'Pedido sem itens' using errcode = 'P0001'; end if;

  -- Margem mínima: exige permissão de aprovação + justificativa.
  select coalesce((select (value)::text::numeric from settings where key = 'commercial.min_margin_percent'), 20) into min_margin;
  if o.margin_percent is not null and o.margin_percent < min_margin then
    if not has_perm('pedidos', 'approve') or coalesce(trim(p_margin_justification), '') = '' then
      raise exception 'Margem de %%% abaixo do mínimo de %%%. Requer aprovação de usuário autorizado com justificativa.', o.margin_percent, min_margin using errcode = 'P0001';
    end if;
    perform set_config('app.audit_reason', 'Exceção de margem: ' || p_margin_justification, true);
    update orders set margin_approved_by = auth.uid(), margin_justification = p_margin_justification where id = o.id;
  end if;

  -- Reserva de estoque (somente itens com stock_item correspondente ao produto + tamanho)
  for it in select oi.*, si.id as stock_item_id from order_items oi
            left join stock_items si on si.product_id = oi.product_id and si.keg_size_id is not distinct from oi.keg_size_id and si.status = 'ativo'
            where oi.order_id = o.id loop
    if it.stock_item_id is not null and not exists (select 1 from stock_reservations where order_id = o.id and stock_item_id = it.stock_item_id and status = 'ativa') then
      perform 1 from stock_items where id = it.stock_item_id for update;
      select available into avail from stock_positions where stock_item_id = it.stock_item_id;
      if coalesce(avail, 0) < it.quantity then
        raise exception 'Estoque disponível insuficiente para o item (disponível %, solicitado %)', coalesce(avail,0), it.quantity using errcode = 'P0001';
      end if;
      insert into stock_reservations (stock_item_id, quantity, order_id) values (it.stock_item_id, it.quantity, o.id);
    end if;
  end loop;

  -- Reserva de equipamentos (constraint de exclusão impede conflitos)
  foreach eq in array coalesce(p_equipment, '{}') loop
    insert into equipment_reservations (equipment_id, customer_id, order_id, starts_at, ends_at)
    values (eq, o.customer_id, o.id,
            coalesce(o.delivery_date, o.order_date)::timestamptz,
            case when o.pickup_date is not null then (o.pickup_date + 1)::timestamptz end);
    update equipment set status = 'reservado' where id = eq and status = 'disponivel';
  end loop;

  -- Recebíveis (parcelas), sem duplicar
  if not exists (select 1 from receivables where order_id = o.id and status <> 'cancelado') and o.total > 0 then
    v_rule := effective_collection_rule(o.customer_id);
    select coalesce(cc.payment_term_days, v_rule.default_term_days, 0) into v_term from (select 1) x
      left join commercial_conditions cc on cc.customer_id = o.customer_id and public.today_sp() between cc.valid_from and coalesce(cc.valid_to, 'infinity');
    v_n := o.installments;
    v_base := trunc(o.total / v_n, 2);
    v_rest := o.total - v_base * v_n;
    for i in 1..v_n loop
      v_due := coalesce(o.first_due_date, coalesce(o.delivery_date, o.order_date) + v_term) + ((i - 1) * 30);
      insert into receivables (customer_id, order_id, description, category_id, installment_no, installment_count,
                               competence_date, due_date, amount, payment_method, collection_rule_snapshot)
      values (o.customer_id, o.id, format('Pedido nº %s — parcela %s/%s', o.number, i, v_n),
              (select id from financial_categories where name = 'Venda de chopp' and direction = 'receita'),
              i, v_n, coalesce(o.delivery_date, o.order_date), v_due, v_base + case when i = 1 then v_rest else 0 end,
              o.payment_method, to_jsonb(v_rule));
      created_recv := created_recv + 1;
    end loop;
  end if;

  -- Entrega e recolhimento
  if o.delivery_date is not null then
    insert into deliveries (kind, order_id, customer_id, scheduled_date, scheduled_time, address, full_kegs, equipment_ids)
    select 'entrega', o.id, o.customer_id, o.delivery_date, o.delivery_time, coalesce(o.delivery_address, concat_ws(', ', c.street, c.number, c.district, c.city)),
           (select coalesce(sum(quantity),0)::int from order_items where order_id = o.id and keg_size_id is not null), coalesce(p_equipment, '{}')
    from customers c where c.id = o.customer_id
    on conflict do nothing;
    insert into calendar_events (title, kind, starts_at, customer_id, ref_type, ref_id)
    values (format('Entrega pedido nº %s', o.number), 'entrega',
            (o.delivery_date + coalesce(o.delivery_time, '09:00'::time)) at time zone 'America/Sao_Paulo', o.customer_id, 'order_delivery', o.id)
    on conflict do nothing;
  end if;
  if o.pickup_date is not null then
    insert into deliveries (kind, order_id, customer_id, scheduled_date, address, empty_kegs, equipment_ids)
    select 'recolhimento', o.id, o.customer_id, o.pickup_date, coalesce(o.delivery_address, concat_ws(', ', c.street, c.number, c.district, c.city)),
           (select coalesce(sum(quantity),0)::int from order_items where order_id = o.id and keg_size_id is not null), coalesce(p_equipment, '{}')
    from customers c where c.id = o.customer_id
    on conflict do nothing;
  end if;

  -- Tarefa operacional de preparação
  insert into tasks (title, category, due_date, priority, ref_type, ref_id, source_key, assignee_id)
  values (format('Preparar pedido nº %s', o.number), 'operacional', coalesce(o.delivery_date, o.order_date), 'alta', 'order', o.id,
          'order_prepare:' || o.id, o.operational_owner_id)
  on conflict (source_key) do nothing;

  update orders set status = 'confirmado', confirmed_at = now() where id = o.id;
  insert into order_status_history (order_id, from_status, to_status) values (o.id, o.status, 'confirmado');
  insert into customer_interactions (customer_id, kind, summary) values (o.customer_id, 'sistema', format('Pedido nº %s confirmado (R$ %s).', o.number, o.total));

  return jsonb_build_object('order_id', o.id, 'status', 'confirmado', 'receivables_created', created_recv);
end $$;

create or replace function public.set_order_status(p_order uuid, p_status text, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o orders; flow text[] := array['orcamento','aguardando_confirmacao','confirmado','em_preparacao','aguardando_entrega','em_rota','entregue','aguardando_recolhimento','finalizado'];
        it record;
begin
  perform require_perm('pedidos', 'edit');
  select * into o from orders where id = p_order for update;
  if o.status in ('finalizado','cancelado') then raise exception 'Pedido encerrado' using errcode = 'P0001'; end if;
  if p_status = 'confirmado' then raise exception 'Use confirm_order para confirmar' using errcode = 'P0001'; end if;
  if p_status = 'cancelado' then perform cancel_order(p_order, coalesce(p_notes, 'Cancelado')); return; end if;
  if array_position(flow, p_status) is null or array_position(flow, p_status) <= array_position(flow, o.status) then
    if not (array_position(flow, o.status) <= 2 and array_position(flow, p_status) < array_position(flow, o.status)) then
      raise exception 'Transição inválida: % → %', o.status, p_status using errcode = 'P0001';
    end if;
  end if;
  if array_position(flow, p_status) > 2 and o.confirmed_at is null then raise exception 'Confirme o pedido antes' using errcode = 'P0001'; end if;
  -- Na entrega, a reserva vira saída física de estoque (FEFO por lote quando houver).
  if p_status in ('entregue','aguardando_recolhimento','finalizado') and o.status not in ('entregue','aguardando_recolhimento') then
    for it in select * from stock_reservations where order_id = o.id and status = 'ativa' loop
      perform consume_stock_fefo(it.stock_item_id, it.quantity, 'order', o.id, format('Entrega pedido nº %s', o.number));
      update stock_reservations set status = 'consumida', released_at = now() where id = it.id;
    end loop;
    update equipment e set status = case when o.kind = 'evento' then 'em_evento' else 'em_ponto_fixo' end,
           customer_id = o.customer_id, location = 'cliente', custody_since = now()
     where e.id in (select equipment_id from equipment_reservations where order_id = o.id and status = 'ativa')
       and e.status in ('reservado','disponivel','em_transporte');
    insert into equipment_movements (equipment_id, from_status, to_status, to_location, customer_id, order_id, reason)
    select equipment_id, 'reservado', case when o.kind = 'evento' then 'em_evento' else 'em_ponto_fixo' end, 'cliente', o.customer_id, o.id, 'Entrega do pedido'
    from equipment_reservations where order_id = o.id and status = 'ativa';
    update deliveries set status = 'concluida', completed_at = now() where order_id = o.id and kind = 'entrega' and status <> 'cancelada';
  end if;
  update orders set status = p_status where id = o.id;
  insert into order_status_history (order_id, from_status, to_status, notes) values (o.id, o.status, p_status, p_notes);
end $$;

create or replace function public.consume_stock_fefo(p_item uuid, p_qty numeric, p_ref_type text, p_ref_id uuid, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare left_ numeric := p_qty; l record; q numeric;
begin
  perform 1 from stock_items where id = p_item for update;
  for l in select lot_id, quantity from lot_balances where stock_item_id = p_item and quantity > 0
           and (expires_at is null or expires_at >= public.today_sp()) order by expires_at nulls last loop
    exit when left_ <= 0;
    q := least(l.quantity, left_);
    insert into inventory_movements (stock_item_id, lot_id, movement_type, quantity, ref_type, ref_id, notes)
    values (p_item, l.lot_id, 'saida', -q, p_ref_type, p_ref_id, p_notes);
    left_ := left_ - q;
  end loop;
  if left_ > 0 then
    insert into inventory_movements (stock_item_id, movement_type, quantity, ref_type, ref_id, notes)
    values (p_item, 'saida', -left_, p_ref_type, p_ref_id, p_notes);  -- trigger impede saldo negativo
  end if;
end $$;

create or replace function public.cancel_order(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  perform require_perm('pedidos', 'cancel');
  select * into o from orders where id = p_order for update;
  if o.status in ('finalizado','cancelado') then raise exception 'Pedido já encerrado' using errcode = 'P0001'; end if;
  if o.status in ('entregue','aguardando_recolhimento') then raise exception 'Pedido entregue não pode ser cancelado; registre devolução' using errcode = 'P0001'; end if;
  if exists (select 1 from receivables where order_id = o.id and paid_amount > 0 and status <> 'cancelado') then
    raise exception 'Há pagamentos registrados; estorne-os antes de cancelar' using errcode = 'P0001';
  end if;
  perform set_config('app.audit_reason', p_reason, true);
  update stock_reservations set status = 'liberada', released_at = now() where order_id = o.id and status = 'ativa';
  update equipment set status = 'disponivel' where id in (select equipment_id from equipment_reservations where order_id = o.id and status = 'ativa') and status = 'reservado';
  update equipment_reservations set status = 'cancelada' where order_id = o.id and status = 'ativa';
  update receivables set status = 'cancelado', notes = coalesce(notes || E'\n', '') || 'Cancelado: ' || p_reason where order_id = o.id and status in ('em_aberto');
  update deliveries set status = 'cancelada' where order_id = o.id and status = 'programada';
  update calendar_events set status = 'cancelado' where ref_type = 'order_delivery' and ref_id = o.id;
  update message_queue set status = 'cancelada', cancel_reason = 'Pedido cancelado' where ref_type = 'order' and ref_id = o.id and status in ('gerada','aberta');
  update orders set status = 'cancelado', cancelled_at = now(), cancel_reason = p_reason where id = o.id;
  insert into order_status_history (order_id, from_status, to_status, notes) values (o.id, o.status, 'cancelado', p_reason);
end $$;

-- Duplica pedido recorrente com preços VIGENTES (não copia preços antigos).
create or replace function public.duplicate_order(p_order uuid, p_delivery_date date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare o orders; new_id uuid; it record; pr record;
begin
  perform require_perm('pedidos', 'create');
  select * into o from orders where id = p_order;
  insert into orders (kind, customer_id, seller_id, partner_id, operational_owner_id, delivery_date, delivery_time, delivery_address,
                      payment_method, installments, discount, freight, equipment_needed, source_order_id, notes)
  values (o.kind, o.customer_id, o.seller_id, o.partner_id, o.operational_owner_id, p_delivery_date, o.delivery_time, o.delivery_address,
          o.payment_method, o.installments, 0, o.freight, o.equipment_needed, o.id, o.notes)
  returning id into new_id;
  for it in select * from order_items where order_id = o.id loop
    select * into pr from resolve_price(o.customer_id, it.product_id, it.keg_size_id);
    insert into order_items (order_id, product_id, keg_size_id, quantity, liters_per_unit, unit_price, price_per_liter, price_source, unit_cost)
    values (new_id, it.product_id, it.keg_size_id, it.quantity, pr.liters, pr.unit_price, pr.price_per_liter, pr.source,
            coalesce((select pv.cost from product_variants pv where pv.product_id = it.product_id and pv.keg_size_id = it.keg_size_id),
                     round((select cost_per_unit from products where id = it.product_id) * pr.liters, 2)));
  end loop;
  return new_id;
end $$;

-- ---------------------------------------------------------------------------
-- Pagamentos
-- ---------------------------------------------------------------------------
create or replace function public.register_receipt(
  p_receivable uuid, p_amount numeric, p_method text, p_paid_at date default public.today_sp(),
  p_account uuid default null, p_external_ref text default null, p_verified boolean default false,
  p_notes text default null, p_idempotency_key text default null, p_interest numeric default 0, p_fine numeric default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r receivables; pay_id uuid; principal numeric; new_paid numeric; new_status text; acc uuid; existing uuid;
begin
  if not (has_perm('financeiro','create') or has_perm('cobranca','edit')) then
    raise exception 'Permissão negada: registrar recebimento' using errcode = '42501';
  end if;
  if p_amount <= 0 then raise exception 'Valor deve ser positivo' using errcode = '22023'; end if;
  if p_idempotency_key is not null then
    select id into existing from payments where idempotency_key = p_idempotency_key;
    if existing is not null then return jsonb_build_object('payment_id', existing, 'duplicate', true); end if;
  end if;
  select * into r from receivables where id = p_receivable for update;
  if not found then raise exception 'Título não encontrado'; end if;
  if r.status in ('cancelado','renegociado','pago') then raise exception 'Título % não aceita pagamento', r.status using errcode = 'P0001'; end if;
  principal := least(p_amount - coalesce(p_interest,0) - coalesce(p_fine,0), r.amount - r.paid_amount);
  if principal <= 0 then raise exception 'Valor insuficiente para amortizar o principal' using errcode = 'P0001'; end if;
  acc := coalesce(p_account, (select id from financial_accounts where active order by kind = 'banco' desc, name limit 1));

  insert into payments (direction, method, amount, paid_at, account_id, customer_id, external_ref, verified, verified_by, notes, idempotency_key)
  values ('entrada', p_method, p_amount, p_paid_at, acc, r.customer_id, p_external_ref, p_verified, case when p_verified then auth.uid() end, p_notes, p_idempotency_key)
  returning id into pay_id;
  insert into payment_allocations (payment_id, receivable_id, amount, principal, interest, fine)
  values (pay_id, r.id, p_amount, principal, coalesce(p_interest,0), coalesce(p_fine,0));

  new_paid := r.paid_amount + principal;
  new_status := case when new_paid >= r.amount then 'pago' else 'parcialmente_pago' end;
  update receivables set paid_amount = new_paid, status = new_status,
         interest_amount = interest_amount + coalesce(p_interest,0), fine_amount = fine_amount + coalesce(p_fine,0),
         paid_at = case when new_status = 'pago' then p_paid_at end,
         payment_method = case when new_status = 'pago' then p_method else payment_method end
   where id = r.id;

  if acc is not null then
    insert into financial_transactions (account_id, kind, amount, occurred_on, description, category_id, payment_id)
    values (acc, 'recebimento', p_amount, p_paid_at, r.description, r.category_id, pay_id);
  end if;

  update pix_charges set status = 'confirmado', payment_id = pay_id where receivable_id = r.id and status in ('gerado','comprovante_recebido') and new_status = 'pago';
  update boletos set status = 'liquidado' where receivable_id = r.id and status = 'registrado' and new_status = 'pago';

  if new_status = 'pago' then
    -- Interrompe lembretes financeiros; a situação cartorária NÃO é alterada automaticamente.
    update message_queue set status = 'cancelada', cancel_reason = 'Título quitado'
     where ref_type = 'receivable' and ref_id = r.id and status in ('gerada','aberta')
       and template_key in ('lembrete_vencimento','boleto_hoje','boleto_vencido','pix_pendente','pagamento_atraso','aviso_protesto');
    if exists (select 1 from protest_records pr where pr.receivable_id = r.id
               and pr.status in ('encaminhado','em_cartorio','protestado','aguardando_anuencia','aguardando_cancelamento','cancelamento_solicitado')) then
      insert into notifications (category, priority, title, body, link, ref_type, ref_id, target_resource, dedup_key)
      values ('financeiro', 'alta', 'Título pago com pendência cartorária',
              format('%s foi quitado (%s), mas segue com pendência em cartório. Providenciar anuência/cancelamento.', r.description, p_method),
              '/financeiro/protestos', 'receivable', r.id, 'cobranca', 'paid_protest:' || r.id)
      on conflict (dedup_key) do nothing;
    end if;
    -- Programado (ainda não encaminhado) volta a não encaminhado.
    update protest_records set status = 'nao_encaminhado', notes = 'Pagamento recebido antes do encaminhamento'
     where receivable_id = r.id and status = 'programado';
  end if;
  insert into customer_interactions (customer_id, kind, summary)
  values (r.customer_id, 'sistema', format('Pagamento de R$ %s via %s registrado (%s).', p_amount, p_method, r.description));
  return jsonb_build_object('payment_id', pay_id, 'status', new_status, 'outstanding', r.amount - new_paid);
end $$;

-- Estorno de pagamento (auditado). Não exclui: marca como estornado e reverte efeitos.
create or replace function public.reverse_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare p payments; a record;
begin
  perform require_perm('financeiro', 'cancel');
  if coalesce(trim(p_reason), '') = '' then raise exception 'Justificativa obrigatória' using errcode = '22023'; end if;
  select * into p from payments where id = p_payment for update;
  if p.reversed_at is not null then raise exception 'Pagamento já estornado' using errcode = 'P0001'; end if;
  perform set_config('app.audit_reason', 'Estorno: ' || p_reason, true);
  for a in select * from payment_allocations where payment_id = p.id and not reversed loop
    if a.receivable_id is not null then
      update receivables set paid_amount = paid_amount - a.principal,
             status = case when paid_amount - a.principal <= 0 then 'em_aberto' else 'parcialmente_pago' end, paid_at = null
       where id = a.receivable_id;
    else
      update payables set paid_amount = paid_amount - a.principal,
             status = case when paid_amount - a.principal <= 0 then 'em_aberto' else 'parcialmente_pago' end, paid_at = null
       where id = a.payable_id;
    end if;
    update payment_allocations set reversed = true where id = a.id;
  end loop;
  update payments set reversed_at = now(), reversed_by = auth.uid(), reverse_reason = p_reason where id = p.id;
  insert into financial_transactions (account_id, kind, amount, occurred_on, description, payment_id)
  select account_id, 'estorno', -amount, public.today_sp(), 'Estorno: ' || p_reason, payment_id
  from financial_transactions where payment_id = p.id and kind in ('recebimento','pagamento');
end $$;

create or replace function public.pay_payable(p_payable uuid, p_amount numeric, p_method text, p_paid_at date default public.today_sp(), p_account uuid default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b payables; pay_id uuid; new_paid numeric; acc uuid; applied numeric;
begin
  perform require_perm('financeiro', 'edit');
  select * into b from payables where id = p_payable for update;
  if b.status in ('pago','cancelado') then raise exception 'Conta % não aceita pagamento', b.status using errcode = 'P0001'; end if;
  applied := least(p_amount, b.amount - b.paid_amount);
  acc := coalesce(p_account, (select id from financial_accounts where active order by kind = 'banco' desc, name limit 1));
  insert into payments (direction, method, amount, paid_at, account_id, supplier_id, notes, verified)
  values ('saida', p_method, applied, p_paid_at, acc, b.supplier_id, p_notes, true) returning id into pay_id;
  insert into payment_allocations (payment_id, payable_id, amount, principal) values (pay_id, b.id, applied, applied);
  new_paid := b.paid_amount + applied;
  update payables set paid_amount = new_paid, status = case when new_paid >= amount then 'pago' else 'parcialmente_pago' end,
         paid_at = case when new_paid >= amount then p_paid_at end where id = b.id;
  if acc is not null then
    insert into financial_transactions (account_id, kind, amount, occurred_on, description, category_id, cost_center_id, payment_id)
    values (acc, 'pagamento', -applied, p_paid_at, b.description, b.category_id, b.cost_center_id, pay_id);
  end if;
  return jsonb_build_object('payment_id', pay_id, 'paid', new_paid);
end $$;

create or replace function public.transfer_between_accounts(p_from uuid, p_to uuid, p_amount numeric, p_on date default public.today_sp(), p_description text default 'Transferência interna')
returns uuid language plpgsql security definer set search_path = public as $$
declare g uuid := gen_random_uuid();
begin
  perform require_perm('financeiro', 'edit');
  if p_from = p_to or p_amount <= 0 then raise exception 'Transferência inválida' using errcode = '22023'; end if;
  insert into financial_transactions (account_id, kind, amount, occurred_on, description, transfer_group)
  values (p_from, 'transferencia_saida', -p_amount, p_on, p_description, g), (p_to, 'transferencia_entrada', p_amount, p_on, p_description, g);
  return g;
end $$;

-- Renegociação: o título original fica "renegociado" (histórico preservado) e novas parcelas são criadas.
create or replace function public.renegotiate_receivable(p_receivable uuid, p_installments int, p_first_due date, p_new_total numeric, p_reason text)
returns int language plpgsql security definer set search_path = public as $$
declare r receivables; base numeric; rest numeric; i int;
begin
  perform require_perm('financeiro', 'approve');
  select * into r from receivables where id = p_receivable for update;
  if r.status not in ('em_aberto','parcialmente_pago') then raise exception 'Título não pode ser renegociado' using errcode = 'P0001'; end if;
  perform set_config('app.audit_reason', 'Renegociação: ' || p_reason, true);
  update receivables set status = 'renegociado', notes = coalesce(notes || E'\n', '') || 'Renegociado: ' || p_reason where id = r.id;
  update message_queue set status = 'cancelada', cancel_reason = 'Título renegociado' where ref_type = 'receivable' and ref_id = r.id and status in ('gerada','aberta');
  base := trunc(p_new_total / p_installments, 2); rest := p_new_total - base * p_installments;
  for i in 1..p_installments loop
    insert into receivables (customer_id, order_id, renegotiated_from, description, category_id, installment_no, installment_count, due_date, amount, payment_method, collection_rule_snapshot)
    values (r.customer_id, r.order_id, r.id, format('Renegociação de "%s" — %s/%s', r.description, i, p_installments), r.category_id,
            i, p_installments, p_first_due + (i - 1) * 30, base + case when i = 1 then rest else 0 end, r.payment_method, r.collection_rule_snapshot);
  end loop;
  return p_installments;
end $$;

-- ---------------------------------------------------------------------------
-- Ordens de serviço
-- ---------------------------------------------------------------------------
create or replace function public.finalize_service_order(p_so uuid, p_work_done text default null, p_acceptance text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s service_orders; it record; svc services; recv_id uuid; v_rule collection_rules; v_kind text; interval_ int;
begin
  perform require_perm('tecnico', 'edit');
  select * into s from service_orders where id = p_so for update;
  if s.status = 'concluida' then return jsonb_build_object('service_order_id', s.id, 'already_completed', true); end if;
  if s.status = 'cancelada' then raise exception 'OS cancelada' using errcode = 'P0001'; end if;
  select * into svc from services where id = s.service_id;

  -- Consumo de peças (idempotente pelo índice único de referência)
  for it in select * from service_order_items where service_order_id = s.id loop
    perform consume_stock_fefo(it.stock_item_id, it.quantity, 'service_order', s.id, format('OS nº %s', s.number));
  end loop;

  -- Histórico patrimonial
  if s.equipment_id is not null then
    v_kind := svc.category;
    if v_kind = 'assepsia' then
      select coalesce(et.sanitization_days, (select (value)::text::int from settings where key = 'equipment.sanitization_days')) into interval_
        from equipment e join equipment_types et on et.id = e.type_id where e.id = s.equipment_id;
      update equipment set last_sanitization_at = public.today_sp(), next_sanitization_at = public.today_sp() + interval_ where id = s.equipment_id;
      update maintenance_schedules set next_date = public.today_sp() + interval_days where equipment_id = s.equipment_id and kind = 'assepsia';
    elsif v_kind in ('manutencao_preventiva','manutencao_corretiva','troca_componente','instalacao') then
      select coalesce(et.maintenance_days, (select (value)::text::int from settings where key = 'equipment.maintenance_days')) into interval_
        from equipment e join equipment_types et on et.id = e.type_id where e.id = s.equipment_id;
      update equipment set last_maintenance_at = public.today_sp(), next_maintenance_at = public.today_sp() + interval_ where id = s.equipment_id;
      update maintenance_schedules set next_date = public.today_sp() + interval_days where equipment_id = s.equipment_id and kind = 'manutencao_preventiva';
    end if;
    insert into equipment_movements (equipment_id, from_status, to_status, customer_id, service_order_id, reason)
    select e.id, e.status, e.status, s.customer_id, s.id, format('OS nº %s concluída: %s', s.number, coalesce(svc.name, 'serviço')) from equipment e where e.id = s.equipment_id;
  end if;

  -- Cobrança (somente se não for gratuita e houver valor)
  if not s.is_free and s.charged_amount > 0 and s.customer_id is not null then
    v_rule := effective_collection_rule(s.customer_id);
    insert into receivables (customer_id, service_order_id, description, category_id, due_date, amount, collection_rule_snapshot)
    values (s.customer_id, s.id, format('OS nº %s — %s', s.number, coalesce(svc.name, 'Serviço técnico')),
            (select id from financial_categories where name = 'Serviços técnicos'), public.today_sp() + coalesce(v_rule.default_term_days, 0),
            s.charged_amount, to_jsonb(v_rule))
    on conflict do nothing returning id into recv_id;
  end if;

  update calendar_events set status = 'concluido' where ref_type = 'service_order' and ref_id = s.id;
  update deliveries set status = 'concluida', completed_at = now() where service_order_id = s.id and status = 'programada';
  update service_orders set status = 'concluida', completed_at = now(), work_done = coalesce(p_work_done, work_done),
         customer_acceptance = coalesce(p_acceptance, customer_acceptance),
         cost = cost + coalesce((select sum(quantity * unit_cost) from service_order_items where service_order_id = s.id), 0)
   where id = s.id;
  if s.customer_id is not null then
    insert into customer_interactions (customer_id, kind, summary) values (s.customer_id, 'sistema', format('OS nº %s concluída.', s.number));
  end if;
  return jsonb_build_object('service_order_id', s.id, 'receivable_id', recv_id);
end $$;

create or replace function public.schedule_service_order(p_so uuid, p_date date, p_time time default '09:00') returns void
language plpgsql security definer set search_path = public as $$
declare s service_orders;
begin
  perform require_perm('tecnico', 'edit');
  update service_orders set scheduled_date = p_date, scheduled_time = p_time, status = 'agendada' where id = p_so and status in ('aberta','agendada') returning * into s;
  if not found then raise exception 'OS não pode ser agendada' using errcode = 'P0001'; end if;
  update calendar_events set starts_at = (p_date + p_time) at time zone 'America/Sao_Paulo' where ref_type = 'service_order' and ref_id = p_so and status <> 'cancelado';
  if not found then
    insert into calendar_events (title, kind, starts_at, customer_id, ref_type, ref_id, owner_id)
    values (format('OS nº %s', s.number), 'visita_tecnica', (p_date + p_time) at time zone 'America/Sao_Paulo', s.customer_id, 'service_order', p_so, s.technician_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Movimentação patrimonial (custódia)
-- ---------------------------------------------------------------------------
create or replace function public.move_equipment(p_equipment uuid, p_to_status text, p_customer uuid default null, p_location text default null, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare e equipment; v_days int;
begin
  perform require_perm('equipamentos', 'edit');
  select * into e from equipment where id = p_equipment for update;
  insert into equipment_movements (equipment_id, from_status, to_status, from_location, to_location, customer_id, reason)
  values (e.id, e.status, p_to_status, e.location, coalesce(p_location, case when p_customer is not null then 'cliente' else 'deposito' end), p_customer, p_reason);
  update equipment set status = p_to_status, customer_id = p_customer,
         location = coalesce(p_location, case when p_customer is not null then 'cliente' else 'deposito' end), custody_since = now()
   where id = e.id;
  -- Instalação em ponto fixo agenda a próxima assepsia.
  if p_to_status in ('em_ponto_fixo','instalado') and p_customer is not null then
    select coalesce(et.sanitization_days, (select (value)::text::int from settings where key = 'equipment.sanitization_days'), 15)
      into v_days from equipment_types et where et.id = e.type_id;
    insert into maintenance_schedules (equipment_id, kind, interval_days, next_date)
    values (e.id, 'assepsia', v_days, public.today_sp() + v_days)
    on conflict (equipment_id, kind) do update set next_date = excluded.next_date, active = true;
    update equipment set next_sanitization_at = public.today_sp() + v_days where id = e.id;
    insert into calendar_events (title, kind, starts_at, customer_id, ref_type, ref_id)
    values (format('Assepsia %s', e.asset_code), 'assepsia', ((public.today_sp() + v_days) + time '09:00') at time zone 'America/Sao_Paulo', p_customer, 'equipment_sanitization', e.id)
    on conflict do nothing;
  end if;
  if p_to_status = 'disponivel' then
    update equipment_reservations set status = 'concluida' where equipment_id = e.id and status = 'ativa' and coalesce(ends_at, 'infinity') > now();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Compras: recebimento (parcial/total) gera entrada de estoque e contas a pagar
-- ---------------------------------------------------------------------------
create or replace function public.receive_purchase(p_purchase uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pu purchases; x jsonb; pi purchase_items; lot uuid; q numeric; recv_total numeric := 0; all_received boolean;
begin
  perform require_perm('estoque', 'edit');
  select * into pu from purchases where id = p_purchase for update;
  if pu.status in ('cancelada','recebida') then raise exception 'Compra %', pu.status using errcode = 'P0001'; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    select * into pi from purchase_items where id = (x->>'item_id')::uuid and purchase_id = pu.id for update;
    q := (x->>'quantity')::numeric;
    if q <= 0 or pi.received_quantity + q > pi.quantity then raise exception 'Quantidade recebida inválida' using errcode = 'P0001'; end if;
    lot := null;
    if coalesce(x->>'lot_code', pi.lot_code) is not null then
      insert into inventory_lots (stock_item_id, lot_code, expires_at) values (pi.stock_item_id, coalesce(x->>'lot_code', pi.lot_code), coalesce((x->>'expires_at')::date, pi.expires_at))
      on conflict (stock_item_id, lot_code) do update set expires_at = excluded.expires_at returning id into lot;
    end if;
    insert into inventory_movements (stock_item_id, lot_id, movement_type, quantity, unit_cost, notes)
    values (pi.stock_item_id, lot, 'entrada', q, pi.unit_cost, format('Recebimento compra nº %s', pu.number));
    update purchase_items set received_quantity = received_quantity + q where id = pi.id;
    update stock_items set unit_cost = pi.unit_cost where id = pi.stock_item_id;
    recv_total := recv_total + round(q * pi.unit_cost, 2);
  end loop;
  select bool_and(received_quantity >= quantity) into all_received from purchase_items where purchase_id = pu.id;
  update purchases set status = case when all_received then 'recebida' else 'recebida_parcial' end where id = pu.id;
  if recv_total > 0 then
    insert into payables (supplier_id, purchase_id, description, category_id, installment_no, due_date, amount)
    values (pu.supplier_id, pu.id, format('Compra nº %s', pu.number), (select id from financial_categories where name = 'Compra de chopp'),
            (select coalesce(max(installment_no), 0) + 1 from payables where purchase_id = pu.id), coalesce(pu.due_date, public.today_sp() + 30), recv_total);
  end if;
  return jsonb_build_object('received_value', recv_total, 'complete', all_received);
end $$;

-- ---------------------------------------------------------------------------
-- Parceiros: fechamento mensal idempotente
-- ---------------------------------------------------------------------------
create or replace function public.close_partner_month(p_partner uuid, p_period date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pa partners; per date := date_trunc('month', p_period)::date; per_end date; opening numeric; obligations numeric; pays numeric; adj numeric;
        credits numeric; offset_ numeric; closing numeric; sid uuid; o record; credit numeric; eligible boolean;
begin
  perform require_perm('parceiros', 'approve');
  per_end := (per + interval '1 month - 1 day')::date;
  select * into pa from partners where id = p_partner for update;
  if exists (select 1 from partner_settlements where partner_id = pa.id and period = per and status = 'fechado') then
    raise exception 'Período já fechado para este parceiro' using errcode = 'P0001';
  end if;
  -- saldo de abertura = saldo inicial + razão até o fim do mês anterior
  opening := pa.opening_debt + coalesce((select sum(amount) from partner_ledger where partner_id = pa.id and occurred_on < per), 0);
  obligations := coalesce((select sum(amount) from partner_ledger where partner_id = pa.id and occurred_on between per and per_end and entry_type = 'obrigacao'), 0);
  pays := coalesce((select -sum(amount) from partner_ledger where partner_id = pa.id and occurred_on between per and per_end and entry_type = 'pagamento'), 0);
  adj := coalesce((select sum(amount) from partner_ledger where partner_id = pa.id and occurred_on between per and per_end and entry_type in ('ajuste','estorno')), 0);

  insert into partner_settlements (partner_id, period, opening_debt, new_obligations, payments, adjustments, closing_debt)
  values (pa.id, per, opening, obligations, pays, adj, 0) returning id into sid;

  credits := 0;
  for o in select ord.*, coalesce((select bool_and(r.status = 'pago') from receivables r where r.order_id = ord.id and r.status <> 'cancelado'), false) as fully_paid
           from orders ord where ord.partner_id = pa.id and ord.status <> 'cancelado' and ord.order_date <= per_end loop
    eligible := case pa.eligibility
      when 'confirmado' then o.confirmed_at is not null
      when 'entregue' then o.status in ('entregue','aguardando_recolhimento','finalizado')
      else o.fully_paid end;
    if eligible then
      credit := round(o.total * (case when o.kind = 'evento' then pa.percent_event else pa.percent_fixed end) / 100, 2) + pa.fixed_per_order;
      if credit > 0 then
        insert into partner_ledger (partner_id, entry_type, amount, order_id, settlement_id, occurred_on, description)
        values (pa.id, 'credito', -credit, o.id, sid, per_end, format('Crédito pedido nº %s', o.number))
        on conflict (partner_id, order_id) where entry_type = 'credito' and order_id is not null do nothing;
        if found then credits := credits + credit; end if;
      end if;
    end if;
  end loop;

  -- Créditos já reduzem a dívida no razão (valores negativos). O abatimento é o quanto da dívida foi coberto.
  offset_ := case when pa.offset_debt then greatest(0, least(credits, opening + obligations - pays + adj)) else 0 end;
  closing := opening + obligations - pays + adj - offset_;
  update partner_settlements set total_credits = credits, offset_amount = offset_, closing_debt = closing,
         credit_payable = credits - offset_ where id = sid;
  -- Crédito excedente (não usado para abater) é devolvido ao razão como saldo a pagar ao parceiro.
  if not pa.offset_debt then
    update partner_ledger set amount = 0, description = description || ' (sem abatimento: crédito a pagar)' where settlement_id = sid and entry_type = 'credito';
  end if;
  return jsonb_build_object('settlement_id', sid, 'credits', credits, 'offset', offset_, 'closing_debt', closing, 'credit_payable', credits - offset_);
end $$;

create or replace function public.reverse_partner_entry(p_entry uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare e partner_ledger; nid uuid;
begin
  perform require_perm('parceiros', 'approve');
  if coalesce(trim(p_reason), '') = '' then raise exception 'Justificativa obrigatória' using errcode = '22023'; end if;
  select * into e from partner_ledger where id = p_entry;
  perform set_config('app.audit_reason', 'Estorno parceiro: ' || p_reason, true);
  insert into partner_ledger (partner_id, entry_type, amount, reversed_entry_id, description)
  values (e.partner_id, 'estorno', -e.amount, e.id, 'Estorno: ' || p_reason) returning id into nid;
  return nid;
end $$;

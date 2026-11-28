-- Importação de pedido em PDF (ordem de serviço JK CHOPP).
-- Cria o pedido como ORÇAMENTO com cliente, entrega, itens (com preço do PDF) e forma de pagamento.
-- Se um boleto já existente for escolhido, o título desse boleto passa a ser o título do pedido
-- (a confirmação NÃO cria outro título): evita cobrança em duplicidade.
-- Transacional e idempotente pelo número do pedido (external_ref).

alter table public.orders add column if not exists external_ref text;
create unique index if not exists ux_orders_external_ref on public.orders (external_ref) where external_ref is not null;

create or replace function public.import_order_pdf(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o orders; it jsonb; v_total numeric; v_items int := 0; v_boleto boletos; v_rec receivables; v_customer customers;
  v_ref text := nullif(trim(p->>'external_ref'), '');
begin
  if not has_perm('pedidos', 'create') then raise exception 'Permissão negada: importar pedido' using errcode = '42501'; end if;
  if v_ref is null then raise exception 'Número do pedido do PDF não identificado' using errcode = '22023'; end if;
  if exists (select 1 from orders where external_ref = v_ref) then
    raise exception 'Este pedido (%) já foi importado', v_ref using errcode = 'P0001';
  end if;

  select * into v_customer from customers where id = nullif(p->>'customer_id', '')::uuid;
  if not found then raise exception 'Selecione ou cadastre o cliente antes de importar' using errcode = '22023'; end if;
  if v_customer.status <> 'ativo' then raise exception 'Cliente inativo' using errcode = 'P0001'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'O pedido precisa de pelo menos um produto' using errcode = '22023';
  end if;

  insert into orders (kind, customer_id, status, order_date, delivery_date, delivery_time, delivery_address,
                      payment_method, installments, notes, external_ref)
  values ('avulso', v_customer.id, 'orcamento', coalesce(nullif(p->>'order_date', '')::date, public.today_sp()),
          nullif(p->>'delivery_date', '')::date, nullif(p->>'delivery_time', '')::time, nullif(trim(p->>'delivery_address'), ''),
          nullif(p->>'payment_method', ''), 1, nullif(trim(p->>'notes'), ''), v_ref)
  returning * into o;

  for it in select value from jsonb_array_elements(p->'items') value loop
    insert into order_items (order_id, product_id, keg_size_id, quantity, liters_per_unit, unit_price, price_source, unit_cost)
    values (o.id, (it->>'product_id')::uuid, nullif(it->>'keg_size_id', '')::uuid, (it->>'quantity')::numeric,
            coalesce(nullif(it->>'liters_per_unit', '')::numeric, 1), (it->>'unit_price')::numeric,
            'importado do PDF do pedido', 0);
    v_items := v_items + 1;
  end loop;

  select total into v_total from orders where id = o.id;

  -- Boleto já gerado: vira o título do pedido (sem duplicar)
  if nullif(p->>'boleto_id', '') is not null then
    if not (has_perm('cobranca', 'view') or has_perm('financeiro', 'view')) then
      raise exception 'Permissão negada: vincular boleto' using errcode = '42501';
    end if;
    select * into v_boleto from boletos where id = (p->>'boleto_id')::uuid;
    if not found then raise exception 'Boleto não encontrado' using errcode = 'P0002'; end if;
    if v_boleto.status <> 'registrado' then raise exception 'O boleto escolhido não está em aberto (%)', v_boleto.status using errcode = 'P0001'; end if;
    select * into v_rec from receivables where id = v_boleto.receivable_id for update;
    if v_rec.customer_id is distinct from v_customer.id then
      raise exception 'O boleto escolhido pertence a outro cliente' using errcode = 'P0001';
    end if;
    if v_rec.order_id is not null then raise exception 'O boleto escolhido já está ligado a outro pedido' using errcode = 'P0001'; end if;
    if v_rec.status not in ('em_aberto','parcialmente_pago') or v_rec.paid_amount > 0 then
      raise exception 'O título do boleto não está em aberto para receber este pedido' using errcode = 'P0001';
    end if;
    if abs(v_rec.amount - v_total) > 0.01 then
      raise exception 'O valor do boleto (R$ %) não confere com o total do pedido (R$ %)', v_rec.amount, v_total using errcode = 'P0001';
    end if;
    update receivables set order_id = o.id, installment_no = 1, installment_count = 1,
           description = format('Pedido nº %s (%s)', o.number, v_ref)
     where id = v_rec.id;
  end if;

  return jsonb_build_object('order_id', o.id, 'number', o.number, 'total', v_total, 'items', v_items,
                            'boleto_linked', nullif(p->>'boleto_id', '') is not null, 'status', o.status);
end $$;

revoke execute on function public.import_order_pdf(jsonb) from public, anon;
grant execute on function public.import_order_pdf(jsonb) to authenticated;

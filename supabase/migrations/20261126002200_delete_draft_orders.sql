-- Exclusão de pedidos em orçamento (sem confirmação, sem estoque reservado, sem títulos, sem entrega).
-- Pedidos confirmados não podem ser excluídos: têm títulos, pagamentos e movimentos de estoque.
create or replace function public.delete_order_draft(p_order uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  if not (has_perm('pedidos', 'edit') or has_perm('pedidos', 'cancel')) then
    raise exception 'Permissão negada: excluir pedido' using errcode = '42501';
  end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if o.status not in ('orcamento', 'aguardando_confirmacao') then
    raise exception 'Pedido confirmado não pode ser excluído: cancele-o (o histórico financeiro é preservado)' using errcode = 'P0001';
  end if;
  if exists (select 1 from receivables where order_id = o.id)
     or exists (select 1 from stock_reservations where order_id = o.id)
     or exists (select 1 from equipment_reservations where order_id = o.id)
     or exists (select 1 from deliveries where order_id = o.id) then
    raise exception 'Pedido com títulos, reservas ou entregas não pode ser excluído' using errcode = 'P0001';
  end if;
  perform set_config('app.audit_reason', 'Exclusão de orçamento: ' || coalesce(nullif(trim(p_reason), ''), 'sem motivo informado'), true);
  delete from order_items where order_id = o.id;
  delete from order_status_history where order_id = o.id;
  delete from orders where id = o.id;
end $$;
revoke execute on function public.delete_order_draft(uuid, text) from anon, public;
grant execute on function public.delete_order_draft(uuid, text) to authenticated;

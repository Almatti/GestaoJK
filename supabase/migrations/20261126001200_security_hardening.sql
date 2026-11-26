-- Endurecimento apontado pelo Security Advisor do Supabase.
-- 1) Funções INTERNAS (usadas só por outras funções/automação) não podem ser chamadas diretamente pela API.
revoke execute on function public.automation_effect(uuid, text, text, uuid, date) from authenticated, anon, public;
revoke execute on function public.consume_stock_fefo(uuid, numeric, text, uuid, text) from authenticated, anon, public;
revoke execute on function public.notify_once(public.automation_rules, text, uuid, date, text, text, text, text, text, text, uuid) from authenticated, anon, public;
revoke execute on function public.queue_receivable_message(public.automation_rules, text, uuid, uuid, text, date) from authenticated, anon, public;
revoke execute on function public.recalc_order_totals(uuid) from authenticated, anon, public;
revoke execute on function public.render_message(text, uuid) from authenticated, anon, public;
revoke execute on function public.attach_audit(regclass) from authenticated, anon, public;

-- 2) Consultas chamadas pela interface passam a respeitar a RLS de quem chama (sem privilégio elevado).
--    Quando usadas dentro de operações transacionais (security definer), continuam funcionando normalmente.
alter function public.receivable_charges(uuid, date) security invoker;
alter function public.resolve_price(uuid, uuid, uuid, date) security invoker;
alter function public.effective_collection_rule(uuid) security invoker;

-- 3) View criada depois da revogação geral: anônimo sem acesso.
revoke all on public.customer_consumption from anon;

-- 4) search_path fixo em funções utilitárias.
alter function public.add_business_days(date, integer) set search_path = public;
alter function public.next_business_day(date) set search_path = public;
alter function public.brl(numeric) set search_path = public;
alter function public.customers_validate() set search_path = public;
alter function public.entity_resource(text) set search_path = public;
alter function public.is_valid_cnpj(text) set search_path = public;
alter function public.is_valid_cpf(text) set search_path = public;
alter function public.orders_discount_changed() set search_path = public;
alter function public.redact(jsonb) set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.today_sp() set search_path = public;
alter function public.attach_audit(regclass) set search_path = public;

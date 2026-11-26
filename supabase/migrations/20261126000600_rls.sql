-- Segurança: Row Level Security em TODAS as tabelas. A autorização é aplicada no banco, não apenas na interface.

-- Mapa tabela → recurso de permissão (ver src/domain/permissions.ts).
create table public.resource_tables (
  table_name text primary key,
  resource text not null,
  allow_delete boolean not null default false
);
insert into public.resource_tables (table_name, resource, allow_delete) values
 ('customers','clientes',false),('customer_contacts','clientes',true),('customer_verifications','clientes',false),
 ('customer_interactions','clientes',false),('commercial_conditions','clientes',false),('customer_product_prices','clientes',false),
 ('customer_health_snapshots','clientes',false),
 ('product_categories','produtos',false),('brands','produtos',false),('keg_sizes','produtos',false),('products','produtos',false),
 ('product_variants','produtos',true),('product_price_history','produtos',false),('price_tables','produtos',false),
 ('price_table_items','produtos',true),('services','produtos',false),
 ('stock_items','estoque',false),('inventory_lots','estoque',false),('inventory_movements','estoque',false),
 ('stock_reservations','estoque',false),('suppliers','estoque',false),('purchases','estoque',false),
 ('purchase_items','estoque',true),('purchase_quotes','estoque',true),
 ('equipment_types','equipamentos',false),('equipment','equipamentos',false),('equipment_movements','equipamentos',false),
 ('equipment_reservations','equipamentos',false),('maintenance_schedules','equipamentos',true),
 ('service_orders','tecnico',false),('service_order_items','tecnico',true),
 ('vehicles','logistica',false),('deliveries','logistica',false),
 ('orders','pedidos',false),('order_items','pedidos',true),('order_status_history','pedidos',false),
 ('financial_accounts','financeiro',false),('financial_categories','financeiro',false),('cost_centers','financeiro',false),
 ('payables','financeiro',false),('financial_transactions','financeiro',false),('bank_statement_imports','financeiro',false),
 ('payments','financeiro',false),('payment_allocations','financeiro',false),
 ('boletos','cobranca',false),('pix_charges','cobranca',false),('protest_records','cobranca',false),
 ('protest_status_history','cobranca',false),('anuence_documents','cobranca',false),('collection_rules','cobranca',false),
 ('document_templates','cobranca',false),
 ('partners','parceiros',false),('partner_ledger','parceiros',false),('partner_settlements','parceiros',false),
 ('calendar_events','organizacao',true),('projects','organizacao',false),('tasks','organizacao',true),
 ('task_comments','organizacao',true),('routines','organizacao',true),('routine_logs','organizacao',true),
 ('meetings','organizacao',false),('notes','organizacao',true),
 ('marketing_campaigns','marketing',false),('marketing_contents','marketing',true),('marketing_metrics','marketing',true),
 ('leads','marketing',false),
 ('strategy_items','estrategia',true),('goals','estrategia',false),
 ('message_templates','automacoes',true),('message_queue','automacoes',false),('message_events','automacoes',false),
 ('automation_rules','automacoes',false),('automation_executions','automacoes',false),('automation_runs','automacoes',false),
 ('integrations','admin',false),('external_sync_records','admin',false),('user_invitations','admin',false);

do $$
declare r record;
begin
  for r in select * from public.resource_tables loop
    execute format('alter table public.%I enable row level security', r.table_name);
    execute format('create policy p_select on public.%I for select to authenticated using (public.has_perm(%L, ''view''))', r.table_name, r.resource);
    execute format('create policy p_insert on public.%I for insert to authenticated with check (public.has_perm(%L, ''create''))', r.table_name, r.resource);
    execute format('create policy p_update on public.%I for update to authenticated using (public.has_perm(%L, ''edit'')) with check (public.has_perm(%L, ''edit''))', r.table_name, r.resource, r.resource);
    if r.allow_delete then
      execute format('create policy p_delete on public.%I for delete to authenticated using (public.has_perm(%L, ''edit''))', r.table_name, r.resource);
    end if;
  end loop;
end $$;

-- Recebíveis: visíveis ao financeiro e à cobrança (comercial vê em leitura); técnicos não.
alter table public.receivables enable row level security;
create policy p_select on public.receivables for select to authenticated using (public.has_perm('financeiro','view') or public.has_perm('cobranca','view'));
create policy p_insert on public.receivables for insert to authenticated with check (public.has_perm('financeiro','create') or public.has_perm('cobranca','create'));
create policy p_update on public.receivables for update to authenticated using (public.has_perm('financeiro','edit') or public.has_perm('cobranca','edit'))
  with check (public.has_perm('financeiro','edit') or public.has_perm('cobranca','edit'));

-- Pagamentos também visíveis à cobrança (histórico de pagamentos do cliente).
drop policy p_select on public.payments;
create policy p_select on public.payments for select to authenticated using (public.has_perm('financeiro','view') or public.has_perm('cobranca','view'));
drop policy p_select on public.payment_allocations;
create policy p_select on public.payment_allocations for select to authenticated using (public.has_perm('financeiro','view') or public.has_perm('cobranca','view'));

-- Configurações e catálogos básicos: leitura para qualquer usuário ATIVO; escrita apenas admin.
do $$
declare t text;
begin
  foreach t in array array['company','settings','settings_history','holidays','roles','role_permissions','resource_tables'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy p_select on public.%I for select to authenticated using (public.current_role_key() is not null)', t);
    execute format('create policy p_write on public.%I for all to authenticated using (public.has_perm(''admin'',''edit'')) with check (public.has_perm(''admin'',''edit''))', t);
  end loop;
end $$;

-- Perfis: cada um vê o próprio; admin vê e gerencia todos. Outros usuários ativos veem nomes (para atribuições).
alter table public.profiles enable row level security;
create policy p_select on public.profiles for select to authenticated using (id = auth.uid() or public.current_role_key() is not null);
create policy p_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy p_admin on public.profiles for all to authenticated using (public.has_perm('admin','edit')) with check (public.has_perm('admin','edit'));
create or replace function public.profiles_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.active is distinct from old.active) and not public.has_perm('admin','edit')
     and current_user not in ('postgres','service_role','supabase_admin') then
    raise exception 'Somente administradores alteram papel ou status de usuários' using errcode = '42501';
  end if;
  if old.id = auth.uid() and old.role = 'admin' and (new.role <> 'admin' or not new.active)
     and (select count(*) from profiles where role = 'admin' and active) <= 1 then
    raise exception 'O sistema precisa de ao menos um administrador ativo' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_profiles_guard before update on public.profiles for each row execute function public.profiles_guard();

-- Auditoria: somente leitura para administradores; gravação apenas via trigger.
alter table public.audit_logs enable row level security;
create policy p_select on public.audit_logs for select to authenticated using (public.has_perm('admin','view'));

-- Notificações: destinatário direto ou quem tem acesso ao recurso alvo.
alter table public.notifications enable row level security;
create policy p_select on public.notifications for select to authenticated
  using (user_id = auth.uid() or (user_id is null and public.current_role_key() is not null and (target_resource is null or public.has_perm(target_resource,'view'))));
create policy p_update on public.notifications for update to authenticated
  using (user_id = auth.uid() or (user_id is null and public.current_role_key() is not null and (target_resource is null or public.has_perm(target_resource,'view'))));
create policy p_insert on public.notifications for insert to authenticated with check (public.current_role_key() is not null);

-- Anexos: herdam a permissão do recurso da entidade.
create or replace function public.entity_resource(p_entity text) returns text language sql immutable as $$
  select case p_entity
    when 'customer' then 'clientes' when 'order' then 'pedidos' when 'receivable' then 'financeiro' when 'payable' then 'financeiro'
    when 'boleto' then 'cobranca' when 'protest' then 'cobranca' when 'payment' then 'financeiro'
    when 'equipment' then 'equipamentos' when 'service_order' then 'tecnico' when 'delivery' then 'logistica'
    when 'purchase' then 'estoque' when 'partner' then 'parceiros' when 'meeting' then 'organizacao' when 'task' then 'organizacao'
    when 'note' then 'organizacao' when 'marketing' then 'marketing' when 'product' then 'produtos'
    else 'admin' end
$$;
alter table public.attachments enable row level security;
create policy p_select on public.attachments for select to authenticated using (public.has_perm(public.entity_resource(entity_type), 'view'));
create policy p_insert on public.attachments for insert to authenticated with check (public.has_perm(public.entity_resource(entity_type), 'create') or public.has_perm(public.entity_resource(entity_type), 'edit'));
create policy p_update on public.attachments for update to authenticated using (public.has_perm(public.entity_resource(entity_type), 'edit'));

alter table public.ai_usage enable row level security;
create policy p_insert on public.ai_usage for insert to authenticated with check (user_id = auth.uid() and public.has_perm('ia','view'));
create policy p_select on public.ai_usage for select to authenticated using (user_id = auth.uid() or public.has_perm('admin','view'));

-- Defesa em profundidade: o papel anônimo não acessa nada do schema public.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
-- Tabelas/visões apenas de leitura para clientes
revoke insert, update, delete on public.audit_logs, public.settings_history, public.order_status_history,
  public.protest_status_history, public.message_events, public.product_price_history, public.automation_executions from authenticated;

-- Storage: bucket privado com URLs temporárias (aplicado somente quando o schema storage existir, i.e., no Supabase).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('documentos', 'documentos', false) on conflict (id) do nothing;
    execute $p$create policy jk_docs_select on storage.objects for select to authenticated
      using (bucket_id = 'documentos' and exists (select 1 from public.attachments a where a.storage_path = name and public.has_perm(public.entity_resource(a.entity_type),'view')))$p$;
    execute $p$create policy jk_docs_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'documentos' and public.current_role_key() is not null)$p$;
  end if;
end $$;

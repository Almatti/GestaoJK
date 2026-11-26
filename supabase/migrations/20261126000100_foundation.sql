-- JK CHOPP GESTÃO — Fundação: extensões, empresa, configurações, perfis, permissões, auditoria.
-- Convenções: valores monetários NUMERIC(14,2); preço/custo por litro NUMERIC(14,4); datas comerciais DATE;
-- carimbos TIMESTAMPTZ. Nenhuma FK financeira usa ON DELETE CASCADE. Registros são arquivados, não excluídos.

create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create or replace function public.today_sp() returns date language sql stable as
$$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- ---------------------------------------------------------------------------
-- Empresa e configurações
-- ---------------------------------------------------------------------------
create table public.company (
  id smallint primary key default 1 check (id = 1),
  legal_name text not null default 'JK CHOPP',
  trade_name text not null default 'JK CHOPP',
  document text,
  state_registration text,
  phone text,
  email text,
  address jsonb not null default '{}'::jsonb,
  logo_path text,
  pix_key text,
  pix_merchant_name text,
  pix_merchant_city text,
  updated_at timestamptz not null default now()
);
insert into public.company (id) values (1);

create table public.settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create table public.settings_history (
  id bigint generated always as identity primary key,
  key text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create or replace function public.settings_versioning() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into settings_history (key, old_value, new_value, changed_by)
  values (new.key, case when tg_op = 'UPDATE' then old.value end, new.value, auth.uid());
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
create trigger trg_settings_versioning before insert or update on public.settings
  for each row execute function public.settings_versioning();

-- Valores INICIAIS configuráveis pela interface (nenhum é fixado no código da aplicação).
insert into public.settings (key, value, description) values
  ('commercial.min_margin_percent', '20', 'Margem mínima comercial (%)'),
  ('commercial.margin_indicator', '"contribution"', 'Indicador para aprovação: contribution | gross'),
  ('commercial.sales_tax_percent', '0', 'Tributos estimados sobre vendas (%) — definir com a contabilidade'),
  ('health.thresholds', '{"excellentRatio":1.1,"healthyRatio":0.85,"attentionRatio":0.5,"inactiveDays":60,"minHistoryDays":30,"minOrders":2,"trendDropPercent":30,"windowDays":30}', 'Critérios de saúde comercial'),
  ('equipment.idle_days', '15', 'Dias parado para considerar equipamento ocioso'),
  ('equipment.sanitization_days', '15', 'Periodicidade padrão de assepsia (dias)'),
  ('equipment.maintenance_days', '90', 'Periodicidade padrão de manutenção preventiva (dias)'),
  ('notifications.quiet_hours', '{"start":"22:00","end":"07:00"}', 'Horário silencioso'),
  ('finance.due_soon_days', '7', 'Dias para considerar título "a vencer"'),
  ('partners.eligibility', '"entregue"', 'Evento que torna um pedido elegível a crédito de parceiro'),
  ('ai.enabled', 'false', 'Assistente com provedor externo habilitado'),
  ('marketing.auto_hashtags', 'false', 'Inserir hashtags automaticamente em legendas');

create table public.holidays (
  day date primary key,
  name text not null,
  scope text not null default 'nacional' check (scope in ('nacional','estadual','municipal','empresa'))
);

-- ---------------------------------------------------------------------------
-- Perfis, papéis e permissões
-- ---------------------------------------------------------------------------
create table public.roles (
  key text primary key,
  name text not null,
  description text
);
insert into public.roles (key, name) values
  ('admin','Administrador geral'),('administrativo','Administrativo'),('financeiro','Financeiro'),
  ('comercial','Comercial'),('logistica','Logística'),('tecnico','Técnico'),('marketing','Marketing'),
  ('operacional','Colaborador operacional'),('leitura','Somente leitura');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null default '',
  email text,
  phone text,
  role text not null default 'leitura' references public.roles(key),
  active boolean not null default false,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles for each row execute function public.set_updated_at();

create table public.role_permissions (
  role text not null references public.roles(key),
  resource text not null,
  action text not null check (action in ('view','create','edit','approve','cancel','export','archive')),
  primary key (role, resource, action)
);

create table public.user_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text not null references public.roles(key),
  invited_by uuid references public.profiles(id),
  status text not null default 'pendente' check (status in ('pendente','aceito','revogado','expirado')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index ux_invitation_pending on public.user_invitations (lower(email)) where status = 'pendente';

-- Novo usuário do Auth: perfil INATIVO por padrão (sem cadastro público). Se houver convite pendente,
-- herda o papel e é ativado. O primeiro usuário do sistema torna-se administrador (bootstrap).
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare inv record; first_user boolean;
begin
  select not exists (select 1 from profiles) into first_user;
  select * into inv from user_invitations where lower(email) = lower(new.email) and status = 'pendente' limit 1;
  insert into profiles (id, email, full_name, role, active)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''),
          case when first_user then 'admin' when inv.id is not null then inv.role else 'leitura' end,
          first_user or inv.id is not null);
  if inv.id is not null then
    update user_invitations set status = 'aceito', accepted_at = now() where id = inv.id;
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Papel do usuário atual (apenas perfis ativos).
create or replace function public.current_role_key() returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function public.has_perm(p_resource text, p_action text default 'view') returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p join role_permissions rp on rp.role = p.role
    where p.id = auth.uid() and p.active and rp.resource = p_resource and rp.action = p_action
  )
$$;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_key() = 'admin', false)
$$;

create or replace function public.require_perm(p_resource text, p_action text) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm(p_resource, p_action) then
    raise exception 'Permissão negada: %/%', p_resource, p_action using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  user_id uuid,
  table_name text not null,
  record_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  reason text
);
create index ix_audit_table_record on public.audit_logs (table_name, record_id);
create index ix_audit_occurred on public.audit_logs (occurred_at desc);

-- Campos sensíveis nunca são gravados por completo no log.
create or replace function public.redact(j jsonb) returns jsonb language sql immutable as $$
  select case when j is null then null else
    j - array['document','cpf','cnpj','password','token','secret','access_token','refresh_token']
      || case when j ? 'document' and j->>'document' is not null
              then jsonb_build_object('document', '***' || right(j->>'document', 4)) else '{}'::jsonb end
  end
$$;

create or replace function public.audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare rid text;
begin
  rid := coalesce(case when tg_op = 'DELETE' then to_jsonb(old)->>'id' else to_jsonb(new)->>'id' end, '');
  insert into audit_logs (user_id, table_name, record_id, action, old_data, new_data, reason)
  values (auth.uid(), tg_table_name, rid, lower(tg_op),
          case when tg_op in ('UPDATE','DELETE') then redact(to_jsonb(old)) end,
          case when tg_op in ('INSERT','UPDATE') then redact(to_jsonb(new)) end,
          nullif(current_setting('app.audit_reason', true), ''));
  return coalesce(new, old);
end $$;

create or replace function public.attach_audit(p_table regclass) returns void language plpgsql as $$
begin
  execute format('create trigger trg_audit after insert or update or delete on %s for each row execute function public.audit_row()', p_table);
end $$;

select public.attach_audit('public.settings');
select public.attach_audit('public.profiles');
select public.attach_audit('public.company');
select public.attach_audit('public.role_permissions');

-- ---------------------------------------------------------------------------
-- Anexos (metadados; arquivos no Supabase Storage, bucket privado "documentos")
-- ---------------------------------------------------------------------------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  category text,
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index ix_attachments_entity on public.attachments (entity_type, entity_id);

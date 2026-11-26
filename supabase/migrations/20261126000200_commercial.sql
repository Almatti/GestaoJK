-- Comercial: clientes, contatos, verificações, produtos, tamanhos de barril, condições comerciais, preços.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  code bigint generated always as identity unique,
  person_type text not null check (person_type in ('PF','PJ')),
  name text not null,                 -- nome completo (PF) ou razão social (PJ)
  trade_name text,                    -- nome fantasia
  document text,                      -- CPF (11 dígitos) ou CNPJ (14, alfanumérico permitido) normalizado
  state_registration text,
  registration_status text,           -- situação cadastral informada pela fonte
  segment text not null default 'ponto_fixo' check (segment in ('ponto_fixo','evento','ambos')),
  phone text, whatsapp text, email text, finance_email text,
  cep text, street text, number text, complement text, district text, city text, state char(2),
  manager_name text, finance_contact_name text,
  origin text, campaign_id uuid,
  notes text,
  status text not null default 'ativo' check (status in ('ativo','inativo','arquivado')),
  verification_status text not null default 'nao_verificado' check (verification_status in
    ('nao_verificado','formato_valido','conferencia_manual','verificado_fonte_oficial','divergencia','consulta_indisponivel')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_customer_document check (
    document is null or (person_type = 'PF' and document ~ '^\d{11}$') or (person_type = 'PJ' and document ~ '^[0-9A-Z]{12}\d{2}$'))
);
create unique index ux_customers_document on public.customers (document) where document is not null;
create index ix_customers_name_trgm on public.customers using gin (name extensions.gin_trgm_ops);
create index ix_customers_status on public.customers (status);
create trigger trg_customers_updated before update on public.customers for each row execute function public.set_updated_at();
select public.attach_audit('public.customers');

-- Validação matemática de CPF/CNPJ (inclui CNPJ alfanumérico) também no servidor.
create or replace function public.is_valid_cpf(p text) returns boolean language plpgsql immutable as $$
declare d int[]; s int; r int; i int;
begin
  if p !~ '^\d{11}$' or p ~ '^(\d)\1{10}$' then return false; end if;
  d := array(select substr(p, g, 1)::int from generate_series(1, 11) g);
  s := 0; for i in 1..9 loop s := s + d[i] * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if; if r <> d[10] then return false; end if;
  s := 0; for i in 1..10 loop s := s + d[i] * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = d[11];
end $$;

create or replace function public.is_valid_cnpj(p text) returns boolean language plpgsql immutable as $$
declare w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2]; w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
        s int; r int; dv1 int; dv2 int; i int;
begin
  if p !~ '^[0-9A-Z]{12}\d{2}$' or p ~ '^(\d)\1{13}$' then return false; end if;
  s := 0; for i in 1..12 loop s := s + (ascii(substr(p, i, 1)) - 48) * w1[i]; end loop;
  r := s % 11; dv1 := case when r < 2 then 0 else 11 - r end;
  s := 0; for i in 1..12 loop s := s + (ascii(substr(p, i, 1)) - 48) * w2[i]; end loop;
  s := s + dv1 * w2[13];
  r := s % 11; dv2 := case when r < 2 then 0 else 11 - r end;
  return substr(p, 13, 2) = dv1::text || dv2::text;
end $$;

create or replace function public.customers_validate() returns trigger language plpgsql as $$
begin
  if new.document is not null then
    new.document := upper(regexp_replace(new.document, '[^0-9A-Za-z]', '', 'g'));
    if new.person_type = 'PF' and not public.is_valid_cpf(new.document) then
      raise exception 'CPF inválido' using errcode = '22023';
    elsif new.person_type = 'PJ' and not public.is_valid_cnpj(new.document) then
      raise exception 'CNPJ inválido' using errcode = '22023';
    end if;
    if new.verification_status = 'nao_verificado' then new.verification_status := 'formato_valido'; end if;
  end if;
  return new;
end $$;
create trigger trg_customers_validate before insert or update of document, person_type on public.customers
  for each row execute function public.customers_validate();

create table public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  name text not null, role text, phone text, whatsapp text, email text,
  is_finance boolean not null default false,
  created_at timestamptz not null default now()
);
create index ix_customer_contacts on public.customer_contacts (customer_id);

-- Histórico de verificações cadastrais (fonte e data sempre registradas).
create table public.customer_verifications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  status text not null check (status in ('nao_verificado','formato_valido','conferencia_manual','verificado_fonte_oficial','divergencia','consulta_indisponivel')),
  source text not null,           -- ex.: 'BrasilAPI (dados públicos RFB)', 'Conferência manual - site RFB', 'Serpro Consulta CNPJ'
  checked_at timestamptz not null default now(),
  checked_by uuid default auth.uid(),
  notes text,
  payload_summary jsonb
);
create index ix_customer_verifications on public.customer_verifications (customer_id, checked_at desc);

create table public.customer_interactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  kind text not null default 'nota' check (kind in ('nota','ligacao','whatsapp','visita','email','reuniao','cobranca','sistema')),
  summary text not null,
  occurred_at timestamptz not null default now(),
  user_id uuid default auth.uid()
);
create index ix_customer_interactions on public.customer_interactions (customer_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Produtos
-- ---------------------------------------------------------------------------
create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);
-- Tamanhos de barril livres (10 L, 15 L, 20 L, 30 L, 50 L …) — nunca fixos no código.
create table public.keg_sizes (
  id uuid primary key default gen_random_uuid(),
  liters numeric(8,2) not null unique check (liters > 0),
  label text not null,
  active boolean not null default true
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null, trade_name text, document text,
  phone text, whatsapp text, email text, contact_name text,
  address text, city text, state char(2),
  lead_time_days int, payment_terms text, rating smallint check (rating between 1 and 5),
  notes text,
  status text not null default 'ativo' check (status in ('ativo','inativo','arquivado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ux_suppliers_document on public.suppliers (document) where document is not null;
create trigger trg_suppliers_updated before update on public.suppliers for each row execute function public.set_updated_at();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  internal_code text unique,
  sku text unique,
  category_id uuid references public.product_categories(id),
  brand_id uuid references public.brands(id),
  supplier_id uuid references public.suppliers(id),
  description text,
  unit text not null default 'litro' check (unit in ('litro','unidade','caixa','fardo','kg','outro')),
  is_draft_beer boolean not null default true,
  cost_per_unit numeric(14,4) not null default 0 check (cost_per_unit >= 0),   -- custo por litro (chopp) ou por unidade
  price_per_unit numeric(14,4) not null default 0 check (price_per_unit >= 0), -- preço de venda por litro/unidade
  min_margin_percent numeric(6,2),                                             -- sobrescreve a margem global
  min_stock numeric(14,3) not null default 0,
  image_path text,
  notes text,
  status text not null default 'ativo' check (status in ('ativo','inativo','arquivado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_products_updated before update on public.products for each row execute function public.set_updated_at();
select public.attach_audit('public.products');

-- Variantes por tamanho de barril com preço/custo específicos opcionais (preço do barril inteiro).
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  keg_size_id uuid not null references public.keg_sizes(id),
  price numeric(14,2),
  cost numeric(14,2),
  active boolean not null default true,
  unique (product_id, keg_size_id)
);

create table public.product_price_history (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id),
  old_cost numeric(14,4), new_cost numeric(14,4),
  old_price numeric(14,4), new_price numeric(14,4),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);
create or replace function public.track_product_prices() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.cost_per_unit is distinct from old.cost_per_unit or new.price_per_unit is distinct from old.price_per_unit then
    insert into product_price_history (product_id, old_cost, new_cost, old_price, new_price)
    values (new.id, case when tg_op='UPDATE' then old.cost_per_unit end, new.cost_per_unit,
            case when tg_op='UPDATE' then old.price_per_unit end, new.price_per_unit);
  end if;
  return new;
end $$;
create trigger trg_product_prices after insert or update on public.products for each row execute function public.track_product_prices();

-- Tabelas comerciais padrão (ex.: "Eventos", "Pontos fixos").
create table public.price_tables (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  applies_to text not null default 'todos' check (applies_to in ('evento','ponto_fixo','todos')),
  active boolean not null default true
);
create table public.price_table_items (
  id uuid primary key default gen_random_uuid(),
  price_table_id uuid not null references public.price_tables(id),
  product_id uuid not null references public.products(id),
  price_per_unit numeric(14,4) not null check (price_per_unit >= 0),
  valid_from date not null default public.today_sp(),
  valid_to date,
  check (valid_to is null or valid_to >= valid_from)
);
create index ix_price_table_items on public.price_table_items (price_table_id, product_id, valid_from desc);

-- ---------------------------------------------------------------------------
-- Condições comerciais por cliente (com vigência; pedidos guardam snapshot de preço)
-- ---------------------------------------------------------------------------
create table public.commercial_conditions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  price_table_id uuid references public.price_tables(id),
  valid_from date not null default public.today_sp(),
  valid_to date,
  discount_percent numeric(6,2) not null default 0,
  payment_term_days int not null default 0,
  preferred_payment_method text,
  credit_limit numeric(14,2),
  expected_kegs_per_week numeric(8,2),
  expected_liters_per_week numeric(10,2),
  min_kegs_per_order int,
  expected_interval_days int,
  preferred_delivery_days text[],
  travel_fee numeric(14,2) not null default 0,
  included_services text[],
  charged_services text[],
  contract_terms text,
  maintenance_rules text,
  protest_terms text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);
-- Não pode haver duas condições vigentes sobrepostas para o mesmo cliente.
alter table public.commercial_conditions add constraint ex_conditions_overlap exclude using gist
  (customer_id with =, daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') with &&);
select public.attach_audit('public.commercial_conditions');

create table public.customer_product_prices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  product_id uuid not null references public.products(id),
  keg_size_id uuid references public.keg_sizes(id),          -- nulo = preço por litro do cliente
  price_per_liter numeric(14,4),                             -- usado quando keg_size_id é nulo
  unit_price numeric(14,2),                                  -- preço do barril inteiro quando keg_size_id informado
  valid_from date not null default public.today_sp(),
  valid_to date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check ((keg_size_id is null and price_per_liter is not null) or (keg_size_id is not null and unit_price is not null)),
  check (valid_to is null or valid_to >= valid_from)
);
alter table public.customer_product_prices add constraint ex_customer_price_overlap exclude using gist
  (customer_id with =, product_id with =, coalesce(keg_size_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
   daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') with &&);
select public.attach_audit('public.customer_product_prices');

-- Resolução de preço no servidor (mesma hierarquia de src/domain/pricing.ts).
create or replace function public.resolve_price(p_customer uuid, p_product uuid, p_keg_size uuid, p_date date default public.today_sp())
returns table (source text, unit_price numeric, price_per_liter numeric, liters numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_liters numeric := 1; v numeric; v_kind text;
begin
  if p_keg_size is not null then select k.liters into v_liters from keg_sizes k where k.id = p_keg_size; end if;
  v_liters := coalesce(v_liters, 1);
  -- 1. cliente + tamanho
  select cpp.unit_price into v from customer_product_prices cpp
   where cpp.customer_id = p_customer and cpp.product_id = p_product and cpp.keg_size_id = p_keg_size
     and p_date between cpp.valid_from and coalesce(cpp.valid_to, 'infinity') limit 1;
  if v is not null then return query select 'cliente_barril', v, round(v / v_liters, 4), v_liters; return; end if;
  -- 2. cliente por litro
  select cpp.price_per_liter into v from customer_product_prices cpp
   where cpp.customer_id = p_customer and cpp.product_id = p_product and cpp.keg_size_id is null
     and p_date between cpp.valid_from and coalesce(cpp.valid_to, 'infinity') limit 1;
  if v is not null then return query select 'cliente_litro', round(v * v_liters, 2), v, v_liters; return; end if;
  -- 3. tabela comercial vigente do cliente, ou tabela do segmento
  select pti.price_per_unit into v from commercial_conditions cc
    join price_table_items pti on pti.price_table_id = cc.price_table_id and pti.product_id = p_product
   where cc.customer_id = p_customer and p_date between cc.valid_from and coalesce(cc.valid_to, 'infinity')
     and p_date between pti.valid_from and coalesce(pti.valid_to, 'infinity')
   order by pti.valid_from desc limit 1;
  if v is null then
    select c.segment into v_kind from customers c where c.id = p_customer;
    select pti.price_per_unit into v from price_tables pt join price_table_items pti on pti.price_table_id = pt.id
     where pt.active and pt.applies_to = v_kind and pti.product_id = p_product
       and p_date between pti.valid_from and coalesce(pti.valid_to, 'infinity')
     order by pti.valid_from desc limit 1;
  end if;
  if v is not null then return query select 'tabela', round(v * v_liters, 2), v, v_liters; return; end if;
  -- 4. preço padrão do barril / produto
  select pv.price into v from product_variants pv where pv.product_id = p_product and pv.keg_size_id = p_keg_size and pv.active;
  if v is not null then return query select 'produto_barril', v, round(v / v_liters, 4), v_liters; return; end if;
  select p.price_per_unit into v from products p where p.id = p_product;
  return query select 'produto_litro', round(coalesce(v,0) * v_liters, 2), coalesce(v,0), v_liters;
end $$;

create table public.customer_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  snapshot_date date not null default public.today_sp(),
  level text not null,
  score int,
  ratio numeric(8,4),
  liters_window numeric(12,2),
  factors jsonb not null default '[]'::jsonb,
  unique (customer_id, snapshot_date)
);

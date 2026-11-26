-- Operação: estoque, patrimônio, serviços, veículos, entregas, compras, parceiros e pedidos.

-- ---------------------------------------------------------------------------
-- Estoque (baseado em movimentações; físico = soma das movimentações)
-- ---------------------------------------------------------------------------
create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('chopp','barril_vazio','cilindro','gas','peca','ferramenta','limpeza','insumo','mercadoria','outro')),
  product_id uuid references public.products(id),
  keg_size_id uuid references public.keg_sizes(id),
  unit text not null default 'unidade',
  min_quantity numeric(14,3) not null default 0,
  returnable boolean not null default false,    -- recipiente retornável (barril vazio, cilindro)
  unit_cost numeric(14,4) not null default 0,
  status text not null default 'ativo' check (status in ('ativo','inativo','arquivado')),
  created_at timestamptz not null default now(),
  unique (product_id, keg_size_id)
);

create table public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references public.stock_items(id),
  lot_code text not null,
  expires_at date,
  received_at date not null default public.today_sp(),
  unique (stock_item_id, lot_code)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references public.stock_items(id),
  lot_id uuid references public.inventory_lots(id),
  movement_type text not null check (movement_type in ('entrada','saida','transferencia','devolucao','perda','vencimento','ajuste','consumo_interno','inventario')),
  quantity numeric(14,3) not null check (quantity <> 0),  -- com sinal: entradas positivas, saídas negativas
  unit_cost numeric(14,4),
  ref_type text, ref_id uuid,
  location text not null default 'deposito',
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check ((movement_type in ('entrada','devolucao') and quantity > 0)
      or (movement_type in ('saida','perda','vencimento','consumo_interno') and quantity < 0)
      or movement_type in ('ajuste','inventario','transferencia'))
);
create index ix_inv_mov_item on public.inventory_movements (stock_item_id, created_at desc);
create unique index ux_inv_mov_ref on public.inventory_movements (ref_type, ref_id, stock_item_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where ref_type is not null;

create table public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references public.stock_items(id),
  quantity numeric(14,3) not null check (quantity > 0),
  order_id uuid,
  status text not null default 'ativa' check (status in ('ativa','consumida','liberada')),
  created_at timestamptz not null default now(),
  released_at timestamptz
);
create index ix_stock_res_item on public.stock_reservations (stock_item_id) where status = 'ativa';

create or replace view public.stock_positions with (security_invoker = true) as
select si.id as stock_item_id, si.name, si.kind, si.unit, si.min_quantity, si.product_id, si.keg_size_id, si.returnable,
       coalesce(m.physical, 0) as physical,
       coalesce(r.reserved, 0) as reserved,
       coalesce(m.physical, 0) - coalesce(r.reserved, 0) as available
from public.stock_items si
left join (select stock_item_id, sum(quantity) physical from public.inventory_movements group by 1) m on m.stock_item_id = si.id
left join (select stock_item_id, sum(quantity) reserved from public.stock_reservations where status = 'ativa' group by 1) r on r.stock_item_id = si.id
where si.status <> 'arquivado';

create or replace view public.lot_balances with (security_invoker = true) as
select l.id as lot_id, l.stock_item_id, l.lot_code, l.expires_at, coalesce(sum(m.quantity), 0) as quantity
from public.inventory_lots l left join public.inventory_movements m on m.lot_id = l.id
group by l.id;

-- Impede estoque físico negativo (por item e por lote). Bloqueia o item para evitar corrida.
create or replace function public.prevent_negative_stock() returns trigger language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_lot numeric;
begin
  perform 1 from stock_items where id = new.stock_item_id for update;
  select coalesce(sum(quantity), 0) into v_total from inventory_movements where stock_item_id = new.stock_item_id;
  if v_total < 0 then raise exception 'Estoque insuficiente para o item (saldo resultante %)', v_total using errcode = 'P0001'; end if;
  if new.lot_id is not null then
    select coalesce(sum(quantity), 0) into v_lot from inventory_movements where lot_id = new.lot_id;
    if v_lot < 0 then raise exception 'Saldo do lote insuficiente' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;
create constraint trigger trg_prevent_negative_stock after insert on public.inventory_movements
  deferrable initially immediate for each row execute function public.prevent_negative_stock();

-- ---------------------------------------------------------------------------
-- Patrimônio
-- ---------------------------------------------------------------------------
create table public.equipment_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  maintenance_days int,
  sanitization_days int,
  active boolean not null default true
);

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null unique,
  serial_number text,
  type_id uuid not null references public.equipment_types(id),
  brand text, model text,
  acquired_at date, acquisition_value numeric(14,2),
  supplier_id uuid references public.suppliers(id),
  ownership text not null default 'propria' check (ownership in ('propria','terceiro','comodato_fornecedor')),
  status text not null default 'disponivel' check (status in ('disponivel','reservado','em_transporte','instalado','em_ponto_fixo','em_evento','aguardando_recolhimento','em_manutencao','em_higienizacao','danificado','extraviado','inativo')),
  location text not null default 'deposito',
  customer_id uuid references public.customers(id),
  custody_since timestamptz not null default now(),
  responsible_id uuid references public.profiles(id),
  warranty_until date,
  last_maintenance_at date, next_maintenance_at date,
  last_sanitization_at date, next_sanitization_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_equipment_status on public.equipment (status);
create index ix_equipment_customer on public.equipment (customer_id);
create trigger trg_equipment_updated before update on public.equipment for each row execute function public.set_updated_at();
select public.attach_audit('public.equipment');

create table public.equipment_movements (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id),
  from_status text, to_status text not null,
  from_location text, to_location text,
  customer_id uuid references public.customers(id),
  order_id uuid, service_order_id uuid, delivery_id uuid,
  reason text,
  moved_by uuid default auth.uid(),
  moved_at timestamptz not null default now()
);
create index ix_equipment_movements on public.equipment_movements (equipment_id, moved_at desc);

create table public.equipment_reservations (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id),
  customer_id uuid not null references public.customers(id),
  order_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'ativa' check (status in ('ativa','cancelada','concluida')),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
-- Garante no banco que um equipamento não seja reservado simultaneamente (inclusive sob concorrência).
alter table public.equipment_reservations add constraint ex_equipment_reservation exclude using gist
  (equipment_id with =, tstzrange(starts_at, coalesce(ends_at, 'infinity'::timestamptz)) with &&) where (status = 'ativa');

create table public.maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id),
  kind text not null check (kind in ('manutencao_preventiva','assepsia','inspecao')),
  interval_days int not null check (interval_days > 0),
  next_date date not null,
  active boolean not null default true,
  unique (equipment_id, kind)
);

-- ---------------------------------------------------------------------------
-- Serviços e ordens de serviço
-- ---------------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  category text not null default 'manutencao' check (category in ('instalacao','assepsia','manutencao_preventiva','manutencao_corretiva','troca_componente','visita_tecnica','deslocamento','retirada','recolhimento','outro')),
  default_price numeric(14,2) not null default 0,
  cost numeric(14,2) not null default 0,
  estimated_minutes int,
  periodicity_days int,
  materials text,
  checklist jsonb not null default '[]'::jsonb,
  free_for_fixed_points boolean not null default false,
  free_conditions text,
  active boolean not null default true
);

create table public.service_orders (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  customer_id uuid references public.customers(id),
  equipment_id uuid references public.equipment(id),
  service_id uuid references public.services(id),
  technician_id uuid references public.profiles(id),
  scheduled_date date, scheduled_time time,
  reason text,
  priority text not null default 'normal' check (priority in ('baixa','normal','alta','urgente')),
  diagnosis text,
  checklist jsonb not null default '[]'::jsonb,
  work_done text,
  cost numeric(14,2) not null default 0,
  charged_amount numeric(14,2) not null default 0,
  is_free boolean not null default false,
  customer_acceptance text,
  notes text,
  status text not null default 'aberta' check (status in ('aberta','agendada','em_execucao','concluida','cancelada')),
  completed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_so_updated before update on public.service_orders for each row execute function public.set_updated_at();
select public.attach_audit('public.service_orders');

create table public.service_order_items (
  id uuid primary key default gen_random_uuid(),
  service_order_id uuid not null references public.service_orders(id),
  stock_item_id uuid not null references public.stock_items(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,4) not null default 0
);

-- ---------------------------------------------------------------------------
-- Parceiros
-- ---------------------------------------------------------------------------
create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  document text, phone text, whatsapp text, email text,
  percent_event numeric(6,2) not null default 0,
  percent_fixed numeric(6,2) not null default 0,
  fixed_per_order numeric(14,2) not null default 0,
  eligibility text not null default 'entregue' check (eligibility in ('confirmado','entregue','recebido')),
  offset_debt boolean not null default true,
  opening_debt numeric(14,2) not null default 0,
  meeting_frequency_days int default 15,
  notes text,
  status text not null default 'ativo' check (status in ('ativo','inativo','arquivado')),
  created_at timestamptz not null default now()
);
select public.attach_audit('public.partners');

-- ---------------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  kind text not null check (kind in ('evento','ponto_fixo','avulso','recorrente')),
  customer_id uuid not null references public.customers(id),
  seller_id uuid references public.profiles(id),
  partner_id uuid references public.partners(id),
  operational_owner_id uuid references public.profiles(id),
  campaign_id uuid,
  status text not null default 'orcamento' check (status in ('orcamento','aguardando_confirmacao','confirmado','em_preparacao','aguardando_entrega','em_rota','entregue','aguardando_recolhimento','finalizado','cancelado')),
  order_date date not null default public.today_sp(),
  delivery_date date, delivery_time time,
  pickup_date date,
  delivery_address text,
  payment_method text,
  installments int not null default 1 check (installments between 1 and 24),
  first_due_date date,
  discount numeric(14,2) not null default 0 check (discount >= 0),
  freight numeric(14,2) not null default 0 check (freight >= 0),
  subtotal numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  total_cost numeric(14,2) not null default 0,
  total_liters numeric(12,2) not null default 0,
  margin_percent numeric(8,2),
  margin_approved_by uuid references public.profiles(id),
  margin_justification text,
  equipment_needed text,
  source_order_id uuid references public.orders(id),
  notes text,
  confirmed_at timestamptz,
  cancelled_at timestamptz, cancel_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_orders_customer on public.orders (customer_id, order_date desc);
create index ix_orders_status on public.orders (status);
create index ix_orders_date on public.orders (order_date);
create trigger trg_orders_updated before update on public.orders for each row execute function public.set_updated_at();
select public.attach_audit('public.orders');

-- Itens guardam SNAPSHOT do preço/custo — alterações futuras de preço não afetam pedidos antigos.
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  product_id uuid not null references public.products(id),
  keg_size_id uuid references public.keg_sizes(id),
  quantity numeric(12,3) not null check (quantity > 0),
  liters_per_unit numeric(8,2) not null default 1,
  unit_price numeric(14,2) not null check (unit_price >= 0),
  price_per_liter numeric(14,4),
  price_source text,
  unit_cost numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) generated always as (round(quantity * unit_price, 2) - discount) stored,
  total_cost numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored,
  liters numeric(12,2) generated always as (quantity * liters_per_unit) stored
);
create index ix_order_items_order on public.order_items (order_id);

create or replace function public.recalc_order_totals(p_order uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update orders o set
    subtotal = coalesce(s.subtotal, 0),
    total_cost = coalesce(s.cost, 0),
    total_liters = coalesce(s.liters, 0),
    total = coalesce(s.subtotal, 0) - o.discount + o.freight,
    margin_percent = case when coalesce(s.subtotal, 0) - o.discount + o.freight > 0
      then round((coalesce(s.subtotal,0) - o.discount - coalesce(s.cost,0)) / (coalesce(s.subtotal,0) - o.discount + o.freight) * 100, 2) end
  from (select sum(total) subtotal, sum(total_cost) cost, sum(liters) liters from order_items where order_id = p_order) s
  where o.id = p_order;
end $$;

create or replace function public.order_items_changed() returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from orders where id = coalesce(new.order_id, old.order_id);
  if v_status not in ('orcamento','aguardando_confirmacao') then
    raise exception 'Itens só podem ser alterados antes da confirmação do pedido' using errcode = 'P0001';
  end if;
  perform recalc_order_totals(coalesce(new.order_id, old.order_id));
  return coalesce(new, old);
end $$;
create trigger trg_order_items_changed after insert or update or delete on public.order_items
  for each row execute function public.order_items_changed();

create or replace function public.orders_discount_changed() returns trigger language plpgsql as $$
begin
  if new.discount is distinct from old.discount or new.freight is distinct from old.freight then
    perform public.recalc_order_totals(new.id);
  end if;
  return null;
end $$;
create trigger trg_orders_discount after update of discount, freight on public.orders for each row execute function public.orders_discount_changed();

create table public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id),
  from_status text, to_status text not null,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now(),
  notes text
);
create index ix_order_status_history on public.order_status_history (order_id, changed_at);

alter table public.stock_reservations add constraint fk_res_order foreign key (order_id) references public.orders(id);
alter table public.equipment_reservations add constraint fk_eqres_order foreign key (order_id) references public.orders(id);
alter table public.equipment_movements add constraint fk_eqmov_order foreign key (order_id) references public.orders(id);
alter table public.equipment_movements add constraint fk_eqmov_so foreign key (service_order_id) references public.service_orders(id);

-- ---------------------------------------------------------------------------
-- Logística
-- ---------------------------------------------------------------------------
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  plate text not null unique,
  model text, capacity text,
  odometer_km numeric(12,1),
  active boolean not null default true
);

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('entrega','recolhimento','instalacao','retirada','visita')),
  order_id uuid references public.orders(id),
  service_order_id uuid references public.service_orders(id),
  customer_id uuid references public.customers(id),
  scheduled_date date not null,
  scheduled_time time,
  address text, city text, region text,
  driver_id uuid references public.profiles(id),
  vehicle_id uuid references public.vehicles(id),
  full_kegs int not null default 0, empty_kegs int not null default 0, cylinders int not null default 0,
  equipment_ids uuid[] not null default '{}',
  distance_km numeric(10,1), fuel_cost numeric(14,2), travel_cost numeric(14,2),
  status text not null default 'programada' check (status in ('programada','em_rota','concluida','tentativa_falha','cancelada')),
  departed_at timestamptz, arrived_at timestamptz, completed_at timestamptz,
  receiver_name text,
  occurrence text,
  notes text,
  created_at timestamptz not null default now()
);
create unique index ux_delivery_order_kind on public.deliveries (order_id, kind) where order_id is not null and status <> 'cancelada';
create index ix_deliveries_date on public.deliveries (scheduled_date);

-- ---------------------------------------------------------------------------
-- Compras
-- ---------------------------------------------------------------------------
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  supplier_id uuid references public.suppliers(id),
  status text not null default 'solicitada' check (status in ('solicitada','cotacao','aprovada','pedido_enviado','recebida_parcial','recebida','cancelada')),
  requested_by uuid default auth.uid(),
  approved_by uuid references public.profiles(id),
  expected_date date,
  payment_terms text,
  due_date date,
  total numeric(14,2) not null default 0,
  notes text,
  divergences text,
  created_at timestamptz not null default now()
);
create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id),
  stock_item_id uuid not null references public.stock_items(id),
  quantity numeric(14,3) not null check (quantity > 0),
  received_quantity numeric(14,3) not null default 0,
  unit_cost numeric(14,4) not null default 0,
  lot_code text, expires_at date
);
create table public.purchase_quotes (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id),
  supplier_id uuid not null references public.suppliers(id),
  total numeric(14,2) not null,
  lead_time_days int,
  notes text,
  selected boolean not null default false
);

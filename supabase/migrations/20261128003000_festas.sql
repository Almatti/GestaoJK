-- Módulo FESTAS: eventos com cadastro próprio (sem vínculo com clientes), integrados somente ao financeiro.
-- Regras: valor só é recebido após confirmação (payments.verified); pagamentos confirmados nunca são apagados
-- (estorno + nova versão); operações multi-tabela são funções transacionais e idempotentes.

-- ---------------------------------------------------------------------------
-- 1) Parâmetros e catálogo financeiro
-- ---------------------------------------------------------------------------
insert into public.settings (key, value, description) values
  ('festas.alert_days', '[3,2,0]', 'Dias antes da festa para lembretes (0 = no dia do evento)'),
  ('festas.unchecked_window_days', '7', 'Janela (dias) para avisar produtos ainda não conferidos')
on conflict (key) do nothing;

insert into public.financial_categories (name, direction, dre_group)
values ('Festas', 'receita', 'receita_produtos')
on conflict (name, direction) do nothing;

create sequence if not exists public.festa_code_seq;

-- ---------------------------------------------------------------------------
-- 2) Tabelas
-- ---------------------------------------------------------------------------
create table public.festa_events (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('FST-' || lpad(nextval('public.festa_code_seq')::text, 5, '0')),
  client_name text,
  client_phone text,
  event_name text,
  event_date date,
  event_time time,
  address text,
  notes text,
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  surcharge_amount numeric(14,2) not null default 0 check (surcharge_amount >= 0),
  ops_status text not null default 'agendado' check (ops_status in ('agendado','em_preparacao','pronto_entrega','entregue','finalizado','cancelado')),
  cancelled_reason text,
  source_sha256 text unique,                 -- impede importar o mesmo PDF duas vezes
  source_file_name text,
  source_extraction jsonb,                   -- o que foi lido do PDF (auditoria da importação)
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index ix_festa_events_date on public.festa_events (event_date);

create table public.festa_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.festa_events(id),
  position int not null default 1,
  product_name text,
  unit text not null default 'barril' check (unit in ('barril','unidade','litro','outro')),
  keg_liters numeric(8,2) check (keg_liters is null or keg_liters > 0),
  quantity numeric(12,3) not null default 0 check (quantity >= 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  surcharge_amount numeric(14,2) not null default 0 check (surcharge_amount >= 0),
  line_total numeric(14,2) generated always as (greatest(quantity * unit_price - discount_amount + surcharge_amount, 0)) stored,
  purchased_qty numeric(12,3) not null default 0 check (purchased_qty >= 0),
  separated_at timestamptz,
  checked_at timestamptz,
  purchased_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index ix_festa_items_event on public.festa_items (event_id);

-- Pagamentos previstos (plano) e confirmados. "previsto" NÃO é recebido.
create table public.festa_payments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.festa_events(id),
  kind text not null default 'parcela' check (kind in ('entrada','parcela','saldo','outro')),
  description text,
  amount numeric(14,2) not null check (amount > 0),
  due_date date,
  method text check (method in ('pix','boleto','dinheiro','cartao_credito','cartao_debito','transferencia','cheque','outro')),
  status text not null default 'previsto' check (status in ('previsto','confirmado','estornado','cancelado')),
  confirmed_at date,
  payment_id uuid references public.payments(id),
  account_id uuid references public.financial_accounts(id),
  version int not null default 1,
  notes text,
  cancel_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_festa_payments_event on public.festa_payments (event_id);
create index ix_festa_payments_due on public.festa_payments (due_date) where status = 'previsto';

-- ---------------------------------------------------------------------------
-- 3) Integração financeira: título (conta a receber) sem cliente do CRM
-- ---------------------------------------------------------------------------
alter table public.receivables alter column customer_id drop not null;
alter table public.receivables add column festa_event_id uuid references public.festa_events(id);
alter table public.receivables add constraint receivables_owner_check check (customer_id is not null or festa_event_id is not null);
create unique index ux_receivable_festa on public.receivables (festa_event_id)
  where festa_event_id is not null and status not in ('cancelado','renegociado');

-- Recebimento de festa só pode ser registrado pela tela Festas (com confirmação). Demais campos inalterados.
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
  if r.festa_event_id is not null and coalesce(p_idempotency_key, '') not like 'festa-pay:%' then
    raise exception 'Recebimento de festa deve ser registrado na tela Festas' using errcode = 'P0001';
  end if;
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
    update protest_records set status = 'nao_encaminhado', notes = 'Pagamento recebido antes do encaminhamento'
     where receivable_id = r.id and status = 'programado';
  end if;
  if r.customer_id is not null then
    insert into customer_interactions (customer_id, kind, summary)
    values (r.customer_id, 'sistema', format('Pagamento de R$ %s via %s registrado (%s).', p_amount, p_method, r.description));
  end if;
  return jsonb_build_object('payment_id', pay_id, 'status', new_status, 'outstanding', r.amount - new_paid);
end $$;

-- ---------------------------------------------------------------------------
-- 4) Views
-- ---------------------------------------------------------------------------
-- Recebíveis: passam a aceitar títulos sem cliente do CRM (origem Festas). Demais colunas inalteradas.
drop view if exists public.receivables_view;
create view public.receivables_view with (security_invoker = true) as
select r.*, coalesce(c.name, fe.client_name) as customer_name, c.trade_name as customer_trade_name,
  c.whatsapp as customer_whatsapp, c.phone as customer_phone,
  greatest(r.amount - r.paid_amount, 0) as outstanding,
  case
    when r.status in ('cancelado','renegociado','pago') then r.status
    when r.due_date < public.today_sp() then case when r.paid_amount > 0 then 'parcialmente_pago' else 'vencido' end
    when r.paid_amount > 0 then 'parcialmente_pago'
    when r.due_date <= public.today_sp() + coalesce((select (value)::text::int from public.settings where key = 'finance.due_soon_days'), 7) then 'a_vencer'
    else 'em_aberto' end as financial_status,
  greatest(public.today_sp() - r.due_date, 0) as days_overdue,
  case when r.festa_event_id is not null then 'festas' else 'manual' end as origin
from public.receivables r
left join public.customers c on c.id = r.customer_id
left join public.festa_events fe on fe.id = r.festa_event_id;

-- Valor já recebido de uma festa (confirmado). Função segura: não expõe títulos fora da festa.
create or replace function public.festa_received(p_event uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(r.paid_amount), 0) from receivables r
   where r.festa_event_id = p_event and r.status <> 'cancelado';
$$;

create or replace view public.festa_events_view with (security_invoker = true) as
select e.*, x.total, x.received, greatest(x.total - x.received, 0) as outstanding,
  x.items_count, x.unchecked_count, x.scheduled_pending, x.due_balance_date,
  case
    when e.ops_status = 'cancelado' then 'cancelado'
    when x.total > 0 and greatest(x.total - x.received, 0) <= 0 then 'pago'
    when x.due_balance_date < public.today_sp() and greatest(x.total - x.received, 0) > 0 then 'vencido'
    when x.received > 0 then 'parcialmente_pago'
    else 'pendente'
  end as financial_status,
  greatest(public.today_sp() - x.due_balance_date, 0) as days_overdue
from public.festa_events e
cross join lateral (
  select
    greatest(coalesce((select sum(i.line_total) from public.festa_items i where i.event_id = e.id and i.archived_at is null), 0)
             - e.discount_amount + e.surcharge_amount, 0) as total,
    public.festa_received(e.id) as received,
    (select count(*) from public.festa_items i where i.event_id = e.id and i.archived_at is null) as items_count,
    (select count(*) from public.festa_items i where i.event_id = e.id and i.archived_at is null and i.checked_at is null) as unchecked_count,
    coalesce((select sum(p.amount) from public.festa_payments p where p.event_id = e.id and p.status = 'previsto'), 0) as scheduled_pending,
    coalesce((select max(p.due_date) from public.festa_payments p where p.event_id = e.id and p.status = 'previsto'), e.event_date, public.today_sp()) as due_balance_date
) x
where e.archived_at is null;

-- ---------------------------------------------------------------------------
-- 5) Funções transacionais
-- ---------------------------------------------------------------------------
-- Cria/edita a festa com itens e pagamentos previstos e sincroniza o título financeiro.
create or replace function public.festa_save(p_id uuid, p_event jsonb, p_items jsonb default '[]'::jsonb, p_payments jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e festa_events; v_id uuid := p_id; it jsonb; pay jsonb; fp festa_payments; v_ord int := 0; iid uuid; pid uuid;
  v_items uuid[] := '{}'; v_pays uuid[] := '{}'; v_sha text; v_total numeric; v_received numeric; v_due date;
  v_rec receivables; v_cat uuid; v_desc text; v_scheduled numeric;
begin
  if not has_perm('festas', case when p_id is null then 'create' else 'edit' end) then
    raise exception 'Permissão negada: festas' using errcode = '42501';
  end if;
  if p_event is null or jsonb_typeof(p_event) <> 'object' then raise exception 'Dados da festa inválidos' using errcode = '22023'; end if;
  v_sha := nullif(p_event->>'source_sha256', '');
  if v_sha is not null and exists (select 1 from festa_events where source_sha256 = v_sha and id is distinct from p_id) then
    raise exception 'Este PDF já foi importado: o pedido já está cadastrado' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into festa_events (client_name, client_phone, event_name, event_date, event_time, address, notes,
                              discount_amount, surcharge_amount, source_sha256, source_file_name, source_extraction)
    values (nullif(trim(p_event->>'client_name'), ''), nullif(trim(p_event->>'client_phone'), ''), nullif(trim(p_event->>'event_name'), ''),
            nullif(p_event->>'event_date', '')::date, nullif(p_event->>'event_time', '')::time, nullif(trim(p_event->>'address'), ''),
            nullif(trim(p_event->>'notes'), ''), coalesce(nullif(p_event->>'discount_amount', '')::numeric, 0),
            coalesce(nullif(p_event->>'surcharge_amount', '')::numeric, 0), v_sha, nullif(p_event->>'source_file_name', ''), p_event->'source_extraction')
    returning * into e;
    v_id := e.id;
  else
    select * into e from festa_events where id = p_id for update;
    if not found then raise exception 'Festa não encontrada' using errcode = 'P0002'; end if;
    if e.ops_status = 'cancelado' then raise exception 'Festa cancelada não pode ser editada' using errcode = 'P0001'; end if;
    update festa_events set client_name = nullif(trim(p_event->>'client_name'), ''), client_phone = nullif(trim(p_event->>'client_phone'), ''),
           event_name = nullif(trim(p_event->>'event_name'), ''), event_date = nullif(p_event->>'event_date', '')::date,
           event_time = nullif(p_event->>'event_time', '')::time, address = nullif(trim(p_event->>'address'), ''),
           notes = nullif(trim(p_event->>'notes'), ''), discount_amount = coalesce(nullif(p_event->>'discount_amount', '')::numeric, 0),
           surcharge_amount = coalesce(nullif(p_event->>'surcharge_amount', '')::numeric, 0)
     where id = p_id;
  end if;

  -- Itens: atualiza os existentes, cria os novos e arquiva (nunca apaga) os removidos.
  for it in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) value loop
    v_ord := v_ord + 1;
    if nullif(it->>'id', '') is not null and exists (select 1 from festa_items where id = (it->>'id')::uuid and event_id = v_id) then
      update festa_items set position = v_ord, product_name = nullif(trim(it->>'product_name'), ''),
             unit = coalesce(nullif(it->>'unit', ''), 'barril'), keg_liters = nullif(it->>'keg_liters', '')::numeric,
             quantity = coalesce(nullif(it->>'quantity', '')::numeric, 0), unit_price = coalesce(nullif(it->>'unit_price', '')::numeric, 0),
             discount_amount = coalesce(nullif(it->>'discount_amount', '')::numeric, 0),
             surcharge_amount = coalesce(nullif(it->>'surcharge_amount', '')::numeric, 0),
             notes = nullif(trim(it->>'notes'), ''), archived_at = null
       where id = (it->>'id')::uuid
       returning id into iid;
    else
      insert into festa_items (event_id, position, product_name, unit, keg_liters, quantity, unit_price, discount_amount, surcharge_amount, notes)
      values (v_id, v_ord, nullif(trim(it->>'product_name'), ''), coalesce(nullif(it->>'unit', ''), 'barril'), nullif(it->>'keg_liters', '')::numeric,
              coalesce(nullif(it->>'quantity', '')::numeric, 0), coalesce(nullif(it->>'unit_price', '')::numeric, 0),
              coalesce(nullif(it->>'discount_amount', '')::numeric, 0), coalesce(nullif(it->>'surcharge_amount', '')::numeric, 0),
              nullif(trim(it->>'notes'), ''))
      returning id into iid;
    end if;
    v_items := array_append(v_items, iid);
  end loop;
  update festa_items set archived_at = now() where event_id = v_id and archived_at is null and not (id = any(v_items));

  -- Pagamentos previstos: cria/atualiza. Confirmados e estornados NUNCA são alterados aqui.
  for pay in select value from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) value loop
    fp := null;
    if nullif(pay->>'id', '') is not null then
      select * into fp from festa_payments where id = (pay->>'id')::uuid and event_id = v_id;
    end if;
    if fp.id is not null then
      if fp.status = 'previsto' then
        update festa_payments set kind = coalesce(nullif(pay->>'kind', ''), kind), description = nullif(trim(pay->>'description'), ''),
               amount = (pay->>'amount')::numeric, due_date = nullif(pay->>'due_date', '')::date,
               method = nullif(pay->>'method', ''), notes = nullif(trim(pay->>'notes'), '')
         where id = fp.id;
      end if;
      v_pays := array_append(v_pays, fp.id);
    else
      insert into festa_payments (event_id, kind, description, amount, due_date, method, notes)
      values (v_id, coalesce(nullif(pay->>'kind', ''), 'parcela'), nullif(trim(pay->>'description'), ''), (pay->>'amount')::numeric,
              nullif(pay->>'due_date', '')::date, nullif(pay->>'method', ''), nullif(trim(pay->>'notes'), ''))
      returning id into pid;
      v_pays := array_append(v_pays, pid);
    end if;
  end loop;
  update festa_payments set status = 'cancelado', cancel_reason = 'Removido do plano de pagamento'
   where event_id = v_id and status = 'previsto' and not (id = any(v_pays));

  -- Totais e sincronização com o financeiro.
  select * into e from festa_events where id = v_id;
  v_total := greatest(coalesce((select sum(line_total) from festa_items where event_id = v_id and archived_at is null), 0) - e.discount_amount + e.surcharge_amount, 0);
  v_received := festa_received(v_id);
  v_scheduled := coalesce((select sum(amount) from festa_payments where event_id = v_id and status = 'previsto'), 0);
  if v_total < v_received then
    raise exception 'O total ficou menor que o valor já recebido (R$ %). Estorne os pagamentos antes de reduzir o total.', v_received using errcode = 'P0001';
  end if;
  if v_received + v_scheduled > v_total then
    raise exception 'A soma dos pagamentos (R$ %) excede o total da festa (R$ %)', v_received + v_scheduled, v_total using errcode = 'P0001';
  end if;
  v_due := coalesce((select max(due_date) from festa_payments where event_id = v_id and status = 'previsto'), e.event_date, public.today_sp());
  v_desc := 'Festa ' || e.code || ': ' || coalesce(e.event_name, 'sem nome') || coalesce(' — ' || e.client_name, '');
  select id into v_cat from financial_categories where name = 'Festas' and direction = 'receita';
  select * into v_rec from receivables where festa_event_id = v_id and status not in ('cancelado','renegociado') for update;

  if v_total > 0 then
    if v_rec.id is not null then
      update receivables set amount = v_total, due_date = v_due, description = v_desc, category_id = v_cat,
             competence_date = coalesce(e.event_date, competence_date)
       where id = v_rec.id;
    else
      insert into receivables (festa_event_id, description, category_id, competence_date, issue_date, due_date, amount, notes)
      values (v_id, v_desc, v_cat, coalesce(e.event_date, public.today_sp()), public.today_sp(), v_due, v_total, 'Origem: módulo Festas')
      returning * into v_rec;
    end if;
  elsif v_rec.id is not null then
    if v_rec.paid_amount > 0 then raise exception 'Total zerado com valores já recebidos' using errcode = 'P0001'; end if;
    update receivables set status = 'cancelado' where id = v_rec.id;
  end if;

  return jsonb_build_object('id', v_id, 'code', e.code, 'total', v_total, 'received', v_received,
                            'receivable_id', case when v_total > 0 then v_rec.id end);
end $$;

-- Confirma um pagamento previsto: só então entra como recebido (registro no financeiro, sem duplicar).
create or replace function public.festa_payment_confirm(p_payment uuid, p_paid_at date, p_method text, p_account uuid default null,
  p_external_ref text default null, p_notes text default null, p_verified boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare fp festa_payments; ev festa_events; rec receivables; res jsonb;
begin
  if not (has_perm('festas','edit') and (has_perm('financeiro','create') or has_perm('cobranca','edit'))) then
    raise exception 'Permissão negada: confirmar recebimento de festa' using errcode = '42501';
  end if;
  if not coalesce(p_verified, false) then
    raise exception 'Confirme que o valor entrou na conta (conferido no extrato ou no banco) antes de registrar como recebido' using errcode = 'P0001';
  end if;
  select * into fp from festa_payments where id = p_payment for update;
  if not found then raise exception 'Pagamento não encontrado' using errcode = 'P0002'; end if;
  if fp.status <> 'previsto' then raise exception 'Somente pagamentos previstos podem ser confirmados (status atual: %)', fp.status using errcode = 'P0001'; end if;
  select * into ev from festa_events where id = fp.event_id;
  if ev.ops_status = 'cancelado' then raise exception 'Festa cancelada' using errcode = 'P0001'; end if;
  select * into rec from receivables where festa_event_id = fp.event_id and status not in ('cancelado','renegociado') for update;
  if rec.id is null then raise exception 'Festa sem valor total: informe os produtos antes de receber' using errcode = 'P0001'; end if;
  if p_method is null then raise exception 'Informe a forma de pagamento' using errcode = '22023'; end if;
  if fp.amount > greatest(rec.amount - rec.paid_amount, 0) then
    raise exception 'Valor (R$ %) maior que o saldo devedor da festa', fp.amount using errcode = 'P0001';
  end if;
  res := public.register_receipt(rec.id, fp.amount, p_method, p_paid_at, p_account, p_external_ref, true, p_notes,
                                 'festa-pay:' || fp.id::text || ':v' || fp.version, 0, 0);
  update festa_payments set status = 'confirmado', confirmed_at = p_paid_at, method = p_method, account_id = p_account,
         payment_id = (res->>'payment_id')::uuid
   where id = fp.id;
  return res || jsonb_build_object('festa_payment_id', fp.id);
end $$;

-- Corrige um pagamento já confirmado: estorna o lançamento anterior e confirma de novo (nova versão, sem duplicar).
create or replace function public.festa_payment_correct(p_payment uuid, p_amount numeric, p_paid_at date, p_method text,
  p_account uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare fp festa_payments; res jsonb;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo da correção' using errcode = '22023'; end if;
  if not (has_perm('festas','edit') and has_perm('financeiro','cancel') and has_perm('financeiro','create')) then
    raise exception 'Permissão negada: corrigir pagamento confirmado' using errcode = '42501';
  end if;
  select * into fp from festa_payments where id = p_payment for update;
  if not found or fp.status <> 'confirmado' then raise exception 'Somente pagamentos confirmados podem ser corrigidos' using errcode = 'P0001'; end if;
  perform public.reverse_payment(fp.payment_id, 'Correção de pagamento de festa: ' || p_reason);
  update festa_payments set status = 'previsto', payment_id = null, confirmed_at = null, version = version + 1,
         amount = coalesce(p_amount, amount), method = coalesce(p_method, method)
   where id = fp.id;
  res := public.festa_payment_confirm(fp.id, coalesce(p_paid_at, fp.confirmed_at, public.today_sp()), coalesce(p_method, fp.method), p_account,
                                      null, 'Correção: ' || p_reason, true);
  return res;
end $$;

-- Estorna (confirmado) ou cancela (previsto) um pagamento. Nada é apagado.
create or replace function public.festa_payment_cancel(p_payment uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare fp festa_payments;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo' using errcode = '22023'; end if;
  if not has_perm('festas','edit') then raise exception 'Permissão negada: festas' using errcode = '42501'; end if;
  select * into fp from festa_payments where id = p_payment for update;
  if not found then raise exception 'Pagamento não encontrado' using errcode = 'P0002'; end if;
  if fp.status = 'previsto' then
    update festa_payments set status = 'cancelado', cancel_reason = p_reason where id = fp.id;
    return jsonb_build_object('status', 'cancelado');
  elsif fp.status = 'confirmado' then
    if not has_perm('financeiro','cancel') then raise exception 'Permissão negada: estornar recebimento' using errcode = '42501'; end if;
    perform public.reverse_payment(fp.payment_id, 'Estorno de pagamento de festa: ' || p_reason);
    update festa_payments set status = 'estornado', cancel_reason = p_reason where id = fp.id;
    return jsonb_build_object('status', 'estornado');
  end if;
  raise exception 'Pagamento já cancelado ou estornado' using errcode = 'P0001';
end $$;

-- Inclui um pagamento previsto (plano) respeitando o total da festa.
create or replace function public.festa_payment_add(p_event uuid, p_kind text, p_description text, p_amount numeric, p_due date, p_method text, p_notes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare ev festa_events; total numeric; committed numeric; pid uuid;
begin
  if not has_perm('festas','edit') then raise exception 'Permissão negada: festas' using errcode = '42501'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Valor do pagamento deve ser positivo' using errcode = '22023'; end if;
  select * into ev from festa_events where id = p_event for update;
  if not found then raise exception 'Festa não encontrada' using errcode = 'P0002'; end if;
  if ev.ops_status = 'cancelado' then raise exception 'Festa cancelada' using errcode = 'P0001'; end if;
  total := greatest(coalesce((select sum(line_total) from festa_items where event_id = p_event and archived_at is null), 0) - ev.discount_amount + ev.surcharge_amount, 0);
  committed := festa_received(p_event) + coalesce((select sum(amount) from festa_payments where event_id = p_event and status = 'previsto'), 0);
  if committed + p_amount > total then
    raise exception 'A soma dos pagamentos excede o total da festa (R$ %)', total using errcode = 'P0001';
  end if;
  insert into festa_payments (event_id, kind, description, amount, due_date, method, notes)
  values (p_event, coalesce(nullif(p_kind, ''), 'parcela'), nullif(trim(p_description), ''), p_amount, p_due, nullif(p_method, ''), nullif(trim(p_notes), ''))
  returning id into pid;
  return pid;
end $$;

-- Altera um pagamento previsto (confirmados usam festa_payment_correct).
create or replace function public.festa_payment_update(p_payment uuid, p_kind text, p_description text, p_amount numeric, p_due date, p_method text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare fp festa_payments;
begin
  if not has_perm('festas','edit') then raise exception 'Permissão negada: festas' using errcode = '42501'; end if;
  select * into fp from festa_payments where id = p_payment for update;
  if not found then raise exception 'Pagamento não encontrado' using errcode = 'P0002'; end if;
  if fp.status <> 'previsto' then raise exception 'Somente pagamentos previstos podem ser alterados' using errcode = 'P0001'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Valor do pagamento deve ser positivo' using errcode = '22023'; end if;
  update festa_payments set kind = coalesce(nullif(p_kind, ''), kind), description = nullif(trim(p_description), ''), amount = p_amount,
         due_date = p_due, method = nullif(p_method, ''), notes = nullif(trim(p_notes), '')
   where id = fp.id;
end $$;

-- Altera o status operacional (exceto cancelamento, que tem regra própria).
create or replace function public.festa_set_ops_status(p_event uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('festas','edit') then raise exception 'Permissão negada: festas' using errcode = '42501'; end if;
  if p_status = 'cancelado' then raise exception 'Use o cancelamento da festa' using errcode = '22023'; end if;
  update festa_events set ops_status = p_status where id = p_event and ops_status <> 'cancelado' and archived_at is null;
  if not found then raise exception 'Festa cancelada ou inexistente' using errcode = 'P0001'; end if;
end $$;

-- Cancela a festa (exige motivo). Bloqueado enquanto houver pagamento confirmado: estorne antes.
create or replace function public.festa_cancel_event(p_event uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ev festa_events;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo do cancelamento' using errcode = '22023'; end if;
  if not has_perm('festas','cancel') then raise exception 'Permissão negada: cancelar festa' using errcode = '42501'; end if;
  select * into ev from festa_events where id = p_event for update;
  if not found then raise exception 'Festa não encontrada' using errcode = 'P0002'; end if;
  if ev.ops_status = 'cancelado' then return jsonb_build_object('status', 'cancelado', 'already', true); end if;
  if exists (select 1 from festa_payments where event_id = p_event and status = 'confirmado') then
    raise exception 'Estorne os pagamentos confirmados antes de cancelar a festa' using errcode = 'P0001';
  end if;
  update festa_events set ops_status = 'cancelado', cancelled_reason = p_reason where id = p_event;
  update festa_payments set status = 'cancelado', cancel_reason = 'Festa cancelada' where event_id = p_event and status = 'previsto';
  update receivables set status = 'cancelado' where festa_event_id = p_event and status in ('em_aberto','parcialmente_pago') and paid_amount = 0;
  return jsonb_build_object('status', 'cancelado');
end $$;

-- Consolidação para compras e checklist: itens de festas no período (respeita RLS do usuário).
create or replace function public.festa_planning(p_from date, p_to date)
returns table (item_id uuid, event_id uuid, event_code text, event_name text, client_name text, event_date date, event_time time,
               product_name text, unit text, keg_liters numeric, quantity numeric, purchased_qty numeric,
               separated_at timestamptz, checked_at timestamptz, purchased_at timestamptz, line_total numeric)
language sql stable security invoker set search_path = public as $$
  select i.id, e.id, e.code, e.event_name, e.client_name, e.event_date, e.event_time, i.product_name, i.unit, i.keg_liters,
         i.quantity, i.purchased_qty, i.separated_at, i.checked_at, i.purchased_at, i.line_total
    from festa_items i join festa_events e on e.id = i.event_id
   where i.archived_at is null and e.archived_at is null and e.ops_status <> 'cancelado'
     and e.event_date between p_from and p_to
   order by e.event_date, e.event_time nulls last, i.position;
$$;

-- Alertas automáticos (idempotentes por dedup_key). Executado diariamente pelo pg_cron.
create or replace function public.festa_generate_alerts(p_ref date default public.today_sp())
returns int language plpgsql security definer set search_path = public as $$
declare d int; n int := 0; c int; r record; win int; days jsonb;
begin
  days := coalesce((select value from settings where key = 'festas.alert_days'), '[3,2,0]'::jsonb);
  win := coalesce((select (value #>> '{}')::int from settings where key = 'festas.unchecked_window_days'), 7);

  -- Festas agendadas nos dias configurados
  for d in select value::int from jsonb_array_elements_text(days) value loop
    for r in select e.* from festa_events e
              where e.event_date = p_ref + d and e.ops_status not in ('cancelado','finalizado') and e.archived_at is null loop
      insert into notifications (category, priority, title, body, link, ref_type, ref_id, target_resource, dedup_key)
      values ('operacional', case when d = 0 then 'alta' else 'normal' end,
              format('Festa %s: %s', case when d = 0 then 'hoje' when d = 1 then 'amanhã' else 'em ' || d || ' dias' end, coalesce(r.event_name, r.code)),
              format('%s · %s · %s', coalesce(r.client_name, 'cliente não informado'),
                     coalesce(left(r.event_time::text, 5), 'horário não informado'), coalesce(r.address, 'endereço não informado')),
              '/festas/' || r.id, 'festa', r.id, 'festas', 'festa:' || r.id || ':lead:' || d)
      on conflict (dedup_key) do nothing;
      get diagnostics c = row_count; n := n + c;
    end loop;
  end loop;

  -- Pagamentos previstos que vencem hoje ou já venceram (aviso diário enquanto estiver em aberto)
  for r in select p.*, e.code, e.event_name, e.client_name from festa_payments p join festa_events e on e.id = p.event_id
            where p.status = 'previsto' and p.due_date is not null and p.due_date <= p_ref and e.ops_status <> 'cancelado' loop
    insert into notifications (category, priority, title, body, link, ref_type, ref_id, target_resource, dedup_key)
    values ('financeiro', case when r.due_date < p_ref then 'alta' else 'normal' end,
            case when r.due_date < p_ref then 'Pagamento de festa vencido' else 'Pagamento de festa vence hoje' end,
            format('%s · %s · R$ %s · vencimento %s', coalesce(r.event_name, r.code), coalesce(r.client_name, 'cliente não informado'),
                   replace(to_char(r.amount, 'FM999999990.00'), '.', ','), to_char(r.due_date, 'DD/MM/YYYY')),
            '/festas/' || r.event_id, 'festa', r.event_id, 'festas',
            case when r.due_date < p_ref then 'festa-pay:' || r.id || ':overdue:' || p_ref else 'festa-pay:' || r.id || ':due' end)
    on conflict (dedup_key) do nothing;
    get diagnostics c = row_count; n := n + c;
  end loop;

  -- Produtos ainda não conferidos em festas próximas (1 aviso por semana)
  for r in select e.id, e.code, e.event_name, count(*) as pending from festa_events e
            join festa_items i on i.event_id = e.id and i.archived_at is null and i.checked_at is null
            where e.ops_status not in ('cancelado','finalizado','entregue') and e.archived_at is null
              and e.event_date between p_ref and p_ref + win
            group by e.id, e.code, e.event_name loop
    insert into notifications (category, priority, title, body, link, ref_type, ref_id, target_resource, dedup_key)
    values ('operacional', 'normal', 'Produtos não conferidos: ' || coalesce(r.event_name, r.code),
            r.pending || ' item(ns) da festa ainda sem conferência.', '/festas/' || r.id, 'festa', r.id, 'festas',
            'festa:' || r.id || ':unchecked:' || to_char(p_ref, 'IYYY-IW'))
    on conflict (dedup_key) do nothing;
    get diagnostics c = row_count; n := n + c;
  end loop;

  -- Cadastro incompleto de festas futuras (1 aviso por festa)
  for r in select e.* from festa_events e
            where e.ops_status not in ('cancelado','finalizado') and e.archived_at is null and (e.event_date is null or e.event_date >= p_ref)
              and (nullif(trim(coalesce(e.client_name, '')), '') is null or nullif(trim(coalesce(e.client_phone, '')), '') is null
                   or nullif(trim(coalesce(e.event_name, '')), '') is null or e.event_date is null or e.event_time is null
                   or nullif(trim(coalesce(e.address, '')), '') is null) loop
    insert into notifications (category, priority, title, body, link, ref_type, ref_id, target_resource, dedup_key)
    values ('operacional', 'baixa', 'Cadastro de festa incompleto: ' || coalesce(r.event_name, r.code),
            'Faltam: ' || concat_ws(', ',
              case when nullif(trim(coalesce(r.client_name, '')), '') is null then 'nome do cliente' end,
              case when nullif(trim(coalesce(r.client_phone, '')), '') is null then 'telefone' end,
              case when nullif(trim(coalesce(r.event_name, '')), '') is null then 'nome do evento' end,
              case when r.event_date is null then 'data' end,
              case when r.event_time is null then 'horário' end,
              case when nullif(trim(coalesce(r.address, '')), '') is null then 'endereço' end),
            '/festas/' || r.id, 'festa', r.id, 'festas', 'festa:' || r.id || ':incomplete')
    on conflict (dedup_key) do nothing;
    get diagnostics c = row_count; n := n + c;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 6) Segurança: RLS, permissões, auditoria, grants
-- ---------------------------------------------------------------------------
insert into public.resource_tables (table_name, resource, allow_delete) values
  ('festa_events','festas',false), ('festa_items','festas',false), ('festa_payments','festas',false)
on conflict (table_name) do nothing;

alter table public.festa_events enable row level security;
alter table public.festa_items enable row level security;
alter table public.festa_payments enable row level security;
create policy p_select on public.festa_events for select to authenticated using (public.has_perm('festas','view'));
create policy p_insert on public.festa_events for insert to authenticated with check (public.has_perm('festas','create'));
create policy p_update on public.festa_events for update to authenticated using (public.has_perm('festas','edit')) with check (public.has_perm('festas','edit'));
create policy p_select on public.festa_items for select to authenticated using (public.has_perm('festas','view'));
create policy p_insert on public.festa_items for insert to authenticated with check (public.has_perm('festas','create'));
create policy p_update on public.festa_items for update to authenticated using (public.has_perm('festas','edit')) with check (public.has_perm('festas','edit'));
create policy p_select on public.festa_payments for select to authenticated using (public.has_perm('festas','view'));
create policy p_insert on public.festa_payments for insert to authenticated with check (public.has_perm('festas','create'));
create policy p_update on public.festa_payments for update to authenticated using (public.has_perm('festas','edit')) with check (public.has_perm('festas','edit'));

create trigger trg_festa_events_updated before update on public.festa_events for each row execute function public.set_updated_at();
create trigger trg_festa_items_updated before update on public.festa_items for each row execute function public.set_updated_at();
create trigger trg_festa_payments_updated before update on public.festa_payments for each row execute function public.set_updated_at();
select public.attach_audit('public.festa_events');
select public.attach_audit('public.festa_items');
select public.attach_audit('public.festa_payments');

-- Anexos da festa (PDF original) seguem a permissão do recurso festas.
create or replace function public.entity_resource(p_entity text) returns text language sql immutable as $$
  select case p_entity
    when 'customer' then 'clientes' when 'order' then 'pedidos' when 'receivable' then 'financeiro' when 'payable' then 'financeiro'
    when 'boleto' then 'cobranca' when 'protest' then 'cobranca' when 'payment' then 'financeiro'
    when 'equipment' then 'equipamentos' when 'service_order' then 'tecnico' when 'delivery' then 'logistica'
    when 'purchase' then 'estoque' when 'partner' then 'parceiros' when 'meeting' then 'organizacao' when 'task' then 'organizacao'
    when 'note' then 'organizacao' when 'marketing' then 'marketing' when 'product' then 'produtos'
    when 'festa' then 'festas'
    else 'admin' end
$$;

-- Permissões do recurso 'festas' (espelho de src/domain/permissions.ts)
insert into public.role_permissions (role, resource, action) values
  ('admin','festas','view'),('admin','festas','create'),('admin','festas','edit'),('admin','festas','approve'),('admin','festas','cancel'),('admin','festas','export'),('admin','festas','archive'),
  ('administrativo','festas','view'),('administrativo','festas','create'),('administrativo','festas','edit'),('administrativo','festas','archive'),('administrativo','festas','cancel'),('administrativo','festas','export'),
  ('financeiro','festas','view'),('financeiro','festas','create'),('financeiro','festas','edit'),('financeiro','festas','approve'),('financeiro','festas','cancel'),('financeiro','festas','export'),('financeiro','festas','archive'),
  ('comercial','festas','view'),('comercial','festas','create'),('comercial','festas','edit'),('comercial','festas','archive'),
  ('logistica','festas','view'),('logistica','festas','edit'),
  ('operacional','festas','view'),('operacional','festas','edit'),
  ('leitura','festas','view')
on conflict do nothing;

grant select, insert, update on public.festa_events, public.festa_items, public.festa_payments to authenticated;
grant select on public.receivables_view, public.festa_events_view to authenticated;
grant usage, select on sequence public.festa_code_seq to authenticated;

revoke execute on function public.festa_received(uuid) from public, anon;
revoke execute on function public.festa_save(uuid, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.festa_payment_confirm(uuid, date, text, uuid, text, text, boolean) from public, anon;
revoke execute on function public.festa_payment_correct(uuid, numeric, date, text, uuid, text) from public, anon;
revoke execute on function public.festa_payment_cancel(uuid, text) from public, anon;
revoke execute on function public.festa_payment_add(uuid, text, text, numeric, date, text, text) from public, anon;
revoke execute on function public.festa_payment_update(uuid, text, text, numeric, date, text, text) from public, anon;
revoke execute on function public.festa_set_ops_status(uuid, text) from public, anon;
revoke execute on function public.festa_cancel_event(uuid, text) from public, anon;
revoke execute on function public.festa_planning(date, date) from public, anon;
revoke execute on function public.festa_generate_alerts(date) from public, anon, authenticated;
grant execute on function public.festa_received(uuid) to authenticated;
grant execute on function public.festa_save(uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.festa_payment_confirm(uuid, date, text, uuid, text, text, boolean) to authenticated;
grant execute on function public.festa_payment_correct(uuid, numeric, date, text, uuid, text) to authenticated;
grant execute on function public.festa_payment_cancel(uuid, text) to authenticated;
grant execute on function public.festa_payment_add(uuid, text, text, numeric, date, text, text) to authenticated;
grant execute on function public.festa_payment_update(uuid, text, text, numeric, date, text, text) to authenticated;
grant execute on function public.festa_set_ops_status(uuid, text) to authenticated;
grant execute on function public.festa_cancel_event(uuid, text) to authenticated;
grant execute on function public.festa_planning(date, date) to authenticated;

-- Alertas diários (08:15 de Brasília), junto das automações.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('jk-festas-alerts', '15 11 * * *', 'select public.festa_generate_alerts()');
    exception when others then raise notice 'pg_cron indisponível: %', sqlerrm;
    end;
  end if;
end $$;

-- Financeiro: contas, categorias, centros de custo, recebíveis, pagáveis, pagamentos, boletos, Pix, protestos, cobrança.

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('banco','caixa','carteira_digital','outro')),
  bank_code text, agency text, account_number text,
  opening_balance numeric(14,2) not null default 0,
  opening_date date not null default public.today_sp(),
  active boolean not null default true
);

create table public.financial_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  direction text not null check (direction in ('receita','despesa')),
  dre_group text not null default 'outras' check (dre_group in
    ('receita_produtos','receita_servicos','deducoes','cmv','despesas_variaveis','despesas_fixas','despesas_financeiras','receitas_financeiras','investimentos','outras')),
  is_operational boolean not null default true,
  parent_id uuid references public.financial_categories(id),
  active boolean not null default true,
  unique (name, direction)
);
insert into public.financial_categories (name, direction, dre_group) values
  ('Venda de chopp','receita','receita_produtos'),('Venda de produtos','receita','receita_produtos'),
  ('Serviços técnicos','receita','receita_servicos'),('Juros e multas recebidos','receita','receitas_financeiras'),
  ('Tributos sobre vendas','despesa','deducoes'),('Compra de chopp','despesa','cmv'),
  ('Fretes e combustível','despesa','despesas_variaveis'),('Comissões','despesa','despesas_variaveis'),
  ('Taxas financeiras','despesa','despesas_financeiras'),('Manutenção','despesa','despesas_variaveis'),
  ('Aluguel','despesa','despesas_fixas'),('Salários e pró-labore','despesa','despesas_fixas'),
  ('Marketing','despesa','despesas_fixas'),('Impostos e taxas','despesa','despesas_fixas'),
  ('Serviços de terceiros','despesa','despesas_fixas'),('Investimentos em equipamentos','despesa','investimentos');

create table public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);
insert into public.cost_centers (name) values ('Comercial'),('Logística'),('Técnico'),('Administrativo'),('Marketing');

-- Regras de cobrança: global (customer_id nulo) + exceções por cliente. Vigência preservada.
create table public.collection_rules (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id),
  default_term_days int not null default 0,
  fine_percent numeric(6,3) not null default 0 check (fine_percent >= 0),
  interest_percent numeric(6,3) not null default 0 check (interest_percent >= 0),
  interest_period text not null default 'mensal' check (interest_period in ('mensal','diario')),
  grace_days int not null default 0,
  due_date_handling text not null default 'proximo_dia_util' check (due_date_handling in ('proximo_dia_util','manter')),
  protest_after_days int not null default 0,
  protest_day_count text not null default 'corridos' check (protest_day_count in ('corridos','uteis')),
  remind_before_days int not null default 1,
  remind_on_due boolean not null default true,
  remind_after_every_days int not null default 3,
  remind_before_protest_days int not null default 1,
  notify_payment_confirmation boolean not null default true,
  notification_time time not null default '09:00',
  approver_role text not null default 'financeiro',
  valid_from date not null default public.today_sp(),
  valid_to date,
  notes text,
  created_at timestamptz not null default now()
);
create unique index ux_collection_rule_global on public.collection_rules ((customer_id is null)) where customer_id is null and valid_to is null;
create unique index ux_collection_rule_customer on public.collection_rules (customer_id) where customer_id is not null and valid_to is null;
-- Regra global inicial SEM percentuais (a administração deve definir conforme contratos/legislação).
insert into public.collection_rules (customer_id) values (null);
select public.attach_audit('public.collection_rules');

-- ---------------------------------------------------------------------------
-- Contas a receber (uma linha por parcela)
-- ---------------------------------------------------------------------------
create table public.receivables (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  order_id uuid references public.orders(id),
  service_order_id uuid references public.service_orders(id),
  renegotiated_from uuid references public.receivables(id),
  description text not null,
  category_id uuid references public.financial_categories(id),
  cost_center_id uuid references public.cost_centers(id),
  installment_no int not null default 1,
  installment_count int not null default 1,
  competence_date date not null default public.today_sp(),
  issue_date date not null default public.today_sp(),
  due_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  discount_amount numeric(14,2) not null default 0,
  interest_amount numeric(14,2) not null default 0,
  fine_amount numeric(14,2) not null default 0,
  payment_method text,
  collection_rule_snapshot jsonb,           -- regra vigente no lançamento (histórico preservado)
  status text not null default 'em_aberto' check (status in ('em_aberto','parcialmente_pago','pago','cancelado','renegociado')),
  paid_at date,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Evita receitas duplicadas por pedido/OS.
create unique index ux_receivable_order_installment on public.receivables (order_id, installment_no) where order_id is not null and status <> 'cancelado' and renegotiated_from is null;
create unique index ux_receivable_so on public.receivables (service_order_id) where service_order_id is not null and status <> 'cancelado';
create index ix_receivables_due on public.receivables (due_date) where status in ('em_aberto','parcialmente_pago');
create index ix_receivables_customer on public.receivables (customer_id);
create trigger trg_receivables_updated before update on public.receivables for each row execute function public.set_updated_at();
select public.attach_audit('public.receivables');

-- Situação financeira derivada (vencido/a vencer são calculados pela data — nunca gravados).
create or replace view public.receivables_view with (security_invoker = true) as
select r.*, c.name as customer_name, c.trade_name as customer_trade_name, c.whatsapp as customer_whatsapp, c.phone as customer_phone,
  greatest(r.amount - r.paid_amount, 0) as outstanding,
  case
    when r.status in ('cancelado','renegociado','pago') then r.status
    when r.due_date < public.today_sp() then case when r.paid_amount > 0 then 'parcialmente_pago' else 'vencido' end
    when r.paid_amount > 0 then 'parcialmente_pago'
    when r.due_date <= public.today_sp() + coalesce((select (value)::text::int from public.settings where key = 'finance.due_soon_days'), 7) then 'a_vencer'
    else 'em_aberto' end as financial_status,
  greatest(public.today_sp() - r.due_date, 0) as days_overdue
from public.receivables r join public.customers c on c.id = r.customer_id;

create table public.payables (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id),
  purchase_id uuid references public.purchases(id),
  description text not null,
  category_id uuid references public.financial_categories(id),
  cost_center_id uuid references public.cost_centers(id),
  installment_no int not null default 1,
  installment_count int not null default 1,
  competence_date date not null default public.today_sp(),
  due_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  paid_amount numeric(14,2) not null default 0,
  status text not null default 'em_aberto' check (status in ('em_aberto','parcialmente_pago','pago','cancelado')),
  recurrence text check (recurrence in ('mensal','semanal','anual')),
  paid_at date,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ux_payable_purchase_installment on public.payables (purchase_id, installment_no) where purchase_id is not null and status <> 'cancelado';
create index ix_payables_due on public.payables (due_date) where status in ('em_aberto','parcialmente_pago');
create trigger trg_payables_updated before update on public.payables for each row execute function public.set_updated_at();
select public.attach_audit('public.payables');

-- ---------------------------------------------------------------------------
-- Pagamentos e movimentações financeiras
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('entrada','saida')),
  method text not null check (method in ('pix','boleto','dinheiro','cartao_credito','cartao_debito','transferencia','cheque','compensacao','outro')),
  amount numeric(14,2) not null check (amount > 0),
  paid_at date not null default public.today_sp(),
  account_id uuid references public.financial_accounts(id),
  customer_id uuid references public.customers(id),
  supplier_id uuid references public.suppliers(id),
  external_ref text,                  -- e2eId Pix, nosso número etc.
  verified boolean not null default false,  -- conferido no extrato/banco (comprovante sozinho não basta)
  verified_by uuid references public.profiles(id),
  reversed_at timestamptz, reversed_by uuid, reverse_reason text,
  notes text,
  idempotency_key text unique,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
select public.attach_audit('public.payments');

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  receivable_id uuid references public.receivables(id),
  payable_id uuid references public.payables(id),
  amount numeric(14,2) not null check (amount > 0),
  principal numeric(14,2) not null default 0,
  interest numeric(14,2) not null default 0,
  fine numeric(14,2) not null default 0,
  reversed boolean not null default false,
  check ((receivable_id is null) <> (payable_id is null))
);
create index ix_alloc_receivable on public.payment_allocations (receivable_id);
create index ix_alloc_payable on public.payment_allocations (payable_id);

-- Razão das contas (regime de caixa). Transferências internas NÃO são receita/despesa.
create table public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.financial_accounts(id),
  kind text not null check (kind in ('recebimento','pagamento','transferencia_entrada','transferencia_saida','ajuste','estorno')),
  amount numeric(14,2) not null,       -- com sinal: entradas positivas
  occurred_on date not null default public.today_sp(),
  description text,
  category_id uuid references public.financial_categories(id),
  cost_center_id uuid references public.cost_centers(id),
  payment_id uuid references public.payments(id),
  transfer_group uuid,
  reconciled boolean not null default false,
  reconciled_at timestamptz,
  bank_statement_ref text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index ix_fin_tx_account on public.financial_transactions (account_id, occurred_on);
select public.attach_audit('public.financial_transactions');

create or replace view public.account_balances with (security_invoker = true) as
select a.id, a.name, a.kind, a.opening_balance,
  a.opening_balance + coalesce(sum(t.amount) filter (where t.occurred_on >= a.opening_date), 0) as balance,
  coalesce(sum(t.amount) filter (where not t.reconciled), 0) as unreconciled
from public.financial_accounts a left join public.financial_transactions t on t.account_id = a.id
group by a.id;

create table public.bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.financial_accounts(id),
  format text not null check (format in ('ofx','cnab240','cnab400','csv')),
  file_name text,
  imported_by uuid default auth.uid(),
  imported_at timestamptz not null default now(),
  lines jsonb not null default '[]'::jsonb
);

-- ---------------------------------------------------------------------------
-- Boletos (cadastro de boletos já emitidos no banco; integração bancária opcional)
-- ---------------------------------------------------------------------------
create table public.boletos (
  id uuid primary key default gen_random_uuid(),
  receivable_id uuid not null references public.receivables(id),
  document_number text, our_number text, your_number text,
  bank_code text, wallet text,
  barcode text, digitable_line text,
  issue_date date not null default public.today_sp(),
  due_date date not null,
  original_amount numeric(14,2) not null check (original_amount > 0),
  planned_protest_date date,        -- data INTERNA prevista de encaminhamento (não é data de protesto)
  file_path text,
  origin text not null default 'manual' check (origin in ('manual','integracao_bancaria')),
  status text not null default 'registrado' check (status in ('registrado','baixado','cancelado','liquidado')),
  created_at timestamptz not null default now(),
  unique (bank_code, our_number)
);
create unique index ux_boleto_receivable on public.boletos (receivable_id) where status <> 'cancelado';
select public.attach_audit('public.boletos');

create table public.pix_charges (
  id uuid primary key default gen_random_uuid(),
  receivable_id uuid references public.receivables(id),
  kind text not null default 'estatico' check (kind in ('estatico','dinamico')),
  amount numeric(14,2),
  txid text,
  br_code text,
  internal_due_date date,
  status text not null default 'gerado' check (status in ('gerado','comprovante_recebido','confirmado','cancelado')),
  payment_id uuid references public.payments(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Protestos (situação cartorária independente da financeira)
-- ---------------------------------------------------------------------------
create table public.protest_records (
  id uuid primary key default gen_random_uuid(),
  receivable_id uuid not null references public.receivables(id),
  boleto_id uuid references public.boletos(id),
  status text not null default 'nao_encaminhado' check (status in ('nao_encaminhado','programado','encaminhado','em_cartorio','protestado','aguardando_anuencia','aguardando_cancelamento','cancelamento_solicitado','protesto_cancelado','retirado')),
  planned_date date,
  sent_at date,
  notary_office text,
  protocol_number text,
  protested_at date,
  fees_informed numeric(14,2),
  anuence_authorized boolean not null default false,
  cancellation_requested_at date,
  authorized_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ux_protest_receivable on public.protest_records (receivable_id);
create trigger trg_protest_updated before update on public.protest_records for each row execute function public.set_updated_at();
select public.attach_audit('public.protest_records');

create table public.protest_status_history (
  id bigint generated always as identity primary key,
  protest_id uuid not null references public.protest_records(id),
  from_status text, to_status text not null,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now(),
  notes text
);

create or replace function public.protest_transition_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare allowed text[];
begin
  if new.status is distinct from old.status then
    allowed := case old.status
      when 'nao_encaminhado' then array['programado','encaminhado']
      when 'programado' then array['encaminhado','nao_encaminhado']
      when 'encaminhado' then array['em_cartorio','retirado','protestado']
      when 'em_cartorio' then array['protestado','retirado']
      when 'protestado' then array['aguardando_anuencia','aguardando_cancelamento','cancelamento_solicitado']
      when 'aguardando_anuencia' then array['aguardando_cancelamento','cancelamento_solicitado']
      when 'aguardando_cancelamento' then array['cancelamento_solicitado','protesto_cancelado']
      when 'cancelamento_solicitado' then array['protesto_cancelado']
      else array[]::text[] end;
    if not new.status = any(allowed) then
      raise exception 'Transição cartorária inválida: % → %', old.status, new.status using errcode = 'P0001';
    end if;
    -- Envio efetivo a protesto exige autorização apropriada.
    if new.status = 'encaminhado' and not public.has_perm('cobranca', 'approve') then
      raise exception 'Encaminhamento a protesto exige permissão de aprovação' using errcode = '42501';
    end if;
    if new.status = 'encaminhado' then new.authorized_by := auth.uid(); new.sent_at := coalesce(new.sent_at, public.today_sp()); end if;
  end if;
  if new.status is distinct from old.status then
    insert into protest_status_history (protest_id, from_status, to_status, notes) values (new.id, old.status, new.status, new.notes);
  end if;
  return new;
end $$;
create trigger trg_protest_guard before update on public.protest_records for each row execute function public.protest_transition_guard();
create or replace function public.protest_insert_history() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into protest_status_history (protest_id, from_status, to_status, notes) values (new.id, null, new.status, new.notes);
  return null;
end $$;
create trigger trg_protest_insert_history after insert on public.protest_records for each row execute function public.protest_insert_history();

create table public.document_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  body text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.document_templates (key, name, body) values ('anuencia', 'Declaração de anuência',
'DECLARAÇÃO DE ANUÊNCIA

[NOME_EMPRESA], inscrita no CNPJ sob nº [DOCUMENTO_EMPRESA], com sede em [ENDERECO_EMPRESA], na qualidade de credora/apresentante, DECLARA, para fins de cancelamento de protesto junto ao Tabelionato de Protesto de Títulos competente, nos termos do art. 26 da Lei nº 9.492/1997, que o título abaixo descrito, emitido contra [NOME_CLIENTE], inscrito(a) sob nº [DOCUMENTO_CLIENTE], foi devidamente quitado, nada mais havendo a reclamar quanto a ele.

Título: [NUMERO_DOCUMENTO]
Seu número: [SEU_NUMERO]
Nosso número: [NOSSO_NUMERO]
Data de emissão: [DATA_EMISSAO]
Data de vencimento: [DATA_VENCIMENTO]
Valor: [VALOR_ORIGINAL]
Cartório: [CARTORIO]   Protocolo: [PROTOCOLO]

[CIDADE_EMPRESA], [DATA_ATUAL].


_____________________________________________
[NOME_EMPRESA]
Representante legal: ______________________
(Assinatura do representante legal — reconhecimento de firma conforme exigência do tabelionato)');

create table public.anuence_documents (
  id uuid primary key default gen_random_uuid(),
  protest_id uuid not null references public.protest_records(id),
  generated_text text not null,
  generated_at timestamptz not null default now(),
  generated_by uuid default auth.uid(),
  signed_file_path text,
  sent_to_customer_at timestamptz,
  sent_channel text,
  status text not null default 'gerada' check (status in ('gerada','assinada','enviada','cancelada'))
);

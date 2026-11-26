-- Organização, estratégia, marketing, parceiros (razão), mensagens, notificações, automações e integrações.

-- ---------------------------------------------------------------------------
-- Razão de parceiros (idempotente: um crédito por pedido)
-- ---------------------------------------------------------------------------
create table public.partner_settlements (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id),
  period date not null,                 -- primeiro dia do mês
  opening_debt numeric(14,2) not null,
  new_obligations numeric(14,2) not null default 0,
  payments numeric(14,2) not null default 0,
  adjustments numeric(14,2) not null default 0,
  total_credits numeric(14,2) not null default 0,
  offset_amount numeric(14,2) not null default 0,
  closing_debt numeric(14,2) not null,
  credit_payable numeric(14,2) not null default 0,
  status text not null default 'fechado' check (status in ('fechado','estornado')),
  closed_by uuid default auth.uid(),
  closed_at timestamptz not null default now(),
  check (period = date_trunc('month', period)::date)
);
create unique index ux_partner_settlement on public.partner_settlements (partner_id, period) where status = 'fechado';

create table public.partner_ledger (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id),
  entry_type text not null check (entry_type in ('saldo_inicial','obrigacao','credito','comissao','abatimento','pagamento','ajuste','estorno')),
  amount numeric(14,2) not null,  -- positivo aumenta a dívida do parceiro; negativo reduz
  order_id uuid references public.orders(id),
  settlement_id uuid references public.partner_settlements(id),
  reversed_entry_id uuid references public.partner_ledger(id),
  occurred_on date not null default public.today_sp(),
  description text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index ux_partner_credit_order on public.partner_ledger (partner_id, order_id) where entry_type = 'credito' and order_id is not null;
create unique index ux_partner_reversal on public.partner_ledger (reversed_entry_id) where reversed_entry_id is not null;
create index ix_partner_ledger on public.partner_ledger (partner_id, occurred_on);
select public.attach_audit('public.partner_ledger');

-- ---------------------------------------------------------------------------
-- Agenda, tarefas, rotinas, reuniões e notas
-- ---------------------------------------------------------------------------
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null default 'compromisso' check (kind in ('reuniao','entrega','recolhimento','visita_tecnica','manutencao','assepsia','evento_comercial','cobranca','compra','pagamento','compromisso','estrategico')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  location text,
  color text,
  priority text not null default 'normal' check (priority in ('baixa','normal','alta','urgente')),
  recurrence_rule text,                 -- RFC 5545 RRULE (ex.: FREQ=WEEKLY;BYDAY=TU)
  owner_id uuid references public.profiles(id) default auth.uid(),
  participants uuid[] not null default '{}',
  reminder_minutes int[] not null default '{30}',
  customer_id uuid references public.customers(id),
  ref_type text, ref_id uuid,
  notes text,
  status text not null default 'confirmado' check (status in ('confirmado','tentativo','cancelado','concluido')),
  external_id text,                      -- id no Google Agenda
  external_etag text,
  sync_origin text not null default 'interno' check (sync_origin in ('interno','google')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index ix_calendar_range on public.calendar_events (starts_at);
create unique index ux_calendar_ref on public.calendar_events (ref_type, ref_id) where ref_type is not null and status <> 'cancelado';
create unique index ux_calendar_external on public.calendar_events (external_id) where external_id is not null;
create trigger trg_calendar_updated before update on public.calendar_events for each row execute function public.set_updated_at();

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  owner_id uuid references public.profiles(id),
  starts_on date, ends_on date,
  status text not null default 'ativo' check (status in ('planejado','ativo','pausado','concluido','cancelado')),
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  parent_id uuid references public.tasks(id),
  project_id uuid references public.projects(id),
  assignee_id uuid references public.profiles(id),
  due_date date,
  priority text not null default 'normal' check (priority in ('baixa','normal','alta','urgente')),
  category text,
  status text not null default 'a_fazer' check (status in ('a_fazer','em_andamento','bloqueada','concluida','cancelada')),
  checklist jsonb not null default '[]'::jsonb,
  depends_on uuid[] not null default '{}',
  recurrence_rule text,
  ref_type text, ref_id uuid,
  source_key text unique,                -- idempotência para tarefas geradas automaticamente
  external_id text unique,               -- Google Tasks
  completed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_tasks_assignee on public.tasks (assignee_id, status);
create trigger trg_tasks_updated before update on public.tasks for each row execute function public.set_updated_at();

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id),
  body text not null,
  author_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null default 'rotina' check (kind in ('rotina','habito')),
  frequency text not null check (frequency in ('diaria','semanal','mensal','anual')),
  weekdays int[] not null default '{}',
  owner_id uuid references public.profiles(id) default auth.uid(),
  target_per_period int not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.routine_logs (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines(id),
  done_on date not null default public.today_sp(),
  done_by uuid default auth.uid(),
  unique (routine_id, done_on)
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  template text check (template in ('administrativa','financeira','operacional','estrategica','parceiros','outra')),
  starts_at timestamptz not null,
  participants text[] not null default '{}',
  partner_id uuid references public.partners(id),
  agenda text,
  topics jsonb not null default '[]'::jsonb,
  notes text,
  decisions jsonb not null default '[]'::jsonb,     -- [{texto, responsavel, prazo, task_id}]
  status text not null default 'agendada' check (status in ('agendada','realizada','cancelada')),
  calendar_event_id uuid references public.calendar_events(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Sem título',
  body text not null default '',
  category text,
  tags text[] not null default '{}',
  favorite boolean not null default false,
  is_draft boolean not null default false,
  customer_id uuid references public.customers(id),
  meeting_id uuid references public.meetings(id),
  task_id uuid references public.tasks(id),
  project_id uuid references public.projects(id),
  owner_id uuid default auth.uid(),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_notes_updated before update on public.notes for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Marketing e estratégia
-- ---------------------------------------------------------------------------
create table public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,                    -- código/UTM para atribuição
  objective text,
  kind text not null default 'aquisicao' check (kind in ('aquisicao','reativacao','eventos','sazonal','branding','pontos_fixos','outra')),
  channel text,
  audience text,
  starts_on date, ends_on date,
  budget numeric(14,2) not null default 0,
  spent numeric(14,2) not null default 0,
  utm_source text, utm_medium text, utm_campaign text,
  status text not null default 'planejada' check (status in ('planejada','ativa','pausada','concluida','cancelada')),
  notes text,
  created_at timestamptz not null default now()
);
alter table public.customers add constraint fk_customer_campaign foreign key (campaign_id) references public.marketing_campaigns(id);
alter table public.orders add constraint fk_order_campaign foreign key (campaign_id) references public.marketing_campaigns(id);

create table public.marketing_contents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  theme text, objective text,
  platform text, format text,
  caption text, script text, creative_path text, cta text,
  owner_id uuid references public.profiles(id),
  publish_date date,
  status text not null default 'ideia' check (status in ('ideia','producao','revisao','aprovado','agendado','publicado','cancelado')),
  campaign_id uuid references public.marketing_campaigns(id),
  created_at timestamptz not null default now()
);

create table public.marketing_metrics (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.marketing_campaigns(id),
  content_id uuid references public.marketing_contents(id),
  channel text not null,
  metric_date date not null,
  metric text not null check (metric in ('seguidores','alcance','impressoes','visualizacoes','engajamento','curtidas','comentarios','compartilhamentos','salvamentos','cliques','leads','conversoes','investimento','receita_atribuida')),
  value numeric(16,2) not null,
  source text not null default 'manual' check (source in ('manual','sincronizado','estimado','importado')),
  created_at timestamptz not null default now(),
  unique (campaign_id, content_id, channel, metric_date, metric)
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text, email text, company text,
  campaign_id uuid references public.marketing_campaigns(id),
  source text,
  stage text not null default 'novo' check (stage in ('novo','contato','qualificado','proposta','ganho','perdido')),
  customer_id uuid references public.customers(id),
  notes text,
  created_at timestamptz not null default now()
);

create table public.strategy_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('swot_forca','swot_fraqueza','swot_oportunidade','swot_ameaca','risco','persona','concorrente','posicionamento','objetivo','okr','plano_acao','ideia')),
  title text not null,
  body text,
  owner_id uuid references public.profiles(id),
  impact smallint check (impact between 1 and 5),
  probability smallint check (probability between 1 and 5),
  due_date date,
  status text not null default 'aberto' check (status in ('aberto','em_andamento','concluido','descartado')),
  created_at timestamptz not null default now()
);

-- Metas vinculadas a indicadores REAIS (calculados por kpi_value()).
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  metric text not null check (metric in ('faturamento','recebimentos','litros_vendidos','pedidos','clientes_ativos','inadimplencia_percent','margem_contribuicao_percent','equipamentos_ociosos','manual')),
  target numeric(16,2) not null,
  direction text not null default 'maior' check (direction in ('maior','menor')),
  period_start date not null,
  period_end date not null,
  manual_value numeric(16,2),
  owner_id uuid references public.profiles(id),
  okr_parent uuid references public.goals(id),
  notes text,
  status text not null default 'ativa' check (status in ('ativa','concluida','cancelada')),
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

-- ---------------------------------------------------------------------------
-- Mensagens (WhatsApp por link oficial), notificações e automações
-- ---------------------------------------------------------------------------
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  channel text not null default 'whatsapp' check (channel in ('whatsapp','email','interno')),
  category text not null default 'cobranca',
  body text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.message_templates (key, name, category, body) values
 ('lembrete_vencimento','Lembrete de vencimento','cobranca','Olá, [NOME_CLIENTE]! Aqui é da [NOME_EMPRESA]. Lembramos que o título no valor de [VALOR_ORIGINAL] vence em [DATA_VENCIMENTO]. Qualquer dúvida, estamos à disposição.'),
 ('boleto_hoje','Boleto vencendo hoje','cobranca','Olá, [NOME_CLIENTE]! O boleto de [VALOR_ORIGINAL] vence hoje ([DATA_VENCIMENTO]). Linha digitável: [LINHA_DIGITAVEL]. Obrigado! — [NOME_EMPRESA]'),
 ('boleto_vencido','Boleto vencido','cobranca','Olá, [NOME_CLIENTE]. Identificamos que o título de [VALOR_ORIGINAL], vencido em [DATA_VENCIMENTO], está em aberto há [DIAS_ATRASO] dia(s). Valor atualizado: [VALOR_ATUALIZADO]. Podemos ajudar na regularização? — [NOME_EMPRESA]'),
 ('pix_pendente','Pix pendente','cobranca','Olá, [NOME_CLIENTE]! Segue a chave Pix para pagamento de [VALOR_ORIGINAL]: [CHAVE_PIX]. Após o pagamento, envie o comprovante por aqui. — [NOME_EMPRESA]'),
 ('pagamento_atraso','Pagamento em atraso','cobranca','Olá, [NOME_CLIENTE]. O pagamento de [VALOR_ATUALIZADO] está em atraso desde [DATA_VENCIMENTO]. Por favor, entre em contato para regularizarmos. — [NOME_EMPRESA]'),
 ('aviso_protesto','Aviso de encaminhamento a protesto','cobranca','Olá, [NOME_CLIENTE]. O título de [VALOR_ORIGINAL], vencido em [DATA_VENCIMENTO], está programado para encaminhamento a protesto em [DATA_ENCAMINHAMENTO], conforme condições contratadas. Para evitar, regularize até essa data. — [NOME_EMPRESA]'),
 ('confirmacao_pagamento','Confirmação de pagamento','cobranca','Olá, [NOME_CLIENTE]! Confirmamos o recebimento de [VALOR_ORIGINAL]. Obrigado pela parceria! — [NOME_EMPRESA]'),
 ('regularizacao_cartoraria','Regularização cartorária','cobranca','Olá, [NOME_CLIENTE]. Recebemos o pagamento do título protestado. Estamos providenciando a carta de anuência para o cancelamento do protesto. — [NOME_EMPRESA]'),
 ('envio_anuencia','Envio de declaração de anuência','cobranca','Olá, [NOME_CLIENTE]. Segue a declaração de anuência referente ao título de [VALOR_ORIGINAL]. Com ela, o cancelamento do protesto pode ser solicitado no cartório. — [NOME_EMPRESA]'),
 ('reativacao','Reativação de cliente','comercial','Olá, [NOME_CLIENTE]! Sentimos sua falta aqui na [NOME_EMPRESA]. Que tal programarmos o próximo pedido? Temos condições especiais para você.'),
 ('baixa_rotatividade','Baixa rotatividade','comercial','Olá, [NOME_CLIENTE]! Notamos uma redução no consumo nas últimas semanas. Podemos conversar para entender como ajudar a girar mais o chopp? — [NOME_RESPONSAVEL], [NOME_EMPRESA]'),
 ('visita_tecnica','Visita técnica','tecnico','Olá, [NOME_CLIENTE]! Confirmamos a visita técnica em [DATA_VISITA] às [HORARIO_VISITA]. — [NOME_EMPRESA]'),
 ('assepsia','Assepsia','tecnico','Olá, [NOME_CLIENTE]! A assepsia do seu equipamento está agendada para [DATA_VISITA] às [HORARIO_VISITA]. — [NOME_EMPRESA]'),
 ('manutencao','Manutenção','tecnico','Olá, [NOME_CLIENTE]! A manutenção do equipamento está agendada para [DATA_VISITA] às [HORARIO_VISITA]. — [NOME_EMPRESA]'),
 ('entrega','Entrega','logistica','Olá, [NOME_CLIENTE]! A entrega do pedido nº [NUMERO_PEDIDO] está programada para [DATA_ENTREGA]. — [NOME_EMPRESA]'),
 ('recolhimento','Recolhimento','logistica','Olá, [NOME_CLIENTE]! O recolhimento referente ao pedido nº [NUMERO_PEDIDO] está programado para [DATA_VISITA]. — [NOME_EMPRESA]'),
 ('confirmacao_pedido','Confirmação de pedido','comercial','Olá, [NOME_CLIENTE]! Seu pedido nº [NUMERO_PEDIDO] foi confirmado, no valor de [VALOR_ORIGINAL]. — [NOME_EMPRESA]'),
 ('pos_venda','Pós-venda','comercial','Olá, [NOME_CLIENTE]! Como foi a experiência com o chopp da [NOME_EMPRESA]? Sua opinião é muito importante para nós.');

create table public.message_queue (
  id uuid primary key default gen_random_uuid(),
  template_key text references public.message_templates(key),
  channel text not null default 'whatsapp',
  customer_id uuid references public.customers(id),
  phone text,
  body text not null,
  ref_type text, ref_id uuid,
  scheduled_for date not null default public.today_sp(),
  dedup_key text unique,
  status text not null default 'gerada' check (status in ('gerada','aberta','envio_informado','entregue_api','falha','cancelada')),
  opened_at timestamptz, reported_sent_at timestamptz, reported_by uuid,
  api_message_id text,
  cancel_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index ix_message_queue_day on public.message_queue (scheduled_for, status);

create table public.message_events (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.message_queue(id),
  from_status text, to_status text not null,
  user_id uuid default auth.uid(),
  occurred_at timestamptz not null default now()
);
create or replace function public.message_status_log() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into message_events (message_id, from_status, to_status) values (new.id, null, new.status);
  elsif new.status is distinct from old.status then
    if old.status in ('entregue_api','cancelada') then raise exception 'Mensagem já finalizada' using errcode = 'P0001'; end if;
    if new.status = 'entregue_api' and new.api_message_id is null then
      raise exception 'Entrega só pode ser confirmada pela API (api_message_id obrigatório)' using errcode = 'P0001';
    end if;
    insert into message_events (message_id, from_status, to_status) values (new.id, old.status, new.status);
  end if;
  return null;
end $$;
create trigger trg_message_status after insert or update on public.message_queue for each row execute function public.message_status_log();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),   -- nulo = destinado a um papel/recurso
  target_resource text,                           -- recurso exigido para ver (ex.: 'cobranca')
  category text not null check (category in ('financeiro','comercial','operacional','logistica','tecnico','estrategico','administrativo','marketing','integracoes','seguranca')),
  priority text not null default 'normal' check (priority in ('baixa','normal','alta','critica')),
  title text not null,
  body text,
  link text,
  ref_type text, ref_id uuid,
  status text not null default 'nao_lida' check (status in ('nao_lida','lida','resolvida','adiada','arquivada')),
  snoozed_until timestamptz,
  dedup_key text unique,
  created_at timestamptz not null default now()
);
create index ix_notifications_status on public.notifications (status, created_at desc);

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trigger text not null,
  conditions jsonb not null default '[]'::jsonb,
  action text not null,
  action_config jsonb not null default '{}'::jsonb,
  dedup_window text not null default 'dia' check (dedup_window in ('dia','semana','mes','unico')),
  responsible_role text,
  active boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.automation_executions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references public.automation_rules(id),
  idempotency_key text not null unique,
  entity_type text, entity_id uuid,
  result text not null default 'sucesso' check (result in ('sucesso','ignorado','falha')),
  error text,
  attempts int not null default 1,
  executed_at timestamptz not null default now()
);
create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  effects int not null default 0,
  status text not null default 'executando' check (status in ('executando','concluida','falha')),
  error text
);

insert into public.automation_rules (name, trigger, action, action_config, dedup_window, responsible_role) values
 ('Lembrete 1 dia antes do vencimento','boleto_vencendo','gerar_mensagem','{"template":"lembrete_vencimento","days_before":1}','dia','financeiro'),
 ('Aviso no dia do vencimento','boleto_vencendo','gerar_mensagem','{"template":"boleto_hoje","days_before":0}','dia','financeiro'),
 ('Cobrança após vencimento','boleto_vencido','gerar_mensagem','{"template":"boleto_vencido"}','dia','financeiro'),
 ('Aviso 1 dia antes do protesto','protesto_proximo','gerar_mensagem','{"template":"aviso_protesto","days_before":1}','dia','financeiro'),
 ('Confirmação de pagamento','pagamento_recebido','gerar_mensagem','{"template":"confirmacao_pagamento"}','unico','financeiro'),
 ('Alerta de estoque mínimo','estoque_minimo','criar_notificacao','{}','dia','logistica'),
 ('Alerta de manutenção/assepsia próxima','manutencao_proxima','criar_notificacao','{"days_before":7}','semana','tecnico'),
 ('Alerta de queda de consumo','queda_consumo','criar_notificacao','{}','semana','comercial'),
 ('Tarefas vencidas','tarefa_vencida','criar_notificacao','{}','dia',null),
 ('Equipamentos ociosos','equipamento_ocioso','criar_notificacao','{}','semana','logistica');

create table public.integrations (
  provider text primary key,
  name text not null,
  status text not null default 'nao_configurada' check (status in ('nao_configurada','aguardando_autorizacao','conectada','desconectada','sincronizacao_pendente','erro','limite_atingido')),
  config jsonb not null default '{}'::jsonb,       -- somente configurações NÃO secretas
  last_sync_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
insert into public.integrations (provider, name) values
 ('supabase','Supabase'),('github','GitHub'),('cloudflare','Cloudflare Pages'),('google_calendar','Google Agenda'),
 ('google_tasks','Google Tasks'),('whatsapp_link','WhatsApp (links oficiais)'),('whatsapp_cloud','WhatsApp Business Platform'),
 ('viacep','Consulta de CEP (ViaCEP)'),('brasilapi_cnpj','Consulta CNPJ (BrasilAPI — dados públicos RFB)'),('serpro','Serpro (Consulta CPF/CNPJ)'),
 ('banco','Banco (boletos/CNAB/OFX)'),('pix_api','API Pix do PSP'),('meta','Meta / Instagram'),('gemini','Google Gemini API');
update public.integrations set status = 'conectada' where provider in ('whatsapp_link');

create table public.external_sync_records (
  id uuid primary key default gen_random_uuid(),
  provider text not null references public.integrations(provider),
  entity_type text not null,
  entity_id uuid not null,
  external_id text not null,
  direction text not null check (direction in ('push','pull')),
  last_hash text,
  last_synced_at timestamptz not null default now(),
  status text not null default 'ok' check (status in ('ok','pendente','erro')),
  error text,
  attempts int not null default 0,
  unique (provider, entity_type, entity_id),
  unique (provider, external_id)
);

create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid(),
  provider text not null,
  question text not null,
  tokens_estimated int,
  created_at timestamptz not null default now()
);

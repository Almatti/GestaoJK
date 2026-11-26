-- Segredos de integrações (tokens OAuth etc.). Acessível SOMENTE pelo service_role (Edge Functions).
-- RLS habilitada e nenhuma policy: usuários autenticados não leem nem escrevem.
create table public.integration_secrets (
  provider text primary key references public.integrations(provider),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.integration_secrets enable row level security;
revoke all on public.integration_secrets from anon, authenticated;

-- Limite de uso do assistente por usuário/dia (consultado pela Edge Function).
create or replace function public.ai_usage_today(p_user uuid) returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from ai_usage where user_id = p_user and created_at >= (public.today_sp()::timestamp at time zone 'America/Sao_Paulo')
$$;
revoke execute on function public.ai_usage_today(uuid) from anon, authenticated, public;

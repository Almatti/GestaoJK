-- Notificações push no celular (Web Push). O banco aciona o envio ao criar uma notificação (assíncrono).
create extension if not exists pg_net with schema extensions;

insert into public.integrations (provider, name) values ('web_push', 'Notificações push (celular)') on conflict (provider) do nothing;
-- Segredo que autoriza o banco a acionar o envio (só o servidor lê; sem acesso pela API).
insert into public.integration_secrets (provider, data)
values ('web_push', jsonb_build_object('webhook_secret', encode(extensions.gen_random_bytes(24), 'hex')))
on conflict (provider) do nothing;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy p_own_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy p_own_insert on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy p_own_update on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy p_own_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Cada notificação criada dispara o envio push (assíncrono; nunca bloqueia a gravação da notificação).
create or replace function public.push_notification_webhook() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare s text;
begin
  select data->>'webhook_secret' into s from integration_secrets where provider = 'web_push';
  if s is null then return new; end if;
  perform net.http_post(
    url := 'https://vqklluhzbxngsjpopzxw.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', s),
    body := jsonb_build_object('id', new.id),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  return new;
end $$;
revoke execute on function public.push_notification_webhook() from anon, authenticated, public;
drop trigger if exists trg_push_notification on public.notifications;
create trigger trg_push_notification after insert on public.notifications for each row execute function public.push_notification_webhook();

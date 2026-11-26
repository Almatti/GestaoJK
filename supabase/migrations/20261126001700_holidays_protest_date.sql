-- Feriados nacionais (2025–2030) para o cálculo de dias úteis (protesto, vencimentos) e data prevista de
-- encaminhamento a protesto calculada pela regra de cobrança quando não informada.
-- Feriados municipais/estaduais (ex.: aniversário da cidade) devem ser incluídos em Configurações → Feriados.

create or replace function public.easter_sunday(p_year int) returns date language plpgsql immutable as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mo int; dy int;
begin
  a := p_year % 19; b := p_year / 100; c := p_year % 100; d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  mo := (h + l - 7 * m + 114) / 31; dy := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(p_year, mo, dy);
end $$;

insert into public.holidays (day, name, scope)
select x.day, x.name, 'nacional' from (
  select y, make_date(y, 1, 1) as day, 'Confraternização Universal' as name from generate_series(2025, 2030) y
  union all select y, public.easter_sunday(y) - 48, 'Carnaval (segunda — sem expediente bancário)' from generate_series(2025, 2030) y
  union all select y, public.easter_sunday(y) - 47, 'Carnaval (terça — sem expediente bancário)' from generate_series(2025, 2030) y
  union all select y, public.easter_sunday(y) - 2, 'Sexta-feira Santa' from generate_series(2025, 2030) y
  union all select y, make_date(y, 4, 21), 'Tiradentes' from generate_series(2025, 2030) y
  union all select y, make_date(y, 5, 1), 'Dia do Trabalho' from generate_series(2025, 2030) y
  union all select y, public.easter_sunday(y) + 60, 'Corpus Christi (ponto facultativo — confira o expediente local)' from generate_series(2025, 2030) y
  union all select y, make_date(y, 9, 7), 'Independência do Brasil' from generate_series(2025, 2030) y
  union all select y, make_date(y, 10, 12), 'Nossa Senhora Aparecida' from generate_series(2025, 2030) y
  union all select y, make_date(y, 11, 2), 'Finados' from generate_series(2025, 2030) y
  union all select y, make_date(y, 11, 15), 'Proclamação da República' from generate_series(2025, 2030) y
  union all select y, make_date(y, 11, 20), 'Dia Nacional de Zumbi e da Consciência Negra' from generate_series(2025, 2030) y
  union all select y, make_date(y, 12, 25), 'Natal' from generate_series(2025, 2030) y
) x
on conflict (day) do nothing;

-- Data prevista de encaminhamento a protesto (interna) pela regra vigente do cliente, quando não informada.
create or replace function public.planned_protest_date(p_customer uuid, p_due date) returns date
language plpgsql stable security definer set search_path = public as $$
declare r collection_rules;
begin
  r := effective_collection_rule(p_customer);
  if p_due is null or r.id is null or coalesce(r.protest_after_days, 0) <= 0 then return null; end if;
  return case when r.protest_day_count = 'uteis' then add_business_days(p_due, r.protest_after_days) else p_due + r.protest_after_days end;
end $$;
revoke execute on function public.planned_protest_date(uuid, date) from anon, public;
grant execute on function public.planned_protest_date(uuid, date) to authenticated;

create or replace function public.boletos_default_protest_date() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.planned_protest_date is null then
    new.planned_protest_date := planned_protest_date((select customer_id from receivables where id = new.receivable_id), new.due_date);
  end if;
  return new;
end $$;
drop trigger if exists trg_boletos_protest_date on public.boletos;
create trigger trg_boletos_protest_date before insert on public.boletos for each row execute function public.boletos_default_protest_date();

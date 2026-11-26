-- Campos em branco: quando um formulário envia NULL para uma coluna obrigatória que tem valor padrão
-- (ex.: percentuais = 0, participantes = lista vazia), o banco usa o padrão em vez de recusar o cadastro.
-- Vale para qualquer versão do app (inclusive a que está em cache no celular). Colunas obrigatórias SEM
-- padrão (ex.: nome, data da reunião) continuam exigidas.

create or replace function public.fill_blank_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c record;
  patch jsonb := '{}'::jsonb;
  v jsonb;
  rec jsonb := to_jsonb(new);
begin
  for c in
    select a.attname, pg_get_expr(d.adbin, d.adrelid) as def
      from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = tg_relid and a.attnotnull and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
  loop
    if rec -> c.attname is null or rec -> c.attname = 'null'::jsonb then
      execute format('select to_jsonb(%s)', c.def) into v;
      patch := patch || jsonb_build_object(c.attname, v);
    end if;
  end loop;
  if patch <> '{}'::jsonb then
    new := jsonb_populate_record(new, patch);
  end if;
  return new;
end $$;
revoke execute on function public.fill_blank_defaults() from public, anon, authenticated;

-- Aplica às tabelas editadas pelas telas de cadastro. O nome "aa_" faz o gatilho rodar antes dos demais.
do $$
declare t text;
begin
  for t in
    select rt.table_name from public.resource_tables rt
    union select unnest(array['customers','receivables','payables','payments','profiles','company','settings','holidays','notifications','attachments'])
  loop
    if to_regclass('public.' || quote_ident(t)) is not null then
      execute format('drop trigger if exists aa_fill_blank_defaults on public.%I', t);
      execute format('create trigger aa_fill_blank_defaults before insert or update on public.%I for each row execute function public.fill_blank_defaults()', t);
    end if;
  end loop;
end $$;

-- Importação única do backup do MODO LOCAL (navegador) para o Supabase.
-- Somente administradores. Transacional (tudo ou nada) e idempotente (reimportar não duplica: conflitos são ignorados).
-- Preserva os valores históricos exatamente como estavam (snapshots de preço, totais, status): triggers de regra de
-- negócio são suspensos SOMENTE durante a importação e reativados ao final da mesma transação.
-- Usuários locais são vinculados ao administrador que importa. Catálogos já existentes no servidor (categorias,
-- centros de custo, modelos de mensagem, regra global de cobrança, automações) são reaproveitados pela chave natural.

create or replace function public.import_local_backup(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  skip text[] := array['profiles','roles','role_permissions','resource_tables','settings','settings_history','company',
                       'integrations','integration_secrets','meta','audit_logs','notifications','automation_executions',
                       'automation_runs','message_queue','message_events','user_invitations','ai_usage','external_sync_records'];
  txt text;
  data jsonb;
  pending text[];
  ordered text[] := '{}';
  deferred jsonb := '{}'::jsonb;   -- tabela -> [colunas FK adiadas (autorreferência/ciclo)]
  t text; c record; pair record; k text; v jsonb;
  progress boolean;
  cols text; sel text; upd text; dcols text[]; rows_ jsonb; dedup text;
  n int; total int := 0;
  counts jsonb := '{}'::jsonb;
  uid_ uuid := auth.uid();
begin
  perform require_perm('admin', 'edit');
  if uid_ is null then raise exception 'Usuário não identificado' using errcode = '42501'; end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'Backup inválido' using errcode = '22023'; end if;

  -- 1) Usuários locais → administrador que importa (substituição textual de identificadores únicos).
  txt := p_data::text;
  for v in select * from jsonb_array_elements(coalesce(p_data->'profiles', '[]'::jsonb)) loop
    if coalesce(v->>'id', '') <> '' then txt := replace(txt, to_jsonb(v->>'id')::text, to_jsonb(uid_::text)::text); end if;
  end loop;
  data := txt::jsonb;

  -- 2) Catálogos já existentes no servidor: reaproveita pela chave natural.
  for pair in
    select l.id::text lid, s.id::text sid from jsonb_populate_recordset(null::financial_categories, data->'financial_categories') l
      join financial_categories s on s.name = l.name and s.direction = l.direction where s.id <> l.id
    union all select l.id::text, s.id::text from jsonb_populate_recordset(null::cost_centers, data->'cost_centers') l
      join cost_centers s on s.name = l.name where s.id <> l.id
    union all select l.id::text, s.id::text from jsonb_populate_recordset(null::message_templates, data->'message_templates') l
      join message_templates s on s.key = l.key where s.id <> l.id
    union all select l.id::text, s.id::text from jsonb_populate_recordset(null::document_templates, data->'document_templates') l
      join document_templates s on s.key = l.key where s.id <> l.id
    union all select l.id::text, s.id::text from jsonb_populate_recordset(null::automation_rules, data->'automation_rules') l
      join automation_rules s on s.name = l.name where s.id <> l.id
    union all select l.id::text, s.id::text from jsonb_populate_recordset(null::keg_sizes, data->'keg_sizes') l
      join keg_sizes s on s.liters = l.liters where s.id <> l.id
    union all select l.id::text, s.id::text from jsonb_populate_recordset(null::equipment_types, data->'equipment_types') l
      join equipment_types s on s.name = l.name where s.id <> l.id
    union all select l.id::text, s.id::text from jsonb_populate_recordset(null::brands, data->'brands') l
      join brands s on s.name = l.name where s.id <> l.id
  loop
    txt := replace(txt, to_jsonb(pair.lid)::text, to_jsonb(pair.sid)::text);
  end loop;
  data := txt::jsonb;

  -- Regra GLOBAL de cobrança: os valores configurados no modo local atualizam a regra global do servidor.
  -- (Títulos já emitidos guardam a própria regra; nada é recalculado retroativamente.)
  select l.* into c from jsonb_populate_recordset(null::collection_rules, data->'collection_rules') l
   where l.customer_id is null order by l.valid_from desc nulls last limit 1;
  if c.id is not null and exists (select 1 from collection_rules where customer_id is null) then
    update collection_rules s set default_term_days = c.default_term_days, fine_percent = c.fine_percent,
           interest_percent = c.interest_percent, interest_period = c.interest_period, grace_days = c.grace_days,
           due_date_handling = c.due_date_handling, protest_after_days = c.protest_after_days,
           protest_day_count = c.protest_day_count, remind_before_days = c.remind_before_days,
           remind_on_due = c.remind_on_due, remind_after_every_days = c.remind_after_every_days,
           notify_payment_confirmation = c.notify_payment_confirmation
     where s.id = (select id from collection_rules where customer_id is null order by valid_from desc limit 1);
    for v in select * from jsonb_array_elements(data->'collection_rules') loop
      if v->'customer_id' = 'null'::jsonb or not (v ? 'customer_id') then
        txt := replace(txt, to_jsonb(v->>'id')::text, to_jsonb((select id::text from collection_rules where customer_id is null order by valid_from desc limit 1))::text);
      end if;
    end loop;
    data := txt::jsonb;
    data := jsonb_set(data, '{collection_rules}', coalesce((select jsonb_agg(x) from jsonb_array_elements(data->'collection_rules') x
                                                     where x->'customer_id' is not null and x->'customer_id' <> 'null'::jsonb), '[]'::jsonb));
    txt := data::text;
  end if;

  -- 3) Configurações e dados da empresa.
  for k, v in select key, value from jsonb_to_recordset(coalesce(data->'settings', '[]'::jsonb)) as x(key text, value jsonb) loop
    update settings set value = v where key = k and value is distinct from v;
  end loop;
  if jsonb_typeof(data->'company'->0) = 'object' then
    update company s set legal_name = coalesce(l.legal_name, s.legal_name), trade_name = coalesce(l.trade_name, s.trade_name),
           document = coalesce(l.document, s.document), state_registration = coalesce(l.state_registration, s.state_registration),
           phone = coalesce(l.phone, s.phone), email = coalesce(l.email, s.email),
           address = coalesce(nullif(l.address, '{}'::jsonb), s.address), pix_key = coalesce(l.pix_key, s.pix_key),
           pix_merchant_name = coalesce(l.pix_merchant_name, s.pix_merchant_name), pix_merchant_city = coalesce(l.pix_merchant_city, s.pix_merchant_city)
      from jsonb_populate_record(null::company, data->'company'->0) l where s.id = 1;
  end if;

  -- 4) Ordem de inserção pelas chaves estrangeiras; autorreferências e ciclos são preenchidos numa 2ª etapa.
  select coalesce(array_agg(key order by key), '{}') into pending
    from jsonb_each(data) e
   where jsonb_typeof(e.value) = 'array' and jsonb_array_length(e.value) > 0 and not (key = any(skip))
     and to_regclass('public.' || quote_ident(key)) is not null;
  while cardinality(pending) > 0 loop
    progress := false;
    foreach t in array pending loop
      if not exists (
        select 1 from pg_constraint k2 where k2.contype = 'f' and k2.conrelid = ('public.' || quote_ident(t))::regclass
          and k2.confrelid <> k2.conrelid and (select relname from pg_class where oid = k2.confrelid)::text = any(pending)
          and not coalesce(deferred->t ? (select attname from pg_attribute where attrelid = k2.conrelid and attnum = k2.conkey[1]), false)) then
        ordered := ordered || t; pending := array_remove(pending, t); progress := true;
      end if;
    end loop;
    if not progress then
      -- Ciclo: adia as FKs (anuláveis) da primeira tabela pendente para outras pendentes.
      t := pending[1];
      deferred := jsonb_set(deferred, array[t], coalesce(deferred->t, '[]'::jsonb) || coalesce((
        select jsonb_agg(a.attname) from pg_constraint k2 join pg_attribute a on a.attrelid = k2.conrelid and a.attnum = k2.conkey[1]
         where k2.contype = 'f' and k2.conrelid = ('public.' || quote_ident(t))::regclass and not a.attnotnull
           and (select relname from pg_class where oid = k2.confrelid)::text = any(pending)), '[]'::jsonb));
      if not exists (select 1 from pg_constraint k2 join pg_attribute a on a.attrelid = k2.conrelid and a.attnum = k2.conkey[1]
                      where k2.contype = 'f' and k2.conrelid = ('public.' || quote_ident(t))::regclass and a.attnotnull
                        and k2.confrelid <> k2.conrelid and (select relname from pg_class where oid = k2.confrelid)::text = any(pending)) then
        continue;
      end if;
      raise exception 'Não foi possível ordenar a importação (dependência obrigatória circular em %)', t;
    end if;
  end loop;
  -- Autorreferências anuláveis sempre na 2ª etapa.
  foreach t in array ordered loop
    deferred := jsonb_set(deferred, array[t], coalesce(deferred->t, '[]'::jsonb) || coalesce((
      select jsonb_agg(a.attname) from pg_constraint k2 join pg_attribute a on a.attrelid = k2.conrelid and a.attnum = k2.conkey[1]
       where k2.contype = 'f' and k2.conrelid = ('public.' || quote_ident(t))::regclass and k2.confrelid = k2.conrelid and not a.attnotnull), '[]'::jsonb));
  end loop;

  perform set_config('app.audit_reason', 'Importação do backup do modo local', true);
  foreach t in array ordered loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;

  -- 5) Inserção (conflitos ignorados = idempotente). Colunas geradas e ids de histórico (identity) ficam com o servidor.
  foreach t in array ordered loop
    select coalesce(array_agg(x), '{}') into dcols from jsonb_array_elements_text(coalesce(deferred->t, '[]'::jsonb)) x;
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
           string_agg(case
             when a.attname = any(dcols) then 'null'
             -- Numeração (ex.: nº do pedido): mantém o número local; se já estiver em uso no servidor, recebe o próximo número.
             when a.attidentity <> '' then format('case when r.%1$I is null or exists (select 1 from public.%2$I x where x.%1$I = r.%1$I) then nextval(%3$L) else r.%1$I end',
                                                  a.attname, t, pg_get_serial_sequence(a.attrelid::regclass::text, a.attname))
             when a.attnotnull and d.adbin is not null then format('coalesce(r.%I, %s)', a.attname, pg_get_expr(d.adbin, d.adrelid))
             else format('r.%I', a.attname) end, ', ' order by a.attnum)
      into cols, sel
      from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = ('public.' || quote_ident(t))::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
       and not (a.attidentity <> '' and a.attname = 'id')
       and exists (select 1 from jsonb_array_elements(data->t) e where e ? a.attname);
    if cols is null then continue; end if;
    -- Registro que já existe no servidor por outra chave única (ex.: mesmo CNPJ): reaproveita o existente.
    if exists (select 1 from pg_attribute where attrelid = ('public.' || quote_ident(t))::regclass and attname = 'id' and atttypid = 'uuid'::regtype) then
      for c in select string_agg(format('s.%1$I = l.%1$I', a.attname), ' and ') cond
                 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                where i.indrelid = ('public.' || quote_ident(t))::regclass and i.indisunique and not i.indisprimary
                  and 0 <> all(i.indkey::int2[])
                  and not exists (select 1 from pg_attribute ia where ia.attrelid = i.indrelid and ia.attnum = any(i.indkey) and ia.attidentity <> '')
                group by i.indexrelid loop
        for pair in execute format('select l.id::text lid, s.id::text sid from jsonb_populate_recordset(null::public.%I, $1) l join public.%I s on %s where s.id <> l.id',
                                   t, t, c.cond) using data->t loop
          txt := replace(txt, to_jsonb(pair.lid)::text, to_jsonb(pair.sid)::text);
        end loop;
      end loop;
      data := txt::jsonb;
    end if;
    begin
      rows_ := data->t; dedup := '';
      if exists (select 1 from pg_attribute where attrelid = ('public.' || quote_ident(t))::regclass and attname = 'id' and attidentity <> '') then
        -- Históricos com id numérico do servidor: descarta o id local e evita duplicar linhas idênticas ao reimportar.
        rows_ := (select jsonb_agg(e - 'id') from jsonb_array_elements(rows_) e);
        dedup := format(' where not exists (select 1 from public.%I s where row(%s) is not distinct from row(%s))', t,
                        (select string_agg('s.' || x, ', ') from unnest(string_to_array(cols, ', ')) x), sel);
      end if;
      execute format('insert into public.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::public.%I, $1) r%s on conflict do nothing',
                     t, cols, sel, t, dedup) using rows_;
      get diagnostics n = row_count;
    exception when others then
      raise exception 'Falha ao importar "%": %', t, sqlerrm using errcode = sqlstate;
    end;
    counts := counts || jsonb_build_object(t, n); total := total + n;
  end loop;

  -- 6) Segunda etapa: FKs adiadas.
  foreach t in array ordered loop
    select coalesce(array_agg(x), '{}') into dcols from jsonb_array_elements_text(coalesce(deferred->t, '[]'::jsonb)) x;
    if cardinality(dcols) = 0 or not exists (select 1 from pg_attribute where attrelid = ('public.' || quote_ident(t))::regclass and attname = 'id') then continue; end if;
    select string_agg(format('%1$I = coalesce(s.%1$I, r.%1$I)', c2), ', ') into upd from unnest(dcols) c2;
    execute format('update public.%I s set %s from jsonb_populate_recordset(null::public.%I, $1) r where s.id = r.id', t, upd, t) using data->t;
  end loop;

  foreach t in array ordered loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;

  -- 7) Numeração (nº de pedido, OS, compra, código de cliente) continua a partir do maior número importado.
  for c in select a.attrelid::regclass::text tbl, a.attname col, pg_get_serial_sequence(a.attrelid::regclass::text, a.attname) seq
             from pg_attribute a where a.attidentity <> '' and a.attname <> 'id'
              and a.attrelid in (select ('public.' || quote_ident(x))::regclass from unnest(ordered) x) loop
    execute format('select setval(%L, greatest((select coalesce(max(%I), 0) from %s), (select last_value from %s)))', c.seq, c.col, c.tbl, c.seq);
  end loop;

  insert into audit_logs (user_id, table_name, record_id, action, new_data, reason)
  values (uid_, 'import_local_backup', '', 'import', jsonb_build_object('rows', total, 'tables', counts), 'Importação do backup do modo local');
  return jsonb_build_object('imported_rows', total, 'tables', counts);
end $$;

revoke execute on function public.import_local_backup(jsonb) from anon, public;
grant execute on function public.import_local_backup(jsonb) to authenticated;

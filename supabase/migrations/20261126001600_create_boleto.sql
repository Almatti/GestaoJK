-- Cadastro de boleto em uma única operação: vincula a um título existente do cliente ou cria o título
-- (conta a receber) com os dados do próprio boleto. Transacional: ou grava tudo, ou nada.
create or replace function public.create_boleto(p_customer uuid, p_receivable uuid, p_boleto jsonb, p_description text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  rid uuid := p_receivable;
  bid uuid;
  r receivables;
  v_due date := nullif(p_boleto->>'due_date', '')::date;
  v_amount numeric := nullif(p_boleto->>'original_amount', '')::numeric;
begin
  if not (has_perm('cobranca', 'create') or has_perm('financeiro', 'create')) then
    raise exception 'Permissão negada: cadastrar boleto' using errcode = '42501';
  end if;
  if v_due is null or coalesce(v_amount, 0) <= 0 then
    raise exception 'Informe vencimento e valor do boleto' using errcode = '22023';
  end if;

  if rid is null then
    if p_customer is null then raise exception 'Selecione o cliente do boleto' using errcode = '22023'; end if;
    insert into receivables (customer_id, description, competence_date, issue_date, due_date, amount, payment_method,
                             category_id, collection_rule_snapshot)
    values (p_customer,
            coalesce(nullif(trim(p_description), ''), 'Boleto' || coalesce(' nº ' || nullif(p_boleto->>'document_number', ''), coalesce(' — nosso nº ' || nullif(p_boleto->>'our_number', ''), ''))),
            coalesce(nullif(p_boleto->>'issue_date', '')::date, public.today_sp()),
            coalesce(nullif(p_boleto->>'issue_date', '')::date, public.today_sp()),
            v_due, v_amount, 'boleto',
            (select id from financial_categories where name = 'Venda de chopp' and direction = 'receita'),
            to_jsonb(effective_collection_rule(p_customer)))
    returning id into rid;
  else
    select * into r from receivables where id = rid for update;
    if not found then raise exception 'Título não encontrado'; end if;
    if p_customer is not null and r.customer_id <> p_customer then
      raise exception 'O título escolhido pertence a outro cliente' using errcode = 'P0001';
    end if;
    if r.status not in ('em_aberto', 'parcialmente_pago') then
      raise exception 'O título escolhido não está em aberto' using errcode = 'P0001';
    end if;
    update receivables set payment_method = 'boleto' where id = rid;
  end if;

  insert into boletos (receivable_id, document_number, our_number, your_number, bank_code, wallet, barcode, digitable_line,
                       issue_date, due_date, original_amount, planned_protest_date, file_path)
  values (rid, nullif(p_boleto->>'document_number', ''), nullif(p_boleto->>'our_number', ''), nullif(p_boleto->>'your_number', ''),
          nullif(p_boleto->>'bank_code', ''), nullif(p_boleto->>'wallet', ''), nullif(p_boleto->>'barcode', ''),
          nullif(p_boleto->>'digitable_line', ''), coalesce(nullif(p_boleto->>'issue_date', '')::date, public.today_sp()),
          v_due, v_amount, nullif(p_boleto->>'planned_protest_date', '')::date, nullif(p_boleto->>'file_path', ''))
  returning id into bid;

  return jsonb_build_object('boleto_id', bid, 'receivable_id', rid, 'receivable_created', p_receivable is null);
end $$;
revoke execute on function public.create_boleto(uuid, uuid, jsonb, text) from anon, public;
grant execute on function public.create_boleto(uuid, uuid, jsonb, text) to authenticated;

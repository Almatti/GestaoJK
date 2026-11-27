-- Correção de lançamentos feitos por engano no boleto, com motivo obrigatório e trilha de auditoria.
-- Nada é apagado: o histórico cartorial registra a correção; estornos usam reverse_payment.

-- 1) A trava de etapas do cartório aceita CORREÇÃO (somente pela função correct_boleto).
create or replace function public.protest_transition_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare allowed text[];
begin
  if new.status is distinct from old.status and coalesce(current_setting('app.protest_correction', true), '') <> 'on' then
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

-- 2) Correções:
--   desfazer_protesto  → protesto volta a "não encaminhado" (lançado por engano)
--   forma_pagamento    → corrige a forma de recebimento registrada (ex.: Pix → boleto)
--   estornar_pagamento → estorna os pagamentos do título (lançado por engano) e o boleto volta a ativo
create or replace function public.correct_boleto(p_boleto uuid, p_action text, p_reason text, p_method text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b boletos; r receivables; pay record; n int := 0;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo da correção' using errcode = '22023'; end if;
  select * into b from boletos where id = p_boleto for update;
  if not found then raise exception 'Boleto não encontrado'; end if;
  select * into r from receivables where id = b.receivable_id for update;
  perform set_config('app.audit_reason', 'Correção (' || p_action || '): ' || p_reason, true);

  if p_action = 'desfazer_protesto' then
    if not (has_perm('cobranca', 'approve') or has_perm('admin', 'edit')) then
      raise exception 'Permissão negada: corrigir protesto' using errcode = '42501';
    end if;
    perform set_config('app.protest_correction', 'on', true);
    update protest_records set status = 'nao_encaminhado', sent_at = null, protested_at = null, notary_office = null, protocol_number = null,
           fees_informed = null, anuence_authorized = false, cancellation_requested_at = null, authorized_by = null,
           notes = 'Correção — protesto lançado por engano: ' || p_reason
     where receivable_id = r.id and status <> 'nao_encaminhado';
    get diagnostics n = row_count;
    perform set_config('app.protest_correction', 'off', true);
    if n = 0 then raise exception 'Não há protesto lançado neste boleto' using errcode = 'P0001'; end if;

  elsif p_action = 'forma_pagamento' then
    if not has_perm('financeiro', 'edit') then raise exception 'Permissão negada: corrigir forma de recebimento' using errcode = '42501'; end if;
    if p_method not in ('pix','boleto','dinheiro','cartao_credito','cartao_debito','transferencia','cheque','compensacao','cartorio','outro') then
      raise exception 'Forma de recebimento inválida' using errcode = '22023';
    end if;
    update payments p set method = p_method
      from payment_allocations a where a.payment_id = p.id and a.receivable_id = r.id and not a.reversed and p.reversed_at is null;
    get diagnostics n = row_count;
    if n = 0 then raise exception 'Não há pagamento registrado neste boleto' using errcode = 'P0001'; end if;
    update receivables set payment_method = p_method where id = r.id;

  elsif p_action = 'estornar_pagamento' then
    for pay in select distinct p.id from payments p join payment_allocations a on a.payment_id = p.id
               where a.receivable_id = r.id and not a.reversed and p.reversed_at is null loop
      perform reverse_payment(pay.id, 'Correção: ' || p_reason);  -- exige permissão financeiro/cancel
      n := n + 1;
    end loop;
    if n = 0 then raise exception 'Não há pagamento registrado neste boleto' using errcode = 'P0001'; end if;
    update boletos set status = 'registrado' where id = b.id and status = 'liquidado';
    update pix_charges set status = 'gerado', payment_id = null where receivable_id = r.id and status = 'confirmado';

  else
    raise exception 'Correção inválida' using errcode = '22023';
  end if;
  return jsonb_build_object('boleto_id', b.id, 'action', p_action, 'affected', n);
end $$;
revoke execute on function public.correct_boleto(uuid, text, text, text) from anon, public;
grant execute on function public.correct_boleto(uuid, text, text, text) to authenticated;

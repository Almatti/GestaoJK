-- Controle de situação do boleto pela tela de boletos: cancelar, baixar (retirado do banco sem pagamento) ou
-- reativar, com justificativa auditada. Pagamentos continuam em register_receipt (que liquida o boleto) e a
-- situação cartorária continua em protest_records (pago não encerra protesto automaticamente).
create or replace function public.set_boleto_status(p_boleto uuid, p_status text, p_reason text, p_cancel_receivable boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b boletos; r receivables;
begin
  if not (has_perm('cobranca', 'cancel') or has_perm('financeiro', 'cancel')) then
    raise exception 'Permissão negada: alterar situação do boleto' using errcode = '42501';
  end if;
  if p_status not in ('cancelado', 'baixado', 'registrado') then raise exception 'Situação inválida' using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo' using errcode = '22023'; end if;
  select * into b from boletos where id = p_boleto for update;
  if not found then raise exception 'Boleto não encontrado'; end if;
  select * into r from receivables where id = b.receivable_id for update;
  if b.status = 'liquidado' then raise exception 'Boleto já pago: para desfazer, estorne o pagamento no financeiro' using errcode = 'P0001'; end if;
  if p_status = 'registrado' and r.status = 'cancelado' then raise exception 'O título deste boleto está cancelado' using errcode = 'P0001'; end if;

  perform set_config('app.audit_reason', 'Boleto ' || p_status || ': ' || p_reason, true);
  update boletos set status = p_status where id = b.id;

  if p_status <> 'registrado' then
    -- Lembretes de cobrança do título deixam de ser enviados.
    update message_queue set status = 'cancelada', cancel_reason = 'Boleto ' || p_status
     where ref_type = 'receivable' and ref_id = r.id and status in ('gerada', 'aberta');
    update protest_records set status = 'nao_encaminhado', notes = 'Boleto ' || p_status || ' antes do encaminhamento'
     where receivable_id = r.id and status = 'programado';
  end if;

  if p_cancel_receivable and p_status = 'cancelado' then
    if r.paid_amount > 0 then raise exception 'Há pagamentos no título: estorne-os antes de cancelá-lo' using errcode = 'P0001'; end if;
    if r.status in ('em_aberto', 'parcialmente_pago') then
      update receivables set status = 'cancelado', notes = coalesce(notes || E'\n', '') || 'Cancelado com o boleto: ' || p_reason where id = r.id;
    end if;
  end if;
  return jsonb_build_object('boleto_id', b.id, 'status', p_status);
end $$;
revoke execute on function public.set_boleto_status(uuid, text, text, boolean) from anon, public;
grant execute on function public.set_boleto_status(uuid, text, text, boolean) to authenticated;

-- Forma de recebimento "Pago no cartório": o cliente quitou no tabelionato e o valor foi repassado.
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('pix','boleto','dinheiro','cartao_credito','cartao_debito','transferencia','cheque','compensacao','cartorio','outro'));

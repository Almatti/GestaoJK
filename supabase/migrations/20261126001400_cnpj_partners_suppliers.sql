-- Consulta de CNPJ também em parceiros e fornecedores: campos para dados oficiais (fonte e data registradas).
alter table public.partners
  add column if not exists trade_name text,
  add column if not exists state_registration text,
  add column if not exists cep text,
  add column if not exists street text,
  add column if not exists number text,
  add column if not exists complement text,
  add column if not exists district text,
  add column if not exists city text,
  add column if not exists state char(2),
  add column if not exists company_data jsonb,
  add column if not exists registration_checked_at timestamptz;
alter table public.suppliers
  add column if not exists state_registration text,
  add column if not exists cep text,
  add column if not exists company_data jsonb,
  add column if not exists registration_checked_at timestamptz;

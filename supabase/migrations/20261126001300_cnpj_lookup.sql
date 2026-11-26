-- Consulta de CNPJ em tempo real (CNPJá): dados completos da Receita Federal guardados com fonte e data.
alter table public.customers
  add column if not exists company_data jsonb,
  add column if not exists registration_checked_at timestamptz;
alter table public.company
  add column if not exists registry_data jsonb,
  add column if not exists registry_checked_at timestamptz;

insert into public.integrations (provider, name) values ('cnpja', 'Consulta CNPJ (CNPJá)') on conflict (provider) do nothing;

-- Parâmetros configuráveis (cada consulta online consome créditos da CNPJá; o cache reduz o consumo).
insert into public.settings (key, value, description) values
  ('cnpj.max_age_days', '30', 'Validade (dias) dos dados de CNPJ em cache antes de nova consulta online'),
  ('cnpj.include_simples', 'true', 'Incluir Simples Nacional/MEI na consulta de CNPJ (+1 crédito online)'),
  ('cnpj.include_registrations', 'true', 'Incluir inscrição estadual na consulta de CNPJ (+1 crédito online)')
on conflict (key) do nothing;

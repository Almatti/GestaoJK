# Implantação

> **Ambiente atual (26/11/2026):** Supabase "Almatti's Project" (`vqklluhzbxngsjpopzxw`) com as migrations 0100–1200
> aplicadas e as 3 Edge Functions publicadas; frontend na **Vercel** (projeto `gestaojk`) com `VITE_SUPABASE_URL` e
> `VITE_SUPABASE_ANON_KEY`. Os passos abaixo servem para recriar o ambiente do zero.
> Migrar do modo local: entre como administrador → Administração → Backups → "Trazer dados do modo local".

## 1. Supabase (banco, autenticação, arquivos, funções)
1. Crie um projeto em https://supabase.com (região São Paulo recomendada).
2. Aplique as migrations, em ordem:
   - CLI: `supabase link --project-ref <ref>` e `supabase db push`; ou
   - SQL Editor: execute cada arquivo de `supabase/migrations` na ordem do nome.
3. Authentication → Providers → Email: **desative "Allow new users to sign up"** (sem cadastro público). Configure o *Site URL* com o domínio do app e habilite MFA se desejar.
4. Crie o primeiro usuário em Authentication → Users → *Add user* (ele vira administrador automaticamente).
5. Verifique que `pg_cron` está habilitado (Database → Extensions) e que o job `jk-run-automations` existe (`select * from cron.job`). Se a extensão foi habilitada depois das migrations, rode novamente o bloco de agendamento da migration 0800.
6. (Opcional) Publique as Edge Functions e segredos — ver INTEGRATIONS.md.

## 2. Frontend (Vercel — atual; ou Cloudflare Pages)
Vercel: o repositório já tem `vercel.json`; defina as duas variáveis em Settings → Environment Variables e publique.

Cloudflare Pages:
1. Cloudflare → Workers & Pages → Create → Pages → conecte o repositório GitHub.
2. Build: `npm run build`; diretório de saída: `dist`; Node 22.
3. Variáveis: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (pública). **Nunca** a service_role.
4. `public/_redirects` (SPA) e `public/_headers` (segurança/CSP) são publicados automaticamente. Se usar outros domínios de API, ajuste o `connect-src` da CSP.
5. Configure o domínio próprio e, no Supabase, adicione-o em Auth → URL Configuration.

## 3. Ambiente de demonstração separado
Crie um segundo projeto no Cloudflare Pages com `VITE_APP_MODE=demo` (sem variáveis do Supabase). Os dados ficam só no navegador de cada visitante e nunca se misturam com produção.

## 4. Checklist de produção
- [ ] Migrations aplicadas e `npm run test:db` verde no CI
- [ ] Cadastro público desativado; primeiro admin criado
- [ ] Dados da empresa e chave Pix em Configurações
- [ ] Regras de cobrança (multa/juros/protesto) definidas com o jurídico
- [ ] Margem mínima e tributos estimados revisados
- [ ] Tamanhos de barril, produtos, custos e preços reais cadastrados
- [ ] Rotina de backup agendada e restauração testada (BACKUP_AND_RESTORE.md)
- [ ] Integrações desejadas configuradas (ou mantidas como pendentes)

## Atualizações
Novas versões: merge na branch principal → Cloudflare publica; o PWA mostra "Nova versão disponível" e o usuário decide quando atualizar. Mudanças de banco sempre por nova migration.

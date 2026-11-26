# JK CHOPP GESTÃO

Sistema interno de gestão da **JK CHOPP** — distribuidora de chopp para eventos e pontos fixos. Reúne ERP, CRM, financeiro, cobrança e protestos, patrimônio, estoque, logística, assistência técnica, agenda, tarefas, marketing, metas, automações e um assistente inteligente — com uma regra central: **uma informação cadastrada uma única vez alimenta todos os módulos**.

> Aplicação web responsiva e PWA instalável (computador, tablet, Android e iOS). Português do Brasil, BRL, fuso America/Sao_Paulo, datas DD/MM/AAAA.

## Usar agora (sem servidor)
Abra o endereço publicado na Vercel, informe seu nome e comece a usar. Os dados ficam no navegador do aparelho:
**baixe um backup em Administração → Backups pelo menos uma vez por semana**. Quando o Supabase for configurado,
os dados serão levados para o servidor.

## Começo rápido

```bash
npm install
cp .env.example .env.local          # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm run dev                         # http://localhost:5173
```

Sem Supabase configurado, a tela inicial oferece o **ambiente de demonstração** (dados fictícios, salvos apenas no navegador, com faixa de aviso permanente). Para forçar: `VITE_APP_MODE=demo npm run dev`.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Verificação de tipos + build de produção (PWA) em `dist/` |
| `npm run typecheck` / `npm run lint` | TypeScript strict / ESLint |
| `npm test` | Testes unitários (Vitest) |
| `npm run test:db` | Aplica as migrations num PostgreSQL local descartável e roda os testes SQL (RLS, cenários 1–9) |
| `npm run test:e2e` | Testes end-to-end (Playwright) no ambiente de demonstração |
| `bash scripts/test-backup-restore.sh` | Testa backup + restauração em bancos locais |

## Stack

React 19 · TypeScript strict · Vite 8 · Tailwind CSS 4 · TanStack Query · React Hook Form + Zod · Recharts · Lucide · React Router · date-fns · vite-plugin-pwa · Supabase (PostgreSQL, Auth, Storage, Edge Functions, pg_cron) · Vitest · Testing Library · Playwright · Cloudflare Pages.

## Documentação

| Documento | Conteúdo |
|---|---|
| [PRD.md](PRD.md) | Requisitos do produto |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Arquitetura e decisões técnicas |
| [DATABASE.md](DATABASE.md) | Modelo de dados, funções e RLS |
| [BUSINESS_RULES.md](BUSINESS_RULES.md) | Regras de negócio (margem, juros, protesto, parceiros…) |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Identidade Tangerine Rush e componentes |
| [INTEGRATIONS.md](INTEGRATIONS.md) | Integrações e o que depende de credenciais |
| [SECURITY.md](SECURITY.md) | Segurança, permissões e LGPD |
| [AUTOMATIONS.md](AUTOMATIONS.md) | Motor de automações |
| [TESTING.md](TESTING.md) | Estratégia e execução de testes |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Implantação (Supabase + Cloudflare Pages) |
| [MAINTENANCE.md](MAINTENANCE.md) | Manutenção e evolução |
| [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md) | Backups e restauração |
| [USER_GUIDE.md](USER_GUIDE.md) | Manual do usuário |
| [PROGRESS.md](PROGRESS.md) | Estado do projeto, pendências e matriz de rastreabilidade |
| [CHANGELOG.md](CHANGELOG.md) | Histórico de versões |
| [CLAUDE.md](CLAUDE.md) | Diretrizes permanentes de desenvolvimento |

# Changelog

Formato baseado em Keep a Changelog; versões semânticas.

## [0.2.0] — 26/11/2026
### Adicionado
- **Modo local**: uso real imediato sem servidor (dados no navegador, começa vazio), login por nome + PIN opcional,
  backup/restauração completos por arquivo, lembrete de backup, aviso permanente.
- RPCs do modo local: estorno, renegociação, recebimento de compras, fechamento/estorno de parceiros, reservas de equipamentos.
- Publicação na Vercel (`vercel.json`), roteamento por hash e build estático opcional (`npm run build:local`).

## [0.1.0] — 26/11/2026
### Adicionado
- Fundação: Vite 8 + React 19 + TypeScript strict + Tailwind 4 (identidade Tangerine Rush), PWA instalável.
- Domínio testado: documentos (CPF/CNPJ alfanumérico), dinheiro, precificação, cobrança, Pix BR Code, mensagens, saúde comercial, parceiros, estoque, patrimônio, automações, recorrência, permissões.
- Banco Supabase/PostgreSQL: 10 migrations, RLS em todas as tabelas, auditoria com mascaramento, funções transacionais idempotentes, motor de automações com pg_cron.
- Módulos: dashboard, CRM, condições comerciais, saúde comercial, produtos/serviços, simulador, pedidos, financeiro completo, boletos, Pix, cobranças/WhatsApp, protestos/anuência, fluxo de caixa, conciliação OFX, relatórios/DRE, estoque, patrimônio/QR, OS, logística, compras, parceiros, agenda, tarefas, rotinas, reuniões, notas, marketing, metas, planejamento, assistente, notificações, administração.
- Edge Functions: invite-user, ai-assistant (Gemini opcional), google-sync (OAuth, push idempotente).
- Ambiente de demonstração isolado com dados fictícios sinalizados.
- Testes: Vitest, testes SQL dos cenários 1–9, Playwright E2E, teste de backup/restauração; CI.
- Documentação completa (README, CLAUDE, PRD, arquitetura, banco, regras, design system, integrações, segurança, automações, testes, implantação, manutenção, backup, manual, progresso).

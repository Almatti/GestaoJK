# CLAUDE.md — Diretrizes permanentes do JK CHOPP GESTÃO

Ao iniciar uma sessão: leia **PROGRESS.md**, **PRD.md**, **BUSINESS_RULES.md** e este arquivo; inspecione o repositório; retome da próxima etapa pendente. Nunca recomece do zero.

## Regras invioláveis
- Idioma pt-BR, moeda BRL, fuso America/Sao_Paulo, datas DD/MM/AAAA, 24 h.
- Dinheiro: centavos inteiros no TS (`src/domain/money.ts`), `NUMERIC` no banco. Nunca `float` para persistir.
- Margem ≠ markup. Faturamento ≠ recebimento. Situação financeira ≠ situação cartorária.
- Preços, juros, prazos, margens, tamanhos de barril: **sempre configuráveis** (tabelas `settings`, `collection_rules`, `keg_sizes`…), nunca fixos no código.
- Pedidos guardam snapshot de preço; valores históricos nunca são recalculados.
- Sem exclusão de histórico financeiro: cancelar/estornar/arquivar com auditoria.
- Autorização no banco (RLS + `has_perm`) — a interface só esconde ações. Matriz única: `src/domain/permissions.ts` → `npm`/`node scripts/gen-permissions-seed.ts` gera a migration de permissões.
- Operações multi-módulo = função SQL transacional e idempotente (`confirm_order`, `register_receipt`, `finalize_service_order`, `close_partner_month`, `run_automations`…).
- Não simular integrações, pagamentos ou envios. WhatsApp apenas por link oficial; abrir ≠ enviar.
- IA: só interpreta resultados determinísticos; nunca calcula valores; nunca executa ações críticas.
- Nunca expor service_role/tokens no frontend nem registrar documentos completos em logs.
- Dados de demonstração só no modo demo (`VITE_APP_MODE=demo` ou botão na tela de configuração) e sempre sinalizados.

## Onde fica cada coisa
- `src/domain/` regras puras e testadas (fonte da verdade no cliente).
- `src/data/` cliente de dados (Supabase ou demo). Selects com relação usam `alias:tabela(cols)` onde `alias_id` é a FK.
- `src/features/<módulo>/` telas. Cadastros simples usam `features/resource` (definições declarativas em `definitions.tsx`).
- `src/config/` navegação, configurações tipadas, modelos padrão.
- `src/styles/index.css` tokens de design (Tailwind v4 `@theme`) e utilitários `glass`, `surface`, `card`, `input`.
- `supabase/migrations/` migrations versionadas; `supabase/tests/` testes SQL; `supabase/functions/` Edge Functions.

## Fluxo de trabalho
1. Regra nova → implemente em `src/domain` com teste, e no SQL quando for transacional (+ teste em `supabase/tests`).
2. Mudança de banco → nova migration (nunca editar migration já aplicada em produção).
3. Antes de commitar: `npm run check` e `npm run test:db`; para UI, `npm run test:e2e`.
4. Atualize PROGRESS.md e CHANGELOG.md.

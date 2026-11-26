# Arquitetura

## Visão geral
Monólito modular sem microserviços:

```
Navegador (React PWA) ──HTTPS──► Supabase
  ├─ src/domain   regras puras         ├─ PostgreSQL (tabelas, views, RLS, funções transacionais)
  ├─ src/data     cliente de dados     ├─ Auth (convite/aprovação)
  ├─ src/features telas por módulo     ├─ Storage (bucket privado "documentos", URLs assinadas)
  └─ service worker (casca offline)    ├─ Edge Functions (invite-user, ai-assistant, google-sync)
                                       └─ pg_cron → run_automations() diário
Integrações públicas diretas do navegador: ViaCEP, BrasilAPI (CNPJ). Demais via Edge Functions.
```

## Camadas
| Camada | Local | Responsabilidade |
|---|---|---|
| Domínio | `src/domain/*.ts` | Cálculos determinísticos testados (dinheiro, documentos, precificação, cobrança, Pix, saúde, parceiros, estoque, patrimônio, automação, recorrência, permissões) |
| Persistência e regras transacionais | `supabase/migrations` | Esquema, restrições (exclusão de sobreposição, unicidades de idempotência, saldo não negativo), RLS, RPCs atômicas, auditoria |
| Acesso a dados | `src/data` | Interface `DataClient` com duas implementações: Supabase (produção) e Demo (navegador) |
| Interface | `src/features`, `src/components` | Telas, design system, layout |
| Integrações | `src/lib/integrations`, `supabase/functions` | Adaptadores substituíveis |

## Decisões (ADR resumido)
1. **Supabase + RLS** como backend: autenticação, autorização no banco e funções SQL evitam um servidor próprio (custo zero, manutenção simples).
2. **Regras transacionais em SQL** (`security definer` + `require_perm`): confirmação de pedido, recebimento, OS, compras e fechamento de parceiros precisam de atomicidade e idempotência garantidas pelo banco (índices únicos parciais, `for update`, `exclude using gist`).
3. **Domínio duplicado conscientemente** em TS para cálculos de tela (simulador, margem em tempo real, saúde) e no SQL para persistência. Os testes de ambos cobrem os mesmos casos (ex.: juros 2%+1% a.m. → R$ 1.025,00).
4. **Status derivados não são gravados**: "vencido"/"a vencer" vêm de `receivables_view` pela data atual em São Paulo.
5. **Modo demonstração** isolado (`src/data/demo`), com dados fictícios marcados "(DEMO)" e faixa permanente — atende ao requisito de ambiente de demonstração separado e permite E2E sem credenciais. Nunca usado quando o Supabase está configurado (exceto se `VITE_APP_MODE=demo`).
6. **Cadastros declarativos** (`features/resource`): uma definição gera lista/tabela/cards, busca, filtros, paginação, ordenação, formulário validado (Zod), rascunho, exportação e arquivamento — reduz código duplicado.
7. **Tailwind v4 com tokens em `@theme`**: identidade centralizada em um arquivo.
8. **Versões**: React 19.3, Vite 8 (Rolldown), Tailwind 4.3, TanStack Query 5, Zod 4, React Router 8, Recharts 3, Vitest 5, Playwright 1.65, TypeScript 6 — estáveis na data do projeto.

## Fluxo de dados exemplo — confirmação de pedido
1. Tela chama `rpc('confirm_order')`.
2. Função verifica permissão, margem (exige aprovação + justificativa abaixo do mínimo), reserva estoque com bloqueio, reserva equipamentos (constraint impede conflito), gera parcelas com snapshot da regra de cobrança, agenda entrega/recolhimento e evento, cria tarefa, registra histórico e interação no CRM.
3. Chamadas repetidas retornam `already_confirmed` sem duplicar efeitos.
4. TanStack Query invalida todas as consultas → dashboard, financeiro, estoque e agenda refletem a mudança.

## Estrutura de pastas
```
src/
  domain/       regras puras + testes
  data/         DataClient (supabase | demo), hooks TanStack Query
  config/       env, navegação, configurações tipadas, modelos
  components/   ui (Button, Modal, Form, Feedback, Layout, Toast, Attachments) e layout (AppShell, CommandPalette…)
  features/     auth, dashboard, customers, orders, products, finance, operations, partners, organization, strategy, assistant, admin, notifications, resource
  lib/          export (CSV/Excel/PDF), format, ofx, integrations (CEP, CNPJ)
supabase/
  migrations/   0100 fundação → 1000 segredos de integração
  tests/        stub do Supabase + cenários SQL
  functions/    invite-user, ai-assistant, google-sync
e2e/            Playwright
scripts/        test-db, backup, restore, test-backup-restore, gen-permissions-seed, gen-icons
```

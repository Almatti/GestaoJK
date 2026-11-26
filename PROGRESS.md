# PROGRESS — estado do projeto

_Atualizado em 26/11/2026 · branch `ccr-b5a6f6b1-80wvkw`_

## Uso imediato (sem servidor) — MODO LOCAL
O app publicado abre no **modo local** enquanto o Supabase não estiver configurado (`.env.production` → `VITE_APP_MODE=local`):
começa vazio (sem dados fictícios), guarda tudo no navegador do dispositivo (`localStorage`, chave `jk-local-db-v1`),
tem PIN opcional, lembrete de backup semanal e **backup/restauração por arquivo JSON** (Administração → Backups).
Limitações: dados por navegador (sem sincronização entre aparelhos), sem anexos, sem perfis múltiplos reais,
sem trilha de auditoria e algumas funções avançadas exibem aviso. Ao configurar o Supabase, ele passa a ter prioridade;
a importação do backup local para o Supabase é a próxima etapa a implementar.

## Resumo
Fases 1 a 8 implementadas em primeira versão funcional: domínio testado, banco com RLS e funções transacionais, ~45 telas, PWA, assistente determinístico, motor de automações, Edge Functions, backups, CI e documentação. **Não está em produção**: falta aplicar as migrations em um projeto Supabase real, cadastrar dados reais e configurar integrações que dependem de credenciais.

## Implementado e testado
| Fase | Itens |
|---|---|
| 1 Fundação | Arquitetura, design system Tangerine Rush, 10 migrations, RLS em todas as tabelas, autenticação por convite/aprovação, permissões granulares (matriz única), navegação (menu lateral, inferior, busca global, criação rápida), configurações tipadas e versionadas |
| 2 Comercial | CRM PF/PJ (CPF, CNPJ numérico e alfanumérico, duplicidade, CEP, consulta CNPJ com fonte/data, status de verificação), perfil 360° com abas, condições comerciais com vigência, preços personalizados, hierarquia de preço (TS + SQL), produtos/tamanhos/variantes/categorias/marcas, serviços, simulador de precificação, pedidos (confirmação atômica e idempotente, exceção de margem auditada, status, cancelamento, duplicação com preços vigentes) |
| 3 Financeiro | Receber/pagar, parcelas, parciais, juros/multa (regra com snapshot), renegociação, estorno, contas/caixa, transferências, categorias/DRE, centros de custo, fluxo de caixa, DRE gerencial, conciliação OFX, boletos (cadastro manual), Pix estático, cobranças com fila WhatsApp, protestos com transições validadas, anuência em PDF, relatórios CSV/Excel/PDF |
| 4 Operação | Estoque por movimentações (lotes, validade, FEFO, sem negativo, reservas, sugestão de compra), patrimônio (ficha, QR Code, custódia, reservas sem conflito, assepsia/manutenção), OS (checklist, peças, finalização integrada), logística (dia/semana/mês, agrupamento, navegação externa, eventos, conflitos), compras (cotações, aprovação, recebimento parcial → estoque e contas a pagar, variação de custo), parceiros (extrato, fechamento mensal idempotente, estorno) |
| 5 Organização | Agenda (5 visões, recorrência RRULE: toda terça, quinzenal), tarefas (kanban, lista, minha rotina, planejamento semanal/mensal, subtarefas, checklist, comentários), rotinas/hábitos com % de conclusão, reuniões (modelos, decisões → tarefas, ata PDF), notas com rascunho automático |
| 6 Estratégia | Dashboard com KPIs reais, comparação de períodos e central de atenção; saúde comercial; metas ligadas a KPIs reais; marketing (campanhas/UTM, conteúdos, leads, métricas com origem, CPL/CAC/ROAS/ROI); SWOT/riscos/OKRs/projetos |
| 7 Automações e IA | Motor no servidor (pg_cron) idempotente; fila de mensagens; notificações com dedup e push opcional; assistente com 11 intenções determinísticas, fontes e limitações; adaptador Gemini opcional com anonimização e limite |
| 8 Validação | 58 testes unitários, 73 asserções SQL (cenários 1–9), 15 E2E (desktop+mobile), teste de backup/restauração, build/lint/typecheck, CI GitHub Actions, PWA (manifest, ícones, SW com atualização controlada), cabeçalhos de segurança, documentação |

## Integrações dependentes de credenciais (pendentes)
Supabase (projeto real), Google Agenda/Tasks (OAuth), Gemini API, WhatsApp Business Platform (paga), Serpro (paga), API do banco (boletos/CNAB), API Pix dinâmica, Meta/Instagram. Todas com interface preparada e alternativa manual funcional (ver INTEGRATIONS.md).

## Decisões técnicas
Ver ARCHITECTURE.md (ADR). Destaques: regras transacionais em SQL; status derivados não gravados; modo demonstração isolado; cadastros declarativos; tokens em `@theme`; empresa única (sem multi-tenant — tabela `company` singleton).

## Problemas conhecidos / limitações
- Ambiente demo implementa apenas um subconjunto das RPCs (as demais exibem aviso de que exigem Supabase).
- Custos logísticos e de manutenção ainda não são rateados por cliente na rentabilidade.
- Regras de cobrança por cliente existem no banco, mas a edição pela interface cobre só a regra global.
- Acessibilidade e performance sem auditoria automatizada (axe/Lighthouse) — recomendada antes da produção.
- Notificações push usam a permissão do navegador; envio push pelo servidor (Web Push/VAPID) não implementado.
- CNPJ alfanumérico: consulta BrasilAPI pode não suportar até a base pública ser atualizada (tratado como "consulta indisponível").

## Próxima etapa
0. Importador do backup do modo local para o Supabase (quando o servidor for criado).
1. Criar projeto Supabase, aplicar migrations, criar admin, configurar empresa/Pix/regras de cobrança (DEPLOYMENT.md).
2. Publicar no Cloudflare Pages (produção) e um segundo projeto em modo demo.
3. Cadastrar dados reais (produtos, custos, tamanhos, clientes, equipamentos) e validar com a equipe.
4. Auditoria de acessibilidade (axe) e Lighthouse; Web Push no servidor; edição de regras de cobrança por cliente; rateio de custos logísticos.

## Matriz de rastreabilidade (requisito → implementação → teste)
| Req. (seção) | Funcionalidade | Arquivos principais | Teste de aceitação |
|---|---|---|---|
| 7 | Design system Tangerine Rush | `src/styles/index.css`, `src/components/ui/*` | E2E navegação; inspeção visual |
| 8–9 | Navegação, busca global, criação rápida | `components/layout/*`, `config/navigation.ts` | `e2e/navigation.spec.ts` |
| 10 | Dashboard com KPIs reais | `features/dashboard`, `dashboard_metrics()` | E2E; `10_scenarios.sql` (bloco financeiro por perfil) |
| 11 | Validação CPF/CNPJ (alfanumérico), duplicidade | `domain/documents.ts`, trigger `customers_validate` | `documents.test.ts`, `10_scenarios.sql`, `e2e/flows.spec.ts` |
| 12 | Perfil 360° | `features/customers/CustomerProfilePage.tsx` | E2E navegação |
| 13 | Condições e hierarquia de preço | `domain/pricing.ts`, `resolve_price()` | `pricing.test.ts`, Cenário 1 SQL/E2E |
| 14 | Saúde comercial | `domain/health.ts`, `HealthPage` | `misc.test.ts` (Cenário 6) |
| 15–16 | Produtos e precificação | `definitions.tsx`, `PricingSimulatorPage`, `domain/pricing.ts` | `pricing.test.ts`, E2E simulador (R$ 125) |
| 17 | Pedidos e confirmação | `OrderEditorPage`, `confirm_order()` | Cenário 1 SQL + E2E |
| 18 | Financeiro, caixa × competência, DRE | `features/finance/*`, `cash_flow()`, `dre()` | `10_scenarios.sql` (transferência, estorno) |
| 19–20 | Boletos; financeiro × cartorário | `BoletosPage`, `domain/collections.ts`, `combinedStatus` | `collections.test.ts`, Cenário 3 |
| 21 | Regras de cobrança | `CollectionRulesForm`, `collection_rules`, `receivable_charges()` | `collections.test.ts`, Cenário 2 SQL |
| 22 | Protestos e anuência | `ProtestsPage`, `protest_transition_guard` | Cenário 3 SQL/E2E |
| 23 | Pix | `domain/pix.ts`, `PixPage` | `misc.test.ts` (vetor BCB) |
| 24 | WhatsApp por link oficial | `domain/messages.ts`, `WhatsAppButton`, `CollectionsPage` | `misc.test.ts`, E2E fila |
| 25 | Logística | `LogisticsPage` | E2E navegação |
| 26 | Estoque FEFO | `domain/inventory.ts`, `prevent_negative_stock`, `consume_stock_fefo` | `misc.test.ts`, SQL (estoque negativo, entrega) |
| 27 | Patrimônio e QR | `EquipmentDetailPage`, `move_equipment()`, `ex_equipment_reservation` | Cenário 4 SQL, `misc.test.ts` |
| 28 | Ordens de serviço | `ServiceOrderDetailPage`, `finalize_service_order()` | Cenário 5 SQL |
| 29 | Compras | `PurchaseDetailPage`, `receive_purchase()` | E2E navegação |
| 30 | Parceiros | `PartnerDetailPage`, `close_partner_month()` | Cenário 7 SQL + `misc.test.ts` |
| 31–32 | Agenda e Google | `AgendaPage`, `domain/recurrence.ts`, `functions/google-sync` | `recurrence.test.ts` |
| 33–34 | Tarefas, rotinas, reuniões, notas | `features/organization/*` | E2E navegação |
| 35–37 | Marketing, analytics, metas | `features/strategy/*`, `kpi_value()` | E2E navegação |
| 38 | Assistente | `features/assistant/*`, `functions/ai-assistant` | `intents.test.ts`, E2E assistente |
| 39 | Automações idempotentes | `run_automations()`, `domain/automation.ts` | Cenário 8 (unit, SQL, E2E) |
| 40 | Notificações | `NotificationsPage`, `notifications.dedup_key` | SQL (alertas), E2E |
| 41 | Relatórios e exportações | `ReportsPage`, `lib/export.ts` | E2E navegação |
| 42 | Configurações centralizadas | `SettingsPage`, `config/settings.ts`, `settings_history` | E2E navegação |
| 43 | Banco normalizado, migrations | `supabase/migrations/*` | `npm run test:db` |
| 44 | Segurança/RLS/LGPD | `0600_rls`, `SECURITY.md`, `audit_row()`/`redact()` | Cenário 9 SQL, mascaramento em auditoria |
| 45 | PWA | `vite.config.ts`, `PwaUpdatePrompt`, ícones | build (SW gerado) |
| 46 | Integrações / custo zero | `IntegrationsPage`, `INTEGRATIONS.md` | — |
| 47 | Backups | `scripts/backup.sh`, `restore.sh` | `scripts/test-backup-restore.sh` |
| 48 | Documentação | arquivos `*.md` na raiz | — |
| 49 | QA | `TESTING.md`, CI | todos acima |

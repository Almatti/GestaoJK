# Banco de dados (PostgreSQL / Supabase)

Migrations versionadas em `supabase/migrations` (aplicar em ordem). Testes em `supabase/tests` (`npm run test:db`).

| Migration | Conteúdo |
|---|---|
| `0100_foundation` | extensões (btree_gist, pg_trgm, unaccent), `company`, `settings` (+ `settings_history` versionado), `holidays`, `roles`, `profiles`, `role_permissions`, `user_invitations`, trigger de novo usuário (inativo; 1º usuário = admin; convite ativa), `has_perm`, `require_perm`, `audit_logs` + `audit_row()` com mascaramento, `attachments` |
| `0200_commercial` | `customers` (validação CPF/CNPJ alfanumérico no servidor, unicidade de documento), contatos, verificações (fonte/data), interações, categorias, marcas, `keg_sizes`, `suppliers`, `products` (+ histórico de preços), `product_variants`, `price_tables(_items)`, `commercial_conditions` e `customer_product_prices` (vigência sem sobreposição — `exclude using gist`), `resolve_price()`, snapshots de saúde |
| `0300_operations_orders` | estoque (`stock_items`, lotes, movimentações com saldo não negativo, reservas, views `stock_positions`/`lot_balances`), patrimônio (tipos, `equipment`, movimentações, reservas sem conflito, agendas de manutenção), serviços e OS, parceiros, `orders`/`order_items` (snapshot de preço, colunas geradas, recálculo de totais, itens bloqueados após confirmação), histórico de status, veículos, `deliveries`, compras/cotações |
| `0400_finance` | contas, categorias (grupo DRE), centros de custo, `collection_rules` (global + por cliente, vigência), `receivables` (parcelas, snapshot da regra, unicidade por pedido/parcela e por OS), `receivables_view` (status derivado), `payables`, `payments` (idempotency_key, conferência, estorno), `payment_allocations`, `financial_transactions` (razão; transferências separadas), `account_balances`, importações de extrato, `boletos`, `pix_charges`, `protest_records` (+ histórico e guarda de transições; encaminhamento exige aprovação), `document_templates` (anuência), `anuence_documents` |
| `0500_org_strategy_automation` | razão e fechamentos de parceiros (crédito único por pedido), agenda (RRULE, id externo), projetos, tarefas (subtarefas, checklist, `source_key` idempotente), comentários, rotinas/hábitos, reuniões, notas, marketing (campanhas com UTM, conteúdos, métricas com origem, leads), estratégia, metas, modelos de mensagem, `message_queue` (dedup, estados, entrega só via API), notificações (dedup), regras/execuções/execuções-do-motor de automação, integrações, registros de sincronização, uso de IA |
| `0600_rls` | RLS em todas as tabelas via mapa `resource_tables`; políticas especiais (recebíveis, perfis, auditoria, notificações, anexos); revogação total do papel `anon`; políticas do bucket privado |
| `0700_business_functions` | `effective_collection_rule`, dias úteis, `receivable_charges`, `confirm_order`, `set_order_status` (baixa FEFO na entrega), `consume_stock_fefo`, `cancel_order`, `duplicate_order`, `register_receipt`, `reverse_payment`, `pay_payable`, `transfer_between_accounts`, `renegotiate_receivable`, `finalize_service_order`, `schedule_service_order`, `move_equipment`, `receive_purchase`, `close_partner_month`, `reverse_partner_entry` |
| `0800_analytics_automation` | `customer_consumption`, `dashboard_metrics` (bloco financeiro só para quem pode), `cash_flow`, `dre`, `kpi_value`, `global_search` (security invoker), motor `run_automations` (idempotente, advisory lock, falhas registradas), agendamento pg_cron |
| `0900_seed_permissions` | Matriz de permissões gerada de `src/domain/permissions.ts` (não editar à mão) |
| `1000_integration_secrets` | Tokens de integração acessíveis só pelo service_role; limite diário de IA |

## Convenções
- PK `uuid` (`gen_random_uuid()`); números sequenciais legíveis (`orders.number`, `service_orders.number`) por `identity`.
- Dinheiro `numeric(14,2)`; preço/custo por litro `numeric(14,4)`; datas comerciais `date`; carimbos `timestamptz`; `today_sp()` para "hoje" em São Paulo.
- Estados como `text` + `check` (evolução simples por migration).
- Nenhuma FK financeira com `on delete cascade`; políticas de `delete` só em tabelas auxiliares (itens de rascunho, notas, checklists).
- Idempotência por índices únicos parciais: recebível por pedido/parcela, OS, entrega por pedido/tipo, crédito de parceiro por pedido, fechamento por parceiro/mês, mensagem por `dedup_key`, notificação por `dedup_key`, execução de automação por `idempotency_key`, pagamento por `idempotency_key`, movimentação de estoque por referência.
- Concorrência: `select … for update` no item/pedido/título; constraint trigger de saldo; `exclude using gist` para reservas e vigências; `pg_try_advisory_xact_lock` no motor.

## Permissões
`has_perm(resource, action)` consulta `profiles` (ativo) × `role_permissions`. Funções `security definer` chamam `require_perm` antes de agir. Técnicos não leem recebíveis, pagamentos, boletos, movimentações, saldos, DRE, auditoria (testado no Cenário 9).

## Diagrama simplificado
```
customers ─┬─< commercial_conditions        products ─┬─< product_variants >─ keg_sizes
           ├─< customer_product_prices >────────────────┘
           ├─< orders ─< order_items >── products         stock_items ─< inventory_movements
           │      ├─< receivables ─< payment_allocations >─ payments ─< financial_transactions >─ financial_accounts
           │      │        ├── boletos     ├── pix_charges     └── protest_records ─< protest_status_history
           │      ├─< stock_reservations   ├─< equipment_reservations >─ equipment ─< equipment_movements
           │      └─< deliveries           └── partner_ledger >─ partners ─< partner_settlements
           ├─< service_orders ─< service_order_items >─ stock_items
           └─< customer_interactions / customer_verifications / attachments
```

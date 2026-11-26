# Motor de automações

Modelo **Gatilho → Condição → Ação**, executado no servidor pela função `public.run_automations(dia)`:
- Agendada diariamente às 08:00 (São Paulo) via `pg_cron` (`jk-run-automations`, criada pela migration 0800 quando a extensão existe). Não depende de navegador aberto.
- Também executável pela interface (Cobranças, Automações, Notificações) por quem tem `automacoes/edit`.
- **Idempotência**: cada efeito grava `automation_executions.idempotency_key = regra|entidade|id|janela` (dia, semana, mês ou única). Mensagens e notificações têm `dedup_key` únicos. Rodar duas vezes não duplica (testado: Cenário 8).
- **Concorrência**: `pg_try_advisory_xact_lock` impede execuções simultâneas.
- **Falhas**: cada regra roda em bloco com tratamento de exceção; o erro é gravado e as demais continuam.
- **Recuperação**: se o serviço ficar parado, a próxima execução processa as pendências do dia (vencidos são verificados por intervalo de atraso, não por evento único). Para reprocessar um dia específico: `select run_automations('AAAA-MM-DD')`.

## Regras iniciais
| Regra | Gatilho | Ação |
|---|---|---|
| Lembrete 1 dia antes | boleto_vencendo (days_before=1) | mensagem `lembrete_vencimento` |
| Aviso no dia | boleto_vencendo (0) | mensagem `boleto_hoje` |
| Cobrança após vencimento | boleto_vencido (a cada N dias da regra) | mensagem `boleto_vencido` |
| Aviso antes do protesto | protesto_proximo (1) | mensagem `aviso_protesto` + notificação |
| Confirmação de pagamento | pagamento_recebido | mensagem `confirmacao_pagamento` (se habilitado na regra de cobrança) |
| Estoque mínimo | estoque_minimo | notificação |
| Manutenção/assepsia | manutencao_proxima (7 dias) | notificação |
| Queda de consumo | queda_consumo (< 50% da meta ou queda ≥ 30%) | notificação comercial |
| Tarefas vencidas | tarefa_vencida | notificação ao responsável |
| Equipamentos ociosos | equipamento_ocioso | notificação |

Além disso, o motor **programa encaminhamentos a protesto** (data interna) para boletos vencidos quando a regra de cobrança define `protest_after_days > 0`.

## Mensagens
As mensagens vão para `message_queue` (fila do dia em Financeiro → Cobranças). O usuário abre o WhatsApp pelo link oficial e informa o envio. Ao quitar um título, mensagens financeiras pendentes são canceladas automaticamente.

## Evoluir
Para um novo gatilho: adicione o código em `src/domain/automation.ts` (rótulo) e um ramo em `run_automations` (nova migration com `create or replace function`), usando `queue_receivable_message` ou `notify_once` para manter a idempotência. Teste em `supabase/tests`.

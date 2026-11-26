# Testes e QA

| Camada | Ferramenta | Comando | Escopo |
|---|---|---|---|
| Unitário (domínio) | Vitest | `npm test` | CPF, CNPJ numérico/alfanumérico, dinheiro, precificação/margem/markup, hierarquia de preço, vigência, juros/multa/dias úteis/feriados, status financeiro × cartorário, pagamentos parciais/alocação, Pix (vetor oficial do BCB), WhatsApp/modelos, saúde comercial, parceiros, FEFO/estoque, reservas de equipamentos, automação idempotente, permissões, datas/fuso, recorrência de agenda, OFX, anonimização da IA |
| Banco/integração | PostgreSQL + psql | `npm run test:db` | Aplica todas as migrations sobre um stub do Supabase e executa `supabase/tests/10_scenarios.sql` como usuários reais com RLS |
| End-to-end | Playwright | `npm run test:e2e` (`PW_CHROMIUM=/caminho/chrome` opcional) | Todas as telas sem erros, busca global, pedido completo, validação de documentos, pagamento de título protestado, simulador, assistente, fila idempotente, responsividade sem rolagem horizontal |
| Backup | bash + pg_dump/pg_restore | `bash scripts/test-backup-restore.sh` | Restauração com contagens idênticas |

## Cenários integrados obrigatórios
| # | Cenário | Onde é comprovado |
|---|---|---|
| 1 | Cliente → preço personalizado → pedido → reserva → recebível → entrega | `10_scenarios.sql` (Cenário 1) + `e2e/flows.spec.ts` |
| 2 | Boleto → lembrete → atraso → saldo atualizado → aviso de protesto | `10_scenarios.sql` (Cenário 2) |
| 3 | Pix de boleto protestado → quitação → fim dos lembretes → pendência cartorária mantida | `10_scenarios.sql`, `collections.test.ts`, `e2e/flows.spec.ts` |
| 4 | Equipamento em ponto fixo → movimentação → assepsia agendada → histórico | `10_scenarios.sql` (Cenário 4) |
| 5 | OS finalizada → peças do estoque → cobrança → agenda | `10_scenarios.sql` (Cenário 5) |
| 6 | Queda de consumo → alerta comercial | `misc.test.ts` + `10_scenarios.sql` |
| 7 | Pedido de parceiro → crédito elegível → fechamento sem duplicidade | `misc.test.ts` + `10_scenarios.sql` |
| 8 | Automação executada 2× sem duplicar | `misc.test.ts` + `10_scenarios.sql` + `e2e/flows.spec.ts` |
| 9 | Técnico sem acesso financeiro, inclusive via API | `10_scenarios.sql` (RLS e RPC) + `misc.test.ts` (UI) |
| 10 | App utilizável com API externa indisponível | CEP/CNPJ/IA/Google tratam falhas com alternativa manual (mensagens "consulta indisponível"); demo roda sem nenhuma integração |

## Última execução (26/11/2026)
- Vitest: 8 arquivos, 58 testes — **aprovados**.
- Banco: 10 migrations aplicadas; 73 asserções — **aprovadas**.
- Playwright: 15 testes (desktop + mobile) — **aprovados**.
- Backup/restauração: **aprovado**.
- `tsc --noEmit`, ESLint e `vite build` — **sem erros**.

## Pendente de testes
Acessibilidade automatizada (axe) e performance (Lighthouse) ainda não automatizadas; Edge Functions dependem de credenciais para teste de integração.

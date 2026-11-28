# Changelog

Formato baseado em Keep a Changelog; versões semânticas.

## [0.4.1] — 28/11/2026
### Adicionado
- Pedidos: importação de PDF do pedido (ordem de serviço JK CHOPP). Lê número, data, cliente (CNPJ, contato, endereço),
  entrega, produtos com litragem, forma de pagamento e totais. Vincula a cliente cadastrado (pelo CNPJ) ou cria um novo,
  e vincula a boleto já gerado (o título do boleto passa a ser o título do pedido; a confirmação não gera outro).
  Pedido entra como orçamento, com opção de confirmar na hora. O PDF fica anexado ao pedido.
- Migration 20261128004000_order_import (coluna `orders.external_ref`, função `import_order_pdf`) e testes de banco (31_order_import.sql).

## [0.4.0] — 28/11/2026
### Adicionado
- Módulo Festas: cadastro independente (sem vínculo com clientes), itens com litragem, descontos/acréscimos gerais e por item,
  pagamentos previstos, confirmação de recebimento (exige conferência), correção por estorno sem duplicar, cancelamento
  com regra própria e histórico preservado. Código FST-00001 sequencial.
- Festas: importação de PDF do pedido com prévia para conferência (campos não encontrados ficam em branco), bloqueio de
  PDF duplicado (hash SHA-256) e PDF original guardado como anexo.
- Festas × financeiro: cada festa gera um título a receber (origem Festas, categoria Festas); pagamentos confirmados entram
  em Contas a receber e no caixa; situação pendente / parcialmente pago / pago / vencido / cancelado derivada.
- Festas: calendário mensal e listagem cronológica, filtros por período, cliente, situação financeira e operacional
  (agendado, em preparação, pronto para entrega, entregue, finalizado, cancelado); indicadores e próximos eventos.
- Festas: alertas automáticos diários (3 dias, 2 dias e no dia — prazos configuráveis em Configurações), pagamentos
  vencidos, produtos não conferidos e cadastros incompletos, sem duplicar.
- Festas: planejamento de compras por período (consolidado por produto e litragem, litros, comprado × necessário),
  checklist interativo (comprado, separado, conferido) e impressão da lista de compras e do checklist por evento.
### Alterado
- `receivables.customer_id` passa a aceitar nulo quando o título vem de uma festa (regra `receivables_owner_check`).
- `receivables_view` aceita títulos sem cliente (colunas acrescentadas: `origin`, nome do cliente da festa).
- `register_receipt`: recebimento de título de festa só pela tela Festas; histórico do CRM só quando há cliente.
- Permissão `festas` na matriz única (`src/domain/permissions.ts`) e na migration 20261128003000.
### Testes
- `src/domain/festas.test.ts` (18 testes), `supabase/tests/30_festas.sql` (cadastro, confirmação, correção, estorno,
  cancelamento, permissões, alertas idempotentes, planejamento), E2E de navegação incluindo o aviso sem servidor.

## [0.3.0] — 26/11/2026
### Adicionado
- Boletos: tela de controle com código (nº doc./seu nº), busca, filtros por situação, PDF para anexar/baixar,
  registrar pagamento, cancelar/baixar/reativar (`set_boleto_status`), protesto e alerta de pago com pendência no cartório.
- Boletos: carteira e nosso número lidos do código de barras (Sicoob, Itaú, Bradesco, BB, Santander, Caixa,
  Sicredi); data prevista de protesto calculada pela regra (ex.: 3 dias úteis); feriados nacionais 2025–2030.
- Boletos: leitura da linha digitável/código de barras (FEBRABAN, com dígitos verificadores, fator de
  vencimento 2025) e importação do PDF (texto lido no navegador, arquivo anexado); vínculo com cliente e criação
  automática do título (`create_boleto`, transacional).
- Consulta de CNPJ também em parceiros e fornecedores; banco aceita campos em branco usando o padrão.
- Consulta de CNPJ em tempo real pela CNPJá (Edge Function `cnpj-lookup`): cadastro de clientes e dados da empresa
  (com atualização automática pelo prazo configurado); guarda situação, CNAE, porte, Simples/MEI, IE e sócios (sem CPF).
- Integração Google Agenda/Tasks conectada; páginas públicas de Privacidade e Termos.
- Banco de produção no Supabase (Almatti's Project): todas as migrations aplicadas, Edge Functions publicadas, variáveis na Vercel.
- Importação do backup do modo local para o servidor (`import_local_backup` + tela em Administração → Backups), com testes SQL.
### Segurança
- Migration 1200: funções internas sem execução pela API; `receivable_charges`, `resolve_price` e
  `effective_collection_rule` passam a respeitar a RLS de quem chama; view `customer_consumption` sem acesso anônimo;
  `search_path` fixo em funções utilitárias.

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

# PRD — JK CHOPP GESTÃO

## 1. Visão
Ecossistema interno que transforma os dados da JK CHOPP (distribuidora de chopp para eventos e pontos fixos) em decisões: cadastro único que alimenta comercial, financeiro, cobrança, patrimônio, estoque, logística, assistência técnica, organização e estratégia. **Não** é delivery, marketplace, e-commerce ou locadora de chopeiras — a atividade principal é a venda do líquido; equipamentos são disponibilizados por condições comerciais/comodato.

## 2. Usuários e perfis
Administrador geral, Administrativo, Financeiro, Comercial, Logística, Técnico, Marketing, Colaborador operacional, Somente leitura. Acesso por convite ou aprovação; sem cadastro público. Permissões granulares (ver, criar, editar, aprovar, cancelar, exportar, arquivar) por recurso — ver `src/domain/permissions.ts`.

## 3. Objetivos de negócio
- Margem mínima comercial de **20%** (configurável), medida preferencialmente pela **margem de contribuição**.
- Previsibilidade financeira (caixa × competência, projeção, DRE gerencial).
- Identificar clientes de baixo retorno, baixa rotatividade, inadimplência ou uso ineficiente de equipamentos.
- Profissionalizar cobrança e protestos sem cobrar duas vezes valores já recebidos.
- Rastreabilidade de patrimônio por custódia.

## 4. Requisitos funcionais (resumo por módulo)
| Módulo | Requisitos-chave |
|---|---|
| Dashboard | KPIs reais por período (dia…ano/personalizado), comparação com período anterior, gráficos, central de atenção, drill-down |
| CRM | PF/PJ, CPF/CNPJ (inclui alfanumérico 2026), duplicidade, CEP, consulta CNPJ com fonte/data, status de verificação, perfil 360° com abas |
| Condições comerciais | Vigência, prazos, limites, metas de consumo, serviços inclusos/cobrados, preços por litro e por barril; hierarquia de preços |
| Saúde comercial | Excelente/Saudável/Atenção/Crítico/Inativo; fatores explicáveis; novos clientes não são críticos; sugestões sem decisão automática |
| Produtos/Serviços | Litro como unidade principal, tamanhos livres, preços por tamanho, histórico de preço/custo, catálogo de serviços com gratuidade |
| Precificação | Simulador com tributos, taxas, comissões, frete, perdas; preço mínimo correto para margem |
| Pedidos | Tipos evento/ponto fixo/avulso/recorrente; status; confirmação atômica (estoque, equipamentos, recebíveis, entrega, tarefa); duplicação com preços vigentes; exceção de margem auditada |
| Financeiro | Receber/pagar, parcelas, parciais, juros/multa, renegociação, estorno, contas/caixa, transferências, categorias, centros de custo, fluxo de caixa, DRE gerencial, conciliação OFX, exportações |
| Boletos/Pix/Protestos | Cadastro de boletos emitidos; Pix estático (BR Code); situação financeira e cartorária separadas e combinadas; anuência em PDF; encaminhamento exige aprovação |
| Cobrança/WhatsApp | Modelos editáveis com variáveis; regras automáticas; fila diária; estados gerada/aberta/envio informado/entregue API/falha/cancelada |
| Estoque | Movimentações rastreáveis, físico/reservado/disponível, lotes/validade, FEFO, sem negativo, sugestão de compra |
| Patrimônio | Ficha, QR Code autenticado, custódia, status, reservas sem conflito, alertas de ociosidade/manutenção |
| Assistência técnica | OS com checklist, peças, fotos, aceite; finalização atualiza estoque, patrimônio, agenda e financeiro |
| Logística | Programação dia/semana/mês, agrupamento por cidade/região, navegação externa, eventos de saída/conclusão/ocorrência, conflitos |
| Compras | Solicitação, cotação, comparação, aprovação, recebimento parcial/total → estoque e contas a pagar; variação de custo |
| Parceiros | Regras de crédito, extrato, fechamento mensal idempotente, abatimento de dívida, estorno auditado |
| Organização | Agenda (dia/semana/mês/ano/lista, recorrência), tarefas (kanban, subtarefas, checklist), rotinas/hábitos, reuniões (decisões → tarefas), notas |
| Estratégia | Marketing (campanhas, conteúdos, leads, métricas com origem), metas ligadas a KPIs reais, SWOT/riscos/OKRs/projetos |
| IA | Perguntas respondidas por consultas determinísticas com fontes; IA externa opcional apenas interpreta; anonimização |
| Automações | Gatilho→condição→ação no servidor, idempotência, concorrência, histórico de execuções e falhas |
| Notificações | Categorias, prioridades, lida/resolvida/adiada/arquivada, sem duplicidade, push opcional |
| Administração | Usuários/convites, matriz de permissões, configurações tipadas e versionadas, integrações, auditoria, backups |

## 5. Requisitos não funcionais
WCAG 2.2 AA como objetivo; PWA instalável com cache só da casca (sem dados financeiros offline); responsivo (sem rolagem horizontal no celular); TypeScript strict; RLS em todas as tabelas; LGPD (minimização, mascaramento em logs, exportação controlada); custo zero por padrão.

## 6. Fora de escopo inicial
Emissão bancária real de boletos e Pix dinâmico (dependem de credenciais do banco); WhatsApp Business API (paga); consulta oficial Serpro (paga); métricas sincronizadas da Meta (revisão de app). Todas têm interface preparada e alternativa manual funcional.

## 7. Critérios de aceite
Ver seção 51 da especificação mestre e a matriz em [PROGRESS.md](PROGRESS.md).

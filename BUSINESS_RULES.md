# Regras de negócio

Fonte de verdade: `src/domain/*` (cliente) e funções SQL (servidor). Valores numéricos marcados como *config* ficam em `settings`/`collection_rules` e são editáveis pela interface.

## Comercial
- **Atividade principal**: venda do líquido (por litro). Equipamentos: comodato/condições comerciais — nunca "locação padrão".
- **Hierarquia de preço** (pedido): 1) preço do cliente para produto+tamanho de barril → 2) preço do cliente por litro → 3) tabela comercial vigente (do cliente ou do segmento) → 4) preço do barril do produto → 5) preço por litro do produto. O pedido grava preço, preço/litro, origem e custo (snapshot).
- **Vigência**: condições e preços personalizados têm início/fim sem sobreposição; mudar preço = encerrar vigência e criar nova. Pedidos antigos não mudam.
- **Margem mínima**: 20% *config*; indicador padrão **margem de contribuição** *config*. Abaixo do mínimo, só usuários com permissão `pedidos/approve` confirmam, com justificativa gravada na auditoria.
- **Fórmulas**: custo do produto = custo/L × litros; lucro bruto = receita líquida − CMV; margem bruta = lucro bruto ÷ receita líquida; margem de contribuição = receita líquida − custos/despesas variáveis; preço mínimo = custos absolutos ÷ (1 − margem − taxas percentuais). 20% sobre R$ 100 ⇒ R$ 125 (markup 25%).
- **Saúde comercial** (pontos fixos), separada da situação financeira: razão consumo/meta na janela (30 dias *config*): ≥110% excelente, ≥85% saudável, ≥50% atenção, abaixo crítico; inativo após 60 dias sem pedido; clientes com < 30 dias ou < 2 pedidos = "histórico insuficiente" (não críticos). Fatores e sugestões explicáveis; nenhuma ação automática de bloqueio/encerramento. Ex.: meta 2 barris/semana e consumo de 2 barris/mês ⇒ crítico + baixa rotatividade.

## Pedidos
- Status: orçamento → aguardando confirmação → confirmado → em preparação → aguardando entrega → em rota → entregue → aguardando recolhimento → finalizado; cancelado a qualquer momento antes da entrega (sem pagamentos).
- Confirmação (atômica e idempotente): reserva estoque (sem exceder disponível), reserva equipamentos (sem conflito), gera parcelas (prazo do cliente ou regra global; centavos residuais na 1ª parcela), agenda entrega/recolhimento, cria tarefa e registra no CRM.
- Entrega: reserva → saída física (FEFO); equipamentos passam à custódia do cliente.
- Itens não podem ser alterados após a confirmação. Duplicação usa preços **vigentes**.

## Financeiro e cobrança
- Recebível ≠ dinheiro disponível. Transferência interna não é receita/despesa. Caixa (pagamentos) e competência (pedidos/lançamentos) são exibidos separadamente; DRE gerencial não substitui a contábil.
- **Multa** moratória: percentual *config*, aplicada **uma única vez** sobre o saldo em atraso. **Juros**: simples, *config*, ao mês (pro rata ÷30) ou ao dia. Carência *config*. Vencimento em fim de semana/feriado pode ser prorrogado ao próximo dia útil *config*. Valores iniciais = 0 até a administração definir (contrato, Código Civil, CDC quando aplicável).
- Cada título guarda a regra vigente no lançamento (`collection_rule_snapshot`).
- Pagamento parcial amortiza o principal; encargos ficam registrados à parte. Pagamento idempotente por chave. Comprovante não confirma pagamento: há o indicador "conferido no extrato".
- Estorno e renegociação exigem permissão e justificativa; o título original é preservado ("renegociado").
- **Situação financeira** (em aberto, a vencer, vencido, parcialmente pago, pago, cancelado, renegociado) e **situação cartorária** (não encaminhado … protesto cancelado/retirado) são independentes. Apresentação combinada, ex.: "Pago via Pix, mas ainda em protesto" ⇒ lembretes financeiros são cancelados e é criado alerta para anuência/cancelamento.
- Data **interna** prevista de encaminhamento a protesto (vencimento + N dias corridos/úteis *config*) ≠ data efetiva do protesto. Encaminhamento efetivo exige permissão `cobranca/approve`. Transições cartorárias validadas no banco.
- Declaração de anuência: modelo editável, preenchida automaticamente, sem assinatura digital simulada; versão assinada é anexada.

## Pix e WhatsApp
- Pix estático (BR Code EMV, CRC16) gerado localmente; confirmação somente após conferência no banco/API. Cobrança dinâmica depende do PSP.
- WhatsApp por `https://wa.me/<E.164>?text=<codificado>`; estados: gerada → aberta → envio informado (pelo usuário) → entregue (somente API) / falha / cancelada.

## Estoque e patrimônio
- Físico = Σ movimentações; disponível = físico − reservas ativas; saldo nunca negativo (banco). Líquido (barris cheios) e retornáveis (barris vazios, cilindros) são itens distintos. FEFO por validade; lotes vencidos não são usados.
- Equipamento: status e custódia (cliente, local, desde quando, responsável) por movimentações; reservas sobrepostas proibidas; instalação em ponto fixo agenda assepsia (*config* 15 dias; manutenção 90 dias).

## Assistência técnica
- Finalizar OS: baixa de peças (FEFO), atualiza última/próxima assepsia ou manutenção, conclui evento na agenda e gera cobrança apenas se não gratuita e com valor. Idempotente.

## Parceiros
- Crédito por pedido elegível (confirmado, entregue ou recebido *config por parceiro*): % evento / % ponto fixo + valor fixo. Um crédito por pedido (índice único). Fechamento mensal único por parceiro/mês; créditos abatem a dívida quando habilitado, excedente vira saldo a pagar. Estornos auditados.

## Automações e notificações
- Execução diária no servidor; cada efeito tem chave (regra + entidade + janela). Repetir a execução não duplica nada (Cenário 8). Falhas por regra são registradas sem interromper as demais.

## IA
- Responde apenas com consultas determinísticas e mostra fontes, período e limitações. Provedor externo opcional recebe dados anonimizados (sem CPF/CNPJ/e-mail/telefone), com limite diário e instrução anti prompt-injection; não executa ações.

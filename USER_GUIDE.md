# Manual do usuário — JK CHOPP GESTÃO

## Acesso
Entre com e-mail e senha recebidos por convite. "Esqueci minha senha" envia um link de redefinição. Se aparecer "Acesso aguardando aprovação", peça a um administrador para ativar seu usuário. No celular, use "Adicionar à tela inicial" para instalar o app.

## Navegação
- **Menu lateral** (computador) agrupado em Visão geral, Comercial, Financeiro, Operacional, Organização, Estratégia e Administração. Pode ser recolhido.
- **Celular**: barra inferior (Início, Clientes, botão laranja "Novo pedido", Financeiro, Agenda) e menu ☰.
- **Busca global**: clique na barra de busca ou pressione **Ctrl+K**. Busque por nome, CNPJ, nº do pedido ou código do equipamento.
- **Criar**: botão laranja no topo para novo pedido, cliente, recebimento, OS, tarefa ou compromisso.

## Tarefas do dia a dia
**Cadastrar cliente** — Clientes → Novo cliente. Informe CPF/CNPJ (aceita CNPJ com letras). "Consultar" preenche os dados públicos da empresa; "Buscar" no CEP preenche o endereço. O sistema avisa se o documento já existe. "Formato válido" significa apenas que os dígitos conferem — registre a conferência na aba Cadastro → Verificações.

**Definir preços do cliente** — Perfil do cliente → Condições comerciais. Cadastre prazo, meta semanal de litros/barris e preços por litro ou por barril. Para mudar um preço, use "Encerrar vigência" e crie o novo; pedidos antigos não mudam.

**Registrar pedido** — Pedidos → Novo pedido. Escolha o cliente; ao incluir produto e barril o preço vem automaticamente (veja a etiqueta de origem do preço). Confira o quadro "Resumo e margem". Salve e clique em **Confirmar pedido**: o sistema reserva estoque e equipamentos, gera as contas a receber, agenda a entrega e cria a tarefa de preparação. Depois avance o status (Em preparação → … → Entregue).

**Receber pagamento** — Financeiro → Contas a receber → Receber. Multa e juros são calculados pela regra vigente. Valor menor que o devido = pagamento parcial. Marque "conferido no extrato" quando confirmar no banco.

**Cobrar pelo WhatsApp** — Financeiro → Cobranças mostra a fila do dia. "Abrir WhatsApp" abre a conversa com a mensagem pronta; depois de enviar, clique em **Informar envio**. Títulos quitados saem da fila sozinhos.

**Boletos e Pix** — Cadastre boletos emitidos no banco em Boletos. Em Pix, gere o QR Code/copia e cola (com valor) e envie ao cliente; a baixa é feita em Contas a receber após conferir o crédito.

**Protestos** — Financeiro → Protestos. A situação cartorária é separada da financeira. Se o cliente pagar um título protestado, aparece "Pago, mas ainda em protesto": gere a **declaração de anuência (PDF)**, assine, anexe e acompanhe o cancelamento.

**Equipamentos** — Cada equipamento tem ficha com QR Code (imprima a etiqueta). "Registrar movimentação" muda situação e custódia (ex.: instalado em ponto fixo agenda a próxima assepsia).

**Ordens de serviço** — Abra a OS, agende, preencha checklist, peças e serviço executado e clique em **Finalizar OS**: estoque, ficha do equipamento, agenda e cobrança (se não for gratuita) são atualizados.

**Estoque** — Estoque → Movimentar para entradas, saídas, perdas e ajustes. O sistema não permite saldo negativo e avisa itens abaixo do mínimo com sugestão de compra.

**Parceiros** — Perfil do parceiro mostra o extrato. No fim do mês, **Fechamento mensal** lança os créditos dos pedidos elegíveis e abate a dívida, sem repetir pedidos.

**Agenda, tarefas e reuniões** — Agenda com visões dia/semana/mês/ano/lista e repetição (ex.: toda terça; a cada 15 dias). Tarefas em Kanban (arraste entre colunas), lista ou planejamento semanal/mensal. Em Reuniões, registre pauta, anotações e decisões e converta decisões em tarefas.

**Assistente** — Faça perguntas como "Quais clientes precisam de cobrança?". As respostas mostram fontes e período. O assistente não executa pagamentos nem alterações.

## Administração
Usuários (convidar, aprovar, perfil), Configurações (empresa, Pix, margem mínima, critérios), Modelos de mensagens, Automações, Integrações, Auditoria e Backups.

## Dúvidas comuns
- *"Faturamento" e "Recebido" diferentes?* Faturamento = pedidos confirmados; recebido = dinheiro que entrou.
- *Por que não consigo editar os itens do pedido?* Após confirmar, os itens ficam travados para não alterar valores já lançados — cancele e refaça se necessário.
- *Apareceu "Ambiente de demonstração"?* Você está na versão de testes com dados fictícios; nada é salvo no servidor.

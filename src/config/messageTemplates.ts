/** Modelos iniciais (os oficiais ficam na tabela message_templates e são editáveis pela interface). */
export const DEFAULT_TEMPLATES: [key: string, name: string, category: string, body: string][] = [
  ['lembrete_vencimento', 'Lembrete de vencimento', 'cobranca', 'Olá, [NOME_CLIENTE]! Aqui é da [NOME_EMPRESA]. Lembramos que o título no valor de [VALOR_ORIGINAL] vence em [DATA_VENCIMENTO]. Qualquer dúvida, estamos à disposição.'],
  ['boleto_hoje', 'Boleto vencendo hoje', 'cobranca', 'Olá, [NOME_CLIENTE]! O boleto de [VALOR_ORIGINAL] vence hoje ([DATA_VENCIMENTO]). Linha digitável: [LINHA_DIGITAVEL]. Obrigado! — [NOME_EMPRESA]'],
  ['boleto_vencido', 'Boleto vencido', 'cobranca', 'Olá, [NOME_CLIENTE]. Identificamos que o título de [VALOR_ORIGINAL], vencido em [DATA_VENCIMENTO], está em aberto há [DIAS_ATRASO] dia(s). Valor atualizado: [VALOR_ATUALIZADO]. Podemos ajudar na regularização? — [NOME_EMPRESA]'],
  ['pix_pendente', 'Pix pendente', 'cobranca', 'Olá, [NOME_CLIENTE]! Segue a chave Pix para pagamento de [VALOR_ORIGINAL]: [CHAVE_PIX]. Após o pagamento, envie o comprovante por aqui. — [NOME_EMPRESA]'],
  ['pagamento_atraso', 'Pagamento em atraso', 'cobranca', 'Olá, [NOME_CLIENTE]. O pagamento de [VALOR_ATUALIZADO] está em atraso desde [DATA_VENCIMENTO]. Por favor, entre em contato para regularizarmos. — [NOME_EMPRESA]'],
  ['aviso_protesto', 'Aviso de encaminhamento a protesto', 'cobranca', 'Olá, [NOME_CLIENTE]. O título de [VALOR_ORIGINAL], vencido em [DATA_VENCIMENTO], está programado para encaminhamento a protesto em [DATA_ENCAMINHAMENTO], conforme condições contratadas. Para evitar, regularize até essa data. — [NOME_EMPRESA]'],
  ['confirmacao_pagamento', 'Confirmação de pagamento', 'cobranca', 'Olá, [NOME_CLIENTE]! Confirmamos o recebimento de [VALOR_ORIGINAL]. Obrigado pela parceria! — [NOME_EMPRESA]'],
  ['regularizacao_cartoraria', 'Regularização cartorária', 'cobranca', 'Olá, [NOME_CLIENTE]. Recebemos o pagamento do título protestado. Estamos providenciando a carta de anuência para o cancelamento do protesto. — [NOME_EMPRESA]'],
  ['envio_anuencia', 'Envio de declaração de anuência', 'cobranca', 'Olá, [NOME_CLIENTE]. Segue a declaração de anuência referente ao título de [VALOR_ORIGINAL]. Com ela, o cancelamento do protesto pode ser solicitado no cartório. — [NOME_EMPRESA]'],
  ['reativacao', 'Reativação de cliente', 'comercial', 'Olá, [NOME_CLIENTE]! Sentimos sua falta aqui na [NOME_EMPRESA]. Que tal programarmos o próximo pedido?'],
  ['baixa_rotatividade', 'Baixa rotatividade', 'comercial', 'Olá, [NOME_CLIENTE]! Notamos uma redução no consumo nas últimas semanas. Podemos conversar para entender como ajudar? — [NOME_RESPONSAVEL], [NOME_EMPRESA]'],
  ['visita_tecnica', 'Visita técnica', 'tecnico', 'Olá, [NOME_CLIENTE]! Confirmamos a visita técnica em [DATA_VISITA] às [HORARIO_VISITA]. — [NOME_EMPRESA]'],
  ['assepsia', 'Assepsia', 'tecnico', 'Olá, [NOME_CLIENTE]! A assepsia do seu equipamento está agendada para [DATA_VISITA] às [HORARIO_VISITA]. — [NOME_EMPRESA]'],
  ['manutencao', 'Manutenção', 'tecnico', 'Olá, [NOME_CLIENTE]! A manutenção do equipamento está agendada para [DATA_VISITA] às [HORARIO_VISITA]. — [NOME_EMPRESA]'],
  ['entrega', 'Entrega', 'logistica', 'Olá, [NOME_CLIENTE]! A entrega do pedido nº [NUMERO_PEDIDO] está programada para [DATA_ENTREGA]. — [NOME_EMPRESA]'],
  ['recolhimento', 'Recolhimento', 'logistica', 'Olá, [NOME_CLIENTE]! O recolhimento referente ao pedido nº [NUMERO_PEDIDO] está programado para [DATA_VISITA]. — [NOME_EMPRESA]'],
  ['confirmacao_pedido', 'Confirmação de pedido', 'comercial', 'Olá, [NOME_CLIENTE]! Seu pedido nº [NUMERO_PEDIDO] foi confirmado, no valor de [VALOR_ORIGINAL]. — [NOME_EMPRESA]'],
  ['pos_venda', 'Pós-venda', 'comercial', 'Olá, [NOME_CLIENTE]! Como foi a experiência com o chopp da [NOME_EMPRESA]? Sua opinião é muito importante.']
];

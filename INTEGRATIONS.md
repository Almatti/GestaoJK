# Integrações

Princípios: adaptadores substituíveis; falha externa não derruba o sistema; nenhum serviço pago habilitado automaticamente; segredos só no servidor. Estados na tabela `integrations`: não configurada, aguardando autorização, conectada, desconectada, sincronização pendente, erro, limite atingido.

| Integração | Situação | Como funciona / configurar | Alternativa manual |
|---|---|---|---|
| Supabase | **Necessária** | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; migrations (DEPLOYMENT.md) | Modo demonstração |
| Cloudflare Pages | Pronta | build `npm run build`, saída `dist`, `_redirects`/`_headers` incluídos | Qualquer host estático |
| GitHub | Ativa | CI em `.github/workflows/ci.yml` | — |
| ViaCEP | **Ativa** | `https://viacep.com.br/ws/{cep}/json/` direto do navegador | Digitação manual |
| BrasilAPI CNPJ | **Ativa** | `https://brasilapi.com.br/api/cnpj/v1/{cnpj}` (dados públicos da RFB); grava fonte/data em `customer_verifications` | Conferência manual registrada |
| Serpro (CPF/CNPJ oficial) | Pendente (pago) | Requer contratação; implementar adaptador em Edge Function com credenciais | Conferência manual na fonte oficial |
| WhatsApp (link oficial) | **Ativa** | `wa.me` + mensagem codificada; envio confirmado pelo usuário | — |
| WhatsApp Business Platform | Pendente (pago) | Conta Meta Business, número, modelos aprovados; token como segredo; marcar `entregue_api` com `api_message_id` | Fila + link oficial |
| Google Agenda / Tasks | Pronta, depende de credenciais | Edge Function `google-sync`: OAuth (Google Cloud → credenciais Web; redirect `https://<ref>.supabase.co/functions/v1/google-sync`), segredos `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_STATE_SECRET`, `APP_ORIGIN`. Sincronização **unidirecional** (sistema → Google), ids externos + hash evitam duplicidade e ciclos; cobranças/pagamentos não são enviados; Tasks sem horário (limitação da API) | Agenda interna |
| Banco (boletos, CNAB, baixa) | Pendente | Depende da API/layout do banco; tabelas `boletos` (`origin='integracao_bancaria'`) e `bank_statement_imports` preparadas | Cadastro manual de boletos + importação **OFX** |
| API Pix (cobrança dinâmica) | Pendente | Certificado e credenciais do PSP; `pix_charges.kind='dinamico'` | Pix estático + conferência |
| Meta / Instagram | Pendente | App Meta com permissões aprovadas; gravar métricas com `source='sincronizado'` | Lançamento manual/importado com origem identificada |
| Gemini API | Opcional | Segredo `GEMINI_API_KEY` (+ `GEMINI_MODEL`, `AI_DAILY_LIMIT`) na função `ai-assistant`; habilitar `ai.enabled`. Verifique os termos de uso de dados do plano | Assistente determinístico interno |

## Publicar Edge Functions
```bash
supabase functions deploy invite-user
supabase functions deploy ai-assistant
supabase functions deploy google-sync --no-verify-jwt   # callback OAuth valida state assinado
supabase secrets set APP_ORIGIN=https://seu-dominio GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_STATE_SECRET=$(openssl rand -hex 32)
```
Cotas, preços e termos mudam: confira a documentação oficial antes de habilitar qualquer serviço.

# Segurança e LGPD

## Autenticação
- Supabase Auth com e-mail/senha; recuperação de senha por e-mail; MFA (TOTP) disponível no Supabase Auth — habilitar no painel e orientar usuários.
- **Sem cadastro público** (`enable_signup=false`). Entrada por convite (`user_invitations` + Edge Function `invite-user`). Contas sem convite ficam **inativas** até aprovação. O primeiro usuário vira administrador (bootstrap) — crie-o pelo painel do Supabase.
- Sessão persistida com renovação automática; "Sair" encerra a sessão.

## Autorização
- RLS em **todas** as tabelas; políticas geradas a partir de `resource_tables` + `has_perm(recurso, ação)`; usuário inativo não acessa nada; papel `anon` sem nenhum privilégio.
- Funções transacionais `security definer` verificam permissão (`require_perm`) e fixam `search_path`.
- Restrições adicionais no banco: papel/ativação só por admin (trigger), sempre ≥ 1 admin ativo, encaminhamento a protesto exige aprovação, estorno/renegociação exigem permissão e justificativa.
- Testado: técnico não lê recebíveis/pagamentos/boletos/saldos/DRE/auditoria nem por chamadas diretas à API (Cenário 9 em `supabase/tests`).

## Dados e arquivos
- Bucket **privado** `documentos`; download por URL assinada de 5 minutos; leitura condicionada ao recurso da entidade.
- Uploads validados (tipo e 15 MB); nomes sanitizados.
- Segredos de integração em `integration_secrets` (sem políticas → só service_role). Nenhuma chave privada no frontend; `.env*` ignorados no git.
- Auditoria (`audit_logs`) de tabelas críticas com antes/depois e justificativa; **documentos mascarados** (`***1234`); sem senhas/tokens.
- Validação server-side (checks, triggers de CPF/CNPJ, transições) além do Zod no cliente; consultas parametrizadas (PostgREST); React escapa saída; CSP e cabeçalhos de segurança em `public/_headers`.
- Limitação de requisições: limites do Supabase/PostgREST + limite diário no assistente de IA; recomenda-se Cloudflare WAF/Rate Limiting no domínio.

## LGPD (Lei nº 13.709/2018)
- Finalidade: gestão comercial, financeira e operacional (execução de contrato e legítimo interesse; obrigações legais para dados fiscais).
- Minimização: só dados necessários; CPF nunca enviado a serviços externos; IA recebe dados anonimizados.
- Testes automatizados usam apenas dados fictícios.
- Direitos do titular: correção pelo cadastro; exclusão/anonimização quando legalmente aplicável — registros financeiros com obrigação de guarda são mantidos (arquivamento). Exportação controlada (Administração → Backups).
- Retenção: definir com a contabilidade/jurídico (sugestão: dados fiscais 5 anos após o exercício; logs de auditoria 5 anos).
- PWA não guarda dados financeiros/pessoais em cache offline (somente a casca do app); rascunhos locais só em recursos não sensíveis (notas, tarefas, marketing).

## Resposta a incidentes
Revogar sessões no Supabase, rotacionar chaves (anon/service_role, segredos das funções), revisar `audit_logs`, comunicar a ANPD e titulares quando exigido.

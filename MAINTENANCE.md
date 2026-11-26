# Manutenção

## Rotina recomendada
| Frequência | Ação |
|---|---|
| Diária | Conferir Central de notificações e fila de Cobranças; verificar "Falhas" em Administração → Automações |
| Semanal | Backup completo (`scripts/backup.sh`); revisar Saúde comercial; conciliação bancária (OFX) |
| Mensal | Fechamento de parceiros; DRE gerencial; testar restauração em banco descartável; revisar usuários ativos |
| Trimestral | Atualizar dependências (`npm outdated`), rodar `npm run check`, `npm run test:db`, `npm run test:e2e` |

## Alterações comuns sem programação
Margens, tributos estimados, periodicidades, critérios de saúde (Configurações); juros/multa/protesto e lembretes (Financeiro → Cobranças → Regras); produtos, tamanhos de barril, preços (Produtos); modelos de mensagem; automações (ativar/desativar); feriados; usuários e perfis.

## Alterações que exigem desenvolvimento
- **Nova tabela/coluna**: criar migration nova em `supabase/migrations` (nunca editar uma já aplicada), incluir a tabela em `resource_tables` (RLS) e, se crítica, `select attach_audit('public.tabela')`. Atualizar `DATABASE.md`.
- **Novo cadastro simples**: adicionar um `ResourceDef` em `src/features/resource/definitions.tsx` e uma rota em `src/App.tsx` + item em `src/config/navigation.ts`.
- **Permissões**: editar `src/domain/permissions.ts`, rodar `node --experimental-strip-types scripts/gen-permissions-seed.ts` e criar migration com o conteúdo gerado (ou reaplicar a 0900 em ambiente novo).
- **Regra financeira**: alterar em `src/domain` + teste e na função SQL correspondente + teste SQL.

## Diagnóstico
- Erro "Você não tem permissão": verificar perfil em Usuários e a matriz de permissões.
- Automação não rodou: `select * from cron.job_run_details order by start_time desc limit 10;` e `select * from automation_runs order by started_at desc;`.
- Integração com erro: Administração → Integrações (último erro) e logs da Edge Function no painel do Supabase.
- Dados inconsistentes: consultar `audit_logs` (antes/depois e autor). Evite alterar produção manualmente; quando inevitável, use transação e registre `set local app.audit_reason = '...'`.

## Infraestrutura gratuita — limitações
Projetos gratuitos do Supabase podem ser pausados por inatividade e têm cotas de banco/armazenamento/funções; não há backup automático diário no plano gratuito (por isso a rotina manual). Cloudflare Pages tem limite de builds mensais. Verifique os valores atuais nas páginas oficiais.

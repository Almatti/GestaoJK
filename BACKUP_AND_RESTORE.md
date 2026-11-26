# Backup e restauração

Exportações (CSV/Excel/JSON) **não** substituem backup completo.

## Backup completo
Requisitos: `pg_dump`/`pg_restore` 15+ e a string de conexão direta (Supabase → Project Settings → Database).

```bash
export SUPABASE_DB_URL="postgresql://postgres:<senha>@db.<ref>.supabase.co:5432/postgres"
bash scripts/backup.sh backups/          # gera jkchopp-AAAAMMDD-HHMMSS.dump + .sha256
```
- Inclui esquema `public` (tabelas, funções, políticas) e dados.
- **Usuários do Auth** (`auth.users`) e **arquivos do Storage** ficam fora do dump do `public`. Para um backup de projeto inteiro use o Supabase CLI conforme a documentação oficial (dump de roles, schema e dados) e copie o bucket `documentos`.
- Armazene fora do provedor, criptografado e com acesso restrito (dados pessoais — LGPD). Retenção sugerida: diários por 7 dias, semanais por 8 semanas, mensais por 12 meses.

## Restauração
```bash
export TARGET_DB_URL="postgresql://..."    # banco de destino (de preferência novo/descartável)
bash scripts/restore.sh backups/jkchopp-AAAAMMDD-HHMMSS.dump
```
- O script confere o checksum e se recusa a restaurar em um projeto Supabase sem `CONFIRM_PRODUCTION=SIM`.
- Em um projeto Supabase novo: recrie os usuários (ou restaure `auth`) **antes** dos dados, pois `profiles.id` referencia `auth.users`.
- Após restaurar: conferir contagens, rodar `select run_automations()` e testar login.

## Teste de restauração (automatizado)
`bash scripts/test-backup-restore.sh` cria um banco com dados de teste, faz backup, restaura em outro banco e compara contagens de tabelas críticas. Último resultado: **aprovado** (contagens idênticas; único aviso esperado: FK de `profiles` para `auth.users`, que fica fora do dump do schema `public`).

## Nunca
Executar restauração em produção sem autorização; versionar dumps no git (pasta `backups/` ignorada).

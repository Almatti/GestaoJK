#!/usr/bin/env bash
# Backup COMPLETO (esquema + dados) do banco Supabase/PostgreSQL em arquivo compactado e com checksum.
# Uso: SUPABASE_DB_URL="postgresql://postgres:<senha>@db.<ref>.supabase.co:5432/postgres" bash scripts/backup.sh [pasta]
# A senha NÃO deve ser gravada em arquivos versionados. Prefira exportar a variável apenas na sessão.
set -euo pipefail
: "${SUPABASE_DB_URL:?Defina SUPABASE_DB_URL (conexão direta do Postgres)}"
OUT_DIR=${1:-backups}
mkdir -p "$OUT_DIR"
STAMP=$(TZ=America/Sao_Paulo date +%Y%m%d-%H%M%S)
FILE="$OUT_DIR/jkchopp-$STAMP.dump"
echo "→ Gerando dump (formato custom, inclui esquema public e dados)…"
pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner --no-privileges --schema=public --file="$FILE"
sha256sum "$FILE" > "$FILE.sha256"
echo "✔ Backup: $FILE ($(du -h "$FILE" | cut -f1))"
echo "  Checksum: $(cut -d' ' -f1 "$FILE.sha256")"
cat <<MSG
Arquivos do Storage (bucket privado "documentos") NÃO estão no dump. Exporte-os com o Supabase CLI:
  supabase storage cp -r ss:///documentos "$OUT_DIR/storage-$STAMP" --experimental
Guarde os backups fora do servidor, em local criptografado e com acesso restrito (contêm dados pessoais — LGPD).
MSG

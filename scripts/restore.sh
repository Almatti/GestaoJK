#!/usr/bin/env bash
# Restaura um backup gerado por scripts/backup.sh em um banco DE DESTINO.
# NUNCA aponte para produção sem autorização expressa: a restauração substitui objetos existentes.
# Uso: TARGET_DB_URL="postgresql://..." bash scripts/restore.sh backups/jkchopp-AAAAMMDD-HHMMSS.dump
set -euo pipefail
FILE=${1:?Informe o arquivo .dump}
: "${TARGET_DB_URL:?Defina TARGET_DB_URL (banco de destino)}"
if [ -f "$FILE.sha256" ]; then sha256sum -c "$FILE.sha256"; fi
if [[ "${TARGET_DB_URL}" == *"supabase.co"* && "${CONFIRM_PRODUCTION:-}" != "SIM" ]]; then
  echo "Destino parece ser um projeto Supabase. Para confirmar, execute com CONFIRM_PRODUCTION=SIM." >&2
  exit 1
fi
pg_restore --dbname="$TARGET_DB_URL" --clean --if-exists --no-owner --no-privileges "$FILE"
echo "✔ Restauração concluída. Valide contagens com: psql \"\$TARGET_DB_URL\" -c 'select count(*) from customers'"

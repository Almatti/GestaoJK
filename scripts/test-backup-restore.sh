#!/usr/bin/env bash
# Teste automatizado de backup + restauração em bancos locais descartáveis (requer PostgreSQL local).
set -euo pipefail
cd "$(dirname "$0")/.."
PGTEST_DB=jk_backup_src bash scripts/test-db.sh >/dev/null
TMP=$(mktemp -d)
SUPABASE_DB_URL="postgresql:///jk_backup_src" bash scripts/backup.sh "$TMP" >/dev/null
psql -q -X -d postgres -c "drop database if exists jk_backup_dst" -c "create database jk_backup_dst" >/dev/null
psql -q -X -d jk_backup_dst -f supabase/tests/00_supabase_stub.sql >/dev/null 2>&1
psql -q -X -d jk_backup_dst -c "create extension if not exists btree_gist with schema extensions; create extension if not exists pg_trgm with schema extensions; create extension if not exists unaccent with schema extensions;" >/dev/null
TARGET_DB_URL="postgresql:///jk_backup_dst" bash scripts/restore.sh "$TMP"/*.dump >/dev/null 2>"$TMP/restore.log" || { echo "pg_restore reportou avisos:"; tail -5 "$TMP/restore.log"; }
for t in customers orders receivables payments protest_records partner_ledger audit_logs; do
  a=$(psql -tA -X -d jk_backup_src -c "select count(*) from public.$t")
  b=$(psql -tA -X -d jk_backup_dst -c "select count(*) from public.$t")
  [ "$a" = "$b" ] || { echo "✘ $t: origem $a, restaurado $b"; exit 1; }
  echo "  $t: $a = $b"
done
echo "✔ Backup e restauração verificados (contagens idênticas)"
rm -rf "$TMP"

#!/usr/bin/env bash
# Aplica as migrations em um banco PostgreSQL local DESCARTÁVEL (com stub do Supabase) e executa os testes SQL.
# Uso: npm run test:db  (requer PostgreSQL 15+ local e um usuário com permissão de criar bancos)
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${PGTEST_DB:-jk_test}
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
$PSQL -d "$DB" -f supabase/tests/00_supabase_stub.sql >/dev/null
for f in supabase/migrations/*.sql; do
  echo "→ migration $(basename "$f")"
  $PSQL -d "$DB" -f "$f" >/dev/null
done
for t in supabase/tests/[1-9]*.sql; do
  echo "→ teste $(basename "$t")"
  $PSQL -d "$DB" -f "$t" >/dev/null
done
echo "✔ Testes de banco concluídos"

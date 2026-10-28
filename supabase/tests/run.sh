#!/usr/bin/env bash
# Aplica las migraciones sobre un Postgres local limpio (con un stub de
# auth/storage de Supabase) y ejecuta la prueba de integración.
# Uso: PGHOST=/ruta/socket PGPORT=5432 PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${TEST_DB:-gigante_test}
P="psql -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB"
$P -d "$DB" -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do
  echo "→ $f"
  $P -d "$DB" -f "$f"
done
$P -d "$DB" -f supabase/tests/integration_test.sql

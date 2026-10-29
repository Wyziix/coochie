#!/usr/bin/env bash
# Applies all migrations to a throwaway local Postgres (with a Supabase stub)
# and runs supabase/tests/*.test.sql. Needs Postgres 15+ binaries installed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
RUN=()
if [ "$(id -u)" = "0" ]; then
  chown postgres "$WORK"
  RUN=(runuser -u postgres --)
fi

cleanup() {
  "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"${RUN[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U postgres --auth=trust >/dev/null
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null

# Hide "already exists, skipping" notices from idempotent migrations.
export PGOPTIONS="-c client_min_messages=warning"
PSQL=("$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -f "$ROOT/supabase/tests/supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate: $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
# Migrations marked "idempotent" must survive being run again (people re-run
# them in the SQL Editor after a failure): apply them a second time.
for f in "$ROOT"/supabase/migrations/*.sql; do
  if head -5 "$f" | grep -q "idempotent"; then
    echo "re-run: $(basename "$f")"
    "${PSQL[@]}" -f "$f"
  fi
done

# ...and must also work after a run that stopped halfway: in a fresh database,
# apply only their first statements, then the whole file.
"${PSQL[@]}" -c "create database partial_run"
PARTIAL=("$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -d partial_run -v ON_ERROR_STOP=1 -q)
"${PARTIAL[@]}" -f "$ROOT/supabase/tests/supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  if head -5 "$f" | grep -q "idempotent"; then
    echo "partial then full: $(basename "$f")"
    awk '/^create or replace function/ { exit } { print }' "$f" | "${PARTIAL[@]}"
  fi
  "${PARTIAL[@]}" -f "$f"
done
"${PARTIAL[@]}" -tAc "select 'partial run: ' || count(*) || ' ready-made templates' from public.templates where owner_id is null"

export PGOPTIONS=""
for f in "$ROOT"/supabase/tests/*.test.sql; do
  echo "test: $(basename "$f")"
  "${PSQL[@]}" -o /dev/null -f "$f" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
done

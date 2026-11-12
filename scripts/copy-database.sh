#!/usr/bin/env bash
# Copies the whole site database into a NEW, empty database (for moving the Supabase project to
# another region). Reads from DATABASE_URL (the current database: nothing in it is changed) and
# writes to NEW_DATABASE_URL:
#   1. applies the migrations to the new database (tables, indexes, row-level security),
#   2. empties its tables and loads every row from the current database,
#   3. compares the number of rows in every table and fails if any differs.
# It refuses to run when the new database already holds subscribers or jobs (set COPY_FORCE=1 to
# load over them), and when both addresses point at the same database.
#
# Usage: the "copy-database" option of the Scheduled jobs workflow, with the repository secret
# NEW_DATABASE_URL set to the new project's connection string (README, "Moving the database").
# Locally: DATABASE_URL=… NEW_DATABASE_URL=… NO_DOCKER=1 bash scripts/copy-database.sh
set -euo pipefail

OLD="${DATABASE_URL:-}"
NEW="${NEW_DATABASE_URL:-}"
if [ -z "$OLD" ]; then echo "::error::DATABASE_URL is not set."; exit 1; fi
if [ -z "$NEW" ]; then echo "::error::Add the NEW_DATABASE_URL repository secret (the new database's connection string)."; exit 1; fi

# pg_dump and psql need a whole session, which Supabase's transaction pooler (port 6543) doesn't
# give: the same pooler host answers in session mode on port 5432. Options such as ?pgbouncer=true
# are for the app only.
session_url() {
  local u="${1%%\?*}"
  if [[ "$u" == *pooler.supabase.com:6543/* ]]; then u="${u/:6543\//:5432/}"; fi
  printf '%s' "$u"
}
host_of() { printf '%s' "$1" | sed -E 's#^[a-z]+://([^@/]*@)?##; s#[/?].*$##'; }
user_of() { printf '%s' "$1" | sed -E 's#^[a-z]+://##; s#[:@].*$##'; }

OLD_S="$(session_url "$OLD")"
NEW_S="$(session_url "$NEW")"
if [ "$(host_of "$OLD_S")" = "$(host_of "$NEW_S")" ] && [ "$(user_of "$OLD_S")" = "$(user_of "$NEW_S")" ] && [ "${OLD_S##*/}" = "${NEW_S##*/}" ]; then
  echo "::error::NEW_DATABASE_URL points at the same database as DATABASE_URL."; exit 1
fi
echo "From: $(host_of "$OLD_S")"
echo "To:   $(host_of "$NEW_S")"

# The tools must be at least as new as both servers: use PostgreSQL's own image unless told not to.
PG_IMAGE="${PG_IMAGE:-postgres:17}"
pg() {
  if [ -z "${NO_DOCKER:-}" ] && command -v docker >/dev/null 2>&1; then
    docker run --rm -i --network host "$PG_IMAGE" "$@"
  else
    "$@"
  fi
}
q() { pg psql "$1" -X -A -t -v ON_ERROR_STOP=1 -c "$2"; }

echo "— 1. Tables in the new database (migrations) —"
DATABASE_URL="$NEW" npm run --silent db:migrate | tail -n 3

existing="$(q "$NEW_S" "select (select count(*) from subscribers) + (select count(*) from jobs)")"
if [ "$existing" != "0" ] && [ -z "${COPY_FORCE:-}" ]; then
  echo "::error::The new database already holds subscribers or jobs ($existing rows). Nothing was copied. To load over them, run again with COPY_FORCE=1."
  exit 1
fi

TABLES_SQL="select string_agg(format('%I.%I', table_schema, table_name), ', ' order by table_name) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'schema_migrations'"

COUNTS_SQL="select table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name"

echo "— 2. Copying the rows —"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
q "$OLD_S" "$COUNTS_SQL" > "$work/old-before.txt"
pg pg_dump "$OLD_S" --data-only --schema=public --exclude-table=public.schema_migrations --no-owner --no-privileges > "$work/data.sql"
echo "Read $(wc -c < "$work/data.sql" | tr -d ' ') bytes from the current database."
tables="$(q "$NEW_S" "$TABLES_SQL")"
{
  echo "begin;"
  # Foreign keys are checked by the source database already; the load order then doesn't matter.
  echo "set local session_replication_role = replica;"
  echo "truncate table $tables restart identity cascade;"
  cat "$work/data.sql"
  echo "commit;"
} | pg psql "$NEW_S" -X -q -v ON_ERROR_STOP=1 > /dev/null

echo "— 3. Comparing row counts —"
q "$OLD_S" "$COUNTS_SQL" > "$work/old-after.txt"
q "$NEW_S" "$COUNTS_SQL" > "$work/new.txt"
bad=0
while IFS='=' read -r name before; do
  after="$(grep -E "^${name}=" "$work/old-after.txt" | cut -d= -f2 || true)"
  m="$(grep -E "^${name}=" "$work/new.txt" | cut -d= -f2 || true)"
  lo=$(( before < ${after:-$before} ? before : ${after:-$before} ))
  hi=$(( before > ${after:-$before} ? before : ${after:-$before} ))
  if [ -n "$m" ] && [ "$m" -ge "$lo" ] && [ "$m" -le "$hi" ]; then
    # A table the live site wrote to while the copy ran (page views, rate limits) may be a few rows apart.
    if [ "$lo" = "$hi" ]; then printf '  ✓ %-28s %s\n' "$name" "$m"; else printf '  ✓ %-28s %s (the current database changed during the copy: %s → %s)\n' "$name" "$m" "$before" "$after"; fi
  else
    printf '  ✗ %-28s current %s, new %s\n' "$name" "$before" "${m:-missing}"; bad=1
  fi
done < "$work/old-before.txt"
if [ "$bad" != "0" ]; then echo "::error::Row counts differ. Nothing in the current database was changed; run the copy again with COPY_FORCE=1."; exit 1; fi
echo "Copied. The new database matches the current one. Next: switch DATABASE_URL on Netlify and in the repository secrets to the new address."

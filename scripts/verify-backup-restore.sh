#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Usage: $0 path/to/backup.dump" >&2
  exit 2
fi
cd "$(dirname "${BASH_SOURCE[0]}")/.."
backup="$(realpath "$1")"
verify_db="bfw_restore_verify_$(date -u +%Y%m%d%H%M%S)_$$"
compose=(docker compose --env-file .env -f compose.yml)
source_db="$("${compose[@]}" exec -T db printenv POSTGRES_DB)"
bootstrap_user="$("${compose[@]}" exec -T db printenv POSTGRES_USER)"
created=0
cleanup() {
  if [[ "$created" == 1 ]]; then
    "${compose[@]}" exec -T db dropdb --if-exists --force --username "$bootstrap_user" "$verify_db" >/dev/null
  fi
}
trap cleanup EXIT

"${compose[@]}" exec -T db createdb --username "$bootstrap_user" "$verify_db"
created=1
"${compose[@]}" exec -T db pg_restore --exit-on-error --no-owner --no-privileges \
  --username "$bootstrap_user" --dbname "$verify_db" < "$backup"

source_schema="$("${compose[@]}" exec -T db psql --no-psqlrc --tuples-only --no-align \
  --username "$bootstrap_user" --dbname "$source_db" \
  --command "SELECT to_regclass('public.schema_migrations') IS NOT NULL" | tr -d '\r')"
restored_schema="$("${compose[@]}" exec -T db psql --no-psqlrc --tuples-only --no-align \
  --username "$bootstrap_user" --dbname "$verify_db" \
  --command "SELECT to_regclass('public.schema_migrations') IS NOT NULL" | tr -d '\r')"
if [[ "$source_schema" != "$restored_schema" ]]; then
  echo "Restore check failed: source and restored migration schemas differ" >&2
  exit 1
fi
if [[ "$source_schema" != t ]]; then
  source_tables="$("${compose[@]}" exec -T db psql --no-psqlrc --tuples-only --no-align \
    --username "$bootstrap_user" --dbname "$source_db" \
    --command "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'" | tr -d '\r')"
  restored_tables="$("${compose[@]}" exec -T db psql --no-psqlrc --tuples-only --no-align \
    --username "$bootstrap_user" --dbname "$verify_db" \
    --command "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'" | tr -d '\r')"
  if [[ "$source_tables" != 0 || "$restored_tables" != 0 ]]; then
    echo "Restore check failed: database has tables but no initial migration record" >&2
    exit 1
  fi
  printf 'Empty pre-migration database restore verified in %s.\n' "$verify_db"
  exit 0
fi

actual="$("${compose[@]}" exec -T db psql --no-psqlrc --tuples-only --no-align \
  --username "$bootstrap_user" --dbname "$verify_db" \
  --command "SELECT count(*) FROM schema_migrations WHERE name = '001_initial.sql'" | tr -d '\r')"
if [[ "$actual" != 1 ]]; then
  echo "Restore check failed: initial schema migration is missing" >&2
  exit 1
fi
row_counts() {
  "${compose[@]}" exec -T db psql --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 \
    --username "$bootstrap_user" --dbname "$1" \
    --command "SELECT 'cards=' || count(*) FROM cards UNION ALL SELECT 'deck_cards=' || count(*) FROM deck_cards UNION ALL SELECT 'decks=' || count(*) FROM decks UNION ALL SELECT 'match_commands=' || count(*) FROM match_commands UNION ALL SELECT 'match_players=' || count(*) FROM match_players UNION ALL SELECT 'matches=' || count(*) FROM matches UNION ALL SELECT 'schema_migrations=' || count(*) FROM schema_migrations UNION ALL SELECT 'sessions=' || count(*) FROM user_sessions UNION ALL SELECT 'users=' || count(*) FROM users UNION ALL SELECT 'avatars=' || count(*) FROM user_avatars ORDER BY 1" | tr -d '\r'
}
source_counts="$(row_counts "$source_db")"
restored_counts="$(row_counts "$verify_db")"
if [[ "$source_counts" != "$restored_counts" ]]; then
  echo "Restore check failed: account/avatar/deck row counts differ from the source database" >&2
  exit 1
fi
printf 'Restore verified in temporary database %s; all application table row counts match and production database was not modified.\n' "$verify_db"

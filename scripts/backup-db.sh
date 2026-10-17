#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ ! -f .env ]]; then echo "Missing .env beside compose.yml" >&2; exit 1; fi
backup_password=''
while IFS= read -r line; do
  case "$line" in BACKUP_DB_PASSWORD=*) backup_password="${line#BACKUP_DB_PASSWORD=}" ;; esac
done < .env
if [[ -z "$backup_password" ]]; then echo "BACKUP_DB_PASSWORD is missing from .env" >&2; exit 1; fi
export BACKUP_DB_PASSWORD="$backup_password" PGPASSWORD="$backup_password"
unset backup_password
backup_dir="${1:-backups}"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
umask 077

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="$backup_dir/.bfw-$stamp.dump.tmp"
backup="$backup_dir/bfw-$stamp.dump"
compose=(docker compose --env-file .env -f compose.yml)
"${compose[@]}" exec -T -e BACKUP_DB_PASSWORD db sh -ec \
  'psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set database_name="$POSTGRES_DB"' <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bfw_backup') THEN
    CREATE ROLE bfw_backup LOGIN;
  END IF;
END $$;
\getenv backup_password BACKUP_DB_PASSWORD
ALTER ROLE bfw_backup LOGIN PASSWORD :'backup_password';
GRANT CONNECT ON DATABASE :"database_name" TO bfw_backup;
GRANT USAGE ON SCHEMA public TO bfw_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO bfw_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO bfw_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE bfw_migrator IN SCHEMA public GRANT SELECT ON TABLES TO bfw_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE bfw_migrator IN SCHEMA public GRANT SELECT ON SEQUENCES TO bfw_backup;
SQL
trap 'rm -f "$temporary"' EXIT

"${compose[@]}" exec -T -e PGPASSWORD db sh -ec \
  'exec pg_dump --username bfw_backup --dbname "$POSTGRES_DB" --format=custom' > "$temporary"
"${compose[@]}" exec -T db pg_restore --list < "$temporary" >/dev/null
mv "$temporary" "$backup"
trap - EXIT
printf 'Backup verified: %s\n' "$backup"

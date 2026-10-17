#!/usr/bin/env bash
set -Eeuo pipefail

psql --set ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set database_name="$POSTGRES_DB" \
  --set app_password="$APP_DB_PASSWORD" \
  --set migration_password="$MIGRATION_DB_PASSWORD" \
  --set backup_password="$BACKUP_DB_PASSWORD" <<'SQL'
CREATE ROLE bfw_app LOGIN PASSWORD :'app_password';
CREATE ROLE bfw_migrator LOGIN PASSWORD :'migration_password';
CREATE ROLE bfw_backup LOGIN PASSWORD :'backup_password';
GRANT CONNECT ON DATABASE :"database_name" TO bfw_app, bfw_migrator, bfw_backup;
GRANT USAGE ON SCHEMA public TO bfw_app;
GRANT CREATE ON SCHEMA public TO bfw_migrator;
GRANT USAGE ON SCHEMA public TO bfw_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO bfw_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO bfw_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE bfw_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bfw_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bfw_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO bfw_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bfw_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO bfw_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE bfw_migrator IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO bfw_backup;
SQL

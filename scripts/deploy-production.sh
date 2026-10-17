#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 API_IMAGE WEB_IMAGE DB_IMAGE" >&2
  exit 2
fi

api_image="$1"
web_image="$2"
requested_db_image="$3"
image_pattern='^ghcr\.io/[a-z0-9._-]+(/[a-z0-9._-]+)*@sha256:[a-f0-9]{64}$'
for image in "$api_image" "$web_image" "$requested_db_image"; do
  if [[ ! "$image" =~ $image_pattern ]]; then
    echo "Image must be an immutable GHCR digest reference" >&2
    exit 2
  fi
done

project_dir=/srv/bfw
release_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="$project_dir/.env"
state_file="$project_dir/current-images.env"
compose=(docker compose --env-file "$env_file" -f "$release_dir/compose.yml")
if [[ ! -f "$env_file" ]]; then echo "Missing $env_file" >&2; exit 1; fi
if [[ -n "$(sed -n 's/^BFW_PROXY_BIND=//p' "$env_file" | tail -n 1)" ]]; then
  compose+=(-f "$release_dir/compose.iis.yml")
fi
if [[ "${BFW_DEPLOY_LOCKED:-}" != 1 ]]; then
  exec flock -w 900 "$project_dir/deploy.lock" env BFW_DEPLOY_LOCKED=1 bash "$0" "$api_image" "$web_image" "$requested_db_image"
fi
ln -sfn "$env_file" "$release_dir/.env"
chmod 700 "$project_dir"

old_api=''
old_web=''
db_image="$requested_db_image"
if [[ -f "$state_file" ]]; then
  old_api="$(sed -n 's/^API_IMAGE=//p' "$state_file")"
  old_web="$(sed -n 's/^WEB_IMAGE=//p' "$state_file")"
  old_db="$(sed -n 's/^DB_IMAGE=//p' "$state_file")"
  for image in "$old_api" "$old_web" "$old_db"; do
    if [[ ! "$image" =~ $image_pattern ]]; then
      echo "Stored image state is invalid; refusing deployment" >&2
      exit 1
    fi
  done
  db_image="$old_db"
fi

read -r registry_user
read -r registry_token
docker_config="$(mktemp -d "$project_dir/.docker-config.XXXXXX")"
export DOCKER_CONFIG="$docker_config" API_IMAGE="$api_image" WEB_IMAGE="$web_image" DB_IMAGE="$db_image"
cleanup() { rm -rf "$docker_config"; }
trap cleanup EXIT
printf '%s\n' "$registry_token" | docker login ghcr.io --username "$registry_user" --password-stdin >/dev/null
unset registry_token

rollback() {
  local status=$?
  trap - ERR
  if [[ -n "$old_api" && -n "$old_web" ]]; then
    echo "Deployment failed; restoring previous API and web images" >&2
    API_IMAGE="$old_api" WEB_IMAGE="$old_web" "${compose[@]}" up -d --wait --no-deps api web || true
  else
    echo "Deployment failed before a previous release was recorded; stopping API and web" >&2
    "${compose[@]}" stop api web || true
  fi
  exit "$status"
}
trap rollback ERR

"${compose[@]}" pull api web
db_container="$("${compose[@]}" ps --all -q db)"
if [[ -z "$db_container" ]]; then
  "${compose[@]}" pull db
  "${compose[@]}" up -d --wait db
else
  if [[ ! -f "$state_file" ]]; then
    db_image="$(docker inspect --format '{{.Config.Image}}' "$db_container")"
    if [[ ! "$db_image" =~ $image_pattern ]]; then echo "Existing database image is not a pinned GHCR digest" >&2; false; fi
    export DB_IMAGE="$db_image"
  fi
  "${compose[@]}" start db
  for attempt in {1..60}; do
    if "${compose[@]}" exec -T db sh -ec 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then break; fi
    if [[ "$attempt" == 60 ]]; then echo "PostgreSQL did not become ready" >&2; false; fi
    sleep 2
  done
fi
bash "$release_dir/scripts/backup-db.sh" "$project_dir/backups"
"${compose[@]}" run --rm migrate
"${compose[@]}" up -d --wait --no-deps api
"${compose[@]}" up -d --wait --no-deps web

app_domain="$(sed -n 's/^APP_DOMAIN=//p' "$env_file" | tail -n 1)"
if [[ ! "$app_domain" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "APP_DOMAIN must be a DNS hostname" >&2
  false
fi
"${compose[@]}" exec -T api node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
curl --fail --silent --show-error --max-time 20 "https://$app_domain/" --output /dev/null
ws_status="$(curl --silent --show-error --max-time 20 --http1.1 --output /dev/null --write-out '%{http_code}' \
  --header 'Connection: Upgrade' --header 'Upgrade: websocket' \
  --header 'Sec-WebSocket-Version: 13' --header 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  --header "Origin: https://$app_domain" "https://$app_domain/ws")"
if [[ "$ws_status" != 401 ]]; then
  echo "WebSocket route smoke check expected unauthenticated 401, received $ws_status" >&2
  false
fi

state_tmp="$(mktemp "$project_dir/.current-images.XXXXXX")"
printf 'API_IMAGE=%s\nWEB_IMAGE=%s\nDB_IMAGE=%s\n' "$api_image" "$web_image" "$db_image" > "$state_tmp"
chmod 600 "$state_tmp"
mv "$state_tmp" "$state_file"
trap - ERR
docker logout ghcr.io >/dev/null 2>&1 || true
echo "Production release is healthy: $api_image $web_image (database image pinned: $db_image)"

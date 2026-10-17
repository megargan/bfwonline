# BFW Online

Vue 3 client, Fastify API, PostgreSQL, shared game packages, and Caddy same-origin routing.

The pnpm workspace keeps the client in `apps/web`, the API in `apps/server`, and shared rules/contracts/catalog in `packages/`. Root scripts remain the supported shortcuts for client checks and local development.

## Run the full local stack

Requires Docker Engine with the Compose plugin. Create a local environment file and replace its four database-role passwords with different hex values (run the generator once per password):

```sh
cp .env.example .env
openssl rand -hex 32
```

Start PostgreSQL, migrations/catalog seed, API, and Caddy:

```sh
docker compose --env-file .env -f compose.yml -f compose.dev.yml up --build
```

Open <http://localhost:8080>. Stop with `docker compose --env-file .env -f compose.yml -f compose.dev.yml down`; this keeps the PostgreSQL volume. Do not use `down -v` if the data matters.

For direct frontend development, run the API and database with `docker compose --env-file .env -f compose.yml -f compose.dev.yml up --build db api`, then `pnpm install` and `pnpm dev` in another terminal. Vite proxies `/api` and `/ws` to port 3000.

## Checks

```sh
pnpm test:server
pnpm test:workspace
pnpm test:contracts
pnpm test:game-core
pnpm test:card-effects
pnpm type-check
pnpm build-only
```

## Production

Пошаговая настройка для выделенного Windows Server 2022, GitHub `megargan/bfwonline` и домена `bfwonline.mrazrust.ru`: [инструкция](docs/production-windows-server.md).

The API and PostgreSQL are private to the Compose network. Caddy serves the client, preserves `/api` and `/ws`, stores certificates in named volumes, and caps avatar uploads at 6 MiB before the API's 5 MiB file limit. PostgreSQL 18 data is stored in `postgres_data`; migrations run with a separate database role from the API.

Production deployment is manual: configure the GitHub `production` Environment with `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `GHCR_DEPLOY_USER`, and `GHCR_READ_TOKEN`, then dispatch **CI and release images** on `master`. Configure required reviewers before adding production secrets; `GHCR_READ_TOKEN` must have `read:packages` access. On the VPS, provision Docker Engine, the Compose plugin, `flock`, and `curl`; create `/srv/bfw/.env` with `APP_DOMAIN` and separate bootstrap/app/migration/backup passwords. Keep it mode `600`, make `/srv/bfw` writable by the deploy user, allow inbound 80/443, and point DNS at the VPS. The workflow publishes API, web, and database images by digest; the first deployment uses the database image from that build and later deploys keep the existing DB digest. It transfers a SHA release bundle over pinned SSH, backs up before migration, serializes remote deployments, checks API readiness, HTTPS, and the WebSocket route, then restores the prior API/web digests on failure. Deploy restarts the single API process and aborts live rooms as described by the MVP.

On pushes, GitHub Actions verifies the code and publishes SHA-addressable API, web, and database images to GHCR; tagged releases record their immutable digests. `workflow_dispatch` on `master` builds fresh images and starts the protected production deployment job. Configure a unique `BACKUP_DB_PASSWORD`; the database creates a read-only `bfw_backup` role on first initialization. Run `bash scripts/backup-db.sh` to create and validate a custom-format dump, then `bash scripts/verify-backup-restore.sh backups/<dump>.dump` to restore it into a temporary database and compare row counts for every application table with the source. Store copies off-host and keep production secrets outside the repository. The backup command also provisions or updates the read-only role on existing volumes using the database bootstrap role; the workflow currently stores the pre-migration dump on the VPS and does not upload it to a separate backup service.

Online matches use the shared `game-core` for server-authoritative rules and the local game delegates supported commands to the same core. The playable catalog includes the 209 cards without the `в разработке` tag; the other 369 cards remain tagged and unavailable for deck building. The current card catalog, core, contract, server, snapshot, local-combat, and production build checks pass. A fresh local production Compose run has also passed two-browser registration, room/deck readiness, match play, a private entry choice, guest leave/rejoin, owner room closure, and concede flows. These targeted scenarios do not prove every interaction or the full semantics of every playable-card effect.

The local full-stack commands require a running Docker Engine and a populated `.env`; Compose configuration can be checked with `docker compose --env-file .env -f compose.yml -f compose.dev.yml config --quiet`. Production deployment has not been run. It requires a selected VPS/domain and GitHub Environment secrets. The backup/restore procedure has been exercised against a temporary PostgreSQL database locally, but production restore and physical two-device checks remain outstanding. Git upload is intentionally deferred.

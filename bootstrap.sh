#!/usr/bin/env bash
# Local bootstrap — brings up Postgres + MinIO, applies the schema, seeds
# demo data, and creates the owner login.
#
# Idempotent: safe to re-run. Skips inserts whose unique keys already exist.
# Run from the repo root:   ./bootstrap.sh
#
# Wipes everything and starts over:
#   docker compose down -v && ./bootstrap.sh

set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "==> Creating .env from .env.example"
  cp .env.example .env
  printf '\nJWT_ACCESS_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
fi

DB_URL_HOST="postgres://tp:tp_local_dev@localhost:5432/tp_manager"

echo "==> Starting Postgres + MinIO"
docker compose up -d postgres minio

echo "==> Waiting for Postgres to accept connections"
for i in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U tp -d tp_manager >/dev/null 2>&1; then
    echo "    ready"
    break
  fi
  sleep 1
  if [ "$i" -eq 60 ]; then
    echo "Postgres did not become ready after 60s. Inspect: docker compose logs postgres" >&2
    exit 1
  fi
done

echo "==> Applying Prisma migrations"
( cd apps/api && DATABASE_URL="$DB_URL_HOST" pnpm db:migrate:deploy )

echo "==> Generating Prisma client"
( cd apps/api && DATABASE_URL="$DB_URL_HOST" pnpm db:generate )

echo "==> Creating owner login"
( cd apps/api && DATABASE_URL="$DB_URL_HOST" pnpm exec tsx scripts/bootstrap-owner.ts )

echo "==> Seeding demo data"
(
  cd apps/api
  export DATABASE_URL="$DB_URL_HOST"
  pnpm exec tsx scripts/seed-demo-data.ts
  pnpm exec tsx scripts/seed-operational-depth.ts
  pnpm exec tsx scripts/load-extracted-lines.ts
  pnpm exec tsx scripts/impute-as-needed-quantities.ts
)

cat <<'EOF'

==> Bootstrap complete.

Next:
  docker compose up -d            # bring up api + web + ml + worker
  open http://localhost:3000      # log in with the credentials printed above

Logs:
  docker compose logs -f api web

Reset and start over:
  docker compose down -v && ./bootstrap.sh
EOF

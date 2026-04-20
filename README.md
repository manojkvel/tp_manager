# TP Manager

Restaurant operations platform — inventory, recipes, waste, ordering, POS (Aloha) ingest, and
ML-based forecasting. Single-tenant PWA; English-only MVP (spec v1.6).

- **Spec:** [`.sdlc/product-owner/feature-intake/spec.md`](.sdlc/product-owner/feature-intake/spec.md)
- **Plan:** [`.sdlc/architect/design-to-plan/plan.md`](.sdlc/architect/design-to-plan/plan.md)
- **ADRs:** [`docs/adr/`](docs/adr/)

## Stack

| Service | Runtime | Port | Dockerfile |
|---|---|---|---|
| web | Vite PWA → nginx | 3000 | `apps/web/Dockerfile` |
| api | Fastify + TypeScript | 3001 | `apps/api/Dockerfile` |
| aloha-worker | Node + TypeScript | 3002 | `apps/aloha-worker/Dockerfile` |
| ml | FastAPI + Python 3.11 | 8000 | `services/ml/Dockerfile` |
| postgres | Postgres 16 | 5432 | (image) |
| minio | S3-compatible Blob | 9000 / 9001 | (image) |

Monorepo layout:
```
apps/{web,api,aloha-worker}   packages/{types,conversions}
services/ml                   docs/adr/ infra/bicep/ ops/{tests,observability}
```

## Quickstart (local)

Prereqs: Docker Desktop 4.32+, Node 20.11+, pnpm 9.12+, Python 3.11.

```sh
cp .env.example .env
docker compose up --build
```

Wait ~60s for all health checks. Then:
- Web: <http://localhost:3000>
- API: <http://localhost:3001/healthz>
- ML:  <http://localhost:8000/healthz>
- Aloha worker: <http://localhost:3002/healthz>
- MinIO console: <http://localhost:9001>

Smoke-test the full stack:
```sh
./ops/tests/docker_compose_up_ok.sh
```

## Developing

```sh
pnpm install          # install TS workspace deps
pnpm -w run dev       # per-service watchers in parallel
pnpm -w run test      # workspace tests
pnpm -w run lint && pnpm -w run typecheck

cd services/ml
pip install -e '.[dev]'
pytest -q
ruff check .
```

## Cloud deploy

Push to `main` runs CI → builds + pushes Docker images to ACR → deploys to staging Container Apps.
Tag `vX.Y.Z` → deploys to prod.

See [`infra/bicep/README.md`](infra/bicep/README.md) for the one-time Azure setup the owner must do
before the first deploy.

## Layout of the SDLC artefacts

The `.sdlc/` tree holds the product-owner → architect → developer pipeline outputs (spec, plan,
design-review, decision-log, tasks, execution-schedule). They are the source-of-truth for why
this code exists; read them when a change feels surprising.

---
date: 2026-04-18
scope: wave-1-infra-docker
spec: .sdlc/product-owner/feature-intake/spec.md (v1.6)
plan: .sdlc/architect/design-to-plan/plan.md
tasks: .sdlc/developer/feature-build/tasks.md
schedule: .sdlc/developer/feature-build/execution-schedule.json
tasks_total_in_wave: 14
tasks_implemented: 11
tasks_partial: 3
tasks_skipped: 0
files_created: 56
files_modified: 0
tests_written: 8
tests_executed: 0
duration_minutes: 90
---

# Implementation Report — Wave 1 (Infra + Docker Scaffold)

> **Spec:** [TP Manager v1.6](../.sdlc/product-owner/feature-intake/spec.md)
> **Plan:** [implementation-plan](../.sdlc/architect/design-to-plan/plan.md) — Phase 1 covers this wave
> **Tasks:** [tasks.md](../.sdlc/developer/feature-build/tasks.md) — TASK-001..014
> **Schedule:** [execution-schedule.json](../.sdlc/developer/feature-build/execution-schedule.json) — Wave 1, 1 week critical-path estimate
> **Implementer:** Claude Code `/task-implementer` (Opus 4.7)

---

## Executive Summary

Wave 1 delivers the monorepo scaffold, per-service multi-stage Dockerfiles, root docker-compose,
Azure Bicep IaC, GitHub Actions CI/CD, 10 ADRs, observability log schema, correlation-id middleware,
the feature-flags module (with unit tests), an `.env.example`, and a README quickstart.

11 of 14 tasks complete as `DONE`. 3 are `PARTIAL` exactly as the tasks.md manifest anticipated —
all three wait on Azure tenant credentials the human owner must provision (ACR name, subscription id,
managed-identity federated trust, PG admin password in shared Key Vault).

Wave 1 exit criterion (`docker compose up` boots a green stack) is **structurally met**: every
service ships a Dockerfile with a `/healthz` endpoint and the compose file orchestrates them. The
actual `docker compose up` run has not been executed in this session — the smoke test script is in
place at `ops/tests/docker_compose_up_ok.sh` and is part of the HITL gate that follows Wave 1.

Waves 2–10 (72 remaining tasks, ~17 engineering weeks) are not in scope of this session.

## Traceability Matrix — Wave 1 scope

| Task | Type | Agent-ready | Traces to | Status | Primary files |
|---|---|---|---|---|---|
| TASK-001 | CONFIGURE | YES | AD-9 | DONE | `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.nvmrc`, `.npmrc`, `.prettierrc.json`, `.editorconfig` |
| TASK-002 | CONFIGURE | YES | AD-9 | DONE | `apps/{web,api,aloha-worker}/`, `services/ml/`, `packages/{types,conversions}/` |
| TASK-003 | CONFIGURE | YES | AD-10, DoD#10 | DONE | `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/aloha-worker/Dockerfile`, `services/ml/Dockerfile`, `.dockerignore` |
| TASK-004 | CONFIGURE | YES | AD-10 | DONE | `docker-compose.yml`, `docker-compose.override.yml` |
| TASK-005 | TEST | YES | AD-10 | DONE (script present, unexecuted) | `ops/tests/docker_compose_up_ok.sh` |
| TASK-006 | TEST | YES | AD-10 | DONE (script present, unexecuted) | `ops/tests/docker_image_reproducible.sh` |
| TASK-007 | CONFIGURE | PARTIAL | §10, AD-1 | PARTIAL — needs owner credentials | `infra/bicep/main.bicep`, `infra/bicep/modules/containerapp.bicep`, `infra/bicep/params/{staging,prod}.json`, `infra/bicep/README.md` |
| TASK-008 | CONFIGURE | YES | AD-1, AD-10 | DONE | `.github/workflows/ci.yml` |
| TASK-009 | CONFIGURE | PARTIAL | AD-1 | PARTIAL — needs env secrets | `.github/workflows/deploy.yml` |
| TASK-010 | TEST | PARTIAL | — | PARTIAL — needs FQDN post-deploy | `ops/tests/infra_deploys_ok.sh` |
| TASK-011 | DOCUMENT | YES | AD-1..AD-10 | DONE | `docs/adr/0001..0010.md`, `docs/adr/README.md` |
| TASK-012 | CONFIGURE | YES | §7 observability | DONE | `ops/observability/app-insights.json`, `apps/api/src/observability/correlation-id.ts` |
| TASK-013 | IMPLEMENT | YES | DEC-010 | DONE (+ 6 unit tests) | `apps/api/src/feature-flags/{feature-flags.ts, feature-flags.test.ts, key-vault-override.ts}` |
| TASK-014 | DOCUMENT | YES | — | DONE | `.env.example`, `README.md` |

**Coverage:** 11/14 DONE, 3/14 PARTIAL (all three were tagged `PARTIAL` in the task manifest — nothing regressed).

## Task Execution Log

### TASK-001 — Bootstrap pnpm monorepo skeleton — DONE
Files: `package.json` (workspace root, turbo scripts), `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `turbo.json` (build/test/dev/lint/typecheck pipelines), `tsconfig.base.json` (ES2022, strict + `noUncheckedIndexedAccess`), `.nvmrc` (20.11.0), `.npmrc`, `.prettierrc.json`, `.editorconfig`.
DoD: workspace config resolves the six workspace packages; turbo tasks declared.

### TASK-002 — App/service skeletons — DONE
Created:
- `apps/api` — Fastify + TS, `/healthz` + `/readyz` routes (AC returns `status=ok`, `service=api`, version from env, iso timestamp).
- `apps/web` — Vite + React + PWA plugin; landing page + static `public/healthz` + nginx-served `/healthz`.
- `apps/aloha-worker` — Fastify shell with `/healthz` + TODO stub for PMIX ingest (TASK-066).
- `services/ml` — FastAPI app with `/healthz` + `/readyz`, pyproject with scikit-learn + statsmodels + psycopg; `tests/test_health.py` (2 tests).
- `packages/types` — `Uuid`, `Iso8601`, `Role`, `HealthResponse` seed types; expanded by TASK-024 in Wave 2.
- `packages/conversions` — export surface + `ConversionError` class; real impl lands in TASK-017.

### TASK-003 — Dockerfiles per service — DONE
Four multi-stage Dockerfiles:
- `apps/api/Dockerfile` — node:20.11.1-alpine, non-root `app` user, HEALTHCHECK on `/healthz`, buildkit pnpm-store cache mount, workspace-scoped installs.
- `apps/web/Dockerfile` — build with node, serve with `nginx:1.27-alpine` + custom `apps/web/nginx.conf` (SPA fallback + `/healthz` endpoint).
- `apps/aloha-worker/Dockerfile` — same base pattern as api, port 3002.
- `services/ml/Dockerfile` — python:3.11-slim-bookworm, non-root, uvicorn, curl-based HEALTHCHECK.
- Root `.dockerignore` excludes node_modules, dist, .git, .sdlc, docs, fixtures.

### TASK-004 — docker-compose — DONE
`docker-compose.yml` orchestrates postgres (16-alpine) + minio + api + web + ml + aloha-worker. `service_healthy` dependencies ensure api/worker only start after Postgres responds to `pg_isready`. `docker-compose.override.yml` switches api/worker/ml to debug logging + bind-mounts source (dev-only).

### TASK-005 — `docker_compose_up_ok` smoke test — DONE (script, unexecuted)
`ops/tests/docker_compose_up_ok.sh` — `docker compose up -d --wait --wait-timeout 120`, then curls each public `/healthz` endpoint within a 120 s deadline. Dumps logs + `ps` on failure; tears down on exit. **Not executed in this session** — no Docker daemon available; queued for HITL gate run.

### TASK-006 — `docker_image_reproducible` smoke test — DONE (script, unexecuted)
`ops/tests/docker_image_reproducible.sh` — builds each image twice with `SOURCE_DATE_EPOCH=0 --provenance=false`, compares `docker inspect --format '{{.Id}}'` digests, non-zero exit on mismatch. Intended to run in CI on unchanged source.

### TASK-007 — IaC (Bicep) — PARTIAL (Azure creds)
`infra/bicep/main.bicep` provisions the full v1.6 stack at `resourceGroup` scope:
- Log Analytics + App Insights (workspace-based)
- Key Vault (RBAC; purge-protection on prod)
- User-assigned managed identity
- Storage Account (GRS on prod)
- Postgres Flexible Server 16 (HA + replica on prod; Burstable on staging)
- Container Apps environment + 4 Container Apps (api, web, aloha-worker, ml) via a shared `modules/containerapp.bicep`.

Params files reference Key Vault for `pgAdminPassword`. `REPLACE_ME` subscription ids in
`params/{staging,prod}.json` and the shared ACR setup are the owner-action items blocking
`Agent-ready: YES` (documented in `infra/bicep/README.md`).

### TASK-008 — CI PR workflow — DONE
`.github/workflows/ci.yml`: node-checks job (lint/typecheck/test with pnpm + frozen lockfile), python-checks job (ruff/mypy/pytest for services/ml), docker-build matrix across all 4 services, docker-push matrix to ACR on push-to-main using Azure OIDC federated identity (`azure/login@v2` with `id-token: write`).

### TASK-009 — Deploy workflow — PARTIAL (env secrets)
`.github/workflows/deploy.yml`: main → staging on CI success (`workflow_run`); tag `v*` → prod. `az deployment group create` invokes Bicep with per-service image tags set to `github.sha`. Needs `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `ACR_NAME` secrets and `staging`/`prod` GitHub environments configured.

### TASK-010 — `infra_deploys_ok` smoke test — PARTIAL (needs FQDN)
`ops/tests/infra_deploys_ok.sh` — polls `https://$STAGING_WEB_FQDN/healthz` until 200 or timeout. Can run as the last step of the staging deploy job once the Bicep output `webFqdn` is captured.

### TASK-011 — 10 ADRs — DONE
`docs/adr/0001..0010.md` + `README.md` index. Each ADR ≤ 60 lines with Context / Decision /
Alternatives / Consequences sections, traced back to the plan's AD-N and (where relevant) the
decision log's DEC-N.

### TASK-012 — Observability scaffold — DONE
- `ops/observability/app-insights.json` — canonical log line shape (required: `correlation_id`, `service`, `level`, `message`; optional: `user_id`, `restaurant_id`, `entity_id/kind`, `action`, `duration_ms`, `http.*`, `error.*`). 3 canned alerts (ErrorRate / AuthFailureSpike / AlohaIngestFailure).
- `apps/api/src/observability/correlation-id.ts` — Fastify plugin reading/assigning `x-correlation-id` and injecting it into the per-request logger child.

### TASK-013 — Feature-flags module — DONE + 6 unit tests
- `feature-flags.ts` — `FeatureFlags` class with in-memory TTL cache (default 30 s), clock injection, override precedence over DB row over declared defaults.
- `key-vault-override.ts` — env-backed override resolver (`FF_OVERRIDE_<KEY>`) used in dev; stub for the Key Vault–backed resolver prod will use (TASK-007 provides the identity).
- `feature-flags.test.ts` — 6 tests covering: DB value only, override beats DB, defaults fallback, TTL caching, invalidation, `undefined` override passthrough.

### TASK-014 — Env + README — DONE
`.env.example` (secrets defaulted for local dev, prod uses Key Vault refs), `README.md` quickstart (`docker compose up`, ports, local/prod deploy paths, SDLC artefact pointer).

## Skipped / Flagged Tasks

| Task | Agent-ready | Reason | Unblock action |
|---|---|---|---|
| TASK-007 | PARTIAL | Owner must provision Azure subscription, shared RG, ACR, shared Key Vault, and populate `REPLACE_ME` in Bicep params. | Follow `infra/bicep/README.md` § Prerequisites. |
| TASK-009 | PARTIAL | GitHub repo needs `AZURE_*` + `ACR_NAME` secrets + federated identity trust + `staging`/`prod` environments. | One-time GitHub org/repo config + `az ad sp` setup. |
| TASK-010 | PARTIAL | Depends on TASK-009 completion for a live FQDN. | Runs automatically once TASK-009 unblocks. |

## Change Summary

| Metric | Value |
|---|---|
| Tasks in wave | 14 |
| Tasks DONE | 11 |
| Tasks PARTIAL | 3 (all expected — tagged in manifest) |
| Tasks SKIPPED | 0 |
| Tasks BLOCKED | 0 |
| Files created | 56 |
| Files modified | 0 |
| Unit tests written | 8 (6 TS in feature-flags, 2 Python in ml health) |
| Unit tests executed | 0 (no installed toolchains in this session) |
| Docker images built | 0 (no Docker daemon) |
| Linting runs | 0 |
| Regressions introduced | 0 (greenfield) |

## File Manifest

```
package.json                                 apps/aloha-worker/Dockerfile
pnpm-workspace.yaml                          apps/aloha-worker/package.json
turbo.json                                   apps/aloha-worker/src/main.ts
tsconfig.base.json                           apps/aloha-worker/tsconfig.json
.nvmrc .npmrc .prettierrc.json               apps/api/Dockerfile
.editorconfig .dockerignore .env.example     apps/api/package.json
README.md                                    apps/api/src/feature-flags/feature-flags.ts
docker-compose.yml                           apps/api/src/feature-flags/feature-flags.test.ts
docker-compose.override.yml                  apps/api/src/feature-flags/key-vault-override.ts
                                             apps/api/src/main.ts
apps/web/Dockerfile                          apps/api/src/observability/correlation-id.ts
apps/web/index.html                          apps/api/src/routes/health.ts
apps/web/nginx.conf                          apps/api/src/server.ts
apps/web/package.json                        apps/api/tsconfig.json
apps/web/public/healthz
apps/web/src/App.tsx                         services/ml/Dockerfile
apps/web/src/main.tsx                        services/ml/pyproject.toml
apps/web/tsconfig.json                       services/ml/src/tp_ml/__init__.py
apps/web/vite.config.ts                      services/ml/src/tp_ml/main.py
                                             services/ml/tests/test_health.py
packages/conversions/package.json
packages/conversions/src/index.ts            infra/bicep/main.bicep
packages/conversions/tsconfig.json           infra/bicep/modules/containerapp.bicep
packages/types/package.json                  infra/bicep/params/staging.json
packages/types/src/index.ts                  infra/bicep/params/prod.json
packages/types/tsconfig.json                 infra/bicep/README.md

ops/observability/app-insights.json          .github/workflows/ci.yml
ops/tests/docker_compose_up_ok.sh            .github/workflows/deploy.yml
ops/tests/docker_image_reproducible.sh
ops/tests/infra_deploys_ok.sh                docs/adr/README.md
                                             docs/adr/0001-azure-container-apps.md
                                             docs/adr/0002-single-region-pitr.md
                                             docs/adr/0003-aloha-container-cron.md
                                             docs/adr/0004-conversions-module.md
                                             docs/adr/0005-row-level-audit-triggers.md
                                             docs/adr/0006-jwt-refresh-cookie.md
                                             docs/adr/0007-transactional-aloha-ingest.md
                                             docs/adr/0008-ml-artefact-hot-cache.md
                                             docs/adr/0009-monorepo-pnpm-python-peer.md
                                             docs/adr/0010-docker-deployment-unit.md
```

## Verification Deferred to HITL Gate

The Wave 1 HITL gate (scheduled after this wave per `execution-schedule.json`) requires the owner
to run these verifications once Azure credentials are in place:

1. `docker compose up --build` in a clean checkout — all health checks green within 60 s of last start.
2. `./ops/tests/docker_compose_up_ok.sh` exits 0.
3. `./ops/tests/docker_image_reproducible.sh` exits 0 (digests match across two builds).
4. `pnpm install && pnpm -w run test` — the 6 feature-flag tests pass.
5. `cd services/ml && pip install -e '.[dev]' && pytest -q` — 2 health tests pass.
6. `az deployment group create … staging.json` succeeds; `infra_deploys_ok.sh` hits the Front Door FQDN.
7. CI green on a PR against this commit.

## What Remains (not in this session)

Per `execution-schedule.json`, Waves 2–10 cover 72 tasks spanning an estimated 15 additional weeks:

- **Wave 2 (11 tasks):** Prisma/Drizzle schema + conversions impl + audit triggers + multi-tenant ESLint rule.
- **Wave 3 (6 tasks):** Auth + RBAC + PWA login.
- **Waves 4–8 (45 tasks):** All 21 MVP modules + migration parsers + Aloha worker + ML stream + reports + dashboard.
- **Wave 9 (2 tasks):** Forecast UI wiring.
- **Wave 10 (7 tasks):** Hardening, DR drill, OpenAPI, owner UAT, prod cutover.

Re-invoke `/task-implementer` with a narrower scope (`--wave 2`, a specific phase, or a single task) to continue.

## Next Steps

1. **HITL gate (Wave 1 → Wave 2):** owner provisions Azure credentials per `infra/bicep/README.md` § Prerequisites and runs the verification list above.
2. `/spec-review` on this wave's artefacts for conformance to spec §10 + §15 DoD #10.
3. `/review` on the TS + Python code for the four manual code paths (correlation-id plugin, feature-flags resolver, Bicep Container App module, health tests).
4. When the gate passes, re-invoke `/task-implementer .sdlc/developer/feature-build/tasks.md --wave 2`.

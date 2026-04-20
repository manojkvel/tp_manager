# ADR 0009 — pnpm workspaces + Python workspace-peer monorepo

- **Status:** Accepted
- **Date:** 2026-04-17
- **Traces to:** Plan AD-9

## Context

One Git repo, one CI pipeline, one release cadence. The team is 2–3 people and splitting into N
repos would 10× the ceremony (cross-repo PRs, version bumps, shared-types sync).

## Decision

- pnpm workspaces manage `apps/{web,api,aloha-worker}` + `packages/{types,conversions}`.
- `services/ml` is a Python project (`pyproject.toml`) that lives in the same repo but outside the
  pnpm workspace. It is referenced by CI as a separate job and by docker-compose as a peer service.
- Shared TS types live in `packages/types`; Python reads the same shape as a JSON schema generated
  at build time (`packages/types/dist/schema.json`).
- Turborepo orchestrates TS builds; Python builds use plain pip + hatchling. Both are dockerised
  per ADR 0010.

## Alternatives considered

- **Nx:** Rejected — stronger opinion about generators but we don't need most of it.
- **Polyrepo:** Rejected — cross-repo changes (e.g., adding a field to a forecast response) would
  require N PRs.

## Consequences

- + One PR per behavioural change, regardless of which languages are touched.
- − TS tooling can't lint Python; two separate CI jobs (see `.github/workflows/ci.yml`).
- − Shared-type drift risk: mitigated by generating `schema.json` from `packages/types` at build
  and having `services/ml` assert on it in CI.

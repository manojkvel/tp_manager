# ADR 0010 — Docker is the unit of deployment and local dev

- **Status:** Accepted (new in v1.6)
- **Date:** 2026-04-17
- **Traces to:** Plan AD-10, Decision Log DEC-016, spec §10 + §15 DoD #10

## Context

Spec v1.6 revised the deployment strategy after the owner raised portability concerns: whatever we
pick must run on any Docker-capable host, not just Azure. The earlier v1.5 plan (ADR 0001) had
already chosen Container Apps, but did not explicitly require Docker as the interchange unit.

## Decision

Every service (`apps/api`, `apps/web`, `apps/aloha-worker`, `services/ml`) ships a multi-stage
`Dockerfile`. The repo root has a `docker-compose.yml` + `docker-compose.override.yml` that brings
up the whole stack (API + web + ML + worker + Postgres 16 + MinIO-for-Blob + nginx) locally with
one command:

```sh
docker compose up --build
```

Production runs the same images from ACR on Container Apps (ADR 0001). The images contain no
environment-specific config; everything is injected via env vars + Key Vault references.

## Alternatives considered

| Option | Verdict | Reason |
|---|---|---|
| App Service Web Apps (source-based) | Rejected | Breaks "same binary local→prod" property |
| Nixpacks / Buildpacks | Rejected | Less transparent than explicit Dockerfiles |
| Static binary + systemd | Rejected | Three different runtimes (Node, Python, static web) |

## Consequences

- + Owner can stand up a dev stack offline on any laptop.
- + Identical images in staging and prod eliminate "works in staging" drift.
- + Future migration off Container Apps = swap the hosting runtime, images stay.
- − Docker adds ~120 MB per image; acceptable for this project.
- − `docker_image_reproducible` (TASK-006) must stay green or the "same binary everywhere" property
  silently breaks.

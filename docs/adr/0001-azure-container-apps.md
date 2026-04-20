# ADR 0001 — Deploy to Azure Container Apps

- **Status:** Accepted
- **Date:** 2026-04-17 (revised for v1.6)
- **Traces to:** Plan AD-1, Decision Log DEC-001

## Context

Spec §10 requires a cloud-hosted deployment with a ≥ 99.5 % availability target, automated rollback,
CI/CD, and a 17–23 engineering-week MVP budget. Spec v1.6 also mandates Docker as the unit of
deployment (see ADR 0010). The owner is a single non-technical operator paying the bill — cost and
operational simplicity outweigh peak-performance tuning.

## Decision

Run every service as a Container App in an Azure Container Apps environment (`cae-tp<env>`). Images
are pushed to a shared Azure Container Registry (`tpmanager.azurecr.io`) by CI. Production enables
ZoneRedundant HA and a Postgres read replica; staging runs a slimmer Burstable tier.

## Alternatives considered

| Option | Verdict | Reason |
|---|---|---|
| Single Azure VM + docker-compose | Rejected | Manual scaling + no automated HA; design-review HIGH #1 |
| AKS | Rejected | YAML + cluster ops overhead beyond a 2-person team |
| App Service (non-container) | Rejected | Conflicts with ADR 0010 (Docker as deployment unit) |

## Consequences

- + Horizontal scale + blue-green deploys via revision labels come for free.
- + Identical Docker images ship to local dev, staging, prod.
- − Regional scope is fixed to `canadacentral`; multi-region failover is deferred.
- − Postgres Flexible Server PITR is our only DR mechanism until a restore drill runs (ADR 0002).

# ADR 0002 — Single-region canadacentral + PG PITR

- **Status:** Accepted
- **Date:** 2026-04-17
- **Traces to:** Plan AD-2, DoD #11

## Context

The owner is a Canadian multi-unit cafe. Data residency preference is Canadian regions; Toronto
(canadacentral) minimises latency for owner + staff. Multi-region failover would double infra cost
and is not worth it for a single-tenant MVP.

## Decision

Deploy exclusively to `canadacentral`. Disaster recovery = Postgres Flexible Server Point-In-Time
Restore (7 days on staging, 30 days on prod, geo-redundant backup on prod). A restore drill
(TASK-084, DoD #11) must be run before cutover and at least quarterly thereafter, measuring RTO and
verifying row-count + referential integrity against a recent snapshot.

## Alternatives considered

- **Active-active multi-region:** Rejected — cost + complexity out of scope for MVP.
- **Read replica in westus as DR warm standby:** Deferred — noted as a post-MVP follow-up.

## Consequences

- + Minimal infra cost.
- − Full regional outage ≈ hours of unavailability; acceptable for this tier.
- − The restore drill is mandatory; without it DR is a theoretical guarantee.

# ADR 0003 — Aloha ingest runs as a scheduled Container App, not via Service Bus

- **Status:** Accepted
- **Date:** 2026-04-17
- **Traces to:** Plan AD-3

## Context

Aloha PMIX reports land in a watched folder / SFTP as one Excel file per business day. The job
schedule is daily, volumes are low (< 1 MB/day), and ordering matters (one file at a time). A
message bus adds queueing, poison-message handling, and operational overhead with no real benefit
at this scale.

## Decision

The `aloha-worker` app runs as a Container App with a scheduled trigger (daily at 02:00 local).
On wake-up it polls the watched folder / SFTP, picks up any unprocessed `myReport*.xlsx`, parses it,
and inserts transactionally (see ADR 0007). On failure the file stays in-place and alerts via the
heartbeat emitter (TASK-068).

## Alternatives considered

- **Azure Service Bus queue + worker consumer:** Rejected — extra service for no gain.
- **Logic App / Durable Functions:** Rejected — breaks the "one image per service" rule (ADR 0010).

## Consequences

- + Single Docker image; same dev/prod surface.
- + Idempotent per `business_date` (see §6.12a AC-6).
- − Scheduled runs drift on replica restarts; acceptable given daily cadence.

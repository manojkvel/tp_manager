# ADR 0008 — ML artefact hot-cache with PG NOTIFY refresh

- **Status:** Accepted
- **Date:** 2026-04-17
- **Traces to:** Plan AD-8, spec §6.12b AC-6/7

## Context

The ML forecast endpoint is on the critical path of the prep-sheet and ordering screens — users
wait for it. Loading a fresh model artefact from Blob on every request would add ~500 ms of latency
for no benefit; the same model can serve thousands of requests. But retraining produces a new
version and the API must switch without a full restart.

## Decision

- `services/ml` keeps the current artefact in-process (sklearn / statsmodels pickle). On boot it
  queries `SELECT * FROM model_version WHERE is_current` and loads the referenced Blob URL.
- Training pipeline (TASK-075) writes a new row `model_version(restaurant_id, version, created_at,
  artefact_url, is_current=true)` and calls `NOTIFY model_version_changed, '<restaurant_id>'` in the
  same transaction.
- Every ML replica opens a `LISTEN model_version_changed` channel at boot; on notify it reloads the
  artefact for that restaurant atomically (swap pointer under a lock).
- Inference endpoint returns `{ point, p10, p90, modelVersion, isColdStart }`; when no model exists
  for an item, fall back to a 4-week rolling mean (§6.12b AC-6).

## Alternatives considered

- **Load per-request from Blob:** Rejected — latency.
- **Redis pub/sub:** Rejected — extra service; PG NOTIFY is already in the stack.
- **Polling `model_version` every 60 s:** Rejected — either too slow (stale serves) or too chatty.

## Consequences

- + p99 inference latency stays under 50 ms.
- + Zero-downtime model swaps.
- − Requires stable DB connection for the LISTEN channel; handled by the psycopg pool with
  reconnect-and-relisten logic.

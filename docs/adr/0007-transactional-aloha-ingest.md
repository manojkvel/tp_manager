# ADR 0007 — Transactional Aloha PMIX ingestion (atomic batch)

- **Status:** Accepted
- **Date:** 2026-04-17
- **Traces to:** Plan AD-7, spec §6.12a AC-6, §6.14 AC-6

## Context

A PMIX parse failure halfway through a file must not leave the DB with half the sales rows imported.
The owner's weekly reports must be trustworthy — a partial ingest is worse than a failed ingest,
because it's silently wrong.

## Decision

The Aloha worker's ingest is parse-first-then-insert:

1. Parse the whole file into an in-memory staging representation.
2. Validate all rows (row_kind, amounts, date parsing, modifier resolution).
3. Open a transaction and INSERT all rows atomically; commit on success; rollback + emit an alert on
   any validation error.
4. Idempotency: a unique `(business_date, source_file_hash)` constraint on `pos_import_run`; a
   second ingest of the same file is a no-op.

The same pattern applies to `/settings/migration` review promotions (§6.14 AC-6): approve-all-or-
none; rollback within 14 days reverses exactly the rows promoted in that run.

## Alternatives considered

- **Streaming row-by-row insert:** Rejected — fails "atomic" requirement.
- **Per-row SAVEPOINT + continue-on-error:** Rejected — users see inconsistent totals while a
  partial file is still processing.

## Consequences

- + Users never see partial sales days.
- − Full file must fit in RAM; current PMIX files are < 1 MB so this is comfortable.
- − Long-running transactions hold locks; we bound transaction wall-time with a 30s statement_timeout.

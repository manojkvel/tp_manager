# ADR 0005 — Row-level audit via Postgres triggers

- **Status:** Accepted
- **Date:** 2026-04-17
- **Traces to:** Plan AD-5, spec §6.11 AC-4, §6.13 AC-4

## Context

The owner needs an unbreakable audit trail for: cost-affecting edits, deletions, recipe version
changes, migration promotions, and privilege changes. App-level audit hooks are routinely bypassed
(raw SQL, migrations, future services). A schema-level trigger guarantees that every UPDATE / DELETE
is captured regardless of caller.

## Decision

For every audited table, an `AFTER INSERT/UPDATE/DELETE` trigger writes a row to `audit_log` with:
`table_name`, `row_id`, `action`, `actor_user_id`, `restaurant_id`, `before` (jsonb), `after`
(jsonb), `occurred_at`. Triggers are auto-generated from a single template — one migration per new
table — to avoid drift.

Audited tables (v1.6): `ingredient`, `supplier`, `recipe`, `recipe_version`, `ingredient_cost`,
`inventory_count`, `waste_log`, `order_form`, `pos_sale`, `user`, `role_assignment`.

## Alternatives considered

- **App-level audit middleware:** Rejected — bypassable.
- **CDC to an external store:** Deferred — useful for long-term analytics but overkill for MVP.

## Consequences

- + Compliance by construction; no code path can skip it.
- − Every schema change needs the trigger template re-applied; linter on migrations prevents drift.
- − JSONB diffs grow fast; `audit_log` partitions by month, old partitions offloaded to Blob via a
  nightly job (post-MVP).

# Decision & Deviation Log — TP Manager

**Feature:** Restaurant Operations Platform ("TP Manager")
**Spec version:** v1.5 (APPROVED)
**Plan:** `.sdlc/architect/design-to-plan/plan.md` (DRAFT)
**Generated:** 2026-04-17
**Source:** `/decision-log capture` invoked after `/plan-gen`

---

## Summary

| ID | Decision | Status | Deviation | Impact |
|----|----------|--------|-----------|--------|
| DEC-001 | Hosting: Azure Container Apps (not raw VM) | ACTIVE | MINOR | plan, impl, ops |
| DEC-002 | API framework: NestJS | ACTIVE | NONE | plan, impl |
| DEC-003 | Aloha transport: scheduled PMIX file-drop | ACTIVE | NONE | plan, impl, data |
| DEC-004 | Conversions as a dedicated module with property tests | ACTIVE | MINOR | plan, impl, test |
| DEC-005 | Audit log via row-level DB triggers | ACTIVE | NOTABLE | plan, impl, ops |
| DEC-006 | JWT-only on `/api/v1` (no session cookies on API) | ACTIVE | MINOR | plan, impl, security |
| DEC-007 | Transactional Aloha batches (parse fully → single insert) | ACTIVE | NONE | plan, impl |
| DEC-008 | ML artefact hot-cached + DB NOTIFY refresh | ACTIVE | NONE | plan, impl |
| DEC-009 | Monorepo with pnpm workspaces (+ Python workspace-peer) | ACTIVE | MINOR | plan, impl, CI |
| DEC-010 | Feature flags: DB-backed table with Key Vault override | ACTIVE | NONE | plan, impl, ops |
| DEC-011 | ML as a separable work stream, not critical path | ACTIVE | NOTABLE | plan, impl |
| DEC-012 | Single-tenant schema with `restaurant_id` from day 1 | ACTIVE | NONE | plan, impl, data |
| DEC-013 | Test-first (TDD) for every phase | ACTIVE | NONE | plan, impl, test |
| DEC-014 | Recipe versioning: historical cost pins to active version | ACTIVE | NONE | plan, impl |
| DEC-015 | Bilingual EN/ES: ES optional + coverage tracked on dashboard | ACTIVE | MINOR | plan, impl |

**Total decisions:** 15
**Deviations from standard:** 7 (MINOR: 5; NOTABLE: 2; SIGNIFICANT: 0)
**Key assumptions:** 8 (fragile: 3)

---

## Decisions

### DEC-001: Hosting — Azure Container Apps (not raw VM)

**Context:** Spec §7 sets availability NFR at 99.5% monthly. Spec §10 initially proposed a single Azure VM running three processes under systemd. Design-review HIGH #1 flagged that as insufficient — one unplanned Azure VM patch window can consume most of the monthly availability budget.

**Decision:** Deploy the three services (API, ML, Aloha worker) as three Azure Container Apps within one Container Apps Environment. API runs with `minReplicas=1`; ML and Aloha worker scale-to-zero acceptable.

**Status:** ACTIVE

**Alternatives considered**

| # | Alternative | Pros | Cons | Rejection reason |
|---|---|---|---|---|
| 1 | Single Azure VM (spec v1.5 original) | Cheapest; full control | Patch windows kill availability; manual process management | Availability risk; operational overhead |
| 2 | Dual VMs behind Front Door hot-standby | Meets 99.5% | Doubles compute cost; DIY orchestration | Overkill for MVP scale |
| 3 | Azure App Service (classic) | Managed | Less flexible scheduler; Python+TS coexistence awkward | Container Apps is the strictly better App Service for this shape |

**Trade-offs accepted**
- Slightly higher compute cost than VM (≈ $40/mo more at expected scale).
- Cold-start on scale-to-zero for ML + Aloha worker (acceptable; not on critical path).

**Assumptions**
- Container Apps regional availability covers the restaurant's region. **[A-001]**
- Team can learn Container Apps deploy flow in ≤ 3 days. **[A-002]**

**Deviation from standard** — MINOR
- **Standard approach:** Raw VMs are the most common "just ssh in" Azure pattern for small MVPs.
- **Our approach:** Managed container runtime.
- **Why:** Availability NFR + patch-free ops outweighs familiarity.

**Downstream impact:** plan Phase 1 + Phase 7 cutover; tasks in Wave 1.

---

### DEC-002: API framework — NestJS

**Context:** Spec §10 lists NestJS or Fastify as the API framework with the decision to be made at plan time. The API is the critical path for web + future native clients.

**Decision:** NestJS.

**Status:** ACTIVE

**Alternatives considered**

| # | Alternative | Pros | Cons | Rejection reason |
|---|---|---|---|---|
| 1 | NestJS (chosen) | Opinionated module/controller/service layering; built-in OpenAPI decorators; DI; testable | Heavier than Fastify; more boilerplate | — |
| 2 | Fastify + hand-rolled layering | Faster; lean | Team re-invents DI + module conventions; OpenAPI work manual | Would grow its own opinionated layer over time = re-implementing Nest |
| 3 | Express | Ubiquitous | Dated; no DI; encourages ad-hoc structure | Rejected on discipline grounds |

**Trade-offs accepted** — Some boilerplate in exchange for consistent structure a 2–3 person team can navigate.

**Assumptions**
- Team has at least one engineer familiar with Nest-style DI. **[A-003]**

**Downstream impact:** all Phase 3/4/5 API modules; task-gen templates.

---

### DEC-003: Aloha transport — scheduled PMIX file-drop

**Context:** Spec §6.12a AC-1 offered four transport options: (a) scheduled PMIX export dropped to SFTP / watched folder; (b) SFTP DBF pickup from Aloha BOH; (c) Aloha Cloud / Insight REST API; (d) 3rd-party middleware.

**Decision:** Path (a). Owner schedules Aloha to email / SFTP-drop the same PMIX report they already run (`myReport (10).xlsx` schema), and TP Manager picks it up nightly.

**Status:** ACTIVE

**Alternatives considered**

| # | Alternative | Pros | Cons | Rejection reason |
|---|---|---|---|---|
| 1 | PMIX file-drop (chosen) | Zero Aloha-side dev; parser validated against real sample; fits owner's existing workflow | File-based is "lower tech" than API | — |
| 2 | SFTP DBF pickup from Aloha BOH | Canonical raw data | DBF encoding quirks; schema varies by Aloha version | Development cost outweighs fidelity gain for MVP |
| 3 | Aloha Cloud / Insight REST | Real-time possible | Owner is on classic on-prem; requires paid Insight subscription | Not available on owner's deployment |
| 4 | Middleware (Omnivore, Itsacheckmate) | Normalised data | Monthly subscription; another vendor dep | Cost + dependency; not needed when (a) works |

**Trade-offs accepted** — File-based daily latency instead of real-time sync. Acceptable: AvT and forecasts work from yesterday's data.

**Assumptions**
- Aloha can schedule a recurring PMIX export. **[A-004]**
- Owner's network allows SFTP or a watched-folder sync to Azure. **[A-005]** ⚠ **FRAGILE** — restaurant POS networks are often locked down; Phase 5 has a "transport pick" runbook as a fallback to investigate (c)/(d) if (a) fails environmental checks.

**Downstream impact:** Phase 5 Aloha worker; AD recorded as `docs/adr/0003-aloha-transport-pmix-filedrop.md`.

---

### DEC-004: Conversions as a dedicated module

**Context:** Three conversion layers are stacked in the domain: (a) weight ↔ volume (requires per-ingredient density); (b) utensil → physical (`Blue Scoop = 2 oz`); (c) per-ingredient utensil override (granola Blue Scoop ≠ diced-tomato Blue Scoop). Design-review MEDIUM #3 flagged that scattering these across call sites is a silent wrong-cost farm.

**Decision:** `packages/conversions` in the monorepo, pure functions, property-based tests. Every cost computation in API, worker, and ML goes through this module — no inline conversion.

**Status:** ACTIVE

**Alternatives considered**

| # | Alternative | Pros | Cons | Rejection reason |
|---|---|---|---|---|
| 1 | Dedicated module + property tests (chosen) | Single source of truth; property tests catch override-fallback edge cases | Slight upfront cost | — |
| 2 | Inline conversion at each cost site | Zero module overhead | Drift across call sites; no central test surface | Silent wrong-cost risk unacceptable |

**Trade-offs accepted** — A small amount of "plumbing" weight in exchange for correctness guarantees.

**Assumptions**
- Ingredient density data is available for every volumetric ingredient at migration time. **[A-006]** ⚠ **FRAGILE** — the source files include weights for some ingredients but densities for few. Plan Phase 2 includes a "missing density" report; Phase 3 migration flags any ingredient referenced by volume without a density.

**Deviation from standard** — MINOR. Most restaurant inventory tools do inline conversion. Dedicated module with property tests is unusual discipline for this domain.

**Downstream impact:** Phase 2 + every cost-computing call site in Phase 3–5.

---

### DEC-005: Audit log via row-level DB triggers

**Context:** Spec §8 defines `AuditLog`; §11 requires 12-month retention. Design-review MEDIUM #7 flagged that app-layer audit hooks are bypassed by ops queries, backfill scripts, and emergency DB edits.

**Decision:** Implement the audit log via Postgres row-level triggers (AFTER INSERT/UPDATE/DELETE) applied to every audited table. Trigger template is code-generated from the Prisma schema.

**Status:** ACTIVE

**Alternatives considered**

| # | Alternative | Pros | Cons | Rejection reason |
|---|---|---|---|---|
| 1 | DB triggers (chosen) | Captures all writes regardless of source (app, ops, backfill) | Schema changes must update triggers | Reliability > maintenance cost |
| 2 | Application middleware | Easy to write in Nest; testable in app land | Ops bypass | Unacceptable for 12-mo retention claim |
| 3 | CDC (logical replication + audit service) | Comprehensive, decoupled | Infra complexity for MVP | Overkill |

**Trade-offs accepted** — Adds a layer of DB-side code; schema migrations must maintain triggers (automated via migration template).

**Assumptions**
- Postgres `trigger` support is sufficient; no need for pgaudit extension. **[A-007]**

**Deviation from standard** — NOTABLE. Most MVP-stage systems use app-layer audit. The choice is explicit in response to the risk that ops edits silently bypass audit during launch.

**Downstream impact:** Phase 2 migration `0002_audit_triggers.sql`; auditable-table list maintained in `apps/api/prisma/audit.ts`; every schema migration has a sibling trigger migration.

---

### DEC-006: JWT-only on `/api/v1` (no session cookies on API surface)

**Context:** Spec §6.13 AC-2 calls for "Session cookie + CSRF token; JWT for API (prepares for native clients)" — design-review LOW #8 flagged this hybrid as a source of middleware overlap and subtle security gaps.

**Decision:** `/api/v1/*` accepts only Bearer JWT. The PWA stores the refresh token in an `httpOnly` cookie and the access token in memory, sending it via the Authorization header. No session cookies on the API surface; no dual-middleware branch.

**Status:** ACTIVE

**Alternatives considered**

| # | Alternative | Pros | Cons | Rejection reason |
|---|---|---|---|---|
| 1 | JWT-only on API + refresh cookie (chosen) | Single auth path; native + PWA same contract | PWA must handle in-memory access token lifecycle | — |
| 2 | Session cookies on web; JWT on `/api/v1/*` for native | Familiar for server-rendered pages | TP Manager is a SPA — no server rendering | Doesn't apply |
| 3 | Dual auth (cookies + JWT both accepted on API) | Flexible | Two middlewares, overlapping CSRF + Bearer paths | Rejected on security clarity |

**Trade-offs accepted** — PWA manages JWT in memory (page refresh = silent refresh round-trip). Acceptable latency.

**Deviation from standard** — MINOR. Classic SSR apps use sessions; SPAs are split on JWT vs cookies. Choice aligns with the "native iOS/Android from same API" Phase 3 goal.

**Assumptions**
- Refresh-token rotation + short access-token TTL is adequate against XSS (accepting that XSS = compromised token). Enforced by strict CSP in PWA. **[A-008]**

**Downstream impact:** Phase 3 Wave 3 auth; PWA refresh flow; API middleware.

---

### DEC-007: Transactional Aloha batches

**Context:** Spec §6.12a AC-6 says "Re-imports for the same business_date are idempotent (last import wins for that date; prior import row-set archived for audit)." Design-review MEDIUM #4 flagged partial-failure ambiguity: if the parser crashes mid-file, what's persisted?

**Decision:** Aloha worker parses the entire PMIX file into memory (or a tmpfile) first, validates row-classification for every row, then performs a **single transaction per `(business_date, import_run)`**. Any failure during parse or insert = zero rows persisted, `AlohaImportRun.status = failed`, error detail captured.

**Status:** ACTIVE

**Alternatives considered**

| # | Alternative | Pros | Cons | Rejection reason |
|---|---|---|---|---|
| 1 | Parse fully then transactional insert (chosen) | Atomic; no partial state | Memory use proportional to file size | PMIX files are small (< 10 MB typical) |
| 2 | Streaming insert with savepoints | Lower memory | "Last import wins" + partial failure = ambiguous | Data-drift risk |

**Trade-offs accepted** — Higher peak memory; acceptable for the expected file size.

**Downstream impact:** Phase 5 Aloha worker; test `aloha.import_run_idempotent`.

---

### DEC-008: ML artefact hot-cache with DB NOTIFY refresh

**Context:** Spec §10 stores ML artefacts in Azure Blob. Design-review MEDIUM #5 flagged the loading-path: cold-load per request = slow; no cache = stale.

**Decision:** ML FastAPI worker loads all current artefacts into memory on startup, keyed by `(entity_type, entity_id, model_version)`. Subscribes to a Postgres `LISTEN model_version_changed` channel. Nightly training writes the new `ForecastModel` row and issues `NOTIFY model_version_changed` with the new version; the worker reloads the affected artefact from Blob.

**Status:** ACTIVE

**Alternatives considered**

| # | Alternative | Pros | Cons | Rejection reason |
|---|---|---|---|---|
| 1 | Hot-cache + NOTIFY (chosen) | Fast inference; bounded staleness | Cache grows with item count | Item count is bounded (few hundred) |
| 2 | Cold-load per request | Always fresh | Blob latency per call | Too slow |
| 3 | Poll every N minutes | Simpler than NOTIFY | Staleness window = poll interval; wasted reads | NOTIFY is already in PG, no reason not to use it |

**Trade-offs accepted** — Memory grows with artefact count; bounded in practice.

**Downstream impact:** Phase 6 ML service; test `ml.artefact_cache_reloads_on_notify`.

---

### DEC-009: Monorepo with pnpm workspaces (+ Python peer)

**Context:** Plan ships TS (web, API, Aloha worker), Python (ML), shared TS types, and shared TS conversions. Polyrepo would force type duplication; single TS repo can't host Python cleanly.

**Decision:** Single repo with pnpm workspaces for TS packages (`apps/web`, `apps/api`, `apps/aloha-worker`, `packages/types`, `packages/conversions`); Python ML lives as `services/ml/` with its own `pyproject.toml` + `uv` (or poetry) lockfile, not a pnpm workspace member.

**Status:** ACTIVE

**Alternatives considered**

| # | Alternative | Pros | Cons | Rejection reason |
|---|---|---|---|---|
| 1 | Monorepo, pnpm + Python peer (chosen) | Shared types across TS; one git history; one CI repo | CI workflows more varied | Manageable |
| 2 | Polyrepo | Independent release cycles | Type sync friction for `packages/types`; coordination overhead | Team is 2–3 people |
| 3 | Single TS repo with Python in `/python` | Single CI workflow | Confuses pnpm tree; subtle tooling issues | Python is a peer, not a TS package |

**Trade-offs accepted** — Slightly more complex CI (separate TS and Python workflows).

**Deviation from standard** — MINOR. "Python peer in a TS monorepo" is uncommon but the cleanest fit for this shape.

**Downstream impact:** Phase 1 scaffolding; CI workflows split per app/service.

---

### DEC-010: Feature flags — DB table with Key Vault override

**Context:** Plan §7 rollback references `feature_flags.operational_module_X` and `feature_flags.ml_enabled`. Gate report advisory #3 flagged that feature flags aren't yet scaffolded.

**Decision:** Simple DB-backed `feature_flags` table (`name`, `enabled`, `updated_by`, `updated_at`), with a per-flag Key Vault override that supersedes the DB value. No external feature-flag service in MVP.

**Status:** ACTIVE

**Alternatives considered**

| # | Alternative | Pros | Cons | Rejection reason |
|---|---|---|---|---|
| 1 | DB + Key Vault override (chosen) | Zero third-party deps; owner can flip flags in app | No targeting/percent rollouts | Not needed for single-tenant MVP |
| 2 | LaunchDarkly / Flagsmith | Full-featured | Vendor + cost + network dep | Overkill |
| 3 | Env-var-only | Simplest | Requires redeploy to flip | Too rigid for rollback use case |

**Downstream impact:** Phase 1 schema; every rollback plan entry references a specific flag.

---

### DEC-011: ML as a separable work stream

**Context:** Spec §6.12b AC-7 says forecasting outages do not block operations. Plan §4 Phase 6 formalizes ML as a parallel stream from Wave 6.

**Decision:** The ML service is deployed independently; operational screens function with forecast-free UI ("insufficient data" fallback) if ML is down or slipped. ML tasks carry a `stream=ml` tag for wave scheduling so they can be dropped without blocking the operational loop.

**Status:** ACTIVE

**Alternatives considered**

| # | Alternative | Pros | Cons | Rejection reason |
|---|---|---|---|---|
| 1 | Separable stream (chosen) | MVP ships even if ML slips | Owner gets less value if ML isn't there at launch | Acceptable; ML is advisory |
| 2 | ML on critical path | Launch includes ML from day 1 | MVP ships late or not at all if ML slips | Unacceptable coupling |

**Deviation from standard** — NOTABLE. Many "ML-native" MVPs make ML critical. TP Manager deliberately doesn't.

**Assumptions**
- Owner accepts that ML is a "stretch goal" within MVP. Confirmed at HITL (gate-briefing v3 condition #6). **[A-009]**

**Downstream impact:** Phase 6 staffing flexibility; dashboard fallback UI design.

---

### DEC-012: `restaurant_id` column from day 1

**Context:** Spec §12 OQ-1 resolved to single restaurant. Future multi-location is Phase 3.

**Decision:** Every operational table carries a `restaurant_id` column (seeded to the single-restaurant UUID) from the initial migration. Query paths filter by `restaurant_id` even though the filter is effectively `= <only value>`.

**Status:** ACTIVE

**Alternatives considered**

| # | Alternative | Pros | Cons | Rejection reason |
|---|---|---|---|---|
| 1 | `restaurant_id` from day 1 (chosen) | Multi-tenant migration = row-filter change only | Single extra column on every table | Cheap insurance |
| 2 | Add `restaurant_id` later via migration | Lighter schema in MVP | Every query needs rewrite; tests need rewrite; app logic needs refactor | Expensive future work |

**Assumptions**
- Future multi-location will share a single DB (row-level multi-tenancy), not DB-per-tenant. **[A-010]**

**Downstream impact:** Phase 2 schema; custom ESLint rule in Phase 1 blocking queries without a `restaurant_id` filter (plan §6 risk row).

---

### DEC-013: Test-first (TDD) for every phase

**Context:** Plan §4 opens every phase with a "Tests first" table before "Changes."

**Decision:** No implementation code ships without a failing test first. Every AC maps to at least one named test in the plan.

**Status:** ACTIVE

**Alternatives considered**

| # | Alternative | Pros | Cons | Rejection reason |
|---|---|---|---|---|
| 1 | TDD (chosen) | AC traceability via tests; fewer regression bugs | Up-front time cost | Required by plan-gen skill conventions |
| 2 | Test-after | Faster first cut | Tests often skipped or retrofitted | Contradicts spec §15 DoD |

**Downstream impact:** every task generated from this plan starts with a test file.

---

### DEC-014: Recipe versioning — historical cost pins to active version

**Context:** Spec §6.3 AC-5 "Version history preserved — editing a recipe creates a new version; past cost computations pin to the version that was active at the time."

**Decision:** Recipe table is append-only for logical versions; `is_current` marks the current version. Cost rows stamp `recipe_version_id` so historical reports reflect what the menu actually was.

**Status:** ACTIVE

**Alternatives considered**

| # | Alternative | Pros | Cons | Rejection reason |
|---|---|---|---|---|
| 1 | Append-only recipe versions (chosen) | Historical reports are faithful | Schema discipline required everywhere recipes are referenced | Necessary for AvT accuracy |
| 2 | Soft-delete only | Simpler | Can't reconstruct plated cost at a past point | Breaks Price Creep + AvT |

**Downstream impact:** every cost-computing path tests for `recipe_version_id` pinning.

---

### DEC-015: Bilingual EN/ES — ES optional + coverage tracked

**Context:** Design-review MEDIUM #6 flagged that a recipe can be saved with empty ES body and nothing blocks it. Line cooks are the ES-primary users.

**Decision:** ES is optional in schema, but every recipe-facing screen + the dashboard surfaces an **ES-coverage percentage** ("ES coverage: 87 of 94 menu recipes"). A drift-detection badge fires when EN `updated_at` > ES `updated_at`.

**Status:** ACTIVE

**Alternatives considered**

| # | Alternative | Pros | Cons | Rejection reason |
|---|---|---|---|---|
| 1 | Optional + coverage tracking (chosen) | Owner has visibility; staged rollout of ES content | Doesn't hard-block; owner must watch the number | Acceptable for bilingual team that already maintains ES content |
| 2 | Mandatory ES on menu-facing recipe publish | Guarantees ES present at publish | Blocks iteration; owner will work around it | Friction without clear payoff |
| 3 | No bilingual enforcement (spec v1.5 default) | Simpler | Silent degradation is the exact risk flagged | Unacceptable |

**Deviation from standard** — MINOR. Most apps either enforce or ignore; coverage tracking is in-between.

**Downstream impact:** Phase 3 recipe module + dashboard KPI.

---

## Assumption Register

| # | Assumption | Supports | Fragility | Validation |
|---|---|---|---|---|
| A-001 | Container Apps available in owner's region | DEC-001 | LOW | Azure region table check in Phase 1 Wave 1 |
| A-002 | Team learns Container Apps in ≤ 3 days | DEC-001 | LOW | Spike in Phase 1 |
| A-003 | At least one engineer familiar with Nest-style DI | DEC-002 | LOW | Confirm at staffing time |
| A-004 | Aloha can schedule recurring PMIX export | DEC-003 | LOW | Owner confirms with their Aloha reseller before Phase 5 |
| A-005 | Network path from restaurant to Azure SFTP target works | DEC-003 | **HIGH** | Network test in Phase 5 Wave 8; fallback = path (c) or (d) runbook |
| A-006 | Ingredient density data exists for every volumetric ingredient | DEC-004 | **HIGH** | Phase 2 missing-density report; Phase 3 migration flags |
| A-007 | Postgres triggers sufficient (no pgaudit) | DEC-005 | LOW | Confirmed by PG docs |
| A-008 | Strict CSP + short JWT TTL adequate against XSS | DEC-006 | MEDIUM | Security audit in Phase 7 |
| A-009 | Owner accepts ML as "stretch within MVP" | DEC-011 | LOW | Confirmed at HITL gate |
| A-010 | Future multi-location uses row-level multi-tenancy | DEC-012 | MEDIUM | Re-confirm at Phase 3 (multi-location) entry |
| A-011 | PMIX report schema stable across Aloha updates | DEC-003, DEC-007 | **HIGH** | Parser versioned; schema-mismatch fails loudly |
| A-012 | 1 year PMIX backfill covers enough seasonality for Holt-Winters | DEC-011 | MEDIUM | Forecast-accuracy dashboard validates retroactively |

Three FRAGILE assumptions — A-005 (network), A-006 (density data), A-011 (PMIX schema stability) — are the top assumption-risks for the build. Plan already accounts for all three (transport fallback runbook; missing-density report; versioned parser with loud failure).

---

## Deviation Summary

| ID | Standard approach | Our approach | Severity | Rationale |
|---|---|---|---|---|
| DEC-001 | Raw VM for single-tenant MVP | Managed container runtime | MINOR | Availability NFR + patch-free ops |
| DEC-004 | Inline conversion per call site | Dedicated module + property tests | MINOR | Silent wrong-cost risk |
| DEC-005 | App-layer audit hook | DB triggers | **NOTABLE** | Ops-bypass risk unacceptable for 12-mo retention |
| DEC-006 | Hybrid session+JWT | JWT-only on API | MINOR | Middleware clarity + native-ready |
| DEC-009 | Polyrepo or single-language monorepo | TS monorepo + Python peer | MINOR | Cleanest fit for the two-language split |
| DEC-011 | ML on critical path | ML as separable stream | **NOTABLE** | Protects MVP ship date |
| DEC-015 | Enforce or ignore bilingual | Optional with coverage tracking | MINOR | Pragmatic given bilingual team |

---

**Next artifact after this pipeline:** task-gen breaks each wave into implementable tasks with DoD per task, dependency edges, and agent-ready ratio measurements.

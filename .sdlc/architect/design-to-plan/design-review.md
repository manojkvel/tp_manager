---
date: 2026-04-17
scope: full (architecture of proposed TP Manager per spec v1.5, re-scoped against v1.6)
tech_debt_rating: N/A (greenfield)
issues_count:
  high: 2
  medium: 4   # was 5 in v1.5; MEDIUM #6 (bilingual drift) retired by v1.6 scope cut
  low: 3
  obsolete: 1
---

# Design Review — TP Manager (greenfield)

**Spec:** `.sdlc/product-owner/feature-intake/spec.md` **v1.6** (APPROVED — Docker-first, EN-only)
**Scope:** §10 Architecture Summary + cross-check against §7 NFRs, §8 Domain Model, §11 Security, §6.12a/b integrations.
**Mode:** Pre-implementation review — no code exists. Evaluates the *proposed* architecture before plan-gen locks it in.
**v1.6 note:** MEDIUM #6 (bilingual content drift) is **OBSOLETE** — bilingual was removed from scope. HIGH #1 recommendation (c) was adopted and expanded in v1.6 to a Docker-first deployment unit.

---

## Architecture Overview

The spec proposes a three-service topology behind a single managed PostgreSQL, deployed to a single Azure VM with managed PaaS dependencies.

```
Browser (PWA, React+Vite+Tailwind+Workbox)
   │  HTTPS (Azure Front Door / nginx TLS)
   ▼
Azure VM (single-host, systemd)
 ├── API service (TS — NestJS or Fastify)     ◄── critical path, web+mobile clients
 ├── ML service (Python — FastAPI, sklearn+statsmodels)  ── advisory, async reads
 └── Aloha import worker (TS, scheduled)       ── nightly PMIX pull
                │         │         │
                ▼         ▼         ▼
     Azure Database for PostgreSQL (primary)
            └── read replica (ML only)
     Azure Blob Storage (photos + model artefacts)
     Azure Key Vault (secrets, managed identity)
```

All three processes share one PostgreSQL primary; the ML service reads from a read replica and writes predictions back in short bursts. The Aloha worker ingests PMIX exports (default path (a) — file-drop over SFTP / watched folder) and writes normalised rows via the transform layer.

---

## Strengths

1. **Clean service split by language fit, not fashion** (§10). TS for web+API, Python for ML. The split is justified by library ecosystem (statsmodels, scikit-learn), not microservice dogma. Two services share one DB → no distributed-transaction tax, one source of truth.
2. **Advisory-by-design ML** (§6.12b AC-5, §10 service-boundary table). ML is explicitly **not** on the critical path. Operational modules function without ML. Stale predictions degrade gracefully with a "last updated" badge. This is the single most important architecture decision — it means the ML service can slip or fail without blocking shipping.
3. **Transport-isolated Aloha worker** (§6.12a AC-1, §10). Import transport is behind an interface — SFTP file-drop / DBF pickup / Aloha REST / middleware all plug into the same normaliser. A plan-time ADR picks one; the rest stay as fallbacks without rewrites.
4. **Migration as a first-class module** (§6.14). The staging → review → canonical pattern with 14-day rollback is production-grade — not the "support ticket" migration that typically ships in MVPs. Rollback window + batch audit trail + explainable fuzzy matching meets what you'd expect of an enterprise data import.
5. **Row-scoped multi-tenancy-readiness without multi-tenant complexity** (§12 OQ-1 resolution). `restaurant_id` is a column from day 1 even though there's only one restaurant. Future multi-tenant is a row-filter change, not a schema migration.
6. **PWA + versioned API from day 1** (§7 API NFR, §10 client block). `/api/v1` + OpenAPI auto-gen means native iOS/Android in Phase 3 consumes the exact same contract — no API rewrite.
7. **Secrets via managed identity + Key Vault, not env files** (§10, §11). The spec explicitly rejects secrets-in-env-files — rare discipline at MVP stage.

---

## Issues Found

### [HIGH] Single-VM deploy topology is a single point of failure for the 99.5% availability NFR
**Location:** §10 "Deploy topology (MVP)" vs §7 "Availability: 99.5% monthly"
**Issue:** Three processes under systemd on **one** VM behind nginx. A VM patch, kernel panic, or failed deploy kills the whole stack. 99.5% monthly = ~3h 36m total downtime allowed. A single unplanned Azure VM reboot + OS patch window realistically eats 30–60 min; a bad deploy without blue/green eats another 15–30. One bad month can burn the entire budget.
**Impact:** Plan will ship with an NFR that cannot be met without operational discipline the spec doesn't budget for.
**Recommendation:** Pick one of:
  (a) **Downgrade NFR to 99% monthly** (~7h 18m/month) — honest for single-VM MVP;
  (b) **Add a standby VM** with hot-failover via Azure Front Door — adds cost but meets 99.5%;
  (c) **Managed container (Azure Container Apps / App Service)** instead of a raw VM — lets Azure handle restarts/patches.
  Record the choice as ADR at plan time.
**Effort:** small (decision) / medium (option b or c)

### [HIGH] No explicit DR / backup-restore test requirement
**Location:** §7 "Data durability: Daily backup; PITR ≤ 24h loss"
**Issue:** "Daily backup" is an input. What's missing is a **proven restore drill** before go-live. A backup that has never been restored is a hope, not a backup. This is especially critical because the migration tool (§6.14) is the system of record for the owner's recipe book — if the post-migration canonical tables go, 11 source files won't rehydrate without redoing the review step.
**Impact:** Owner could permanently lose migrated data.
**Recommendation:** Add to DoD: "One full restore drill completed from Azure PITR into a staging DB; timing measured; post-restore integrity check run." Include in plan Phase 5 (Cleanup).
**Effort:** small

### [MEDIUM] Unit conversion is a cross-cutting landmine — spec treats it as a detail
**Location:** §6.1 AC-6, §6.3a AC-3/4, §8 `UnitConversion` + `UtensilEquivalence`
**Issue:** The system has **three** independent conversion layers stacked: (a) weight↔volume (requires per-ingredient density); (b) utensil↔physical (Blue Scoop → 2 oz); (c) per-ingredient utensil override (a Blue Scoop of granola ≠ Blue Scoop of diced tomato by weight). Any recipe-cost computation walks all three. Bugs in this layer will mis-cost plates silently — the owner's entire food-cost thesis rides on it being correct.
**Impact:** Silent wrong-cost errors propagate through AvT variance, price creep, plated cost, and forecast inputs.
**Recommendation:** Treat `conversions` as its own service module with property-based tests (scoop count × override → expected oz). Plan Phase 2 should dedicate ≥ 1 task to this with explicit test coverage; every call site computes cost *through* this module, never ad-hoc.
**Effort:** medium

### [MEDIUM] Aloha PMIX ingestion is an "all or nothing" idempotency — partial failures are ambiguous
**Location:** §6.12a AC-6 "Re-imports for the same business_date are idempotent (last import wins)"
**Issue:** "Last import wins" is clean for full-day retries, but the PMIX sample has **mixed row types** in one file (items + modifiers + 86-markers + covers). If the parser gets 80% through and crashes, what state is the `staging.pos_sales` bucket in? The spec is silent on partial-file handling.
**Impact:** Silent data drift if a retry re-imports only the rows the parser got past before the crash; doubled counts if "last import wins" overwrites with a truncated set.
**Recommendation:** Make the batch atomic: parse fully into memory (or tmpfile), then single transactional insert. `AlohaImportRun.status=failed` → zero rows persisted. Document this in §6.12a as an AC clarification during plan-gen.
**Effort:** small

### [MEDIUM] ML model artefact storage + retrieval path is under-specified
**Location:** §8 `ForecastModel.artefact_ref` + §10 "Azure Blob Storage for recipe/waste photos + ML model artefacts"
**Issue:** Blob is right for the artefact, but the spec doesn't say **how the ML service loads artefacts at inference time**. Cold-load from blob on every request = high p50 latency. In-memory cache with eviction = stale model risk. No strategy stated.
**Impact:** Either forecast endpoint is slow or it silently serves stale model versions.
**Recommendation:** Load on worker startup + refresh on `model_version` change signal (polled from DB or pushed via DB NOTIFY). Keep last N versions warm. Plan-gen must name this explicitly.
**Effort:** small

### ~~[MEDIUM] Bilingual content drift is only an NFR risk — not a system invariant~~ — **OBSOLETE v1.6**
**Retired:** 2026-04-17 with spec v1.6. Owner removed bilingual EN/ES from scope ("we will have only english"). There is no ES surface to drift, so this finding no longer applies. Retained below for historical traceability; DEC-015 in the decision log is likewise retired.

~~**Location:** §13 risk row + §6.3 AC-3~~
~~**Issue:** "UI badge 'ES outdated' when `updated_at` on EN body > ES body" is a UI patch, not a data-layer guarantee. A recipe can be saved with a valid EN body and an empty ES body; nothing blocks it. Line cooks are the Spanish-primary users — a silently-empty ES field *is* the failure mode the spec's bilingual story was supposed to prevent.~~
~~**Recommendation:** Either (a) make ES optional explicitly in the API schema and track coverage % on the dashboard, or (b) require ES on publish of any menu-facing recipe.~~

### [MEDIUM] Audit log at the DB layer means DB-bypass = no audit
**Location:** §8 `AuditLog (entity, entity_id, field, before, after)` + §11 "Audit log retained 12 months"
**Issue:** Where is the audit log written from? If it's an application-layer trigger, direct DB edits (backfill scripts, ops queries, emergency fixes) bypass it. If it's a DB trigger, schema changes must update the trigger.
**Impact:** Retroactive SOX-ish accountability claims may not hold; the owner may make hand-edits no one knows about.
**Recommendation:** Use **row-level DB triggers** on audited tables (Postgres triggers writing to `audit_log`), not app-layer hooks. Trigger template gets written once, applied per table. Plan-gen records this as ADR.
**Effort:** small

### [LOW] JWT + session cookie hybrid auth adds complexity without clear boundary rules
**Location:** §6.13 AC-2 "Session cookie + CSRF token; JWT for API (prepares for native clients)"
**Issue:** Web uses cookies-with-CSRF; native will use JWT. Fine in theory, but the spec doesn't say which endpoints accept which. If the same `/api/v1/recipes` endpoint takes both, the security review gets messy (CSRF middleware doesn't apply to Bearer-token requests).
**Impact:** Subtle security holes in the overlap; more branches in middleware.
**Recommendation:** Split: `/api/v1/*` is JWT-only (for both PWA and future native); PWA sets an `httpOnly` refresh cookie but sends access JWT via Authorization header. No session cookies on the API surface. Plan-gen records this as ADR.
**Effort:** small

### [LOW] No observability budget for the Aloha worker
**Location:** §10 observability block
**Issue:** Structured logs + Application Insights cover API and ML. The Aloha worker runs once a night — a silent failure (e.g., SFTP drop file named wrong) means missing data for a day before anyone notices.
**Impact:** POS gaps show up in the dashboard warning, but only after the owner checks.
**Recommendation:** Worker emits a heartbeat metric on every run (success/fail/rows-ingested). Missing heartbeat for >28h → alert. Plan Phase 5 adds this.
**Effort:** small

### [LOW] "No desktop-only chrome" is a vague NFR
**Location:** §10 client block + §7 "Mobile first: 360×640 viewport, one-thumb reach"
**Issue:** "Responsive-first" is fine; "no desktop-only chrome" isn't a testable condition. Does it mean no hover-only interactions? No right-click menus? No keyboard shortcuts?
**Impact:** Ambiguity between design and QA later.
**Recommendation:** Plan-gen replaces this with an explicit checklist (no hover-only affordances; every action reachable by tap; keyboard shortcuts are additive only).
**Effort:** tiny

---

## Recommendations (prioritized by impact-to-effort ratio)

1. **Pick deploy topology explicitly** (HIGH #1) — **RESOLVED v1.6**: adopted recommendation (c) and expanded to Docker-first (`Dockerfile` per service + `docker-compose` for local dev + Container Apps for prod). See DEC-001 + DEC-016.
2. **Lock the conversion module as a dedicated service with property tests** (MEDIUM #3) — small-to-medium effort, prevents silent wrong-cost bugs in the entire reporting stack.
3. **Make Aloha imports transactional** (MEDIUM #4) — small fix, eliminates an entire class of data-drift bug.
4. **DB-trigger-based audit log** (MEDIUM #7) — one-time template, covers ops edits automatically.
5. **Split API auth cleanly: JWT only for `/api/v1`** (LOW #8) — small simplification, material security clarity.
6. **DR restore drill in DoD** (HIGH #2) — small effort, catches a backup-that-never-restores disaster.
7. **ML artefact loading strategy** (MEDIUM #5) — small, affects forecast latency.
8. ~~**Bilingual enforcement point** (MEDIUM #6)~~ — **OBSOLETE v1.6** (bilingual removed from scope).
9. **Aloha worker heartbeat** (LOW #9) — small.
10. **Crisp "mobile first" criteria** (LOW #10) — tiny.

---

## Technical Debt Assessment

**Rating:** N/A (greenfield — no debt yet).

However, three architectural choices in the spec were **pre-committed to tech debt** if plan-gen didn't address them:

- ~~**Single-VM deploy** will become a debt item the first time Azure patches the VM during service hours.~~ — **RESOLVED v1.6** via Docker + Container Apps (DEC-001, DEC-016).
- **Unit conversion scattered across call sites** (if not centralized) becomes a classic "works 95% of the time" bug farm. — addressed by plan DEC-004.
- **App-layer audit log** will silently drift from schema changes. — addressed by plan DEC-005.

All three are now folded into plan ADRs; none remain open as of v1.6.

---

## Alignment With Spec NFRs

| NFR (§7) | Proposed Design Meets It? | Notes |
|---|---|---|
| Mobile first (360×640) | Yes — PWA design + responsive-first | Tighten LOW #10 criteria |
| PWA installable, offline reads | Yes — Workbox SW | No issue |
| FCP < 2s on 4G | Likely — Vite build + Tailwind JIT | Verify with perf budget in plan |
| Availability 99.5% | **Yes — Container Apps + Docker (v1.6)** | HIGH #1 resolved via DEC-001 + DEC-016 |
| Data durability ≤ 24h PITR | Yes (managed PG PITR) | HIGH #2 adds restore drill |
| Browser support latest-2 | Yes | No issue |
| WCAG 2.1 AA | Plan must add a11y tests per screen | Track in DoD |
| ~~i18n EN/ES~~ | **N/A — removed from scope in v1.6** | See DEC-015 retirement |
| Security OWASP Top 10 | Addressed in §11 | LOW #8 tightens auth boundary |
| API versioned + OpenAPI | Yes | No issue |
| Observability | Partial — see LOW #9 | Worker heartbeat missing |

---

## Handoff to plan-gen

The plan must:
1. Open with an ADR for deploy topology (HIGH #1).
2. Put a `conversions` module in Phase 2 with property-based tests as the first task.
3. Specify Aloha-worker import as single-transaction-per-batch (MEDIUM #4).
4. Specify DB-trigger audit log (MEDIUM #7).
5. Specify JWT-only `/api/v1` (LOW #8) and include an ADR.
6. Include a restore-drill task in Phase 5 (HIGH #2).
7. Include an artefact-loading decision for the ML service (MEDIUM #5).

These are the seven items that design review ties to plan-gen. Lower-priority items (~~#6 bilingual enforcement — obsolete v1.6~~, #9 heartbeat, #10 mobile-first criteria) are captured as smaller tasks inside the normal phase structure.

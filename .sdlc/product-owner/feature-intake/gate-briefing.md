# Gate Briefing — Executive Decision (v3, final HITL)

**Audience:** Product Owner
**Gate:** `feature-intake` → `architect/design-to-plan`
**Date:** 2026-04-17
**Spec:** `.sdlc/product-owner/feature-intake/spec.md` (v1.4)
**Decision requested:** APPROVE / APPROVE WITH CONDITIONS / REJECT / DEFER

---

## What Changed Since v2 Briefing

You provided four more pieces of information across two rounds:

1. **Stack + hosting (OQ-3, OQ-4)** → TypeScript web/API + Python ML, Azure VM + managed PostgreSQL + Blob. §10 rewritten with the concrete topology.
2. **5 more source files** (Lunch / Expo / Slicing-Portioning / Portion Utensils / Egg) → spec v1.3 added portion-utensil catalogue, per-ingredient utensil overrides, pre-portioning (portion bags), and station cheat-sheet views. MVP module count grew 19 → **22**.
3. **OQ-1 Target market** → **single restaurant** (Turning Point of Collegeville, Aloha store 1002). Multi-location is Phase 3. `restaurant_id` carried from day one so the future migration is row-scoping, not a schema rewrite.
4. **OQ-6 Flash-card printing** → **on-demand PDF** is enough. No kitchen-printer integration.
5. **OQ-7 Migration** → **full automated import with a human review step.** Spec v1.4 adds §6.14 (staging → review → canonical pattern with rollback within 14 days).
6. **Aloha PMIX sample report** (`myReport (10).xlsx`) → **§6.12a rewritten with the real schema**. Surfaced three row types the earlier draft had missed: modifiers ("Add Cheese"), 86-stockout markers ("86 Bacon"), and cover counts ("3 People"). Data model adds `AlohaModifierMap`, `StockoutEvent`, `CoverCount`, `AlohaReconciliationQueue`.

Net effect: **no new top-level modules** (22 stays). Effort estimate stable at **17–23 eng-weeks**. Deep score **3.78 → 3.82**. Risk profile improved (automated migration replaces hand-curation; single-restaurant locks the data model) with one small addition (Aloha mapping UI slightly deeper to cover modifiers / stockouts / covers).

---

## TL;DR

Build TP Manager as a mobile-first PWA that **(a)** replaces the 11 operational source files, **(b)** pulls nightly Aloha PMIX into a modifier/stockout/cover-aware POS model, **(c)** serves baseline ML forecasts from day one against the owner's 1 year of history, and **(d)** onboards via a review-gated automated migration tool. Deep score **3.82 / 5 → BUILD**.

**Recommendation:** APPROVE WITH CONDITIONS (7 conditions — 2 dropped, 5 carried forward).

---

## Final MVP Scope — 22 modules

| # | Module | Route / reference |
|---|---|---|
| 1 | Ingredients master | `/ingredients` |
| 2 | Suppliers + supplier↔ingredient map | `/suppliers`, `/suppliers/:id` |
| 3 | Recipes (prep + menu, bilingual EN/ES, nested BOM, versioned, cycle-safe) | `/prep/items` + menu view |
| 4 | Daily Prep Sheet | `/prep/sheet` |
| 5 | Inventory Count | `/inventory` |
| 6 | Deliveries | `/deliveries` |
| 7 | Order Forms | `/orders` |
| 8 | Waste Log (incl. partial-use for portion bags) | `/prep/waste` |
| 9 | Reports (AvT variance, price creep, waste, forecast accuracy) | `/reports/*` |
| 10 | Dashboard | `/` |
| 11 | Settings (incl. portion-utensil catalogue) | `/settings` |
| 12 | Auth + RBAC (owner / manager / staff) | — |
| 13 | Bilingual UI (EN + ES from day 1, ES-staleness badge) | — |
| 14 | PWA (installable, offline read paths) | — |
| 15 | Aloha POS integration (nightly PMIX import, modifier + 86 + cover row-type handling, ≥1 yr backfill) | §6.12a |
| 16 | ML baseline forecasting (7-day ingredient demand + prep qty, advisory, overrideable) | §6.12b |
| 17 | Data transform layer (11 files + Aloha → canonical) | §10 |
| 18 | Forecast-accuracy dashboard | `/reports/forecast-accuracy` |
| 19 | Portion utensils (first-class catalogue + per-ingredient overrides) | §6.3a, §6.11 |
| 20 | Pre-portioning / portion bags | §6.3a |
| 21 | Station cheat-sheet views (lunch / breakfast / expo / egg / bar / bakery) + on-demand PDF | §6.3b |
| 22 | **Data migration tool — staging → review → canonical, with rollback** | §6.14 |

---

## Explicitly OUT of MVP (deferred)

| Deferred | Earliest phase | Why |
|---|---|---|
| Advanced ML (gradient boosting, weather, holidays, event-aware, anomaly detection) | Phase 2 | Must earn the upgrade by beating the baseline |
| Native iOS/Android | Phase 3 | PWA meets mobile need; API designed for native later |
| Two-way Aloha (push menu back to Aloha) | Phase 2 | One-way read is sufficient |
| Multi-location | Phase 3 | OQ-1 confirmed single-tenant MVP |
| Auto-send POs (EDI) | Phase 2 | Manual PDF/CSV sufficient |
| Kitchen-printer integration for flash cards | — | On-demand PDF is enough (OQ-6) |
| HACCP record-keeping (formal compliance logs) | Phase 2 unless regulator requires | **Still open (OQ-5)** |

---

## Key Numbers

| Metric | Value |
|---|---|
| Quick score | 3.83 / 5 (PROCEED — threshold 3.0) |
| Quality gate (standard) | PASS (4/4) |
| Deep score v1 (14 modules) | 3.78 |
| Deep score v2 (19 modules) | 3.78 |
| Deep score v3 (22 modules) | 3.78 |
| Deep score **v4** (22 modules, OQ-1/6/7 resolved, PMIX concrete) | **3.82** |
| Combined verdict | **BUILD** (threshold 3.5) |
| MVP modules | **22** |
| Effort estimate | **17–23 engineering-weeks**, 2–3 person team |
| Aloha historical backfill | ~1 year PMIX reports |
| Open questions blocking plan-gen | **1** (OQ-5 HACCP) |

---

## Resolved Decisions Carried to Plan

| Item | Decision | Reference |
|---|---|---|
| Target market | Single restaurant (Turning Point of Collegeville, Aloha store 1002) | §12 OQ-1 |
| POS | NCR Aloha, nightly PMIX import | §6.12a |
| Stack | TypeScript (PWA + API), Python (ML) | §10 |
| Hosting | Azure VM + managed Azure PostgreSQL + Azure Blob | §10 |
| Flash-card print | On-demand PDF | §6.3b, OQ-6 |
| Migration | Full automated, staging → review → canonical, 14-day rollback | §6.14, OQ-7 |

---

## The 7 Remaining Conditions (recommended for APPROVE WITH CONDITIONS)

1. **Lock the 22-module MVP at this gate.** Additions flow through `/scope-tracker` with cost estimate.
2. **Resolve OQ-5 (HACCP in MVP?)** before `/plan-gen`. Only remaining blocker.
3. **ML stays baseline-only in MVP** — Holt-Winters / seasonal-naïve. No gradient boosting, weather, or holiday features until Phase 2.
4. **Data migration + transform layer is a first-class plan phase** with its own timeline and owner — now includes §6.14 review UI work, not just the parsers.
5. **Aloha transport pick is an ADR at plan time** — default recommended path is the scheduled **PMIX export drop** (file-based) since you already produce that report; alternatives (SFTP DBF / Aloha Cloud REST / middleware) are evaluated against the same criteria.
6. **ML is a separable work stream** — operational modules are the critical path. If ML slips, MVP still ships with "insufficient data" fallbacks.
7. **Forecast UI non-negotiables:** confidence badge on every prediction, every prediction overrideable, "last updated N days ago" banner when stale, app fully functional without ML service.

**Dropped from v2 briefing:**
- ~~PWA-first, native-later~~ — now unambiguous in the spec (§4.2).
- ~~Resolve OQ-1~~ — resolved.

---

## Still Blocking Plan-Gen — One Question

### Q1 (OQ-5): Canadian HACCP record-keeping in MVP?

**Context:** OQ-5 is the only remaining open question in §12. Turning Point of Collegeville is in Pennsylvania (US, not Canada), which likely makes this moot — but the spec was originally drafted assuming a Canadian cafe. If your target jurisdiction does **not** require inspector-ready HACCP logs for MVP, we defer formal HACCP export to Phase 2. If any US-state or FDA-level requirement does apply, we add it to MVP scope with compliance-level acceptance criteria.

**→ Your answer?** (Likely: "Defer — PA doesn't require it" — but please confirm.)

### Q2 (Aloha transport flavour — informational, not blocking)

The default recommendation is path (a) — the scheduled **PMIX export** you already run, dropped onto an SFTP or watched folder, ingested by the same parser that handled the sample. This is the cheapest path and uses the exact schema we already validated. Confirm at plan time if you want to evaluate (b) SFTP DBF / (c) Aloha Cloud REST / (d) 3rd-party middleware — tech lead records the decision as an ADR.

---

## Risks (final)

| Risk | Mitigation in spec |
|---|---|
| ML baseline over-promises accuracy | Advisory-only, confidence badge, forecast-accuracy dashboard, "last updated" banner |
| ML crowds out operational work | Separable work stream; MVP ships without ML if needed |
| Aloha PMIX schema shifts (Aloha update changes column order) | Parser is versioned; schema mismatch fails the import with a clear error instead of silently corrupting |
| Modifier / 86 / cover rows mis-classified | Reconciliation queue on dashboard surfaces unmapped rows; no silent promotion |
| Menu-mapping ongoing cost | In-app reconciliation queue; owner maps in UI, not SQL |
| Migration mis-matches | Staging → review → canonical with explain-why on every proposed match; 14-day rollback |
| Scope lock | This HITL gate + `/scope-tracker` |

---

## Your Decision

Reply with one of:

- **APPROVE** — proceed to `/plan-gen` with spec v1.4; OQ-5 must still be answered, but can be resolved inline during planning.
- **APPROVE WITH CONDITIONS** *(recommended)* — proceed with the 7 conditions above; answer **Q1 (OQ-5 HACCP)** in your reply; Q2 (Aloha transport) is informational.
- **REJECT** — stop and route to `/spec-evolve` or kill.
- **DEFER** — save state; resume later with `--resume`.

Pipeline is paused awaiting your decision.

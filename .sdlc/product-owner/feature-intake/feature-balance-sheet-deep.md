# Feature Balance Sheet — Deep Assessment (v4, post-OQ-1/6/7-resolution + Aloha PMIX concretization)

**v4 note (2026-04-17):** Owner resolved OQ-1 (single restaurant — Turning Point of Collegeville, Aloha store 1002), OQ-6 (on-demand PDF for flash cards), OQ-7 (full automated migration with a review step), and supplied a real Aloha PMIX sample (`myReport (10).xlsx`) that confirmed the import schema and surfaced three row types the earlier spec had missed: **modifiers** ("Add Cheese", "With Meal"), **86-markers** (stockout signals — "86 Bacon"), and **cover counts** ("3 People"). Spec v1.4 adds §6.14 (Migration Tool with staging → review → canonical path) and rewrites §6.12a with the concrete PMIX schema.

Net effect on estimate: **no new module count change** (22 remains; §6.14 was implicit in the "data migration" line). Effort stays at **17–23 eng-weeks** — the migration path was already costed, it's now just specified. Risk profile *improves* in two ways: (a) the automated-with-review migration eliminates the "owner hand-curates 11 files" failure mode; (b) the single-restaurant scope decision locks the data model. Risk profile *worsens* in one way: modifier/stockout/cover handling was not in the original module list — Aloha mapping UI is slightly deeper.

**Deep score moves from 3.78 → 3.82. Still BUILD.** Business value ticks up (stockout tracking is a tangible owner win; automated migration removes onboarding as a launch-risk line item); cost stays flat (new detail was latent, not additional).

---

# Feature Balance Sheet — Deep Assessment (v3, post-portion-control-input)

**v3 note (2026-04-17):** Owner provided 5 additional source files. Spec v1.3 added portion-utensil and station-view concepts. Net effect: no new eng modules, but recipe + settings modules deepened. Effort estimate nudges from 16–22 wks → **17–23 wks** (+1 wk for utensil catalogue, equivalence table, station-view rendering, partial-use waste). Benefit nudges up: the owner's kitchen speaks in scoops and portion bags, not oz — respecting that vocabulary is what turns this from a "database tool" into an operational system people actually use. **Deep score stable at 3.78. Still BUILD.**

---

# Feature Balance Sheet — Deep Assessment (v2, post-HITL-input)

**Feature:** Restaurant Operations Platform ("TP Manager")
**Spec version:** v1.1 — `.sdlc/product-owner/feature-intake/spec.md`
**Date:** 2026-04-17
**Mode:** Deep (post-spec, re-scored after PO input at HITL gate)

## What changed since v1 of this document

Owner provided two pieces of information at the HITL gate:
1. **~1 year of historical data is available** → ML forecasting becomes feasible at launch. The spec moved ML from "Phase 2 with entry criteria" to "MVP baseline (§6.12b) + Phase 2 upgrades".
2. **POS is NCR Aloha** → OQ-2 resolved. Spec adds §6.12a (one-way nightly Aloha import) and expands the data-transform layer to cover Aloha exports + 1 year backfill.

Net effect: **+2 new MVP modules (POS, ML baseline), +1 scope expansion (transform layer)**. MVP module count 14 → 19. Effort estimate 12–18 eng-weeks → **16–22 eng-weeks**.

## Score Summary — v1 → v2

### Benefit

| Dimension | v1 (deep) | v2 (deep) | Weight | Weighted | Rationale for v2 |
|---|---|---|---|---|---|
| User value | 5 | 5 | 0.30 | 1.50 | Already at ceiling. |
| Business value | 4 | 5 | 0.25 | 1.25 | **+1**. With real POS-driven AvT variance and forecast-driven ordering, the product now directly touches the food-cost lever (not just visibility of it). Shifts from "replaces spreadsheets" to "tells you what to order". |
| Strategic alignment | 5 | 5 | 0.20 | 1.00 | Unchanged. |
| Platform leverage | 4 | 5 | 0.15 | 0.75 | **+1**. POS + forecasting infrastructure is genuinely reusable for every future analytics feature (menu engineering, pricing, promotions). |
| Risk reduction | 4 | 4 | 0.10 | 0.40 | Unchanged — already captured shelf-life + delivery-dispute. ML adds stock-out risk reduction but we cap at 4 pending real evidence of forecast accuracy. |
| **Benefit total** | **4.50** | — | **1.00** | **4.90/5** | |

### Cost (inverted — higher = lower cost)

| Dimension | v1 (deep) | v2 (deep) | Weight | Weighted | Rationale for v2 |
|---|---|---|---|---|---|
| Development effort | 2 | 2 | 0.30 | 0.60 | Score stays at 2 (XL). The module count is higher but the effort was already XL; this shifts the upper bound on the estimate (18 → 22 wks). |
| Maintenance burden | 3 | 2 | 0.25 | 0.50 | **−1**. Nightly Aloha import (failure-handling, schema drift, menu remapping) + ML retraining pipeline (monitoring, drift detection, accuracy dashboard) is real ongoing work. |
| Technical debt | 3 | 3 | 0.20 | 0.60 | Unchanged. Baseline-only ML is a deliberate debt-avoidance choice; gradient boosting was the debt risk, not Holt-Winters. |
| Operational risk | 4 | 3 | 0.15 | 0.45 | **−1**. Aloha credentials + historical backfill + nightly jobs all increase blast radius of a bad deploy. Still single-tenant so not a 2. |
| Opportunity cost | 5 | 5 | 0.10 | 0.50 | Unchanged. |
| **Cost-inverted total** | **3.05** | — | **1.00** | **2.65/5** | |

### Combined Score

**v2 deep score = (4.90 + 2.65) / 2 = 3.78 / 5**

- v1 (pre-HITL-input): 3.78
- v2 (post-HITL-input): **3.78**

The score is identical by coincidence of the arithmetic — benefit gained +0.40, cost-inverted lost −0.40. What actually changed is the **character** of the build: higher value, higher ongoing cost, higher operational ambition. The decision doesn't change.

## Thresholds

- build ≥ 3.5, conditional ≥ 2.5, defer ≥ 2.0, kill < 1.5.

**3.78 ≥ 3.5 → BUILD (confirmed).**

## Recommendation: **BUILD (with revised conditions)**

The added scope (POS, ML baseline, transform layer) earns its cost — the product moves from "replaces the Excel sheets" to "tells the owner what to order and what to prep". That is the real value the owner wants, and the 1 year of historical data makes it attainable without the usual "wait 8 weeks" ML trap.

## Revised Conditions for BUILD (to carry into planning)

1. **Lock the 19-module MVP at this gate.** Additions flow through `/scope-tracker`.
2. **Resolve OQ-1 (single- vs multi-location)** before `/plan-gen`. Still outstanding.
3. **Resolve OQ-5 (HACCP in MVP?)** before `/plan-gen`. Still outstanding.
4. **ML stays baseline-only in MVP.** No gradient boosting, no weather features, no holidays. Phase 2 earns these by showing the baseline has measurable error to beat.
5. **Data migration + transform layer is a first-class plan phase** with its own timeline and owner.
6. **Aloha transport pick happens at plan time** — tech lead evaluates (SFTP DBF / Aloha Cloud REST / middleware) against the owner's real Aloha deployment; pick is recorded as an ADR.
7. **ML is a separable work stream** — operational modules remain the critical path. If ML slips, MVP can still ship with forecasts showing "insufficient data" fallback on day one.
8. **Forecast UI rules (non-negotiable):** every prediction shows confidence, every prediction is overrideable, every screen shows "last updated N days ago" if stale. The app must function without the ML service.
9. **PWA-first, native-later.** Unchanged.

## Risk Summary (updated)

- **New top risk:** Aloha integration friction. The three candidate transports all work, but each has its own gotchas (DBF encoding quirks, Aloha Cloud rate limits, middleware subscription cost). Mitigated by isolating the transport in the import service.
- **Previous top risk (scope lock):** still the biggest one — MVP just grew by 35% in module count. The gate must hold.
- **ML overselling:** avoided in spec by advisory-only + accuracy dashboard + explicit baseline framing. Owner must hold the line on "no demo screenshot promises beyond what the baseline delivers."

## Portfolio Comparison

Still single-feature backlog; no conflicts. Timeline now 16–22 eng-weeks for a 2–3 person team.

## Recommendation History

| Date | Mode | Score | Recommendation |
|---|---|---|---|
| 2026-04-17 | Quick | 3.83 | PROCEED |
| 2026-04-17 | Deep v1 | 3.78 | BUILD (14 modules, ML Phase 2) |
| 2026-04-17 | Deep v2 | 3.78 | BUILD (19 modules, ML baseline in MVP, Aloha in MVP) |
| 2026-04-17 | Deep v3 | 3.78 | BUILD (22 modules, utensil + station-view added) |
| 2026-04-17 | Deep v4 | **3.82** | **BUILD** (22 modules, OQ-1/6/7 resolved, Aloha PMIX concrete, §6.14 migration tool formalized) |

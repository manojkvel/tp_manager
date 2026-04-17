# Feature Balance Sheet — Quick Assessment

**Feature:** Restaurant Operations Web App (inventory, supplier mapping, recipe management, waste log, ML forecasting)
**Date:** 2026-04-17
**Mode:** Quick (pre-spec)
**Config profile:** default (`.claude/config/balance-sheet-config.json`)

## Summary

The request is the whole product — a single-tenant operational backbone for a small restaurant owner, to replace a pile of Excel/Word/PowerPoint files with a mobile-responsive web app (and a path to native iOS/Android later). Real operational data is already available (TP Recipe Book, Prep & Shelf Life, Menu/Beverage Flash Cards, Barista Prep) and a Lovable reference prototype exists, which materially de-risks both scope and design direction.

## Benefit Score (weighted)

| Dimension | Score (1–5) | Weight | Weighted | Evidence |
|---|---|---|---|---|
| User value | 5 | 0.30 | 1.50 | Owner today juggles 6+ disconnected files (Excel/Word/PPT) across recipes, prep, shelf life, beverages. The request replaces this with one operational system — direct, recurring daily pain. |
| Business value | 4 | 0.25 | 1.00 | Food cost is typically 28–35% of a cafe's revenue; measurable savings from waste reduction and fewer 86'd items. Not a revenue product, but real P&L impact. |
| Strategic alignment | 5 | 0.20 | 1.00 | This *is* the product — roadmap alignment is 100%. |
| Platform leverage | 4 | 0.15 | 0.60 | Clean ingredient/recipe/waste schema becomes the substrate for forecasting, supplier analytics, menu engineering, and future iOS/Android native clients. |
| Risk reduction | 3 | 0.10 | 0.30 | Formalises shelf-life tracking and waste logging — helps with food-safety hygiene; not a compliance-mandated driver today. |
| **Benefit total** | | **1.00** | **4.40/5** | |

## Cost Score (weighted, inverted — higher = lower cost)

| Dimension | Cost score (1–5) | Weight | Weighted | Evidence |
|---|---|---|---|---|
| Development effort | 2 | 0.30 | 0.60 | Multi-module product: auth, inventory, suppliers, prep vs menu recipe graph, waste log, ML forecasting, mobile-responsive UI. MVP estimate 10–16 eng-weeks; "High" effort. |
| Maintenance burden | 3 | 0.25 | 0.75 | Multi-user SaaS-ish app with ML pipeline — moderate ongoing (monitoring, model retraining, supplier/ingredient data hygiene). |
| Technical debt | 4 | 0.20 | 0.80 | Greenfield — can set standards cleanly; low inherent debt if the data model is done properly up-front. |
| Operational risk | 4 | 0.15 | 0.60 | Single-tenant prototype; blast radius is one restaurant. Not safety-of-life, not payment-critical. |
| Opportunity cost | 5 | 0.10 | 0.50 | No competing backlog — this *is* the backlog. |
| **Cost total (inverted)** | | **1.00** | **3.25/5** | |

## Overall Score

**Combined = (benefit + cost-inverted) / 2 = (4.40 + 3.25) / 2 = 3.83 / 5**

Thresholds (from `balance-sheet-config.json > quick_assessment`): proceed ≥ 3.0, discuss ≥ 2.0, no-go < 1.5.

## Recommendation: **PROCEED**

The feature clears the proceed threshold comfortably (3.83 vs 3.0). Benefit is anchored by strong, specific user pain and a product-market fit that already has a working Lovable prototype and real restaurant data. The dominant concern is effort, not value — which is a scope-management problem, not a go/no-go problem. Move to `/spec-gen` and use the spec to tighten MVP boundaries (ML likely a post-MVP phase).

## Key Factors

**Strongest signals**
- Concrete, documented workflow pain: six source files covering recipes, prep shelf life, flash cards, and barista prep — a real, measurable replacement target.
- Working reference prototype at `recipe-radar-assist.lovable.app` substantially reduces design ambiguity.
- Strategic alignment is trivially 5/5 — this is the product.

**Weakest signals**
- Development effort is "High" (2/5 cost). MVP will need ruthless scope discipline.
- ML forecasting is the highest-risk scope item: needs ≥ 8–12 weeks of waste + sales history before it's useful. Should be deferred to Phase 2.
- Maintenance burden is moderate — ingredient/supplier/price data hygiene tends to rot without explicit owner workflows.

**Insufficient data (quick mode)**
- Number of locations / concurrent users (single cafe vs multi-unit?).
- POS integration requirement — will sales data be manually entered or pulled from Square/Toast/Clover?
- Compliance context (Canadian provincial food-safety record-keeping requirements).
- Target launch date / budget envelope.

## Risk Flags

1. **ML-before-data trap** — forecasting requires historical waste + sales data the system doesn't yet collect. Do not promise ML in MVP; frame as Phase 2 once ≥ 8 weeks of clean data exists.
2. **Scope sprawl** — "inventory + supplier + recipes + waste + ML + mobile + future native apps" is ~4 products stacked. Spec must define a crisp MVP boundary (recommend: ingredient + recipe + waste log, deferring supplier procurement and ML).
3. **Data migration is the hidden cost** — seeding the system from the existing spreadsheets/Word/PPT files is non-trivial and must be budgeted as real scope, not an afterthought.
4. **Mobile vs native** — "mobile-responsive PWA now, native later" is the right call, but the spec must explicitly pick PWA-first so the team does not accidentally build a desktop-only SPA.

## Gate Decision

**PROCEED to `/spec-gen`.** Carry forward the three risk flags above so the spec explicitly addresses MVP boundary, ML phasing, and data-migration scope.

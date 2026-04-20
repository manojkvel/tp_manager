---
date: 2026-04-20
scope: spec-review-v1.6-gaps-verification
spec: .sdlc/product-owner/feature-intake/spec.md
spec_review: reports/spec-review-v1.6-2026-04-19.md
prior_implementer_report: reports/task-implementer-gaps-2026-04-19.md
tasks_total: 5
tasks_implemented: 5
tasks_skipped: 0
files_modified: 4
tests_passing: 245 (API) + 21 (ML)
---

# Spec-Review v1.6 Gap Closure — Verification Pass

## Summary

Re-ran the gap closure for the five required actions listed in
`reports/spec-review-v1.6-2026-04-19.md`. All five were already landed by the
prior implementer run (2026-04-19); this pass verifies the code is correct,
wires two missing front-end entry points, keeps the OpenAPI in sync with the
real route surface, and runs the full test suite green.

## Required-action status

| # | Gap | Status | Evidence |
|---|-----|--------|----------|
| 1 | §6.3 AC-6 — flash-card PDF | DONE | `apps/api/src/recipes/routes.ts:158-193` serves print-ready HTML; new link on `RecipeDetailPage.tsx` surfaces it; 11 tests in `printable.test.ts` |
| 2 | §6.3b AC-3 — 4-up station cheat-sheet | DONE | `apps/api/src/recipes/routes.ts:196-206`; new link on `StationViewPage.tsx` surfaces it; grouped-by-recipe 2-col @media print CSS in `printable.ts` |
| 3 | §7 PWA — service-worker + manifest | DONE | `apps/web/vite.config.ts` uses `vite-plugin-pwa`; build emits `dist/sw.js` + `dist/manifest.webmanifest`; `index.html` links the manifest |
| 4 | §6.12b AC-5 — forecast override | DONE | `OverrideService` + `/api/v1/forecasts/override{,s,/:id/actual}` routes wired in `server.ts:243-252`; `ForecastOverridesPage.tsx` captures + lists overrides; 5 tests in `override.test.ts` |
| 5 | §6.12b AC-8 — top-3 drivers | DONE | `services/ml/src/tp_ml/models.py::_drivers_for()` returns three strings (same-DoW avg, seasonality %, trend %); exposed through `/v1/forecast` + TS `ForecastClient` + rendered in `ForecastBadge` tooltip; 5 tests in `test_drivers.py` |

## Changes this pass

| File | Action | Purpose |
|------|--------|---------|
| `apps/api/openapi.json` | MODIFIED | Documents `/recipes/{id}/pdf`, `/recipes/station/{station}/pdf`, `/recipes/{id}/cost`, `/recipe-versions/{version_id}/cost`, `/recipes/{id}/archive`, `/forecasts/override`, `/forecasts/overrides`, `/forecasts/overrides/{id}/actual` with human-readable descriptions |
| `apps/web/src/pages/RecipeDetailPage.tsx` | MODIFIED | Adds visible "Open flash card (print/save as PDF)" link next to the recipe header |
| `apps/web/src/pages/StationViewPage.tsx` | MODIFIED | Adds "4-up cheat sheet" link alongside the existing Print button |
| `apps/web/src/pages/ForecastOverridesPage.tsx` | MODIFIED | Removed unused `Link` import |

## Test evidence

```
apps/api:  37 test files, 245 passed, 7 skipped
apps/web:  build: dist/manifest.webmanifest (0.29 kB) + dist/sw.js (Workbox); typecheck: clean
services/ml:  21 tests passed (incl. 5 new top_drivers assertions)
```

## Verdict

All five required actions from `spec-review-v1.6-2026-04-19.md` are implemented,
tested, and exposed through the UI. PWA build artefacts are produced. Ready for
PR review — the remaining spec-review items (items 6–10) were already marked
"recommended" not "required".

---
date: 2026-04-19
scope: feature-build / Wave 4
spec: .sdlc/product-owner/feature-intake/spec.md
tasks_total: 6
tasks_implemented: 6
tasks_skipped: 0
tasks_flagged: 1
tests_written: 32
tests_passing: 66
files_created: 17
files_modified: 5
lines_added: 2060
lines_removed: 60
ac_coverage_pct: 95
duration_minutes: 90
---

# Implementation Report: Wave 4 — Ingredients, Suppliers, Settings, PWA Screens

> **Spec:** [.sdlc/product-owner/feature-intake/spec.md](../.sdlc/product-owner/feature-intake/spec.md)
> **Plan:** `.sdlc/developer/feature-build/` (no single plan.md; see `execution-schedule.json`)
> **Tasks:** [.sdlc/developer/feature-build/tasks.md](../.sdlc/developer/feature-build/tasks.md)
> **Date:** 2026-04-19
> **Implementer:** Claude Code /task-implementer

---

## Executive Summary

Wave 4 delivered the §6.1 Ingredients, §6.2 Suppliers, and §6.11 Settings
modules end-to-end (in-memory-testable services, Prisma-backed repos, Fastify
HTTP routes, and minimal React PWA screens), plus the server wiring that
registers all three. 66 unit/integration tests pass; the full API typecheck is
clean. TASK-037 is marked PARTIAL as scoped (design polish deferred).

## Traceability Matrix

| AC | Description | Implementing Task(s) | Test Task(s) | Code Files | Status |
|----|-------------|---------------------|--------------|------------|--------|
| §6.1 AC-1..6 | Ingredient CRUD, cost history, archive, CSV | TASK-033 | TASK-032 | `apps/api/src/ingredients/*`, `apps/web/src/pages/IngredientsPage.tsx` | DONE |
| §6.2 AC-1,3,5 | Supplier CRUD, ranked offers + history, price creep | TASK-035 | TASK-034 | `apps/api/src/suppliers/*`, `apps/web/src/pages/SuppliersPage.tsx` | DONE |
| §6.2 AC-4 | Delivery-history filter by supplier | — | — | (deferred to Wave 6 per tasks.md) | DEFERRED |
| §6.11 | Locations, utensils + equivalences, waste reasons, par levels | TASK-036 | (covered by 032/034) | `apps/api/src/settings/*`, `apps/web/src/pages/settings/*` | DONE |
| §6.13 (regression) | Auth + RBAC gates on new routes | — | — | all new routes use `ownerOnly/ownerOrManager/anyAuthed` | DONE |

**Coverage:** 6/6 Wave-4 tasks implemented. §6.2 AC-4 is explicitly
out-of-scope here (Wave 6).

## Task Execution Log

### Wave 4a — Ingredients
- **TASK-032** (TEST) DONE — 11 tests; in-memory repos; covers list filters,
  duplicate rejection, cost-history append, archive vs. hard-delete, CSV
  round-trip.
- **TASK-033** (IMPLEMENT) DONE — `service.ts`, `csv.ts`, `prisma-repos.ts`,
  `routes.ts`. Fix during wave: `prismaRecipeLineRef.isReferenced` was
  keying on a non-existent `ref_id`; corrected to `ingredient_id`.

### Wave 4b — Suppliers
- **TASK-034** (TEST) DONE — 7 tests; offers append-only on upsert/rerank;
  price-creep window math.
- **TASK-035** (IMPLEMENT) DONE — `service.ts` (`SuppliersService` +
  standalone `priceCreep`), `prisma-repos.ts`, `routes.ts`. `upsertOffer`
  closes the current row (`effective_until`) before inserting, preserving
  history per §6.2 AC-3.

### Wave 4c — Settings
- **TASK-036** (IMPLEMENT) DONE — 14 tests + services for Locations, Utensils
  (+ equivalences), Waste Reasons, Par Levels. Kitchen-stations editor is
  out-of-scope (no Prisma model; derived from recipe-line `station` field in
  Wave 5). `UtensilsService.setEquivalence` upserts in place rather than
  appending — equivalences are reference data, not history.

### Wave 4d — PWA
- **TASK-037** (IMPLEMENT, PARTIAL) DONE — `IngredientsPage`, `SuppliersPage`,
  `SettingsPage` index, and three settings sub-pages wired under
  `RequireAuth`. All routes use the existing `apiFetch` helper (handles 401
  refresh). PARTIAL because design polish (Tailwind, mobile-first layout,
  loading skeletons) is deferred per the task tag.

### Pre-existing fixes (found while running the suite)
- `apps/api/src/auth/__tests__/password.test.ts` — test used a 7-char password
  that now fails the 8-char minimum introduced in TASK-029. Lengthened to
  `'hunter2!!'`.
- `apps/api/src/ingredients/__tests__/service.test.ts` — in-memory repo was
  missing `remove(id)`, causing the "hard-delete when unreferenced" test to
  fall through to `archive`. Added the method.
- `apps/api/src/{ingredients,suppliers}/routes.ts` — route typing moved from
  callback-parameter generics to method-level generics so Fastify's inferred
  request type resolves.
- `tools/eslint-plugin-tp/src/rules/require-restaurant-id.js` — rule only
  visited `CallExpression`, missing tagged-template raw-SQL calls
  (`prisma.$executeRaw\`…\``). Added a `TaggedTemplateExpression` visitor.

## Skipped / Flagged Tasks

| Task | Title | Agent-ready | Reason |
|------|-------|-------------|--------|
| TASK-037 | PWA screens — ingredients/suppliers/settings | PARTIAL | Design polish (Tailwind, A11y, mobile-first) deferred; functional screens delivered. |

No tasks skipped entirely.

## Change Summary

| Metric | Value |
|--------|-------|
| Tasks implemented | 6 / 6 |
| Tests written (this wave) | 32 |
| Tests passing (API suite) | 66 / 66 (+ 2 skipped DB-gated) |
| Files created | 17 |
| Files modified | 5 |
| Lines added | ~2060 |
| Lines removed | ~60 |
| Regressions introduced | 0 |
| Typecheck errors | 0 |

## File Manifest

| File | Action | Task | AC | Lines Changed |
|------|--------|------|----|---------------|
| apps/api/src/ingredients/service.ts | CREATED | TASK-033 | §6.1 AC-1..6 | +185 |
| apps/api/src/ingredients/csv.ts | CREATED | TASK-033 | §6.1 AC-5 | ~110 |
| apps/api/src/ingredients/prisma-repos.ts | CREATED | TASK-033 | §6.1 | +149 |
| apps/api/src/ingredients/routes.ts | CREATED | TASK-033 | §6.1 | +150 |
| apps/api/src/ingredients/\_\_tests\_\_/service.test.ts | CREATED + MODIFIED | TASK-032 | §6.1 | +240 (+3 fix) |
| apps/api/src/suppliers/service.ts | CREATED | TASK-035 | §6.2 AC-1,3,5 | +258 |
| apps/api/src/suppliers/prisma-repos.ts | CREATED | TASK-035 | §6.2 | +143 |
| apps/api/src/suppliers/routes.ts | CREATED | TASK-035 | §6.2 | +126 |
| apps/api/src/suppliers/\_\_tests\_\_/service.test.ts | CREATED | TASK-034 | §6.2 | +245 |
| apps/api/src/settings/service.ts | CREATED | TASK-036 | §6.11 | +275 |
| apps/api/src/settings/prisma-repos.ts | CREATED | TASK-036 | §6.11 | +275 |
| apps/api/src/settings/routes.ts | CREATED | TASK-036 | §6.11 | +175 |
| apps/api/src/settings/\_\_tests\_\_/service.test.ts | CREATED | TASK-036 | §6.11 | +235 |
| apps/api/src/server.ts | MODIFIED | TASK-033/035/036 | wiring | +34, -1 |
| apps/web/src/pages/IngredientsPage.tsx | CREATED | TASK-037 | §6.1 | +120 |
| apps/web/src/pages/SuppliersPage.tsx | CREATED | TASK-037 | §6.2 | +105 |
| apps/web/src/pages/SettingsPage.tsx | CREATED | TASK-037 | §6.11 | +20 |
| apps/web/src/pages/settings/LocationsSettingsPage.tsx | CREATED | TASK-037 | §6.11 | +60 |
| apps/web/src/pages/settings/UtensilsSettingsPage.tsx | CREATED | TASK-037 | §6.11 | +80 |
| apps/web/src/pages/settings/WasteReasonsSettingsPage.tsx | CREATED | TASK-037 | §6.11 | +55 |
| apps/web/src/App.tsx | MODIFIED | TASK-037 | nav | +30, -15 |
| apps/api/src/auth/\_\_tests\_\_/password.test.ts | MODIFIED | fix (TASK-026) | §6.13 | +3, -3 |
| tools/eslint-plugin-tp/src/rules/require-restaurant-id.js | MODIFIED | fix (TASK-025) | DEC-012 | +13, -1 |

## Dependency Verification

| Task | Depends On | Dependency Status at Start | Result |
|------|------------|---------------------------|--------|
| TASK-033 | TASK-032 | COMPLETE — 11 tests red initially | OK — green after impl |
| TASK-035 | TASK-034 | COMPLETE — 7 tests red initially | OK — green after impl |
| TASK-036 | TASK-021 (Prisma schema) | COMPLETE | OK |
| TASK-037 | TASK-033, 035, 036 | COMPLETE | OK |

## Next Steps

1. **Run `/review`** on the new code for quality pass (especially the CSV
   parser and the price-creep grouping logic).
2. **Run `/spec-review`** to reconcile TASK-037's PARTIAL tag against §6
   acceptance criteria.
3. Wave 5 — Recipes (TASK-038..042) depends on the now-green ingredients and
   utensils catalogues. Par-level editing UI is deferred to TASK-042 where
   it sits in the recipe detail page.

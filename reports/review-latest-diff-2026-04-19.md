---
date: 2026-04-19
scope: latest-diff (Wave 5 — Recipes, Migration parsers, PWA)
verdict: Request changes
issues_count:
  critical: 0
  high: 1
  medium: 6
  low: 5
---

# Code Review — Wave 5 (Recipes, Migration, PWA)

## Summary

Wave 5 lands a well-factored Recipes module (pure cost calculator + cycle
detector, station view, append-only versioning, transactional promote), a
migration scaffold with an atomic-batch runner and explainable dedupe, and
three PWA pages. Overall shape is good: the pure/I-O split makes `cost.ts`
and `station.ts` cheap to test, and the Prisma-backed cost context is a
clean adapter. However, one endpoint bypasses tenant scoping (cross-tenant
data leak), and several medium issues around type drift, error-handling
consistency, and silent-data edge cases need attention before merging.

## Issues Found

### [HIGH] apps/api/src/recipes/routes.ts:116-130 — `/api/v1/recipe-versions/:version_id/cost` has no tenant check

The endpoint calls `svc.platedCostForVersion(req.params.version_id)` with no
`restaurant_id` argument (service.ts:214 takes only `version_id`; the Prisma
repo's `byId` at prisma-repos.ts:62 does a `findUnique` by primary key with
no tenant filter). Any authenticated user can read the cost breakdown of any
recipe version across tenants by guessing/supplying another tenant's UUID.
This violates DEC-012 (multi-tenant isolation) and the spec's RBAC contract.

**Suggested fix:** Thread `restaurant_id` through the service method and
verify the version's owning recipe belongs to the caller's tenant before
computing.

```ts
// service.ts
async platedCostForVersion(restaurant_id: string, version_id: string): Promise<PlatedCostResult> {
  const v = await this.deps.versions.byId(version_id);
  if (!v) throw new Error(`recipe version ${version_id} not found`);
  const recipe = await this.deps.recipes.findById(v.version.recipe_id);
  if (!recipe || recipe.restaurant_id !== restaurant_id) {
    throw new RecipeNotFoundError(version_id);
  }
  return computePlatedCost(v.version, v.lines, this.deps.costs);
}

// routes.ts
const result = await svc.platedCostForVersion(req.auth!.restaurant_id, req.params.version_id);
```

---

### [MEDIUM] apps/api/src/migration/parsers/recipe_book_parser.ts:96 — `step_order` attached via ad-hoc cast drifts from the domain type

`StagingRecipeLine` (types.ts:37) has no `step_order` field, yet the parser
writes one via `(lastLine as StagingRecipeLine & { step_order?: number })`.
Consumers typed against `StagingRecipeLine` cannot see this field, so the
writer will silently drop it unless it performs the same cast. This is the
exact class of bug that compile-time types are meant to prevent.

**Suggested fix:** Add `step_order?: number` to `StagingRecipeLine` in
types.ts so every consumer sees it.

---

### [MEDIUM] apps/api/src/migration/atomic_batch.ts:52 — Writer failures are not represented in `RunBatchResult`

`await writer({ ctx, files })` is outside the try/catch. If the writer
throws (e.g., Prisma transaction fails), `runBatch` re-throws and the
caller never gets `{ written: false, error }`. The contract "parse-all-
then-insert — nothing is written on any failure" is true by virtue of the
transaction, but the return type lies: callers handling result-based
errors miss the writer-fault path.

**Suggested fix:**

```ts
try {
  await writer({ ctx, files });
} catch (err) {
  return {
    written: false,
    files: files.map((f) => ({ parser: f.parser, row_count: f.result.rows.length, error_count: f.result.errors.length })),
    error: { parser: '<writer>', message: (err as Error).message },
  };
}
return { written: true, files: ... };
```

---

### [MEDIUM] apps/api/src/recipes/routes.ts:124 — Error handling on `/recipe-versions/:version_id/cost` is brittle and inconsistent with sibling endpoint

Two issues:
1. Error detection relies on substring match `(err as Error).message?.includes('not found')` instead of an `instanceof` check — a single phrasing change breaks the 404 path.
2. The sibling `/recipes/:id/cost` (lines 94-114) handles `RecipeNotFoundError`, `RecipeCycleError`, and `ConversionError`. This endpoint handles only the string-matched "not found", so cycles and conversion failures surface as 500s instead of 409/422.

**Suggested fix:** Throw `RecipeNotFoundError` from `platedCostForVersion`
(instead of `new Error(...)` at service.ts:216) and mirror the full error
ladder from the `/recipes/:id/cost` handler.

---

### [MEDIUM] apps/api/src/recipes/service.ts:188-191 — Cycle error thrown as plain `Error` with mutated `.name`, bypassing the typed class

The service imports/re-exports `RecipeCycleError` (service.ts:95) — a proper
typed error with a `cycle: string[]` field — but `appendVersion` synthesises
a plain `Error` and overwrites its `name`. Routes match on `err.name ===
'RecipeCycleError'` (routes.ts:70, 105) so it works today, but clients lose
the structured `cycle` path, and `err instanceof RecipeCycleError` returns
`false`.

**Suggested fix:**

```ts
if (cycle) throw new RecipeCycleError(cycle);
```

Then switch the route handlers to `if (err instanceof RecipeCycleError)`.

---

### [MEDIUM] apps/api/src/migration/parsers/aloha_pmix_parser.ts:61-64 — First-row modifier silently orphaned

If the first data row's name is `MOD:...`, `lastItem` is still `null`, so
the row is persisted with `modifier_of: null` — an orphan modifier with no
error emitted. The spec (§6.12a AC-3) treats modifiers as back-references
to the preceding item; a modifier with no parent is malformed input and
should surface as a `ParseError` so the review UI can flag it.

**Suggested fix:**

```ts
if (kind === 'modifier' && !lastItem) {
  errors.push({ source_row_ref: `row:${i + 1}`, message: 'modifier row before any item — cannot back-link' });
  continue;
}
```

---

### [MEDIUM] apps/api/src/migration/parsers/recipe_book_parser.ts:79 — O(n²) `position` default via `lines.filter(...).length`

For every line without an explicit `line_position`, the parser scans the
entire `lines` array to count prior lines for the same recipe. On a recipe
book with N total lines split across R recipes, this is O(N × avg_lines).
For the pilot restaurant's book (~hundreds of lines) this is fine, but
it's an easy fix and avoids a future papercut when the file grows.

**Suggested fix:** Track per-recipe counts in a `Map<string, number>`:

```ts
const lineCounts = new Map<string, number>();
// ...
const current = lineCounts.get(recipe.staging_id) ?? 0;
lineCounts.set(recipe.staging_id, current + 1);
// use `current` as the position default
```

---

### [LOW] apps/api/src/recipes/cost.ts:127 — Silent division when child's `yield_qty` is 0

`(childResult.total_cents / child.version.yield_qty) * qtyInYield` produces
`Infinity` or `NaN` when a referenced child recipe has `yield_qty === 0`.
The top-level return at cost.ts:175 guards `per_yield_unit_cents`, but
the intermediate roll-up does not, which poisons the parent total.

**Suggested fix:** Treat a zero-yield child as `skipped: 'missing_cost'`
with a descriptive note, matching the pattern used for missing ingredient
costs.

---

### [LOW] apps/api/src/migration/dedupe.ts:84-93 — Weights are hard-coded magic numbers

Name 0.7 / UoM 0.2 / supplier 0.1 weights are embedded inline. These are
tuning knobs the product will want to iterate on once real dedupe results
land in review. Extract to a named constant so the scorer is auditable
without grepping arithmetic.

---

### [LOW] apps/api/src/recipes/prisma-repos.ts:130-133 — `resolveVersion` creates a new repo on every call

`prismaCostContext.resolveVersion` calls `prismaRecipeVersionRepo(prisma)
.current(recipe_id)` — a fresh repo object per invocation. Harmless (repos
are closures over Prisma) but minor garbage. Create the repo once when the
context is built.

**Suggested fix:**

```ts
export function prismaCostContext(prisma: PrismaClient): CostContext {
  const versions = prismaRecipeVersionRepo(prisma);
  return {
    async resolveVersion(id) {
      const v = await versions.current(id);
      return v ? { version: v.version, lines: v.lines } : null;
    },
    // ...
  };
}
```

---

### [LOW] apps/api/src/recipes/service.ts:141 — `create` is not wrapped in a transaction

`create` inserts a recipe then calls `appendVersion`, which calls
`appendAndPromote` (itself transactional). If the recipe insert succeeds
but version insert fails, the tenant is left with an orphan recipe and no
versions — a 404 on `GET /recipes/:id/cost` forever. Given the call-site
is almost always paired, consider wrapping both in a single outer
transaction.

---

### [LOW] apps/web/src/pages/RecipesPage.tsx:38-43 — Form submits with `yield_qty = 0` when cleared

The `Number(form.get('yield_qty') ?? 1)` coerces an empty field to `0`,
not `1`, because `''` → `0`. Back-end `computePlatedCost` then divides by
zero (guarded) but the UX shows "$0.00 per undefined" silently. A required
+ `min="0.01"` HTML attribute — or a post-coerce fallback — avoids the
pothole.

---

## Positive Observations

1. **Clean pure/I-O split in the cost module.** `cost.ts` and `station.ts`
   take injected resolvers and have no Prisma/Fastify references — which is
   why the 14-test cost suite and 4-test station suite run DB-free in
   milliseconds. This should be the template for future domain modules.

2. **Transactional `appendAndPromote` demotes before insert** (prisma-repos.ts:82-103).
   The order is correct: previous `is_current` is flipped to false before
   the new current is inserted, closing the window where two versions
   could be current simultaneously.

3. **Typed error ladder in `/recipes/:id/cost`** (routes.ts:101-112). The
   `instanceof RecipeNotFoundError` → 404, `err.name === 'RecipeCycleError'`
   → 409, `instanceof ConversionError` → 422 pattern maps domain errors
   to semantically correct HTTP codes — a pattern the weaker
   `/recipe-versions/...` handler should adopt.

4. **Field-level agreement explainability in dedupe** (dedupe.ts:81-94)
   directly fulfils §6.14 AC-5 — the review UI can show the owner *why*
   a candidate matched, not just a score.

## Verdict

**Request changes** — the HIGH cross-tenant leak at `routes.ts:116` must
be fixed before this merges. The medium-severity items (step_order type
drift, writer-failure return, cycle-error class usage, inconsistent error
handling, modifier-orphan detection, and the O(n²) scan) are worth
bundling into the same follow-up. Low items can land in a polish pass.

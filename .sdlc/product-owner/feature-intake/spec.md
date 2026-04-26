# Spec — Restaurant Operations Platform ("TP Manager")

**Status:** **APPROVED v1.7** (PO design alignment — see `spec-amendment-2026-04-21-v1.7.md` for AC additions)
**Date:** 2026-04-21
**Change log:**
- **v1.7** — PO supplied 13-screen reference design (StockChef/Inventory Manager). Amendment adds per-ingredient PAR, zone-centric inventory UI, two-dimensional waste taxonomy (operational reason + attribution_bucket), invoice OCR, GPS verification, photo-required flag, barcode scanning, supplier KPIs (on-time/fill-rate/YTD spend), prep QC sign-off with temp probe, Prep Items library nav, top-level report pages (AvT/Price Creep/Waste & Loss), auto-generated orders from PAR shortfall, order email send (SMTP_HOST-gated), and dashboard KPIs + charts. Module count unchanged (21). Details in `.sdlc/product-owner/feature-intake/spec-amendment-2026-04-21-v1.7.md`; gap analysis in `.sdlc/product-owner/design-review/deviation-log-2026-04-21.md`.
- **v1.6** — Owner trimmed scope at architect pipeline. **(a)** Bilingual EN/ES **removed** — English only for MVP. Deletes module #14; §6.3 AC-3, §6.3a and §6.3b ES references, §7 i18n NFR, §8 `_es` fields and `User.language`, §11 bilingual row, §13 drift risk, §15 DoD item #3 all simplified. **(b)** Deployment unit formalized as **Docker containers** — every service ships a `Dockerfile`, local dev uses `docker-compose`, production is Container Apps (or equivalent Docker-image runtime). Module count 22 → 21. Effort reduction: ~1 eng-week saved (removed ES translation ops + bilingual drift tests + `_es` schema column maintenance).
- **v1.5** — Owner APPROVED at HITL gate. OQ-5 resolved (HACCP deferred to Phase 2 — restaurant is in Pennsylvania, no state mandate). All 7 open questions now resolved. Spec frozen for handoff to `architect/design-to-plan`.
- **v1.4** — Owner supplied a sample Aloha PMIX (Product Mix) report (`myReport (10).xlsx`) — 7-day per-day per-item qty/sales with modifier + 86 (out-of-stock) rows. §6.12a Aloha AC updated with concrete column schema. Modifier handling and 86-count added to the data model. OQ-1 resolved (single restaurant — Turning Point of Collegeville, Aloha store ID 1002). OQ-6 resolved (on-demand PDF for flash cards). OQ-7 resolved (full automated import with a human review step). §6.14 added (migration tool).
- **v1.3** — Ingested 5 additional source files: `Lunch Station Cheat Sheet`, `Expo Station Cheat Sheet`, `Slicing & Portioning Chart`, `Portion Control Utensils`, `Egg Amount Cheat Sheet`. Introduces **utensil-based portioning** (scoops/ladles/portion bags as named UoMs), **station cheat-sheet views** (station-grouped plating presentation), and **pre-portioning** (raw → portion bag) as first-class concepts. Data model and recipe ACs updated.
- **v1.2** — Stack resolved (OQ-3): TypeScript web/API + Python ML. Hosting resolved (OQ-4): Azure VM + Azure Database for PostgreSQL + Azure Blob Storage. §10 rewritten with concrete topology.
- **v1.1** — ML forecasting moved from Phase 2 to MVP (owner confirmed 1 year of historical data); POS confirmed as NCR Aloha (OQ-2); data-transform layer added as an MVP module.
- **v1.0** — Initial spec from the feature request + Lovable prototype + 6 source files.
**Owner:** Product (pending approval)
**Reference prototype:** https://recipe-radar-assist.lovable.app ("Inventory Guardian")
**Source materials ingested:**
- `TP Recipe Book.xlsx` — 80+ prep recipes with shelf life, equipment, procedures (source is bilingual EN/ES; only the English body is ingested in v1.6)
- `Prep and Ingredients Shelf Life.xlsx` — Canonical shelf-life matrix (~90 items across meats, vegetables, cheeses, dressings/sauces/mixes, batters, misc)
- `Menu Flash Cards (1).pptx` — 99 menu-item plating/build cards
- `Beverage Recipes.docx` — 200+ hot/cold/blender beverage recipes
- `Beverage Flash Cards.pptx` — 26 beverage plating/build cards
- `Barista Prep.xlsx` — Barista station par list + stocking list
- `Lunch Station Cheat Sheet.docx` — Station-grouped plating instructions with utensil-based portions ("2 Blue Scoops Avocado Chunk", "1 Powergrain Pancake (1 White Scoop)")
- `Expo Station Cheat Sheet.docx` — Expo-station plating/garnish steps by menu category (Appetizers / Lunch / Breakfast)
- `Slicing & Portioning Chart.docx` — Pre-portioning rules: how raw ingredients are sliced and bagged ("Pork Roll 3×1oz slices per portion bag", "Smoked Salmon 2oz per portion bag")
- `Portion Control Utensils.docx` — Utensil taxonomy: colour/name-coded scoops and ladles (Purple .75oz, Blue 2oz, Grey 4oz, White 5.3oz, Small Baseball Cap 2oz, Large Baseball Cap 4oz, 2oz Ladle, 6oz Ladle) mapped to the ingredients/preps each is used for
- `Egg Amount Cheat Sheet.xlsx` — Per-dish egg quantities across three egg formats (shelled count, whipped oz, whites oz)

---

## 1. Problem Statement

A single-unit cafe/restaurant owner today coordinates operations across six disconnected files: an Excel recipe book, a shelf-life spreadsheet, two PowerPoint flash-card decks, a Word doc of beverage recipes, and a barista prep list. The same ingredients appear under different names across files, shelf-life data is authoritative in only one place, and there is no system that connects recipes → ingredients → suppliers → waste → forecast demand. Results: over-ordering, expired prep, menu items 86'd at service, and no data to manage food cost.

**We will build a single web-first system** — responsive for phones/tablets, architected so a native iOS/Android app can be layered on the same API later — that replaces all six files and gives the owner one screen to run the kitchen from.

## 2. Goals & Success Metrics

| Goal | Measurable outcome |
|---|---|
| Replace spreadsheet/PPT sprawl | 100% of current prep recipes, menu items, and shelf-life data migrated and editable in-app at launch |
| Reduce food waste | Waste-log coverage ≥ 80% of shifts by week 4; waste $ / week visible on dashboard and trending down by week 8 |
| Reduce stock-outs | < 1 stock-out event per week by month 3 (baseline captured in month 1) |
| Mobile usability | p95 time-on-task for "log a waste entry" < 30 sec on phone |
| ML readiness (Phase 2) | 8+ continuous weeks of clean sales + waste data available for forecasting training |

## 3. Personas

| Persona | Who | Primary device | Key jobs |
|---|---|---|---|
| **Owner / GM** | The person paying for the product | Phone + desktop | Cost visibility, ordering, supplier mgmt, decisions |
| **Kitchen Lead / Sous** | Runs prep list each AM | Tablet on the line | Generate daily prep sheet, mark complete, log waste |
| **Line / Prep Cook** | Executes recipes | Phone (shared tablet) | View recipe, check shelf-life, log waste |
| **Barista** | Runs bar station | Phone (shared tablet) | Par list, stocking list, beverage recipes |
| **Receiving** | Checks in deliveries | Phone at loading dock | Log delivery vs PO, flag variances |

Non-persona (MVP): customer, diner, external auditor.

## 4. Scope

### 4.1 In scope (MVP)

The MVP is scoped to match — and unify — what the Lovable prototype outlines, mapped to the real source data. The following modules ship in MVP:

1. **Ingredients master** (`/ingredients`) — canonical ingredient list with unit of measure, storage location (Dry Storage / Bar / Freezer / Walk-in / Prep Station), default supplier, current on-hand cost.
2. **Suppliers** (`/suppliers`, `/suppliers/:id`) — supplier directory with which ingredients each supplies, contact info, lead time, order cadence.
3. **Supplier → Ingredient mapping** — many-to-many: an ingredient can have multiple suppliers with ranked preference; a supplier carries many ingredients.
4. **Recipes — two types**:
   - **Prep recipes** (`/prep/items`) — intermediate items that are themselves "ingredients" for menu recipes (e.g., Salsa, Cranberry Chicken Salad, Caramelized Onions). Each has yield, shelf life, equipment, procedure.
   - **Menu recipes** — items served to the guest (Avocado Toast, Tropical Bliss Smoothie, Salted Caramel Mocha-chino). Reference ingredients **and** prep recipes (nested bill-of-materials).
5. **Daily Prep Sheet** (`/prep/sheet`) — generated each morning based on par levels + on-hand; each prep item has status `pending | in progress | complete | skipped` with timestamp and initials.
6. **Inventory Count** (`/inventory`) — periodic (weekly) count screen by location; computes on-hand value.
7. **Deliveries** (`/deliveries`) — log a delivery against a supplier/PO; status `pending | verified | disputed`; variance captured.
8. **Order Forms** (`/orders`) — generate a supplier-specific order list from par + on-hand + lead time.
9. **Waste Log** (`/prep/waste`, `/reports/waste`) — log reason, quantity, ingredient/prep item, $ value. Reasons standardised (expired, spoilage, overprep, burn/error, customer return).
10. **Reports** — AvT Variance (`/reports/variance`), Price Creep (`/reports/price-creep`), Waste trend (`/reports/waste`).
11. **Dashboard** (`/`) — total inventory value, items tracked, variance alerts, today's prep progress, this-week waste trend.
12. **Settings** (`/settings`) — locations, units, taxonomies, users.
13. **Auth + RBAC** — owner, manager, staff roles. Email+password, password reset.
14. **Data migration from the 11 source files** — one-time import tool for recipes, ingredients, shelf life, prep items, station sheets, portion utensils. Explicit deliverable, not a support-ticket afterthought.
15. **PWA** — installable to home screen on iOS/Android, offline-capable for read paths (view a recipe, view shelf life, view prep sheet).
16. **Aloha POS integration (one-way read)** — scheduled nightly import of daily item-level sales from NCR Aloha into the system; maps Aloha menu items to TP Manager menu recipes so theoretical ingredient usage and AvT variance are computable from real sales (not manual entry).
17. **ML baseline forecasting** — waste forecast per prep item and ingredient demand forecast per supplier lead-time window, trained off the owner's 1 year of historical POS + (as it accumulates) waste data. MVP model is intentionally simple (seasonal-naïve + exponential smoothing baseline); more sophisticated models are Phase 2. Recommendations are **advisory and dismissable** — they must not block operational workflows.
18. **Data transform layer (one-time + ongoing)** — deterministic, idempotent ETL that normalises (a) the 11 operational source files and (b) the Aloha daily exports into the canonical entities in §8. Explicit module, not a support activity.
19. **Portion utensils** — first-class catalogue of named portioning utensils (colour-coded scoops, baseball-cap scoops, ladles, portion bags) with physical equivalents (e.g., "Blue Scoop" = 2 oz volume). Recipe lines reference ingredients *via* a utensil when the kitchen does ("2 Blue Scoops Avocado Chunk" is the canonical instruction — the system converts this to oz/g for cost and inventory arithmetic).
20. **Pre-portioning (portion bags)** — raw-ingredient pre-portioning step: e.g., "Pork Roll → 3×1oz slices per portion bag". A pre-portioning operation consumes a raw ingredient (lbs of pork roll) and yields N countable portion units (bags), each with a fixed content. Modelled as a prep recipe with yield = N portion bags. Line cooks pick portion bags, not raw lbs.
21. **Station cheat-sheet views** — printable / screen views of menu recipes grouped by kitchen station (Lunch, Egg, Expo, Barista) with utensil-specific plating steps. This is a view, not a new data model — the underlying data is menu-recipe line items plus station tag + utensil reference.

### 4.2 Out of scope (MVP) — deferred to later phases

| Item | Reason | Earliest phase |
|---|---|---|
| Advanced ML (gradient boosting, anomaly detection, weather/holiday features) | MVP ships a baseline; upgrades come after baseline is in production and showing lift | Phase 2 |
| Native iOS / Android apps | PWA meets mobile need for MVP; API designed to support native later | Phase 3 |
| Two-way POS integration (push menu changes back to Aloha) | One-way read is sufficient for MVP operations + forecasting | Phase 2 |
| Multi-location | Single-tenant, single-restaurant MVP | Phase 3 |
| Supplier EDI / auto-send POs | Manual email/PDF order sheet for MVP | Phase 2 |
| Employee scheduling, payroll, tip-out | Separate domain | — |
| Financial accounting / invoicing | Out of product scope | — |
| Customer-facing ordering / reservations | Operations product, not guest product | — |
| Food-safety HACCP formal logs / health-inspector export | Noted in risk; not an MVP deliverable | Phase 2 |

## 5. Non-Goals

- We are not building a general-purpose ERP. We will refuse feature requests that push into accounting, HR, scheduling.
- We are not building a marketplace connecting restaurants to suppliers.
- We are not replicating the Lovable prototype pixel-for-pixel — it is a reference, not a contract.

## 6. Functional Requirements (per module)

### 6.1 Ingredients Master

**User stories**
- As an owner, I want to see every ingredient we buy, with its current cost and default supplier, so I can understand food cost structure.
- As receiving, I want to search ingredients quickly so I can verify a delivery line.

**Acceptance criteria**
1. List view supports search by name, filter by storage location, filter by supplier.
2. Create/edit ingredient with: name, UOM (weight / volume / each), pack size, current unit cost, storage location, default supplier, shelf-life (days), allergen flags.
3. Cost history preserved — each cost change stamps `effective_from` so Price Creep report can be computed.
4. Ingredients cannot be hard-deleted if referenced by a recipe; must be soft-archived with migration of references.
5. CSV import/export (matches prototype "Export ingredients CSV").
6. Unit conversion handled: recipes can reference an ingredient in any supported unit as long as a conversion exists (e.g., `1 cup = 236.6 mL` for volumetric; weight↔volume requires per-ingredient density; utensil ↔ physical volume/weight requires a utensil equivalence — see §6.3a).

**Edge cases**
- Ingredient with no supplier (pre-migration state) — allowed, but dashboard flags as "needs supplier".
- Ingredient used in 50+ recipes — bulk re-cost must propagate atomically.
- Ingredient name collision on import ("Cilantro" in two sheets) — dedupe by normalised name + UOM.

### 6.2 Suppliers & Supplier→Ingredient Mapping

**User stories**
- As an owner, I want each ingredient to have a ranked supplier list so I can switch primary if one goes out of stock.
- As an owner, I want to see every ingredient a supplier carries so I can consolidate orders.

**Acceptance criteria**
1. Supplier CRUD: name, contact, phone, email, order cadence, lead time (days), min order $.
2. Supplier detail page (`/suppliers/:id`) lists ingredients supplied with pack size and current price.
3. Each ingredient can have N supplier offers with rank (1 = primary); changing rank does not lose historical price data.
4. Delivery history filterable by supplier.
5. Price Creep report flags ingredients where supplier cost has risen > X% over the configurable window.

**Edge cases**
- Supplier stops carrying an ingredient — mark as inactive with `effective_until` date; existing deliveries referencing it remain valid.

### 6.3 Recipes (Prep + Menu)

**User stories**
- As a cook, I want to open a prep recipe on a tablet and see ingredients, shelf life, equipment, and procedure.
- As a GM, I want to change the mayo brand once and have every recipe's cost update.
- As an owner, I want to see the plated cost of every menu item updated as ingredient costs change.

**Acceptance criteria**
1. Two recipe subtypes with shared schema: **Prep** (yields an internal "prep item") and **Menu** (yields a dish served).
2. Each recipe references line items; a line item is either (a) an ingredient or (b) another prep recipe — nested BOM supported to arbitrary depth but with cycle detection.
3. Recipe fields: name, yield (qty + UOM), shelf-life days, equipment list, procedure (rich-text), photo (optional).
4. Plated cost computed live from the nested BOM and current ingredient costs; shows per-serving cost and per-batch cost.
5. Version history preserved — editing a recipe creates a new version; past cost computations pin to the version that was active at the time.
6. Flash-card view — printable / slide-style layout that matches the current PPT flash cards (description, components, plating, vessel/container).
7. Recipe search: by name, ingredient used, shelf-life threshold, station (Kitchen / Bar / Bakery).
8. Cycle prevention: a prep recipe cannot (transitively) include itself.

**Edge cases**
- Ingredient quantity "as specified" / "to taste" — allowed via free-text qty field; excluded from cost computation with a visible "~" indicator.
- Recipe quantity scaling: view "1× / 2× / 4× / 0.5×" with proportional ingredient amounts.
- Recipe that references an archived ingredient — flagged in a "needs fixup" queue; not blocked from opening.

### 6.3a Portion Utensils & Pre-portioning

**User stories**
- As a line cook, when I read a menu recipe I want it to say "2 Blue Scoops of Avocado Chunk" because that's the language the kitchen uses — not "4 oz of Avocado Chunk".
- As an owner, I want the system to still know that "2 Blue Scoops" = 4 oz so cost and inventory arithmetic works.
- As receiving, when a portion-bag prep is "used", I want inventory to decrement by the portion-bag count, not raw ounces.

**Acceptance criteria**
1. Portion Utensil catalogue (settings, see §6.11) with fields: name (e.g., "Blue Scoop"), colour/label, physical equivalent (volume OR weight OR count), default-for-ingredients list (reference only).
2. Seed data (migrated from `Portion Control Utensils.docx`): Purple 0.75 oz Scoop, Blue 2 oz Scoop, Grey 4 oz Scoop, White 5.3 oz Scoop, Small Baseball Cap 2 oz, Large Baseball Cap 4 oz, 2 oz Ladle, 6 oz Ladle. UoM support for oz → mL → g conversion.
3. A recipe line can reference an ingredient (or prep item) *via* a utensil: `qty=2, utensil_id=<Blue Scoop>, ref=<Avocado Chunk>`. The system treats this as `2 × utensil.equivalent_volume` (or weight) for downstream arithmetic.
4. Per-ingredient utensil override: some utensils carry different weights for different ingredients (a Blue Scoop of granola weighs less than a Blue Scoop of diced tomato). Override table: `(utensil_id, ingredient_id, equivalent_qty, equivalent_uom)` — falls back to the utensil default if no override exists.
5. Pre-portioning prep: a prep recipe can declare itself as a portion-bag prep — it consumes a raw ingredient and yields N countable portion units. E.g., "Portioned Pork Roll" yields 100 portion bags, each containing 3×1oz slices, from 18.75 lbs of raw pork roll. Menu recipes that reference portioned pork roll consume portion bags (count), not ounces.
6. Inventory and cost computation honour both paths: utensil-based lines roll up to the ingredient's native UoM; portion-bag references roll up to the portion-bag's count. No double-counting.

**Edge cases**
- A utensil is deprecated or renamed — existing recipe references continue to resolve by ID; the utensil row is soft-archived.
- A menu recipe specifies a utensil that has no override for that ingredient and no default volume equivalence is sensible (e.g., "Small Baseball Cap" of a liquid) — migration tool flags this and the recipe is opened with a "needs fixup" banner.
- A portion bag is opened for a customer request and only part is used — staff can log a "partial use" waste entry; the system recomputes remaining inventory.
- A station cheat sheet uses a fractional utensil ("½ Blue Scoop Pickled Onions" as seen in the Lunch Station sheet) — quantity field supports fractions.

### 6.3b Station Cheat-Sheet Views

**User stories**
- As an expo cook, I want a printable one-page view of every menu item's plating/garnish steps grouped by my station (Expo), so I can work without flipping through the recipe book.
- As a lunch-line cook, I want my station's menu items condensed into the build-order I actually cook, with the right utensil called out for each step.

**Acceptance criteria**
1. Every menu-recipe line has an optional `station` tag (`lunch | breakfast | expo | egg | bar | bakery`) and an optional `step_order`.
2. Station Cheat-Sheet view (`/recipes/station/:station`) renders menu items filtered to that station, with line items sorted by `step_order`, utensil names spelled out ("2 Blue Scoops"), and no cost info.
3. The same data can render as a printable PDF (one menu item per card, 4-up on US Letter / A4) — intended as the direct replacement for the current Word cheat-sheet docs.
4. Station and step_order are editable on each recipe line via the standard recipe edit screen; the Station Cheat-Sheet view is a read presentation, not a separate edit surface.
5. Egg Cheat Sheet (`Egg Amount Cheat Sheet.xlsx`) migrates cleanly as station=`egg` lines on each menu recipe with the right egg UoM (shelled-count / whipped-oz / whites-oz).

**Edge cases**
- A menu item has no station lines (pure assembly at expo) — still shows on the expo view with a "NA" marker (as in the source `Expo Station Cheat Sheet.docx`).
- A menu item spans two stations (e.g., egg station + lunch) — appears on both views with only its station-tagged lines.

### 6.4 Daily Prep Sheet

**User stories**
- As a kitchen lead, each morning I want a generated prep sheet telling me what to make today based on par levels and what's already prepped.

**Acceptance criteria**
1. Each prep item has a configurable par level (by day of week, since weekends differ).
2. Morning generation computes: needed = par − (on-hand within shelf-life window).
3. Each row on the sheet has status `pending | in progress | complete | skipped`, initials of person executing, time-started, time-completed.
4. Marking "complete" increments the on-hand quantity of that prep item and stamps `prepared_on` for shelf-life tracking.
5. Skipped items require a reason (shortage of ingredient / out of time / not needed).
6. History retained per day for AvT variance analysis.

### 6.5 Inventory Count

**User stories**
- As an owner, I want a weekly count broken by storage location so I know what I actually have vs what the system thinks.

**Acceptance criteria**
1. Count workflow grouped by location (Dry Storage, Bar, Freezer, Walk-in, Prep Station).
2. System suggests expected count from last count ± deliveries ± theoretical usage; user enters actual.
3. Difference becomes the variance, fed into AvT report.
4. Count can be paused mid-way and resumed (PWA offline-safe for read; write syncs on reconnect).
5. Historic counts immutable; amendments create a new count with reference to prior.

### 6.6 Deliveries

**User stories**
- As receiving, when a truck arrives I want to scan through the PO and log actual vs ordered.

**Acceptance criteria**
1. Delivery references a PO (optional: ad-hoc allowed).
2. Each line: ordered qty, received qty, unit cost charged, condition note.
3. Delivery status: `pending` → `verified` (all lines match) → `disputed` (any variance above tolerance).
4. Verifying a delivery increments ingredient on-hand and updates cost history if unit cost differs from current.
5. Disputed delivery creates an alert on dashboard.

### 6.7 Order Forms

**User stories**
- As an owner, I want to generate next week's order for each supplier with one tap based on par and lead time.

**Acceptance criteria**
1. For each supplier, compute: to_order = par − on-hand − in-transit, rounded up to pack size.
2. Editable before send; user can add non-par items.
3. Export options: email PDF (MVP), printable view (MVP), CSV (MVP). EDI is Phase 2.
4. Sending an order creates a PO record with `expected_delivery_date = today + supplier.lead_time`.

### 6.8 Waste Log

**User stories**
- As a cook, when I throw something away I want to tap one button and have the $ value logged.
- As an owner, I want to see this week's waste $ broken down by reason and item.

**Acceptance criteria**
1. Waste entry: ingredient OR prep item, qty + UOM, reason (expired / spoiled / overprepped / burn-error / customer return / other), free-text note, optional photo.
2. $ value computed from current cost at time of entry; pinned.
3. Waste view `/reports/waste`: group by reason, by item, by week; sparkline trend.
4. Expired-shelf-life items are auto-suggested for waste entry on the dashboard (derived from `prepared_on + shelf_life_days < today` with qty > 0).

### 6.9 Reports

| Report | What it shows | Derived from |
|---|---|---|
| **AvT Variance** (`/reports/variance`) | Theoretical usage (from menu items sold × recipe) vs actual (count deltas + waste + deliveries) | Sales (manual in MVP), counts, deliveries, waste |
| **Price Creep** (`/reports/price-creep`) | Ingredients whose unit cost has risen > X% over Y weeks; plated-cost impact | Ingredient cost history |
| **Waste** (`/reports/waste`) | Waste $ by reason, by item, weekly trend | Waste log |

All reports exportable as CSV; default window 4 weeks, user-adjustable.

### 6.10 Dashboard

- Total inventory value (from latest count × cost) — primary KPI.
- Items tracked (count of active ingredients + prep items).
- Variance alerts (open disputed deliveries, AvT breaches, expired items).
- Today's prep progress (n of m complete).
- This-week waste $ vs last week.
- Quick actions: Start Inventory Count, Log Delivery, Report Waste, Generate Order.

### 6.11 Settings

- Locations list (add / rename / archive).
- Units of measure + conversions.
- **Portion utensils** (name, colour/label, kind, default equivalence) + per-ingredient overrides.
- Kitchen stations list (lunch, breakfast, expo, egg, bar, bakery — editable).
- Waste reasons list.
- Users + roles (owner, manager, staff).
- Par levels by day of week (per prep item).
- Shelf-life default days (per ingredient category).

### 6.12a Aloha POS Integration (one-way read, nightly)

**Reference report (sample provided by owner):** `myReport (10).xlsx` — the **PMIX Cost By Category By Store — Detail** report for store 1002 (Turning Point of Collegeville), date range 4/14/2025–4/21/2025. This is the primary import schema for MVP.

**User stories**
- As an owner, I want the system to pull yesterday's item-level sales from Aloha automatically so my AvT variance and forecasts reflect reality, not data I typed twice.
- As an owner, I want to know which items were "86'd" (out of stock) and how often, because today that's tribal knowledge.

**Acceptance criteria**
1. Supports Aloha integration via one of the standard pathways — to be picked at plan time: (a) **nightly PMIX report export** (the exact report the owner already runs — owner schedules Aloha to drop the Excel/CSV export to SFTP or a watched folder; simplest path), (b) SFTP DBF/flat-file pickup from the Aloha BOH server's `\Bootdrv\Aloha\Data`, (c) NCR Aloha Cloud / Aloha Insight REST API, (d) 3rd-party middleware (Omnivore, Itsacheckmate). Decision recorded as an ADR at plan time. **Default recommendation:** path (a) — owner already produces this report; the ETL ingests the exact file we've seen.
2. PMIX ingest schema (columns in the sample): `business_date`, `category`, `store`, `item_name_aloha`, `quantity`, `unit_price`, `item_sales`, `sales_pct`, `cost`, `cost_pct`. Rows are grouped by `business_date → category → item_name_aloha`. Store-level and day-level **totals** and **subtotals** in the source must be recognised and skipped (the `Grand Total:` / `4/21/2025 Total:` / `All Food & N/A Bev Total:` rows in the sample). Aloha's `cost` column is often zero (owner hasn't loaded item cost into Aloha) — TP Manager uses its own recipe BOM × current ingredient cost for true food cost; the Aloha `cost` field is stored for reference but not trusted.
3. **Item classification on ingest** — the PMIX contains mixed row types that must be classified at import:
   - **Menu items** (e.g., "Avocado Toast", "Wilbur Skillet", "Basic Omelet") → map to a TP Manager menu recipe.
   - **Modifiers** (e.g., "Add Cheese", "Add Choc Chips", "Add Fruit", "With Meal") → map to an ingredient or a small "modifier recipe" that adds lines to the parent order.
   - **86 markers** (e.g., "86 Bacon", "86 Chorizo") → **not a sale**; increments a daily `stockout_events` counter per referenced ingredient/prep. Surfaced on dashboard and in the waste/stockout report.
   - **Cover counts** (e.g., "1 Person", "3 People") → party-size signal, rolled up per business day as `cover_count` for per-cover metrics (waste $/cover, revenue/cover).
   - **Unclassified** → reconciliation queue on dashboard until owner classifies.
4. **Modifier → ingredient BOM:** modifiers contribute to theoretical ingredient usage. "Add Cheese" consumes cheese; "Add Choc Chips" consumes chocolate chips. Owner configures modifier-to-ingredient mapping (one modifier → N ingredient lines) in the Aloha mapping UI. Unmapped modifiers do not block ingestion but flag the AvT report until mapped.
5. Menu items are mapped to TP Manager menu recipes via an `AlohaMenuMap` table with `effective_from/effective_until`; modifiers go to `AlohaModifierMap` with same effective-dating.
6. Re-imports for the same `business_date` are idempotent (last import wins for that date; prior import row-set archived for audit).
7. Import failures alert the owner; failed days show in a "needs attention" list. Missed days do not silently corrupt the AvT report — dashboard shows "POS data missing for N days" warning.
8. **Historical backfill** — the owner's ~1 year of Aloha history is imported as part of initial onboarding via the same PMIX schema (the owner exports weekly reports, the system concatenates). The backfill completes before ML training starts.

**Edge cases**
- Aloha menu changes (item renamed / new item / retired item) → mapping table effective-dating keeps historical data correct.
- Voids and comps — PMIX already nets these out of `quantity`. If the owner later wants gross vs net, we add a columnar split in Phase 2.
- Business-day crossing midnight (late-night orders) — Aloha `business_date` is the authoritative field; we use it verbatim. Display-side time-zone rendering uses restaurant-local TZ.
- A PMIX export missing a day (owner forgot to run the report) — import records `status=partial`; dashboard shows gap; owner can manually upload that day's report through the same UI.
- Same item-name in two categories (e.g., `Avocado Toast` under "All Food & N/A Bev" and a subcategory) — dedupe by `(business_date, category, item_name)` key; ingest preserves category so reporting can slice by it.
- Modifier charges $0 with $0 cost (e.g., "With Meal") — still ingested because it signals combo purchases; does not affect AvT.

### 6.12b ML Forecasting (MVP baseline)

**User stories**
- As an owner, before placing this week's order I want the system to tell me how much of each ingredient I will likely use, based on the last year of my own sales data, so I stop over-ordering.
- As a kitchen lead, before today's prep I want the system to recommend quantities for each prep item based on predicted demand so I stop over-prepping.

**Acceptance criteria**
1. **Ingredient demand forecast:** for each ingredient, produce a 7-day-ahead forecast (unit-of-measure, same as ingredient master) with lower/upper 80% prediction intervals. Computed nightly off the latest POS + recipe BOM + waste data.
2. **Prep quantity recommendation:** for each prep item on the Daily Prep Sheet, show a recommended quantity and a confidence badge (low / medium / high) derived from forecast interval width.
3. **Baseline models** (MVP — intentionally simple): seasonal-naïve (same day-of-week one year ago), exponential smoothing (Holt-Winters) with day-of-week seasonality. Model selection per item by lowest MAPE on 8-week holdout. No gradient boosting, no weather, no holidays in MVP — phased to Phase 2.
4. **Model artefacts are versioned** — each nightly retraining stamps `model_version`, `trained_on_date_range`, `holdout_mape`. Predictions reference the version that produced them.
5. **Advisory, not authoritative:** the owner / kitchen lead can always override the recommendation. Overrides are captured (expected vs override vs actual) so Phase 2 can use them as training signal.
6. **Cold-start handling:** ingredients with < 8 weeks of data show "insufficient history — using 4-week rolling mean" instead of a forecast; the UI is explicit about this.
7. **Failure safety:** if a nightly training job fails, the app continues to function; stale predictions from the prior successful run are shown with a "forecast last updated N days ago" badge. Forecasting outages do not block ordering, prep sheets, or waste logging.
8. **Explainability (minimal):** for each ingredient's forecast, the UI shows the three top drivers — "last 4 weeks same day-of-week avg = X" / "seasonality adjustment = +Y%" / "recent trend = Z%". Owner must be able to see why, not just what.
9. **Evaluation dashboard** under `/reports/forecast-accuracy` — per-item MAPE over last 4 / 8 / 12 weeks; which items are reliably forecast vs which aren't.

**Edge cases**
- New menu item with no history → forecast disabled until 4 weeks of data, then cold-start mean, then full model.
- Menu item retired mid-history → treated as censored; forecasts skip it automatically.
- Seasonality at an unusual period (special events) → explicit "holiday/event" override field on the forecast screen in MVP; full event-aware modelling is Phase 2.

### 6.13 Auth & RBAC

**Acceptance criteria**
1. Email + password, bcrypt/argon2 hashing, forgot-password email flow.
2. Session cookie + CSRF token; JWT for API (prepares for native clients).
3. Roles: **owner** (all), **manager** (all except user admin + settings taxonomies), **staff** (view + log waste + mark prep complete + log deliveries; cannot edit recipes or change cost).
4. Audit log of who changed what, retained 12 months.

### 6.14 Data Migration Tool (automated import + review step)

**Resolves OQ-7.** The owner's 11 source files (6 operational + 5 station/portioning references) and ~1 year of Aloha PMIX history are migrated by an **automated import pipeline with a mandatory human review step**, not a support ticket or one-shot script.

**User stories**
- As an owner, I want to load all my recipe books, shelf-life sheets, cheat sheets, and 1 year of POS history into the system without hand-retyping anything.
- As an owner, before the data becomes "live", I want to see and approve every dedupe and mapping decision the system made, in the UI, so bad data never reaches production.

**Acceptance criteria**
1. **Staging schema.** Imports land in a `staging.*` schema (mirrors §8 entities with `staging_` prefix) — never directly into canonical tables. Staging rows carry `source_file`, `source_row_ref`, and `batch_id`.
2. **Deterministic + idempotent.** Re-running the import on the same source file with the same `batch_id` produces the same staging rows; previous staging rows for that batch are archived, not merged.
3. **Per-file parsers** (extensible, one parser per source type):
   - `recipe_book_parser` — `TP Recipe Book.xlsx` → staging recipes + lines (English body only; ES column ignored in v1.6).
   - `shelf_life_parser` — `Prep and Ingredients Shelf Life.xlsx` → staging ingredients + shelf-life days.
   - `flash_card_parser` — `Menu Flash Cards.pptx` + `Beverage Flash Cards.pptx` → staging menu recipes + plating text.
   - `beverage_recipes_parser` — `Beverage Recipes.docx` → staging beverage recipes.
   - `barista_prep_parser` — `Barista Prep.xlsx` → staging par list.
   - `station_cheat_sheet_parser` — the 4 station docs (lunch / expo / slicing-portioning / egg) → staging recipe-line station tags + utensil references.
   - `portion_utensils_parser` — `Portion Control Utensils.docx` → staging portion utensils + default equivalences + per-ingredient overrides.
   - `aloha_pmix_parser` — `myReport (10).xlsx` schema (§6.12a AC-2) → staging pos_sales + modifier/stockout/cover classification.
4. **Review UI (`/settings/migration`).** The owner sees, per entity type, a review queue with four bucket views:
   - **New** — new canonical row will be created (owner can edit or skip).
   - **Matched** — staging row maps to an existing canonical row (owner confirms).
   - **Ambiguous** — ≥ 2 candidate canonical matches above similarity threshold (owner picks or creates new).
   - **Unmapped** — cannot map with confidence (owner classifies manually or defers).
5. **Fuzzy matching with explainability.** Dedupe uses normalised name + UOM + (where available) supplier scope. Each candidate match shows a confidence score and the fields that agreed; the owner sees *why* the system proposed this match, not just the match.
6. **Approve-to-promote.** Canonical tables are written only when the owner clicks Approve on a staging batch. Approval is all-or-nothing per batch (no partial promotion) so the canonical state is always consistent.
7. **Rollback.** A promoted batch can be rolled back within 14 days; rollback restores canonical tables to the pre-batch state and re-opens the review queue. After 14 days, rollback requires manual DB intervention (documented runbook).
8. **Batch audit trail.** Every batch stores: source files + hash, parser version, staging row count, review decisions (owner choice per ambiguous row), approved-by, approved-at. Accessible indefinitely for forensic review.
9. **Ongoing nightly Aloha uses the same path.** The nightly Aloha import writes to `staging.pos_sales` and auto-promotes *only* when no new unmapped items appeared (AC-3 of §6.12a). Otherwise the day's import pauses at the review step and surfaces on the dashboard.
10. **Bootstrap ordering.** The one-time initial migration runs in a fixed order so referential integrity holds: ingredients → portion utensils → utensil equivalences → suppliers → supplier↔ingredient → prep recipes → menu recipes → par levels → Aloha PMIX backfill → Aloha menu/modifier map suggestions.

**Edge cases**
- Source file changes between staging and review (owner edits the Excel and re-runs) — new `batch_id`; previous staging superseded; owner restarts review.
- Parser encounters a malformed row — row goes to a `staging.parse_errors` bucket with file path + row number + error text; does not stop the import.
- Owner approves a batch, then finds a bad mapping the next week — use rollback (AC-7) within 14 days; after that, normal in-app edit tools apply.
- Partial Aloha history (some weeks missing) — backfill proceeds with gaps; gaps flagged; forecasts mark affected items as low-confidence until filled.

## 7. Non-Functional Requirements

| NFR | Target |
|---|---|
| Mobile first | All screens usable on 360 × 640 viewport with one-thumb reach for primary actions |
| PWA | Installable; service worker caches read paths; background sync for queued writes |
| Performance | First contentful paint < 2 s on 4G; list screens < 500 ms with 1k items |
| Availability | 99.5% monthly for MVP (single-tenant) |
| Data durability | Daily backup; point-in-time recovery ≤ 24 h loss |
| Browser support | Latest-2 Chrome, Safari, Firefox, Edge. iOS Safari 16+, Android Chrome 110+ |
| Accessibility | WCAG 2.1 AA for the MVP screens |
| Security | OWASP Top 10 addressed; parameterised queries enforced; secrets via env only; HTTPS-only |
| API | RESTful, versioned (`/api/v1`), OpenAPI spec generated; designed so native iOS/Android can consume without change |
| Observability | Structured JSON logs; error tracker (Sentry or equiv); uptime check |

## 8. Domain Model (key entities)

```
Ingredient (id, name, uom, pack_size, storage_location_id,
            default_supplier_id, allergen_flags, is_archived)
IngredientCost (id, ingredient_id, unit_cost, effective_from, source: delivery|manual)
UnitConversion (ingredient_id?, from_uom, to_uom, factor)
PortionUtensil (id, name, label_colour?, kind: scoop|ladle|bag|spoon,
                default_uom, default_qty, is_archived)
UtensilEquivalence (utensil_id, ingredient_id?, equivalent_qty,
                    equivalent_uom, source: default|override)
                    -- ingredient_id NULL = utensil default;
                    -- otherwise per-ingredient override
Supplier (id, name, contact, email, phone, lead_time_days, min_order_cents,
          order_cadence, is_active)
SupplierIngredient (supplier_id, ingredient_id, supplier_pack_size,
                    unit_cost, rank, effective_from, effective_until)
Recipe (id, type: prep|menu, name, yield_qty, yield_uom,
        shelf_life_days, equipment, procedure, photo_url,
        version, is_current,
        is_portion_bag_prep: bool,
        portion_bag_content_json?)
        -- is_portion_bag_prep=true means yield is countable portion units
        -- portion_bag_content_json describes each unit (e.g., "3×1oz slices")
RecipeLine (recipe_id, position, ref_type: ingredient|recipe, ref_id,
            qty, uom, note,
            station?: lunch|breakfast|expo|egg|bar|bakery,
            step_order?, utensil_id?)
            -- if utensil_id is set, qty is expressed in utensil units
            -- (e.g., qty=2, utensil=Blue Scoop); the system resolves
            -- to canonical uom via UtensilEquivalence for cost + inventory
PrepRun (id, recipe_id, prepared_on, prepared_by_user_id, qty_yielded,
         expires_on)  -- a physical batch of a prep item
PrepSheet (date, generated_at)
PrepSheetRow (prep_sheet_id, recipe_id, needed_qty, status, started_at,
              completed_at, user_id, skip_reason?)
InventoryCount (id, date, status, started_by, completed_by)
InventoryCountLine (count_id, ingredient_or_prep_ref, location_id,
                    expected_qty, actual_qty, unit_cost_at_count)
Delivery (id, supplier_id, po_id?, received_on, status, received_by)
DeliveryLine (delivery_id, ingredient_id, ordered_qty, received_qty,
              unit_cost, note)
Order (id, supplier_id, status: draft|sent|received,
       sent_at, expected_on)
OrderLine (order_id, ingredient_id, qty, pack_size, unit_cost)
WasteEntry (id, ref_type: ingredient|prep, ref_id, qty, uom, reason,
            note, photo_url, unit_cost_pinned, $_value, user_id, at)
Location (id, name, kind: dry|cold|freezer|bar|prep)
User (id, email, role: owner|manager|staff, active)
AuditLog (id, user_id, entity, entity_id, field, before, after, at)
Session / RefreshToken (standard)

-- Aloha POS integration
AlohaImportRun (id, business_date, source: sftp|api|middleware, started_at,
                completed_at, status: ok|failed|partial, rows_ingested,
                error_detail?)
PosSale (id, import_run_id, business_date, category,
         aloha_item_name, row_kind: item|modifier|stockout_86|cover|unclassified,
         qty, unit_price_cents, item_sales_cents, aloha_cost_cents,
         ingested_at)
         -- aloha_cost_cents stored for reference; true cost is computed
         -- from recipe BOM × current ingredient cost
AlohaMenuMap (id, aloha_item_name, menu_recipe_id, effective_from,
              effective_until?, mapped_by, confidence: manual|suggested)
AlohaModifierMap (id, aloha_modifier_name, ingredient_id?, recipe_id?,
                  qty, uom, effective_from, effective_until?, mapped_by)
                  -- a modifier can add an ingredient directly (Add Cheese)
                  -- or invoke a small recipe (Add Fruit = 3 fruits mix)
StockoutEvent (business_date, ingredient_or_prep_ref_type,
               ingredient_or_prep_ref_id?, aloha_marker_name,
               count, mapped: bool)
               -- one row per business_date × "86 X" marker
CoverCount (business_date, covers)
AlohaReconciliationQueue (aloha_item_name, row_kind, first_seen_on,
                          occurrences, resolved)

-- ML forecasting
ForecastModel (id, entity_type: ingredient|prep, entity_id, algorithm,
               trained_on_start, trained_on_end, holdout_mape, params,
               artefact_ref, trained_at)
ForecastPrediction (id, model_id, target_date, point, p10, p90,
                    top_drivers_json, generated_at)
ForecastOverride (entity_type, entity_id, target_date, expected_qty,
                  override_qty, actual_qty?, user_id, reason, at)
```

## 9. Machine Learning (MVP baseline + Phase 2 upgrades)

### 9.1 MVP baseline (in scope — see §6.12b)

The owner has ~1 year of Aloha POS history, which means we can train real models at launch. MVP ships a deliberately simple, well-understood baseline:

1. **Ingredient demand forecast** — 7-day-ahead, per ingredient, derived from POS sales × menu-recipe BOM. Baseline: seasonal-naïve + Holt-Winters (day-of-week seasonality). Per-item model selection by 8-week holdout MAPE.
2. **Prep quantity recommendation** — for each prep item on the Daily Prep Sheet, a recommended qty with a low/medium/high confidence badge derived from forecast interval width.
3. **Advisory-only** — every prediction is overrideable. Overrides are captured for Phase 2 training signal.
4. **Failure-safe** — forecasting outages do not block ordering, prep sheets, inventory counts, or waste logging. Stale predictions are flagged but displayed.

**Why baseline-only in MVP** — the 1 year of history unlocks forecasting, but it does not justify building a gradient-boosting pipeline with feature engineering on day one. A Holt-Winters baseline is 80% of the business value at 20% of the effort and lets us ship and learn. Phase 2 earns its upgrades by demonstrating lift against this baseline.

### 9.2 Phase 2 upgrades (deferred)

1. **Gradient boosting** with engineered features (day-of-week, trend, recent-weeks MAPE, weather pull, local holidays, school schedule).
2. **Anomaly detection on AvT variance** — flag variances that look like theft/error vs seasonality.
3. **Event-aware modelling** — special events, promotions, weather-sensitive items.
4. **Cross-item effects** — pancake batter demand reacts when a pancake special runs; explicit item co-occurrence.

### 9.3 Phase 2 entry criteria (must all be true before upgrade work starts)

- Baseline MVP models in production for ≥ 8 weeks.
- Baseline MAPE measured and meaningful lift is plausible (i.e., current errors are not already at noise floor).
- ≥ 8 continuous weeks of in-app waste log coverage ≥ 80% of shifts.
- Override-rate and override-accuracy measured.

### 9.4 Non-negotiable data-hygiene obligations (apply to MVP now)

- Stable ingredient + recipe IDs across versions (no reuse after retirement).
- Timestamped events with restaurant-local TZ + UTC on every row.
- Pinned unit costs at event time.
- Idempotent POS re-imports (§6.12a AC-4).
- Aloha menu-item mapping versioned so historical predictions stay explainable.

## 10. Architecture Summary (for the architect pipeline)

**Stack decision (OQ-3, resolved):** TypeScript for the web stack, Python for ML. Two services, one shared PostgreSQL.
**Hosting decision (OQ-4, resolved v1.6):** **Docker-first.** Every service (API, ML, Aloha worker) ships a `Dockerfile` as its deployment unit. Local dev runs `docker-compose up` at the repo root to bring up the full stack + Postgres + a local blob store. Production runs the same Docker images on **Azure Container Apps** with managed Azure Database for PostgreSQL + Azure Blob Storage. Container Apps is the chosen runtime because it gives managed TLS, auto-scale, and rolling deploys without the team operating a raw VM; any Docker-image runtime (AKS, ACI, k3s, ECS) can host the same images if a future migration is needed.

### Components

- **Client (PWA):** React + Vite, Tailwind, Workbox service worker. Responsive-first; no desktop-only chrome. Installs to home screen on iOS/Android. Offline-capable for read paths (recipe view, shelf-life lookup, prep sheet view).
- **API service (TypeScript):** NestJS or Fastify — decision recorded as an ADR at plan time; default NestJS for opinionated structure. Versioned REST (`/api/v1`), JWT bearer, cookies + CSRF for web, pure JWT for future native. OpenAPI spec auto-generated. This is the operational critical path.
- **ML service (Python):** FastAPI. Owns (a) the nightly training job (scikit-learn + statsmodels — Holt-Winters, seasonal-naïve, exponential smoothing), (b) the inference endpoint consumed by the TS API. Reads from a **read replica** of the primary PostgreSQL so training never contends with operational writes. Writes predictions back to the primary in short bursts.
- **Aloha import worker:** separate scheduled job on the same VM. Transport picked at plan time from (a) SFTP DBF pickup from the restaurant's Aloha BOH server, (b) NCR Aloha Cloud / Aloha Insight REST API, (c) 3rd-party middleware (Omnivore, Itsacheckmate). Transport is isolated behind an interface so it's swappable without touching business logic. Writes normalised rows into the canonical schema (§8) via the transform layer.
- **Data transform layer:** plain SQL migrations + typed transform scripts (TypeScript). Deterministic and idempotent. One-time batch for the 6 source files + ~1 year of Aloha backfill; ongoing nightly for Aloha pulls. Lives in the API-service repo so schema and transforms evolve together.
- **Database:** Azure Database for PostgreSQL (managed, flexible-server). Point-in-time recovery enabled. A read replica is provisioned for the ML service (and future analytics). Single-tenant schema — per-restaurant scoping handled by rows, not schemas (pending OQ-1 resolution).
- **Object storage:** Azure Blob Storage for recipe/waste photos + ML model artefacts (pickled model + metadata JSON per `(entity_type, entity_id, model_version)`).
- **Auth:** argon2 password hashing, session cookies for web (with CSRF), short-lived access JWT + rotating refresh tokens for API.
- **Deploy topology (MVP):** Single Azure VM running three processes under systemd (API + ML + Aloha worker) behind nginx. Managed Postgres separately. Azure Front Door or nginx for TLS. Log shipping to Azure Monitor / Application Insights. Daily DB backup (managed by Azure) + blob-lifecycle policy for storage.
- **Observability:** Structured JSON logs (all services), Application Insights for request traces + errors, uptime probe. Forecast-accuracy dashboard (§6.12b AC-9) doubles as ML observability.
- **Secrets:** Azure Key Vault; pulled into each service via managed-identity auth on the VM. No secrets in code or env files checked in.
- **CI/CD:** GitHub Actions (or Azure DevOps) → build images → deploy to the VM via SSH or Azure App Configuration. Blue/green not required at MVP; rolling restart per service is acceptable given single-tenant scope.

### Service boundary summary

| Service | Lang | Role | Critical path? |
|---|---|---|---|
| PWA client | TS/React | UI | Yes |
| API | TS (NestJS/Fastify) | Business logic, auth, reads/writes | Yes |
| ML | Python (FastAPI) | Training + inference | **No** (advisory) |
| Aloha import | TS worker | Scheduled POS pull + menu map | Partial (daily, tolerates 1-day miss) |

**Why two languages is worth the complexity here:** the team gets the TS ecosystem for the web + API, and Python for ML where the library ecosystem (statsmodels, scikit-learn, pandas) is dramatically stronger. The two services share one database, so there is no distributed-transaction tax; they communicate via HTTPS for inference and the DB for everything else.

## 11. Security & Compliance Constraints

- All endpoints require authentication; public endpoints must be explicitly annotated.
- Input validation at API boundary (zod/pydantic).
- Parameterised SQL only (per CLAUDE.md).
- Secrets via environment variables; never checked in.
- Response envelope: `{ "data": ..., "error": null }` (matches CLAUDE.md).
- HTTPS only; HSTS on.
- CSRF protection on cookie-auth routes; JWT rotation on API routes.
- Data at rest encrypted (managed by hosting provider).
- PII minimised — the system stores staff emails + names only; no customer data.
- Audit log retained 12 months; food-safety-relevant events (expired items, temperature excursions if added) retained 24 months.
- Canadian compliance (if target market is CA): PIPEDA-compatible privacy notice; data residency in CA if provincial regulator requires.

## 12. Open Questions (must resolve before plan-gen)

| # | Question | Who decides | Blocks |
|---|---|---|---|
| OQ-1 | ~~Target market — single restaurant or multi-location?~~ **RESOLVED 2026-04-17:** **single restaurant** (Turning Point of Collegeville, Aloha store ID 1002). Multi-location is Phase 3. Data model keeps `restaurant_id` as a column from day one so a future migration to multi-tenant is a row-scoping change, not a schema rewrite. | — | — |
| OQ-2 | ~~POS integration in MVP, or manual sales entry?~~ **RESOLVED 2026-04-17:** NCR Aloha, one-way read, nightly import. ~1 year of history available to backfill. See §6.12a. | — | — |
| OQ-3 | ~~Team composition and budget — which implies TS-vs-Python stack pick~~ **RESOLVED 2026-04-17:** **TypeScript** for the web stack (API + PWA), **Python** for ML (training + inference). Two services, one shared PostgreSQL, ML reads from a read replica. See §10. | — | — |
| OQ-4 | ~~Hosting — self-hosted vs managed~~ **RESOLVED 2026-04-17:** **Azure VM** (self-hosted on Azure). Single VM for MVP; managed Azure Database for PostgreSQL; Azure Blob Storage for recipe photos + model artefacts. See §10. | — | — |
| OQ-5 | ~~Canadian provincial food-safety record-keeping — is HACCP export an MVP requirement?~~ **RESOLVED 2026-04-17:** **deferred to Phase 2.** Restaurant is in Pennsylvania (US); no state-level HACCP export mandate applies at MVP. If a future jurisdictional change or multi-location expansion introduces the requirement, it reopens as a scope-tracker item. | — | — |
| OQ-6 | ~~Print flash cards — on-demand PDF or kitchen printer integration?~~ **RESOLVED 2026-04-17:** **on-demand PDF** is sufficient. Owner prints flash cards / station sheets from the web UI; no kitchen printer integration in MVP. | — | — |
| OQ-7 | ~~Migration — full automated or curated?~~ **RESOLVED 2026-04-17:** **full automated import with a review step** — tool ingests all 11 source files + Aloha history into a staging schema; owner reviews dedupe/mapping decisions in-app; approval promotes staging → canonical. See §6.14 (new). | — | — |

## 13. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ML baseline over-promises accuracy | Medium | Medium | MVP models are explicitly baseline (Holt-Winters / seasonal-naïve); UI always shows confidence + "last updated" + allows override. Accuracy dashboard (§6.12b AC-9) keeps expectations grounded. |
| ML work crowds out operational modules | Medium | High | ML is a separable work stream (distinct service); operational modules are the critical path. If ML slips, MVP still ships with "insufficient history" fallback everywhere. |
| Aloha integration path uncertainty | Medium | Medium | Plan-time decision among 3 known pathways (SFTP / REST / middleware); import service isolates transport so decision is reversible. |
| Aloha menu-mapping ongoing cost | Medium | Medium | Reconciliation queue + dashboard surfaces unmapped items; owner does it in-app, not in SQL. |
| Data migration underestimated (now larger: 6 files + 1 yr Aloha + ongoing Aloha nightly) | High | High | Dedicated data-transform layer is an MVP module (§4.1 #19), not sidecar. |
| Unit conversion complexity (weight↔volume + utensil↔physical) | Medium | Medium | Per-ingredient density table; per-ingredient utensil override table (§6.3a AC-4); fallback to free-text qty with "~" cost indicator |
| Utensil catalogue drift (new scoops added, names change) | Low | Low | Utensils are soft-archived, referenced by ID; editable from Settings without code change |
| Portion-bag inventory mismatch (partial use) | Medium | Low | Waste log supports partial-use entries (§6.3a edge case) |
| PWA offline writes — conflicts on sync | Medium | Medium | Last-write-wins for counts/waste (small conflict surface); prep-sheet status append-only log |
| Owner changes mind on scope mid-build | High | High | Lock MVP list at HITL gate; scope changes go through `/scope-tracker` with cost estimate |
| Native iOS/Android pressure before API is proven | Medium | High | Explicit Phase 3; communicate that PWA ships first |

## 14. Dependencies

- Access to the 6 source files (received) and permission to migrate their content.
- A real restaurant willing to pilot (assumed = the owner requesting this).
- **Aloha POS access** — credentials + chosen transport:
  - If SFTP DBF pickup: SFTP credentials to the restaurant's Aloha server + directory path to `\Bootdrv\Aloha\Data` DBF exports.
  - If NCR Aloha Cloud / Aloha Insight API: API credentials + tenant ID.
  - If 3rd-party middleware: vendor + API credentials.
- **Aloha historical backfill** — export of ~1 year of transaction history in whatever format Aloha supports (DBF, CSV, or API window pagination).
- Hosting account (to be provisioned during DevOps plan) with sufficient compute for a lightweight nightly ML training job.
- Domain name (deferred to launch).

## 15. Definition of Done (MVP)

1. All 21 in-scope modules (§4.1) shipped with acceptance criteria met.
2. All 11 source files fully migrated through the staging → review → canonical path (§6.14); ~1 year of Aloha PMIX history backfilled; nightly Aloha import running for ≥ 7 consecutive days at pilot with the review-step auto-promote working cleanly.
3. PWA install verified on iOS Safari and Android Chrome.
4. WCAG AA audit clean for the 5 most-used screens (dashboard, inventory count, waste log, prep sheet, recipe view).
5. Security review clean (no critical, no high OWASP findings).
6. Data dictionary + OpenAPI spec published.
7. Owner sign-off on dashboard KPIs.
8. Forecasting baseline trained and serving predictions for ≥ 80% of active ingredients and prep items; accuracy dashboard populated with ≥ 4 weeks of measured MAPE.
9. Aloha menu mapping: ≥ 95% of last-90-day Aloha items mapped to TP Manager menu recipes (remainder surfaced in reconciliation queue).
10. **Every service ships with a `Dockerfile`; `docker-compose.yml` at repo root brings up the full stack (API, ML, Aloha worker, Postgres, MinIO-for-Blob) for local dev in one command; production runs the same Docker images on Azure Container Apps (or an equivalent Docker-image runtime).**

---

**Next pipeline step:** `/quality-gate spec-to-plan` → `/feature-balance-sheet deep` → PO HITL gate → `/plan-gen`.

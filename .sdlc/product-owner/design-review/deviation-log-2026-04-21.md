# TP Manager ↔ PO Design Deviation Log

**Date:** 2026-04-21
**Reference design:** https://recipe-radar-assist.lovable.app/ ("StockChef / Inventory Manager")
**Scope:** 13 PO-provided screens reviewed against current TP Manager implementation.
**Status:** captured; sequencing recommendation at the bottom. No code changes yet.

---

## 0. Overall framing

| | PO design | TP Manager |
|---|---|---|
| Brand | **StockChef / Inventory Manager** — inventory-first product | **TP Manager / Restaurant Ops** — broader ops platform |
| Sidebar groups | 3: Operations · Kitchen · Reports | 5: Overview · Daily Ops · Library · Insights · Admin |
| Reports | AvT Variance / Price Creep / Waste & Loss each at top-level | rolled under single "Reports" tab |
| Settings | under Reports group | Admin group |

The PO design is an **inventory-and-variance-first** product with a strong PAR → auto-order → delivery → count → variance loop. TP Manager is a **broader kitchen-ops** platform that includes inventory. The four themes below account for most deltas:

1. **Per-ingredient PAR levels** (vs. TP's per-recipe ParLevel) — drives auto-orders, the Ingredients "PAR Level" column, and prep-sheet "Below PAR" KPIs.
2. **Zone-centric inventory** (cooler / dry / freezer / bar / prep) — schema already supports it via `LocationKind`; needs UI.
3. **Two-tier waste model** — operational reason *and* attribution bucket (spoilage / prep / comped / theft).
4. **Promote reports to top-level nav** — each report becomes a page with KPI strip + chart + table.

---

## 1. Sidebar item delta

| PO has | TP equivalent | Gap |
|---|---|---|
| Dashboard | Dashboard | ✓ |
| **Inventory Count** | Inventory | name only |
| Ingredients | Ingredients | ✓ |
| Deliveries | Deliveries | ✓ |
| **Order Forms** | Orders | name only |
| Suppliers | Suppliers | ✓ |
| **Prep Items** | (folded into `/recipes?type=prep`) | **missing nav** |
| Daily Prep Sheet | Prep sheet | ✓ |
| Waste Log | Waste log | ✓ |
| **AvT Variance** (top-level) | under /reports | flattened |
| **Price Creep** (top-level) | under /reports | flattened |
| **Waste & Loss** (top-level) | under /reports | flattened |
| *(no Recipes nav)* | **Recipes** (top-level) | TP added this |

The PO intentionally elevates each report to its own nav row and hides "recipes" behind "Prep Items" — kitchen staff think *what do I make today*, not *browse the recipe book*.

---

## 2. Dashboard

**PO:** 4 headline KPIs (**Total Inventory Value $48,290 · Items Tracked 342 · Variance Alerts 7 · Food Cost % 28.4%**), Actual-vs-Theoretical daily bar chart, Weekly Inventory Cost trend, Recent Activity feed, Quick Actions panel.

**Gaps:** Inventory-value KPI and weekly inventory-cost trend not surfaced. Food-cost % is computable from existing AvT plumbing but not a headline number. Quick Actions panel missing.

---

## 3. Inventory Count (biggest single-screen delta)

| PO pattern | TP | Schema supports? |
|---|---|---|
| **Zone tabs** w/ progress (Walk-in Cooler 0/6, Dry Storage 0/3, Bar 0/3, Freezer 0/2, Prep Station 0/2) | flat list, no zones | ✅ `LocationKind` enum already has cold/dry/freezer/bar/prep |
| **Continuous Scan / Visual Count** mode toggle | missing | no |
| **GPS: Verified** stamp on each session | missing | no |
| **−/+ spinner** with qty between | text input | trivial UI |
| **Photo Required** badge on high-value items (proteins) | missing | needs `ingredient.photo_required` flag |
| Always-on counting surface | **Start / Pause / Resume / Complete / Amend** lifecycle | different mental model |

PO model: "walk the cooler, tap items, done." TP model: "open a formal count, lifecycle-managed."

---

## 4. Ingredients

PO columns (in order): **Name · Category · Supplier · Unit Cost · PAR Level · Recipes · ✎ 🗑**
TP columns: Name · UoM · Pack · Category · Allergens · Archive

Missing in TP:
- **Unit Cost** inline (cost exists as history but not on list)
- **PAR Level** per ingredient (TP ParLevel is per-recipe — different concept)
- **Recipes used-in** count (derivable from `RecipeLine`)
- **Supplier** column (`default_supplier_id` exists but not joined in list)
- **Culinary category** colored pills (Proteins/Dairy/Produce/Grains/Spirits/Oils) — TP shows technical `uom_category` which is wrong for this view
- **Filter** chip next to search
- **Edit/Delete icons** per row — TP uses text "Archive" button

---

## 5. Deliveries

| PO | TP |
|---|---|
| **"Scan Invoice"** primary CTA (OCR pipeline) | not present |
| Status pills: Pending / Verified / Disputed | verify |
| Inline warning "⚠ No invoice scanned" | missing |
| **Discrepancy count badge** ("2 discrepancies") | not surfaced |
| "Review" deep-link per delivery | verify |

Invoice OCR is not in spec v1.6. Discrepancy-count surfacing is doable with current data.

---

## 6. Order Forms

| PO | TP |
|---|---|
| **Auto-Generate Orders** from PAR shortfall (primary CTA) | not present — TP has manual orders only |
| Per-supplier grouped order cards | verify |
| Status: draft / sent / confirmed | verify |
| **Send to Supplier / Resend** action (email integration) | not present |

Auto-generation requires per-ingredient PAR (missing). Email-send is integration work.

---

## 7. Suppliers

| PO | TP |
|---|---|
| KPI strip: Active Suppliers · YTD Spend · Avg On-Time · Missed Items | not present |
| **Star rating** (★ 4.8) per supplier | not present |
| Columns: Category · Delivery Days · Cutoff · **On-Time % · Fill Rate %** · YTD Spend · Status · **CSV action** | TP has far fewer columns |
| Category pills: Broadline / Produce / Beverage / Bakery | no supplier category |
| Status pills: Active / Review | partial |

Supplier KPIs require derived rollups; raw data exists (deliveries, PO lines) but no materialized view. Star rating + category are new schema fields.

---

## 8. Prep Items (separate nav from Recipes)

PO columns: **Prep Item · Category (Sauces/Mise en Place/Dressings) · Batch Yield · Ingredients (chip stack with "+2") · Shelf Life (hours) · Storage Temp (°F)**

**Schema gap:** `Recipe` has no `storage_temp_f`, `shelf_life_hours` (shelf life lives on Ingredient in days), or `prep_category`.

---

## 9. Daily Prep Sheet

| PO | TP |
|---|---|
| Date picker + **Recalculate / Submit Sheet** actions | verify |
| KPI cards: **Completion % · Total Suggested · QC Passed · Below PAR** | likely missing |
| Per-row: "On hand 2qt · PAR 8qt · Suggested 6qt" inline | style differs |
| **Make-qty spinner** editable by manager | verify |
| **Assignee dropdown** (Maria G. / Carlos M.) with cook photo | not present |
| Status pills: Pending / In Progress / Complete | verify |
| **QC & Sign** button + **temperature probe reading** ("165°F · Edit") | not present |
| **Start** button gates workflow | verify |

Assignment + QC sign-off + temp-probe are entirely new. §6.4 mentions prep sheet but not cook-assignment/QC flow.

---

## 10. Waste Log

| PO | TP |
|---|---|
| KPI strip: Total Cost · Expiry/Spoilage · **Kitchen Mistakes (red)** · Training | not present |
| **Loss by Reason** horizontal bar with count + % | missing |
| Columns: Time · Item (w/ note) · Qty · **Reason pill (colored)** · **Station** | verify |
| Reasons: Expiry / Server Mistake / Burned/Overcooked / Training / Spoilage | TP has fewer/different |
| "Log Waste" primary CTA with modal | verify |
| "All Reasons" filter dropdown | likely missing |

Station column + training/server-mistake reasons need schema additions.

---

## 11. AvT Variance (top-level)

| PO | TP |
|---|---|
| 3 headline cards: Total Variance Cost · Items Over Threshold · **Formula** (shows "Start + Received − Counted − POS Usage") | not present |
| **Variance by Ingredient** horizontal bar (red shortfall / green surplus / yellow near-zero) | not present |
| Table: Ingredient · Variance % · Cost Impact · **Status pill (Critical/Warning/OK)** | verify |

AvT is currently a sub-tab of /reports; PO promotes it to a full top-level page with chart + tiered status.

---

## 12. Price Creep (top-level)

| PO | TP |
|---|---|
| Alert banner: "3 Items with >5% price increase · Over the last 3 deliveries" | verify |
| **Flagged Items — Price Trend** line chart (one line per flagged ingredient across Del 1 / Del 2 / Del 3) | not present |
| Table: Ingredient · Supplier · Current Price · **Change % (colored)** · Status pill | verify |

---

## 13. Waste & Loss Attribution (top-level — different from Waste Log)

PO has **TWO** waste screens. Waste Log = entry/list. Waste & Loss Attribution = analytics:
- 4 KPI cards by waste *bucket*: **Spoilage · Prep Waste · Comped Meals · Theft (Suspected)**
- **Waste Breakdown donut** by bucket
- Recent Waste Log stream with red "Theft (Suspected)" highlighting

**Big gap:** TP has no *Theft Suspected* or *Comped Meals* waste bucket (only operational reasons). These represent different conceptual categories: "who ate the cost" vs "why did it spoil".

---

## Sequencing recommendation

**In-scope (v1.6-compatible, no product re-approval):**

1. **Ingredient PAR level + supplier + cost on list** (schema: `Ingredient.par_qty` + `par_uom`; API: join default_supplier + latest cost + recipes-count; UI: new columns). *~1 day.* Unlocks 3 PO screens.
2. **Sidebar restructure** to 3 groups + promote AvT/Price-Creep/Waste-&-Loss to top-level. *~2 hours.*
3. **Inventory zone tabs + progress counters** using existing `LocationKind`. *~half day of UI.*
4. **Waste attribution bucket** (new enum on `WasteEntry`) + new Waste & Loss page with donut + bucket KPIs. *~1 day.*
5. **Prep Items library** as its own page (distinct from `/recipes?type=prep`), plus `Recipe.storage_temp_f` + `shelf_life_hours` + `prep_category`. *~1 day.*
6. **Report top-level pages** (AvT, Price Creep) with KPI strip + chart + table — computations largely exist in `prismaReportsRepo`. *~1 day.*

**Out-of-scope — needs product re-approval:**

- Invoice OCR (delivery scan)
- GPS verification on counts
- Assignee + QC sign-off + temp-probe on prep sheet
- Email-send integration for orders
- Photo-Required high-value-item flow
- Supplier star rating + auto-computed on-time/fill-rate
- Continuous Scan mode (barcode pipeline)

## Open questions for the PO

1. Is TP's recipe-book feature still in scope, or does PO intend it to be *implicit* through Prep Items + menu management elsewhere?
2. Should PAR live on ingredient, recipe, or both? PO design implies ingredient; TP schema has recipe-only.
3. Waste "attribution bucket" (theft/comped/spoilage/prep) — is this meant to replace the operational reason, or live alongside it?
4. Is the "StockChef" branding the actual product name, or a placeholder in the PO mock?

# Spec Amendment v1.7 — PO Design Alignment

**Date:** 2026-04-21
**Supersedes header of:** `spec.md` (was v1.6 → now v1.7)
**Reason:** PO shared a 13-screen reference design (StockChef / Inventory Manager) at https://recipe-radar-assist.lovable.app/. PO directed "build everything in the design" — amending the v1.6 contract to capture the new in-scope features before they get built. Gap analysis lives at `.sdlc/product-owner/design-review/deviation-log-2026-04-21.md`.

## Scope summary (what v1.7 adds to v1.6)

1. **Per-ingredient PAR** (new field set; recipe-derived PAR remains as fallback).
2. **Zone-centric inventory** UI backed by existing `LocationKind`.
3. **Two-dimensional waste taxonomy** — operational `reason` kept, new mandatory `attribution_bucket` added.
4. **Invoice OCR** on deliveries — rapidocr-onnxruntime on ML service; worker consumer.
5. **GPS verification** on inventory counts.
6. **Photo-required flag** on high-value ingredients; counts enforce photo on those rows.
7. **Continuous-scan mode** on inventory counts (html5-qrcode barcode reader).
8. **Supplier KPIs** — on-time %, fill-rate %, YTD spend, missed items — plus `category`, `star_rating`, `delivery_days`, `cutoff_time`, `status`.
9. **Prep QC sign-off + temp-probe** on prep sheet rows; **assignee** dropdown.
10. **Prep Items library** as a first-class nav (distinct from the recipe book).
11. **Reports promoted to top-level nav** — AvT Variance, Price Creep, Waste & Loss Attribution each a dedicated page with KPI strip → chart → table.
12. **Auto-generate orders** from PAR shortfall, one draft per supplier.
13. **Order email send** via nodemailer, gated on `SMTP_HOST` env var.
14. **Dashboard** gets Inventory Value, Items Tracked, Variance Alerts, Food Cost % KPIs + AvT daily + Weekly Inventory Cost charts + Quick Actions.
15. **Waste Attribution donut + bucket KPIs** and a two-dimensional log UI.

## Module count delta

v1.6 = 21 modules. v1.7 = 21 modules (no new top-level module; existing modules gain ACs).

## Acceptance Criteria additions

### §6.1 Ingredients (extends v1.6 AC)

- **AC-6.1.7** Ingredient persists `par_qty` (Decimal 18,6) + `par_uom`; NULL means "use recipe-derived PAR" (v1.6 behaviour).
- **AC-6.1.8** Ingredient persists `culinary_category` enum (proteins, dairy, produce, grains, spirits, oils, condiments, beverage, bakery, other). Rendered as colored pill in list.
- **AC-6.1.9** Ingredient persists `photo_required` Boolean, default false. When true, inventory-count rows for this ingredient show a "Photo Required" badge and cannot be marked complete without a photo upload.
- **AC-6.1.10** Ingredient persists `supplier_sku` (string, nullable) for cross-ref with supplier catalog.
- **AC-6.1.11** `GET /api/v1/ingredients` returns `supplier_name`, `supplier_id`, `latest_unit_cost_cents`, `recipes_using_count` joined inline.
- **AC-6.1.12** List filter supports `culinary_category` and `below_par=true` query params.

### §6.3 Suppliers (extends v1.6 AC)

- **AC-6.3.5** Supplier persists `category` (broadline / produce / beverage / bakery / dairy / specialty / other).
- **AC-6.3.6** Supplier persists `star_rating` (Decimal 3,2; 0.00–5.00).
- **AC-6.3.7** Supplier persists `delivery_days` (int array, 0–6 = Sun–Sat) and `cutoff_time` (HH:mm local).
- **AC-6.3.8** Supplier persists `status` enum (active / review / inactive), default active.
- **AC-6.3.9** `GET /api/v1/suppliers/kpis` returns per-supplier on-time %, fill-rate %, YTD spend, missed-items count, plus restaurant aggregates (active supplier count, total YTD spend, avg on-time, total missed).
- **AC-6.3.10** On-time % = `count(Delivery.received_on ≤ expected_date) / count(Delivery)` over last 180 days. Fill-rate % = `sum(DeliveryLine.qty_received) / sum(OrderLine.qty_ordered)` over last 180 days.

### §6.4 Inventory counts (extends v1.6 AC)

- **AC-6.4.9** Count UI groups ingredients by `Location.kind` (cooler / dry / freezer / bar / prep) via `ZoneTabs`, showing `{counted}/{total}` progress per zone.
- **AC-6.4.10** On first row interaction, client calls `navigator.geolocation.getCurrentPosition` and POSTs lat/lng + captured_at to the count (`InventoryCount.gps_lat`, `gps_lng`, `gps_captured_at`). Denial renders "⚠ GPS unavailable" non-blocking.
- **AC-6.4.11** Each count line can persist `photo_url` (MinIO). Rows where `ingredient.photo_required=true` require a photo before `Complete` is enabled.
- **AC-6.4.12** Header mode toggle `[Continuous Scan] [Visual Count]`. Continuous Scan uses html5-qrcode camera stream → matches ingredient by `supplier_sku` or barcode field → auto-focuses row. Permission denial falls back to Visual Count mode.
- **AC-6.4.13** Count surface is always-open for today's date; explicit Start/Pause/Resume/Complete lifecycle preserved for amendment flows but not the primary entry path.

### §6.5 Deliveries (extends v1.6 AC)

- **AC-6.5.7** `POST /api/v1/deliveries/:id/scan` accepts multipart invoice image or PDF, stores to MinIO as `invoice_scan_url`, sets `ocr_status='processing'`.
- **AC-6.5.8** Aloha-worker polls `ocr_status='processing'` deliveries, calls ML `/v1/ocr/invoice`, parses line-items into `ocr_extracted_lines_json`, flips status to `parsed` or `failed`.
- **AC-6.5.9** Delivery status pill: `pending` / `verified` / `disputed`. Cards show scan thumbnail or "⚠ No invoice scanned".
- **AC-6.5.10** On verify, `discrepancy_count` denormalised from dispute array. List renders badge when >0.
- **AC-6.5.11** OCR accuracy is not blocking: owner can manually override any parsed line during review.

### §6.6 Orders (extends v1.6 AC)

- **AC-6.6.5** `POST /api/v1/orders/auto-generate` builds one draft Order per supplier from current PAR shortfalls. Prefers `Ingredient.par_qty` when set; falls back to recipe-derived PAR.
- **AC-6.6.6** Order cards grouped by supplier; status pill (draft / sent / confirmed / cancelled).
- **AC-6.6.7** `POST /api/v1/orders/:id/send` sends email via nodemailer using supplier.email (cc: owner) **only when `SMTP_HOST` env var is set**. If unset, logs to stdout for dev.

### §6.7 Waste (extends v1.6 AC)

- **AC-6.7.4** WasteEntry requires `attribution_bucket` (spoilage / prep_waste / comped_meals / theft_suspected). Existing rows backfilled by deterministic reason→bucket map (default `spoilage`).
- **AC-6.7.5** WasteEntry persists optional `station_code`.
- **AC-6.7.6** `GET /api/v1/waste/by-bucket?since=&until=` returns totals and by-bucket breakdown for the donut.
- **AC-6.7.7** `GET /api/v1/reports/waste-loss` returns KPI strip (Spoilage, Prep Waste, Comped Meals, Theft Suspected totals), bucket donut data, and recent-waste stream with `theft_suspected` highlighted.

### §6.8 Prep sheet (extends v1.6 AC)

- **AC-6.8.6** PrepSheetRow persists `assigned_to_user_id`, `started_at`, `qc_signed_by_user_id`, `qc_signed_at`, `temp_f` (Decimal 6,2).
- **AC-6.8.7** `PATCH /api/v1/prep/rows/:id` accepts `assigned_to_user_id` + `temp_f`.
- **AC-6.8.8** `POST /api/v1/prep/rows/:id/start` sets `started_at` (row becomes in_progress).
- **AC-6.8.9** `POST /api/v1/prep/rows/:id/qc-sign` requires `temp_f` if the recipe's version has `storage_temp_f` set; sets `qc_signed_by_user_id` + `qc_signed_at`.
- **AC-6.8.10** Sheet KPI strip: Completion % · Total Suggested · QC Passed · Below PAR.

### §6.9 Prep Items (new — distinct nav from Recipes)

- **AC-6.9.1** `/prep/items` lists recipes where `type='prep'`.
- **AC-6.9.2** Columns: Prep Item · Category (PrepCategory pill) · Batch Yield · Ingredients (chip stack with "+N" overflow) · Shelf Life (hours) · Storage Temp (°F).
- **AC-6.9.3** Recipe persists `prep_category` (sauces / mise_en_place / dressings / marinades / stocks / doughs_batters / proteins_cooked / vegetables_prepped / other).
- **AC-6.9.4** RecipeVersion persists `storage_temp_f` (Decimal 6,2) and `shelf_life_hours` (Int) alongside existing Ingredient-level `shelf_life_days`.

### §6.12 Reports (extends v1.6 AC — split into 3 top-level pages)

- **AC-6.12.4** `/reports/avt` page: KPI strip (Total Variance Cost, Items Over Threshold, Formula card) → HorizontalBarChart (variance by ingredient) → table with status pills. Row status = critical (|variance| >10%), warning (5–10%), ok (<5%).
- **AC-6.12.5** `/reports/price-creep` page: alert banner (flagged items over last 3 deliveries) → LineChart (per-ingredient price trend, last 3 deliveries) → table with colored change-% column.
- **AC-6.12.6** `/reports/waste-loss` page: 4 bucket KPI cards → DonutChart (waste by bucket) → recent stream with bucket pills.
- **AC-6.12.7** `/reports` becomes a hub linking to the three pages plus existing Forecast Accuracy / Forecast Overrides / Settings.

### §6.13 Dashboard (extends v1.6 AC)

- **AC-6.13.2** 4-card KPI strip: Total Inventory Value · Items Tracked · Variance Alerts · Food Cost %. Food Cost % = `sum(actual_cost_cents) / sum(item_sales_cents)` trailing 30 days (`GET /api/v1/reports/food-cost-pct`).
- **AC-6.13.3** Two-column chart row: Actual-vs-Theoretical daily VerticalBarChart (Mon–Sun) + Weekly Inventory Cost LineChart (`GET /api/v1/reports/inventory-cost-weekly`).
- **AC-6.13.4** Recent Activity feed (audit stream, last 10 events) + Quick Actions panel (New count · Log waste · Scan invoice · New order).

## Non-functional additions

- **NFR-1.5** OCR latency: parsed within 30 s of upload for a typical A4 invoice. Timeout flips `ocr_status='failed'` at 120 s.
- **NFR-1.6** GPS capture is non-blocking. If user denies or times out (5 s), count proceeds without GPS; `gps_captured_at` stays NULL.
- **NFR-1.7** Email send is gated on `SMTP_HOST`. Never auto-send in dev.

## Data-model additions (pointer to schema)

Delivered in migration `0006_po_design_alignment`. See `apps/api/prisma/schema.prisma` for authoritative definitions. New enums: `CulinaryCategory`, `SupplierCategory`, `SupplierStatus`, `WasteAttributionBucket`, `PrepCategory`. Column additions enumerated in plan file `recursive-whistling-crane.md` Wave 1.

## Out of scope for v1.7 (clarified)

- Rebrand to "StockChef" — PO clarified the name in the mock is a placeholder; TP Manager brand stays.
- Native mobile app.
- Offline inventory counts.
- Historical backfill of supplier on-time/fill-rate beyond existing Delivery rows.

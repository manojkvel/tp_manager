# TP Manager — Data Dictionary (v1.6)

> **Source:** Prisma schema at `apps/api/prisma/schema.prisma`.
> **Conventions:** Money stored as integer cents. Quantities stored as Decimal(18,6). Timestamps in UTC. All row-scoped entities carry `restaurant_id` (DEC-012).

## Identity & Access

| Entity | Key columns | Notes |
|---|---|---|
| User | id, email, role | argon2 password hash. Roles: owner / manager / staff. |
| RefreshToken | id, user_id, token_hash, expires_at, revoked_at | AD-6 rotation + reuse detection. |
| Restaurant | id, name, timezone | Multi-tenant boundary. |

## Menu, Recipes, Conversions

| Entity | Key columns | Notes |
|---|---|---|
| Ingredient | id, restaurant_id, name, category, default_supplier_id, is_archived | Soft-archive only (§6.1 AC-4). |
| IngredientCost | id, ingredient_id, unit_cost_cents, effective_from, source | Append-only history. |
| Supplier | id, restaurant_id, name, lead_time_days, min_order_cents, order_cadence | |
| SupplierIngredient | id, supplier_id, ingredient_id, unit_cost_cents, pack_size, is_preferred | Ranked offers (§6.2). |
| Recipe | id, restaurant_id, recipe_type, station, yield_qty, yield_uom | prep vs menu (§6.3). |
| RecipeVersion | id, recipe_id, version_num, plated_cost_cents, is_current | Append-only; cost-pin (DEC-014). |
| RecipeLine | id, recipe_version_id, ref_type, ingredient_id / sub_recipe_id / utensil_id, qty, uom | Nested BOM (§6.3 AC-4/5). |
| Utensil | id, restaurant_id, kind, name, ml_equivalent | §6.3a. |
| UtensilEquivalence | id, utensil_id, ingredient_id, qty, uom, source=default/override | §6.3a AC-3. |

## Operations

| Entity | Key columns | Notes |
|---|---|---|
| PrepSheet / PrepRun | id, restaurant_id, business_date, recipe_version_id, qty_target, qty_actual, prepared_on, expires_on | §6.4. |
| InventoryCount / InventoryCountLine | id, restaurant_id, location_id, status (in_progress/completed), resumed_from_id | §6.5. |
| Delivery / DeliveryLine | id, restaurant_id, supplier_id, status (pending/verified/disputed) | §6.6; verified → append IngredientCost row. |
| Order / OrderLine | id, restaurant_id, supplier_id, status (draft/sent/received), pack_size, unit_cost_cents | §6.7. |
| WasteEntry | id, restaurant_id, ref_type (ingredient/prep/menu), qty, unit_cost_cents_pinned, value_cents, reason_id, photo_url | §6.8; cost pinned at log time. |
| ParLevel | id, restaurant_id, ingredient_id, day_of_week, qty | §6.11. |
| WasteReason / Location | id, restaurant_id, label / kind | §6.11. |

## POS + Aloha

| Entity | Key columns | Notes |
|---|---|---|
| AlohaImportRun | id, restaurant_id, business_date, source, status (ok/failed/partial), rows_ingested | §6.12a; re-import replaces the day. |
| PosSale | id, import_run_id, restaurant_id, business_date, aloha_item_name, row_kind (item/modifier/stockout_86/cover/unclassified), qty, item_sales_cents | §6.12a AC-3, CHECK constraint at DB. |
| AlohaMenuMap / AlohaModifierMap | id, restaurant_id, aloha_*_name, recipe_id / ingredient_id, effective_from/until | Time-sliced mapping (§6.12a AC-5). |
| StockoutEvent | id, restaurant_id, business_date, aloha_marker_name, count, mapped | §6.12a "86" markers. |
| CoverCount | id, restaurant_id, business_date, covers | Per-day guest count. |
| AlohaReconciliationQueue | id, restaurant_id, aloha_item_name, row_kind, occurrences, resolved | Queue for unmapped items. |

## Migration Review

| Entity | Key columns | Notes |
|---|---|---|
| StagedMigrationBatch | id, source_file, parser_version, staged_at, status (staged/approved/rolled_back) | §6.14 AC-4. |
| StagedMigrationItem | id, batch_id, kind, payload (JSON), bucket (new/matched/ambiguous/unmapped), matches (JSON), decision, decision_target_id | Per-row review state. |

## ML

| Entity | Key columns | Notes |
|---|---|---|
| ForecastModel | id, restaurant_id, entity_type, entity_id, algorithm (seasonal_naive/holt_winters/cold_start), holdout_mape, artefact_ref, trained_at | AD-8 hot-reload via NOTIFY. |
| ForecastPrediction | id, model_id, target_date, point, p10, p90, top_drivers_json | §6.12b AC-1/6. |

## Audit

All audited tables emit row-level INSERT/UPDATE/DELETE to `audit_log` via trigger (AD-5, migration 0002).

| Entity | Key columns |
|---|---|
| AuditLog | id, table_name, row_id, op, user_id, changed_at, before (JSON), after (JSON) |

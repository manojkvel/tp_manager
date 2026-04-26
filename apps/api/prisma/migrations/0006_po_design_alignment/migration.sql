-- Spec v1.7 — PO design alignment. Single forward-only migration adding:
--   - 5 new enums (CulinaryCategory, SupplierCategory, SupplierStatus,
--     WasteAttributionBucket, PrepCategory)
--   - Per-ingredient PAR + culinary category + photo_required + supplier_sku
--   - Supplier KPI fields (category, star_rating, delivery_days, cutoff_time,
--     status)
--   - Recipe prep_category + RecipeVersion storage_temp_f / shelf_life_hours
--   - WasteEntry attribution_bucket (NOT NULL, backfilled from reason→bucket
--     map; default spoilage) + station_code
--   - PrepSheetRow assigned_to_user_id / qc_signed_by_user_id / qc_signed_at /
--     temp_f
--   - InventoryCount gps_lat/lng/captured_at
--   - InventoryCountLine photo_url
--   - Delivery invoice_scan_url / ocr_status / discrepancy_count
--
-- No destructive changes. Every new column nullable (except WasteEntry.
-- attribution_bucket which is backfilled before NOT NULL is enforced).

-- ─── Enums ──────────────────────────────────────────────────────────────────
CREATE TYPE "CulinaryCategory" AS ENUM (
    'proteins', 'dairy', 'produce', 'grains', 'spirits',
    'oils', 'condiments', 'beverage', 'bakery', 'other'
);

CREATE TYPE "SupplierCategory" AS ENUM (
    'broadline', 'produce', 'beverage', 'bakery', 'dairy', 'specialty', 'other'
);

CREATE TYPE "SupplierStatus" AS ENUM ('active', 'review', 'inactive');

CREATE TYPE "WasteAttributionBucket" AS ENUM (
    'spoilage', 'prep_waste', 'comped_meals', 'theft_suspected'
);

CREATE TYPE "PrepCategory" AS ENUM (
    'sauces', 'mise_en_place', 'dressings', 'marinades', 'stocks',
    'doughs_batters', 'proteins_cooked', 'vegetables_prepped', 'other'
);

-- ─── Ingredient ─────────────────────────────────────────────────────────────
ALTER TABLE "ingredient"
    ADD COLUMN "par_qty"            DECIMAL(18,6),
    ADD COLUMN "par_uom"             TEXT,
    ADD COLUMN "culinary_category"  "CulinaryCategory",
    ADD COLUMN "photo_required"     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "supplier_sku"       TEXT;

CREATE INDEX "ingredient_culinary_category_idx"
    ON "ingredient" ("restaurant_id", "culinary_category");

-- ─── Supplier ───────────────────────────────────────────────────────────────
ALTER TABLE "supplier"
    ADD COLUMN "category"       "SupplierCategory",
    ADD COLUMN "star_rating"    DECIMAL(3,2),
    ADD COLUMN "delivery_days"  INT[] NOT NULL DEFAULT '{}',
    ADD COLUMN "cutoff_time"    TEXT,
    ADD COLUMN "status"         "SupplierStatus" NOT NULL DEFAULT 'active';

-- ─── Recipe / RecipeVersion ─────────────────────────────────────────────────
ALTER TABLE "recipe"
    ADD COLUMN "prep_category" "PrepCategory";

ALTER TABLE "recipe_version"
    ADD COLUMN "storage_temp_f"    DECIMAL(6,2),
    ADD COLUMN "shelf_life_hours"  INT;

-- ─── WasteEntry ─────────────────────────────────────────────────────────────
-- Step 1: add nullable with default, so we can backfill via reason code map.
ALTER TABLE "waste_entry"
    ADD COLUMN "attribution_bucket" "WasteAttributionBucket",
    ADD COLUMN "station_code"       TEXT;

-- Step 2: backfill from reason.code using a deterministic mapping. Unmatched
-- codes fall back to 'spoilage' (the conservative default for v1.6 data).
UPDATE "waste_entry" we
SET "attribution_bucket" = CASE
    WHEN wr.code IN ('expiry', 'spoilage', 'contamination') THEN 'spoilage'::"WasteAttributionBucket"
    WHEN wr.code IN ('burned', 'overcooked', 'prep_mistake', 'server_mistake', 'training') THEN 'prep_waste'::"WasteAttributionBucket"
    WHEN wr.code IN ('comped', 'comp', 'remake') THEN 'comped_meals'::"WasteAttributionBucket"
    WHEN wr.code IN ('theft', 'shrinkage') THEN 'theft_suspected'::"WasteAttributionBucket"
    ELSE 'spoilage'::"WasteAttributionBucket"
END
FROM "waste_reason" wr
WHERE we.reason_id = wr.id;

-- Step 3: enforce NOT NULL.
ALTER TABLE "waste_entry"
    ALTER COLUMN "attribution_bucket" SET NOT NULL;

CREATE INDEX "waste_entry_attribution_bucket_idx"
    ON "waste_entry" ("restaurant_id", "attribution_bucket", "at");

-- ─── PrepSheetRow ───────────────────────────────────────────────────────────
ALTER TABLE "prep_sheet_row"
    ADD COLUMN "assigned_to_user_id"    UUID,
    ADD COLUMN "qc_signed_by_user_id"   UUID,
    ADD COLUMN "qc_signed_at"           TIMESTAMPTZ(3),
    ADD COLUMN "temp_f"                 DECIMAL(6,2);

-- ─── InventoryCount / InventoryCountLine ────────────────────────────────────
ALTER TABLE "inventory_count"
    ADD COLUMN "gps_lat"           DECIMAL(10,7),
    ADD COLUMN "gps_lng"           DECIMAL(10,7),
    ADD COLUMN "gps_captured_at"   TIMESTAMPTZ(3);

ALTER TABLE "inventory_count_line"
    ADD COLUMN "photo_url" TEXT;

CREATE INDEX "inventory_count_line_location_idx"
    ON "inventory_count_line" ("count_id", "location_id");

-- ─── Delivery ───────────────────────────────────────────────────────────────
ALTER TABLE "delivery"
    ADD COLUMN "invoice_scan_url"     TEXT,
    ADD COLUMN "ocr_status"           TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN "ocr_extracted_lines_json" JSONB,
    ADD COLUMN "discrepancy_count"    INT NOT NULL DEFAULT 0;

-- OCR status is free-form text (none | processing | parsed | failed) by
-- design — keeps worker/ML service free to add new values without a schema
-- migration. Enforce via application-layer validation.

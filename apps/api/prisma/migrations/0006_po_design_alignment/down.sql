-- Reverse of 0006_po_design_alignment. Destructive on any data written since
-- this migration applied — reason we ship a functional down purely for
-- local-dev reset, not for prod rollback.

ALTER TABLE "delivery"
    DROP COLUMN IF EXISTS "discrepancy_count",
    DROP COLUMN IF EXISTS "ocr_extracted_lines_json",
    DROP COLUMN IF EXISTS "ocr_status",
    DROP COLUMN IF EXISTS "invoice_scan_url";

DROP INDEX IF EXISTS "inventory_count_line_location_idx";
ALTER TABLE "inventory_count_line" DROP COLUMN IF EXISTS "photo_url";

ALTER TABLE "inventory_count"
    DROP COLUMN IF EXISTS "gps_captured_at",
    DROP COLUMN IF EXISTS "gps_lng",
    DROP COLUMN IF EXISTS "gps_lat";

ALTER TABLE "prep_sheet_row"
    DROP COLUMN IF EXISTS "temp_f",
    DROP COLUMN IF EXISTS "qc_signed_at",
    DROP COLUMN IF EXISTS "qc_signed_by_user_id",
    DROP COLUMN IF EXISTS "assigned_to_user_id";

DROP INDEX IF EXISTS "waste_entry_attribution_bucket_idx";
ALTER TABLE "waste_entry"
    DROP COLUMN IF EXISTS "station_code",
    DROP COLUMN IF EXISTS "attribution_bucket";

ALTER TABLE "recipe_version"
    DROP COLUMN IF EXISTS "shelf_life_hours",
    DROP COLUMN IF EXISTS "storage_temp_f";

ALTER TABLE "recipe" DROP COLUMN IF EXISTS "prep_category";

ALTER TABLE "supplier"
    DROP COLUMN IF EXISTS "status",
    DROP COLUMN IF EXISTS "cutoff_time",
    DROP COLUMN IF EXISTS "delivery_days",
    DROP COLUMN IF EXISTS "star_rating",
    DROP COLUMN IF EXISTS "category";

DROP INDEX IF EXISTS "ingredient_culinary_category_idx";
ALTER TABLE "ingredient"
    DROP COLUMN IF EXISTS "supplier_sku",
    DROP COLUMN IF EXISTS "photo_required",
    DROP COLUMN IF EXISTS "culinary_category",
    DROP COLUMN IF EXISTS "par_uom",
    DROP COLUMN IF EXISTS "par_qty";

DROP TYPE IF EXISTS "PrepCategory";
DROP TYPE IF EXISTS "WasteAttributionBucket";
DROP TYPE IF EXISTS "SupplierStatus";
DROP TYPE IF EXISTS "SupplierCategory";
DROP TYPE IF EXISTS "CulinaryCategory";

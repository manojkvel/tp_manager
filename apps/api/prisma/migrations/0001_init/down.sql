-- Rollback for 0001_init (TASK-019). Drops every object created by `migration.sql`.
-- Runs inside a transaction so a failure anywhere leaves the DB intact.

BEGIN;

DROP VIEW IF EXISTS recipe_current_version;

DROP TABLE IF EXISTS feature_flag_value CASCADE;
DROP TABLE IF EXISTS feature_flag CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;

DROP TABLE IF EXISTS forecast_override CASCADE;
DROP TABLE IF EXISTS forecast_prediction CASCADE;
DROP TABLE IF EXISTS forecast_model CASCADE;

DROP TABLE IF EXISTS aloha_reconciliation_queue CASCADE;
DROP TABLE IF EXISTS cover_count CASCADE;
DROP TABLE IF EXISTS stockout_event CASCADE;
DROP TABLE IF EXISTS aloha_modifier_map CASCADE;
DROP TABLE IF EXISTS aloha_menu_map CASCADE;
DROP TABLE IF EXISTS pos_sale CASCADE;
DROP TABLE IF EXISTS aloha_import_run CASCADE;

DROP TABLE IF EXISTS waste_entry CASCADE;
DROP TABLE IF EXISTS delivery_line CASCADE;
DROP TABLE IF EXISTS delivery CASCADE;
DROP TABLE IF EXISTS order_line CASCADE;
DROP TABLE IF EXISTS purchase_order CASCADE;
DROP TABLE IF EXISTS inventory_count_line CASCADE;
DROP TABLE IF EXISTS inventory_count CASCADE;
DROP TABLE IF EXISTS par_level CASCADE;
DROP TABLE IF EXISTS prep_sheet_row CASCADE;
DROP TABLE IF EXISTS prep_sheet CASCADE;
DROP TABLE IF EXISTS prep_run CASCADE;

DROP TABLE IF EXISTS recipe_line CASCADE;
DROP TABLE IF EXISTS recipe_version CASCADE;
DROP TABLE IF EXISTS recipe CASCADE;

DROP TABLE IF EXISTS supplier_ingredient CASCADE;
DROP TABLE IF EXISTS ingredient_cost CASCADE;
DROP TABLE IF EXISTS utensil_equivalence CASCADE;
DROP TABLE IF EXISTS ingredient CASCADE;
DROP TABLE IF EXISTS supplier CASCADE;

DROP TABLE IF EXISTS waste_reason CASCADE;
DROP TABLE IF EXISTS portion_utensil CASCADE;
DROP TABLE IF EXISTS location CASCADE;
DROP TABLE IF EXISTS refresh_token CASCADE;
DROP TABLE IF EXISTS user_account CASCADE;
DROP TABLE IF EXISTS restaurant CASCADE;

DROP TYPE IF EXISTS "ForecastEntityType";
DROP TYPE IF EXISTS "PosRowKind";
DROP TYPE IF EXISTS "AlohaImportStatus";
DROP TYPE IF EXISTS "AlohaImportSource";
DROP TYPE IF EXISTS "WasteRefType";
DROP TYPE IF EXISTS "OrderStatus";
DROP TYPE IF EXISTS "DeliveryStatus";
DROP TYPE IF EXISTS "InventoryCountStatus";
DROP TYPE IF EXISTS "PrepSheetRowStatus";
DROP TYPE IF EXISTS "RecipeLineRefType";
DROP TYPE IF EXISTS "Station";
DROP TYPE IF EXISTS "RecipeType";
DROP TYPE IF EXISTS "CostSource";
DROP TYPE IF EXISTS "EquivalenceSource";
DROP TYPE IF EXISTS "UtensilKind";
DROP TYPE IF EXISTS "LocationKind";
DROP TYPE IF EXISTS "Role";
DROP TYPE IF EXISTS "UomCategory";

COMMIT;

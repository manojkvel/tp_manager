-- Rollback for 0002_audit_triggers (TASK-021). Drops every trigger the
-- migration created and the shared trigger function. Runs inside a transaction.

BEGIN;

DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'user_account', 'location', 'portion_utensil', 'waste_reason', 'par_level',
        'supplier', 'ingredient', 'recipe', 'prep_sheet', 'inventory_count',
        'purchase_order', 'delivery', 'waste_entry',
        'aloha_import_run', 'pos_sale', 'aloha_menu_map', 'aloha_modifier_map',
        'stockout_event', 'cover_count', 'aloha_reconciliation_queue',
        'forecast_model', 'forecast_override',
        'ingredient_cost', 'recipe_version', 'recipe_line',
        'prep_run', 'prep_sheet_row', 'inventory_count_line',
        'delivery_line', 'order_line'
    ]) LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I_audit ON %I', t, t);
    END LOOP;
END $$;

DROP FUNCTION IF EXISTS tp_audit_fn();

COMMIT;

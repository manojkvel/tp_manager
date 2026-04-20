-- TASK-021 — row-level audit triggers (AD-5).
-- Intent: every INSERT / UPDATE / DELETE on an audited table writes a JSON
-- before/after row to `audit_log`. App-layer hooks are bypassable by backfill
-- SQL and ops scripts; the trigger is not.
--
-- Reversible via ./down.sql.

BEGIN;

-- ─── trigger function ────────────────────────────────────────────────────────
-- `tp_audit_fn()` is table-agnostic: it reads `restaurant_id` from NEW/OLD when
-- the column exists (TG_ARGV[0] = 'has_restaurant_id' | 'no_restaurant_id').
-- The trigger is attached with `CREATE TRIGGER ... FOR EACH ROW EXECUTE
-- FUNCTION tp_audit_fn('has_restaurant_id')`. The template (below) keeps the
-- wiring uniform.
CREATE OR REPLACE FUNCTION tp_audit_fn() RETURNS TRIGGER AS $$
DECLARE
    has_rest_id BOOLEAN := COALESCE(TG_ARGV[0], 'has_restaurant_id') = 'has_restaurant_id';
    rest_id     UUID;
    ent_id      TEXT;
    before_val  JSONB;
    after_val   JSONB;
    action      TEXT;
    session_user_id UUID;
BEGIN
    IF TG_OP = 'INSERT' THEN
        action     := 'insert';
        before_val := NULL;
        after_val  := to_jsonb(NEW);
        ent_id     := NEW.id::text;
        IF has_rest_id THEN rest_id := (to_jsonb(NEW) ->> 'restaurant_id')::uuid; END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        action     := 'update';
        before_val := to_jsonb(OLD);
        after_val  := to_jsonb(NEW);
        ent_id     := NEW.id::text;
        IF has_rest_id THEN rest_id := (to_jsonb(NEW) ->> 'restaurant_id')::uuid; END IF;
    ELSIF TG_OP = 'DELETE' THEN
        action     := 'delete';
        before_val := to_jsonb(OLD);
        after_val  := NULL;
        ent_id     := OLD.id::text;
        IF has_rest_id THEN rest_id := (to_jsonb(OLD) ->> 'restaurant_id')::uuid; END IF;
    END IF;

    -- Correlation: the app sets `SET LOCAL "app.user_id" = '<uuid>'` at the
    -- start of each request so the trigger can stamp the acting user. Backfill
    -- scripts leave it NULL; that is the *correct* signal that the row was
    -- changed outside a user session.
    BEGIN
        session_user_id := current_setting('app.user_id', true)::uuid;
    EXCEPTION WHEN OTHERS THEN
        session_user_id := NULL;
    END;

    INSERT INTO audit_log (restaurant_id, user_id, entity, entity_id, before, after, action)
    VALUES (rest_id, session_user_id, TG_TABLE_NAME, ent_id, before_val, after_val, action);

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

-- ─── trigger application ─────────────────────────────────────────────────────
-- Applied to every entity that carries business-meaningful state — the food-
-- safety and financial-integrity tables. Pure join-tables (supplier_ingredient,
-- utensil_equivalence) and transient caches (refresh_token, feature_flag_value)
-- are excluded to keep the log readable; their state is reconstructible from
-- the edges they reference.
--
-- Each `DO ... EXECUTE` is identical shape; an auto-generator would lift this
-- into metadata, but the list is small enough that explicit SQL stays readable
-- and reviewable.

-- Tables WITH restaurant_id:
DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'user_account',
        'location',
        'portion_utensil',
        'waste_reason',
        'par_level',
        'supplier',
        'ingredient',
        'recipe',
        'prep_sheet',
        'inventory_count',
        'purchase_order',
        'delivery',
        'waste_entry',
        'aloha_import_run',
        'pos_sale',
        'aloha_menu_map',
        'aloha_modifier_map',
        'stockout_event',
        'cover_count',
        'aloha_reconciliation_queue',
        'forecast_model',
        'forecast_override'
    ]) LOOP
        EXECUTE format(
            'CREATE TRIGGER %I_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION tp_audit_fn(%L)',
            t, t, 'has_restaurant_id'
        );
    END LOOP;
END $$;

-- Tables WITHOUT restaurant_id (audit still captured; rest_id stays NULL):
DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'ingredient_cost',
        'recipe_version',
        'recipe_line',
        'prep_run',
        'prep_sheet_row',
        'inventory_count_line',
        'delivery_line',
        'order_line'
    ]) LOOP
        EXECUTE format(
            'CREATE TRIGGER %I_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION tp_audit_fn(%L)',
            t, t, 'no_restaurant_id'
        );
    END LOOP;
END $$;

COMMIT;

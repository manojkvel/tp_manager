-- TP Manager — initial schema (TASK-019 / Wave 2)
-- Reversible via ./down.sql.
-- Mirrors apps/api/prisma/schema.prisma. Keep the two in sync until we adopt
-- `prisma migrate` in a container (post-Wave 2). `restaurant_id` is present on
-- every row-scoped table from day one (DEC-012) so a future multi-tenant move
-- is a row-scoping change, not a schema rewrite.

BEGIN;

-- ─── extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── enums ───────────────────────────────────────────────────────────────────
CREATE TYPE "UomCategory"          AS ENUM ('weight', 'volume', 'count');
CREATE TYPE "Role"                 AS ENUM ('owner', 'manager', 'staff');
CREATE TYPE "LocationKind"         AS ENUM ('dry', 'cold', 'freezer', 'bar', 'prep');
CREATE TYPE "UtensilKind"          AS ENUM ('scoop', 'ladle', 'bag', 'spoon', 'cap');
CREATE TYPE "EquivalenceSource"    AS ENUM ('default', 'override');
CREATE TYPE "CostSource"           AS ENUM ('delivery', 'manual', 'migration');
CREATE TYPE "RecipeType"           AS ENUM ('prep', 'menu');
CREATE TYPE "Station"              AS ENUM ('lunch', 'breakfast', 'expo', 'egg', 'bar', 'bakery');
CREATE TYPE "RecipeLineRefType"    AS ENUM ('ingredient', 'recipe');
CREATE TYPE "PrepSheetRowStatus"   AS ENUM ('pending', 'in_progress', 'complete', 'skipped');
CREATE TYPE "InventoryCountStatus" AS ENUM ('open', 'paused', 'completed', 'amended');
CREATE TYPE "DeliveryStatus"       AS ENUM ('pending', 'verified', 'disputed');
CREATE TYPE "OrderStatus"          AS ENUM ('draft', 'sent', 'received');
CREATE TYPE "WasteRefType"         AS ENUM ('ingredient', 'prep');
CREATE TYPE "AlohaImportSource"    AS ENUM ('sftp', 'api', 'middleware', 'manual_upload');
CREATE TYPE "AlohaImportStatus"    AS ENUM ('ok', 'failed', 'partial');
CREATE TYPE "PosRowKind"           AS ENUM ('item', 'modifier', 'stockout_86', 'cover', 'unclassified');
CREATE TYPE "ForecastEntityType"   AS ENUM ('ingredient', 'prep');

-- ─── tenant root ─────────────────────────────────────────────────────────────
CREATE TABLE restaurant (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    timezone        TEXT NOT NULL DEFAULT 'America/New_York',
    aloha_store_id  TEXT,
    created_at      TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);

-- ─── auth ────────────────────────────────────────────────────────────────────
CREATE TABLE user_account (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  UUID NOT NULL REFERENCES restaurant(id),
    email          TEXT NOT NULL,
    name           TEXT,
    password_hash  TEXT NOT NULL,
    role           "Role" NOT NULL DEFAULT 'staff',
    active         BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at  TIMESTAMPTZ(3),
    created_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    UNIQUE (restaurant_id, email)
);
CREATE INDEX ON user_account (restaurant_id);

CREATE TABLE refresh_token (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ(3) NOT NULL,
    revoked_at  TIMESTAMPTZ(3),
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX ON refresh_token (user_id);

-- ─── settings ────────────────────────────────────────────────────────────────
CREATE TABLE location (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  UUID NOT NULL REFERENCES restaurant(id),
    name           TEXT NOT NULL,
    kind           "LocationKind" NOT NULL,
    is_archived    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    UNIQUE (restaurant_id, name)
);
CREATE INDEX ON location (restaurant_id);

CREATE TABLE portion_utensil (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  UUID NOT NULL REFERENCES restaurant(id),
    name           TEXT NOT NULL,
    label_colour   TEXT,
    kind           "UtensilKind" NOT NULL,
    default_uom    TEXT NOT NULL,
    default_qty    NUMERIC(18, 6) NOT NULL,
    is_archived    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    UNIQUE (restaurant_id, name)
);
CREATE INDEX ON portion_utensil (restaurant_id);

CREATE TABLE waste_reason (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  UUID NOT NULL REFERENCES restaurant(id),
    code           TEXT NOT NULL,
    label          TEXT NOT NULL,
    is_archived    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    UNIQUE (restaurant_id, code)
);
CREATE INDEX ON waste_reason (restaurant_id);

-- ─── ingredients, costs, suppliers ───────────────────────────────────────────
CREATE TABLE supplier (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id    UUID NOT NULL REFERENCES restaurant(id),
    name             TEXT NOT NULL,
    contact_name     TEXT,
    email            TEXT,
    phone            TEXT,
    lead_time_days   INT NOT NULL DEFAULT 1,
    min_order_cents  INT NOT NULL DEFAULT 0,
    order_cadence    TEXT,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    UNIQUE (restaurant_id, name)
);
CREATE INDEX ON supplier (restaurant_id);

CREATE TABLE ingredient (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id       UUID NOT NULL REFERENCES restaurant(id),
    name                TEXT NOT NULL,
    uom                 TEXT NOT NULL,
    uom_category        "UomCategory" NOT NULL,
    pack_size           NUMERIC(18, 6),
    storage_location_id UUID REFERENCES location(id),
    default_supplier_id UUID REFERENCES supplier(id),
    shelf_life_days     INT,
    allergen_flags      TEXT[] NOT NULL DEFAULT '{}',
    density_g_per_ml    NUMERIC(18, 6),
    is_archived         BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at         TIMESTAMPTZ(3),
    created_at          TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    UNIQUE (restaurant_id, name)
);
CREATE INDEX ON ingredient (restaurant_id);
CREATE INDEX ON ingredient (restaurant_id, is_archived);

CREATE TABLE utensil_equivalence (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    utensil_id      UUID NOT NULL REFERENCES portion_utensil(id),
    ingredient_id   UUID REFERENCES ingredient(id),
    equivalent_qty  NUMERIC(18, 6) NOT NULL,
    equivalent_uom  TEXT NOT NULL,
    source          "EquivalenceSource" NOT NULL,
    created_at      TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX ON utensil_equivalence (utensil_id);
CREATE INDEX ON utensil_equivalence (ingredient_id);
-- A utensil has exactly one default (ingredient_id IS NULL) and at most one
-- override per ingredient. The partial unique indexes below express both halves.
CREATE UNIQUE INDEX utensil_equivalence_default_uniq
    ON utensil_equivalence (utensil_id) WHERE ingredient_id IS NULL;
CREATE UNIQUE INDEX utensil_equivalence_override_uniq
    ON utensil_equivalence (utensil_id, ingredient_id) WHERE ingredient_id IS NOT NULL;

CREATE TABLE ingredient_cost (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingredient_id    UUID NOT NULL REFERENCES ingredient(id),
    unit_cost_cents  INT NOT NULL,
    effective_from   TIMESTAMPTZ(3) NOT NULL,
    source           "CostSource" NOT NULL,
    note             TEXT,
    created_at       TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX ON ingredient_cost (ingredient_id, effective_from);

CREATE TABLE supplier_ingredient (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id         UUID NOT NULL REFERENCES supplier(id),
    ingredient_id       UUID NOT NULL REFERENCES ingredient(id),
    supplier_pack_size  NUMERIC(18, 6),
    unit_cost_cents     INT NOT NULL,
    rank                INT NOT NULL DEFAULT 1,
    effective_from      TIMESTAMPTZ(3) NOT NULL,
    effective_until     TIMESTAMPTZ(3),
    created_at          TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    UNIQUE (supplier_id, ingredient_id, effective_from)
);
CREATE INDEX ON supplier_ingredient (ingredient_id, rank);

-- ─── recipes ─────────────────────────────────────────────────────────────────
CREATE TABLE recipe (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  UUID NOT NULL REFERENCES restaurant(id),
    type           "RecipeType" NOT NULL,
    name           TEXT NOT NULL,
    is_archived    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    UNIQUE (restaurant_id, type, name)
);
CREATE INDEX ON recipe (restaurant_id, is_archived);

CREATE TABLE recipe_version (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id                UUID NOT NULL REFERENCES recipe(id),
    version                  INT NOT NULL,
    is_current               BOOLEAN NOT NULL DEFAULT FALSE,
    yield_qty                NUMERIC(18, 6) NOT NULL,
    yield_uom                TEXT NOT NULL,
    shelf_life_days          INT,
    equipment                TEXT[] NOT NULL DEFAULT '{}',
    procedure                TEXT NOT NULL DEFAULT '',
    photo_url                TEXT,
    is_portion_bag_prep      BOOLEAN NOT NULL DEFAULT FALSE,
    portion_bag_content_json JSONB,
    created_by_user_id       UUID,
    created_at               TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    UNIQUE (recipe_id, version)
);
CREATE INDEX ON recipe_version (recipe_id, is_current);
-- At most one current version per recipe.
CREATE UNIQUE INDEX recipe_version_one_current
    ON recipe_version (recipe_id) WHERE is_current;

CREATE TABLE recipe_line (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_version_id  UUID NOT NULL REFERENCES recipe_version(id),
    position           INT NOT NULL,
    ref_type           "RecipeLineRefType" NOT NULL,
    ingredient_id      UUID REFERENCES ingredient(id),
    ref_recipe_id      UUID REFERENCES recipe(id),
    qty                NUMERIC(18, 6) NOT NULL,
    qty_text           TEXT,
    uom                TEXT,
    note               TEXT,
    station            "Station",
    step_order         INT,
    utensil_id         UUID REFERENCES portion_utensil(id),
    CHECK (
        (ref_type = 'ingredient' AND ingredient_id IS NOT NULL AND ref_recipe_id IS NULL)
        OR (ref_type = 'recipe'     AND ref_recipe_id IS NOT NULL AND ingredient_id IS NULL)
    )
);
CREATE INDEX ON recipe_line (recipe_version_id, position);
CREATE INDEX ON recipe_line (station);

-- ─── operational loop ────────────────────────────────────────────────────────
CREATE TABLE prep_run (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_version_id   UUID NOT NULL REFERENCES recipe_version(id),
    prepared_on         DATE NOT NULL,
    prepared_by_user_id UUID,
    qty_yielded         NUMERIC(18, 6) NOT NULL,
    expires_on          DATE,
    created_at          TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX ON prep_run (recipe_version_id, prepared_on);

CREATE TABLE prep_sheet (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  UUID NOT NULL REFERENCES restaurant(id),
    date           DATE NOT NULL,
    generated_at   TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    UNIQUE (restaurant_id, date)
);
CREATE INDEX ON prep_sheet (restaurant_id);

CREATE TABLE prep_sheet_row (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prep_sheet_id      UUID NOT NULL REFERENCES prep_sheet(id) ON DELETE CASCADE,
    recipe_version_id  UUID NOT NULL REFERENCES recipe_version(id),
    needed_qty         NUMERIC(18, 6) NOT NULL,
    status             "PrepSheetRowStatus" NOT NULL DEFAULT 'pending',
    started_at         TIMESTAMPTZ(3),
    completed_at       TIMESTAMPTZ(3),
    user_id            UUID,
    skip_reason        TEXT
);
CREATE INDEX ON prep_sheet_row (prep_sheet_id);
CREATE INDEX ON prep_sheet_row (recipe_version_id);

CREATE TABLE par_level (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  UUID NOT NULL REFERENCES restaurant(id),
    recipe_id      UUID NOT NULL REFERENCES recipe(id),
    day_of_week    INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    qty            NUMERIC(18, 6) NOT NULL,
    updated_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    UNIQUE (recipe_id, day_of_week)
);
CREATE INDEX ON par_level (restaurant_id);

CREATE TABLE inventory_count (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id    UUID NOT NULL REFERENCES restaurant(id),
    date             DATE NOT NULL,
    status           "InventoryCountStatus" NOT NULL DEFAULT 'open',
    started_by       UUID,
    completed_by     UUID,
    amends_count_id  UUID REFERENCES inventory_count(id),
    created_at       TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX ON inventory_count (restaurant_id, date);

CREATE TABLE inventory_count_line (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    count_id           UUID NOT NULL REFERENCES inventory_count(id) ON DELETE CASCADE,
    ref_type           "RecipeLineRefType" NOT NULL,
    ingredient_id      UUID REFERENCES ingredient(id),
    recipe_version_id  UUID REFERENCES recipe_version(id),
    location_id        UUID REFERENCES location(id),
    expected_qty       NUMERIC(18, 6),
    actual_qty         NUMERIC(18, 6) NOT NULL,
    unit_cost_cents    INT
);
CREATE INDEX ON inventory_count_line (count_id);

CREATE TABLE purchase_order (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  UUID NOT NULL REFERENCES restaurant(id),
    supplier_id    UUID NOT NULL REFERENCES supplier(id),
    status         "OrderStatus" NOT NULL DEFAULT 'draft',
    sent_at        TIMESTAMPTZ(3),
    expected_on    DATE,
    created_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX ON purchase_order (restaurant_id, status);

CREATE TABLE order_line (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
    ingredient_id   UUID NOT NULL REFERENCES ingredient(id),
    qty             NUMERIC(18, 6) NOT NULL,
    pack_size       NUMERIC(18, 6),
    unit_cost_cents INT NOT NULL
);
CREATE INDEX ON order_line (order_id);
CREATE INDEX ON order_line (ingredient_id);

CREATE TABLE delivery (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  UUID NOT NULL REFERENCES restaurant(id),
    supplier_id    UUID NOT NULL REFERENCES supplier(id),
    po_id          UUID REFERENCES purchase_order(id),
    received_on    DATE NOT NULL,
    status         "DeliveryStatus" NOT NULL DEFAULT 'pending',
    received_by    UUID,
    created_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX ON delivery (restaurant_id, received_on);

CREATE TABLE delivery_line (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id     UUID NOT NULL REFERENCES delivery(id) ON DELETE CASCADE,
    ingredient_id   UUID NOT NULL REFERENCES ingredient(id),
    ordered_qty     NUMERIC(18, 6),
    received_qty    NUMERIC(18, 6) NOT NULL,
    unit_cost_cents INT NOT NULL,
    note            TEXT
);
CREATE INDEX ON delivery_line (delivery_id);
CREATE INDEX ON delivery_line (ingredient_id);

CREATE TABLE waste_entry (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id           UUID NOT NULL REFERENCES restaurant(id),
    ref_type                "WasteRefType" NOT NULL,
    ingredient_id           UUID REFERENCES ingredient(id),
    recipe_version_id       UUID REFERENCES recipe_version(id),
    qty                     NUMERIC(18, 6) NOT NULL,
    uom                     TEXT NOT NULL,
    reason_id               UUID NOT NULL REFERENCES waste_reason(id),
    note                    TEXT,
    photo_url               TEXT,
    unit_cost_cents_pinned  INT NOT NULL,
    value_cents             INT NOT NULL,
    user_id                 UUID,
    at                      TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX ON waste_entry (restaurant_id, at);

-- ─── Aloha POS ───────────────────────────────────────────────────────────────
CREATE TABLE aloha_import_run (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  UUID NOT NULL REFERENCES restaurant(id),
    business_date  DATE NOT NULL,
    source         "AlohaImportSource" NOT NULL,
    started_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    completed_at   TIMESTAMPTZ(3),
    status         "AlohaImportStatus" NOT NULL DEFAULT 'ok',
    rows_ingested  INT NOT NULL DEFAULT 0,
    error_detail   TEXT
);
CREATE INDEX ON aloha_import_run (restaurant_id, business_date);

-- Belt-and-braces: enum already restricts values, but §6.12a AC-3 + AD-7 want a
-- named CHECK at the DB layer so backfill SQL can't slip an unclassified row in
-- with a bad label. TASK-022 proves this constraint fires.
CREATE TABLE pos_sale (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_run_id     UUID NOT NULL REFERENCES aloha_import_run(id) ON DELETE CASCADE,
    restaurant_id     UUID NOT NULL REFERENCES restaurant(id),
    business_date     DATE NOT NULL,
    category          TEXT,
    aloha_item_name   TEXT NOT NULL,
    row_kind          "PosRowKind" NOT NULL,
    qty               NUMERIC(18, 6) NOT NULL,
    unit_price_cents  INT,
    item_sales_cents  INT,
    aloha_cost_cents  INT,
    ingested_at       TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT pos_sale_row_kind_valid
        CHECK (row_kind IN ('item', 'modifier', 'stockout_86', 'cover', 'unclassified'))
);
CREATE INDEX ON pos_sale (restaurant_id, business_date);
CREATE INDEX ON pos_sale (import_run_id);
CREATE INDEX ON pos_sale (row_kind);

CREATE TABLE aloha_menu_map (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id    UUID NOT NULL REFERENCES restaurant(id),
    aloha_item_name  TEXT NOT NULL,
    menu_recipe_id   UUID NOT NULL REFERENCES recipe(id),
    effective_from   DATE NOT NULL,
    effective_until  DATE,
    mapped_by        UUID,
    confidence       TEXT NOT NULL DEFAULT 'manual'
);
CREATE INDEX ON aloha_menu_map (restaurant_id, aloha_item_name, effective_from);

CREATE TABLE aloha_modifier_map (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id         UUID NOT NULL REFERENCES restaurant(id),
    aloha_modifier_name   TEXT NOT NULL,
    ingredient_id         UUID REFERENCES ingredient(id),
    recipe_id             UUID REFERENCES recipe(id),
    qty                   NUMERIC(18, 6) NOT NULL,
    uom                   TEXT NOT NULL,
    effective_from        DATE NOT NULL,
    effective_until       DATE,
    mapped_by             UUID
);
CREATE INDEX ON aloha_modifier_map (restaurant_id, aloha_modifier_name, effective_from);

CREATE TABLE stockout_event (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id      UUID NOT NULL REFERENCES restaurant(id),
    import_run_id      UUID REFERENCES aloha_import_run(id),
    business_date      DATE NOT NULL,
    ingredient_id      UUID REFERENCES ingredient(id),
    recipe_id          UUID REFERENCES recipe(id),
    aloha_marker_name  TEXT NOT NULL,
    count              INT NOT NULL DEFAULT 1,
    mapped             BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX ON stockout_event (restaurant_id, business_date);

CREATE TABLE cover_count (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  UUID NOT NULL REFERENCES restaurant(id),
    import_run_id  UUID REFERENCES aloha_import_run(id),
    business_date  DATE NOT NULL,
    covers         INT NOT NULL,
    UNIQUE (restaurant_id, business_date)
);

CREATE TABLE aloha_reconciliation_queue (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id    UUID NOT NULL REFERENCES restaurant(id),
    aloha_item_name  TEXT NOT NULL,
    row_kind         "PosRowKind" NOT NULL,
    first_seen_on    DATE NOT NULL,
    occurrences      INT NOT NULL DEFAULT 1,
    resolved         BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at      TIMESTAMPTZ(3),
    UNIQUE (restaurant_id, aloha_item_name, row_kind)
);

-- ─── ML ──────────────────────────────────────────────────────────────────────
CREATE TABLE forecast_model (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id     UUID NOT NULL REFERENCES restaurant(id),
    entity_type       "ForecastEntityType" NOT NULL,
    entity_id         UUID NOT NULL,
    algorithm         TEXT NOT NULL,
    trained_on_start  DATE NOT NULL,
    trained_on_end    DATE NOT NULL,
    holdout_mape      NUMERIC(8, 4),
    params            JSONB,
    artefact_ref      TEXT NOT NULL,
    trained_at        TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX ON forecast_model (restaurant_id, entity_type, entity_id);

CREATE TABLE forecast_prediction (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id          UUID NOT NULL REFERENCES forecast_model(id),
    target_date       DATE NOT NULL,
    point             NUMERIC(18, 6) NOT NULL,
    p10               NUMERIC(18, 6),
    p90               NUMERIC(18, 6),
    top_drivers_json  JSONB,
    generated_at      TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX ON forecast_prediction (model_id, target_date);

CREATE TABLE forecast_override (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  UUID NOT NULL REFERENCES restaurant(id),
    entity_type    "ForecastEntityType" NOT NULL,
    entity_id      UUID NOT NULL,
    target_date    DATE NOT NULL,
    expected_qty   NUMERIC(18, 6) NOT NULL,
    override_qty   NUMERIC(18, 6) NOT NULL,
    actual_qty     NUMERIC(18, 6),
    user_id        UUID,
    reason         TEXT,
    at             TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX ON forecast_override (restaurant_id, entity_type, entity_id, target_date);

-- ─── cross-cutting ───────────────────────────────────────────────────────────
CREATE TABLE audit_log (
    id             BIGSERIAL PRIMARY KEY,
    restaurant_id  UUID,
    user_id        UUID,
    entity         TEXT NOT NULL,
    entity_id      TEXT NOT NULL,
    field          TEXT,
    before         JSONB,
    after          JSONB,
    action         TEXT NOT NULL DEFAULT 'update',
    at             TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX ON audit_log (entity, entity_id, at);
CREATE INDEX ON audit_log (restaurant_id, at);

CREATE TABLE feature_flag (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key            TEXT NOT NULL UNIQUE,
    default_value  BOOLEAN NOT NULL DEFAULT FALSE,
    description    TEXT,
    created_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);

CREATE TABLE feature_flag_value (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_id        UUID NOT NULL REFERENCES feature_flag(id) ON DELETE CASCADE,
    restaurant_id  UUID NOT NULL REFERENCES restaurant(id),
    value          BOOLEAN NOT NULL,
    updated_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    UNIQUE (flag_id, restaurant_id)
);

-- ─── convenience view: current recipe version per recipe ─────────────────────
CREATE VIEW recipe_current_version AS
SELECT r.id AS recipe_id, rv.id AS recipe_version_id, rv.version
FROM recipe r
JOIN recipe_version rv ON rv.recipe_id = r.id AND rv.is_current;

COMMIT;

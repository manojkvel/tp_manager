-- §6.11 — Promote kitchen `Station` from a Postgres enum to a per-restaurant
-- editable catalogue. RecipeLine.station becomes plain TEXT carrying the
-- station's `code` (no FK), so renames and archives never orphan recipe
-- history (DEC-014: append-only recipe versions).

-- ─── New table ──────────────────────────────────────────────────────────────
CREATE TABLE "station" (
    "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "code"          TEXT NOT NULL,
    "label"         TEXT NOT NULL,
    "sort_order"    INT  NOT NULL DEFAULT 0,
    "is_archived"   BOOLEAN NOT NULL DEFAULT FALSE,
    "archived_at"   TIMESTAMPTZ(3),
    "created_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "station_restaurant_id_code_key" UNIQUE ("restaurant_id", "code")
);
CREATE INDEX "station_restaurant_id_idx" ON "station" ("restaurant_id");

-- ─── Convert recipe_line.station from enum to TEXT ──────────────────────────
ALTER TABLE "recipe_line"
    ALTER COLUMN "station" TYPE TEXT
    USING ("station"::TEXT);

-- ─── Seed the legacy 6 stations for every existing restaurant ───────────────
INSERT INTO "station" ("restaurant_id", "code", "label", "sort_order")
SELECT r.id, s.code, s.label, s.sort_order
FROM "restaurant" r
CROSS JOIN (
    VALUES
        ('lunch',     'Lunch',     1),
        ('breakfast', 'Breakfast', 2),
        ('expo',      'Expo',      3),
        ('egg',       'Egg',       4),
        ('bar',       'Bar',       5),
        ('bakery',    'Bakery',    6)
) AS s(code, label, sort_order);

-- ─── Drop the now-unused enum type ──────────────────────────────────────────
DROP TYPE "Station";

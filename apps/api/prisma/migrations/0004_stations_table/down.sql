-- Reverse §6.11 station promotion. Recreates the enum and casts
-- recipe_line.station back. Any stations whose `code` is not in the legacy
-- 6-value enum are nulled out (the only safe value the enum can hold).

CREATE TYPE "Station" AS ENUM ('lunch', 'breakfast', 'expo', 'egg', 'bar', 'bakery');

UPDATE "recipe_line"
SET "station" = NULL
WHERE "station" IS NOT NULL
  AND "station" NOT IN ('lunch', 'breakfast', 'expo', 'egg', 'bar', 'bakery');

ALTER TABLE "recipe_line"
    ALTER COLUMN "station" TYPE "Station"
    USING ("station"::"Station");

DROP TABLE IF EXISTS "station";

-- §6.12b — add `recipe` to ForecastEntityType so the nightly trainer can
-- record an audit row for per-menu-recipe demand models (pos_sale → recipe).
-- The existing `prep` value continues to cover prep-production forecasts.
ALTER TYPE "ForecastEntityType" ADD VALUE IF NOT EXISTS 'recipe';

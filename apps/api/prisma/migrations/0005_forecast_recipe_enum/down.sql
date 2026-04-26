-- Postgres doesn't support removing enum values without recreating the type.
-- A reverse migration would: (a) create a new enum without 'recipe',
-- (b) migrate/delete rows using 'recipe', (c) swap the type. Out of scope for
-- a forward-only add — ship with an empty down to fail fast if someone tries
-- to roll back, forcing an explicit manual cleanup.
SELECT 1;

-- TASK-061 — staged migration batches + items for owner review (§6.14 AC-4..7).

CREATE TABLE "staged_migration_batch" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "restaurant_id" UUID NOT NULL,
  "source_file" TEXT NOT NULL,
  "parser_version" TEXT NOT NULL,
  "staged_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'staged',
  "approved_at" TIMESTAMPTZ(3),
  "approved_by" UUID,
  "rolled_back_at" TIMESTAMPTZ(3),
  CONSTRAINT "staged_migration_batch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staged_migration_batch_status_check" CHECK ("status" IN ('staged','approved','rolled_back'))
);

CREATE INDEX "staged_migration_batch_restaurant_id_status_idx" ON "staged_migration_batch" ("restaurant_id", "status");

CREATE TABLE "staged_migration_item" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batch_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "probe" JSONB NOT NULL,
  "payload" JSONB NOT NULL,
  "bucket" TEXT NOT NULL,
  "matches" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "decision" TEXT NOT NULL DEFAULT 'pending',
  "decision_target_id" UUID,
  CONSTRAINT "staged_migration_item_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staged_migration_item_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "staged_migration_batch"("id") ON DELETE CASCADE,
  CONSTRAINT "staged_migration_item_bucket_check" CHECK ("bucket" IN ('new','matched','ambiguous','unmapped')),
  CONSTRAINT "staged_migration_item_decision_check" CHECK ("decision" IN ('pending','accept_new','merge','reject'))
);

CREATE INDEX "staged_migration_item_batch_id_idx" ON "staged_migration_item" ("batch_id");

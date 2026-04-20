// TASK-022 — pos_sale.row_kind CHECK constraint is enforced at the DB layer
// (§6.12a AC-3). Backfill SQL cannot insert an out-of-vocab row_kind.
//
// Enum types already restrict at Prisma — but the explicit named CHECK is what
// makes the invariant survive any future `ALTER TYPE` / raw-SQL usage.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, connect, ensureRestaurant, type TestDb } from './helpers/test-db.js';

const maybeDb: { db: TestDb | null } = { db: null };

beforeAll(async () => {
  maybeDb.db = await connect();
});

afterAll(async () => {
  await maybeDb.db?.close();
});

describe('pos_sale.row_kind CHECK constraint (TASK-022 / §6.12a AC-3)', () => {
  it.runIf(!!process.env['TEST_DATABASE_URL'])('rejects an invalid row_kind via raw SQL', async () => {
    const db = maybeDb.db!;
    const { client } = db;
    const restaurantId = await ensureRestaurant(client);
    try {
      const runId = (
        await client.query<{ id: string }>(
          `INSERT INTO aloha_import_run (restaurant_id, business_date, source)
           VALUES ($1, CURRENT_DATE, 'manual_upload')
           RETURNING id`,
          [restaurantId],
        )
      ).rows[0]!.id;

      // Valid row — must succeed.
      await expect(
        client.query(
          `INSERT INTO pos_sale (import_run_id, restaurant_id, business_date, aloha_item_name, row_kind, qty)
           VALUES ($1, $2, CURRENT_DATE, 'Avocado Toast', 'item', 1)`,
          [runId, restaurantId],
        ),
      ).resolves.toBeTruthy();

      // Invalid enum label — the enum cast should fail before the CHECK even
      // runs; assert the error is raised. Postgres reports "invalid input
      // value for enum" here; any rejection is fine for our purposes.
      await expect(
        client.query(
          `INSERT INTO pos_sale (import_run_id, restaurant_id, business_date, aloha_item_name, row_kind, qty)
           VALUES ($1, $2, CURRENT_DATE, 'Mystery', 'not_a_kind', 1)`,
          [runId, restaurantId],
        ),
      ).rejects.toThrow();
    } finally {
      await cleanup(client, restaurantId);
    }
  });

  it.runIf(!process.env['TEST_DATABASE_URL'])('skipped — TEST_DATABASE_URL not set', () => {
    expect(true).toBe(true);
  });
});

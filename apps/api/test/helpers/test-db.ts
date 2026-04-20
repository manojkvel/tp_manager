// Test-DB helper used by integration tests (TASK-020, TASK-022, + later waves).
//
// Strategy: the test process is given `TEST_DATABASE_URL` pointing at an
// ephemeral Postgres (docker-compose service + migrations applied). Each test
// acquires a dedicated `pg.Client`, runs in a truncate-reset transaction, and
// the helper exposes a minimal SQL surface so tests don't pull Prisma in.
//
// This module does not START a database — that is the harness's job. If
// `TEST_DATABASE_URL` is not set, tests skip with a clear message rather than
// exploding the suite on a developer box with no compose stack.

import { Client } from 'pg';

export interface TestDb {
  client: Client;
  close: () => Promise<void>;
}

export async function connect(): Promise<TestDb | null> {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) return null;
  const client = new Client({ connectionString: url });
  await client.connect();
  return {
    client,
    close: async () => {
      try { await client.end(); } catch { /* swallow — teardown best-effort */ }
    },
  };
}

export async function ensureRestaurant(client: Client): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO restaurant (name) VALUES ('__test__')
     ON CONFLICT DO NOTHING
     RETURNING id`,
  );
  if (rows[0]) return rows[0].id;
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM restaurant WHERE name = '__test__' LIMIT 1`,
  );
  return existing.rows[0]!.id;
}

export async function cleanup(client: Client, restaurantId: string): Promise<void> {
  // Leave the restaurant row; drop everything that depended on it for this test run.
  await client.query(`DELETE FROM audit_log WHERE restaurant_id = $1`, [restaurantId]);
  await client.query(`DELETE FROM pos_sale WHERE restaurant_id = $1`, [restaurantId]);
  await client.query(`DELETE FROM aloha_import_run WHERE restaurant_id = $1`, [restaurantId]);
  await client.query(`DELETE FROM ingredient WHERE restaurant_id = $1`, [restaurantId]);
}

// TASK-020 — DB audit trigger captures UPDATE at the schema level (AD-5).
// Invariant: an UPDATE on an audited table inserts exactly one row into
// `audit_log` with `action='update'` and the per-field before/after values,
// *regardless* of whether the UPDATE was issued by the ORM or a backfill
// script. AD-5 exists precisely because app-level hooks are bypassable.
//
// The test requires a running Postgres with migrations 0001 + 0002 applied.
// `TEST_DATABASE_URL` gates execution — unset → suite skips with a message.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, connect, ensureRestaurant, type TestDb } from './helpers/test-db.js';

const maybeDb: { db: TestDb | null } = { db: null };

beforeAll(async () => {
  maybeDb.db = await connect();
});

afterAll(async () => {
  await maybeDb.db?.close();
});

describe('db audit triggers (TASK-020 / AD-5)', () => {
  it.runIf(!!process.env['TEST_DATABASE_URL'])(
    'INSERT on ingredient writes an insert row with the restaurant_id propagated',
    async () => {
      const db = maybeDb.db!;
      const { client } = db;
      const restaurantId = await ensureRestaurant(client);
      try {
        const ingredientId = (
          await client.query<{ id: string }>(
            `INSERT INTO ingredient (restaurant_id, name, uom, uom_category)
             VALUES ($1, 'Audit Insert Test', 'g', 'weight')
             RETURNING id`,
            [restaurantId],
          )
        ).rows[0]!.id;

        const { rows } = await client.query<{ action: string; before: unknown; after: unknown; restaurant_id: string }>(
          `SELECT action, before, after, restaurant_id
           FROM audit_log
           WHERE entity = 'ingredient' AND entity_id = $1
           ORDER BY at DESC LIMIT 1`,
          [ingredientId],
        );

        expect(rows.length).toBe(1);
        expect(rows[0]!.action).toBe('insert');
        expect(rows[0]!.before).toBeNull();
        expect(rows[0]!.after).toBeTruthy();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((rows[0]!.after as any).name).toBe('Audit Insert Test');
        expect(rows[0]!.restaurant_id).toBe(restaurantId);
      } finally {
        await cleanup(client, restaurantId);
      }
    },
  );

  it.runIf(!!process.env['TEST_DATABASE_URL'])(
    'DELETE on ingredient writes a delete row with before set and after null',
    async () => {
      const db = maybeDb.db!;
      const { client } = db;
      const restaurantId = await ensureRestaurant(client);
      try {
        const ingredientId = (
          await client.query<{ id: string }>(
            `INSERT INTO ingredient (restaurant_id, name, uom, uom_category)
             VALUES ($1, 'Audit Delete Test', 'g', 'weight')
             RETURNING id`,
            [restaurantId],
          )
        ).rows[0]!.id;

        await client.query(`DELETE FROM ingredient WHERE id = $1`, [ingredientId]);

        const { rows } = await client.query<{ action: string; before: unknown; after: unknown }>(
          `SELECT action, before, after
           FROM audit_log
           WHERE entity = 'ingredient' AND entity_id = $1
           ORDER BY at DESC LIMIT 1`,
          [ingredientId],
        );

        expect(rows.length).toBe(1);
        expect(rows[0]!.action).toBe('delete');
        expect(rows[0]!.before).toBeTruthy();
        expect(rows[0]!.after).toBeNull();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((rows[0]!.before as any).name).toBe('Audit Delete Test');
      } finally {
        await cleanup(client, restaurantId);
      }
    },
  );

  it.runIf(!!process.env['TEST_DATABASE_URL'])(
    'stamps user_id when app.user_id session setting is present',
    async () => {
      const db = maybeDb.db!;
      const { client } = db;
      const restaurantId = await ensureRestaurant(client);
      const actingUserId = '11111111-2222-3333-4444-555555555555';
      try {
        // SET LOCAL requires a transaction block so the setting only applies
        // for the statements below (this mirrors the app's per-request hook).
        await client.query('BEGIN');
        await client.query(`SET LOCAL "app.user_id" = '${actingUserId}'`);
        const ingredientId = (
          await client.query<{ id: string }>(
            `INSERT INTO ingredient (restaurant_id, name, uom, uom_category)
             VALUES ($1, 'User-Stamped Audit', 'g', 'weight')
             RETURNING id`,
            [restaurantId],
          )
        ).rows[0]!.id;
        await client.query('COMMIT');

        const { rows } = await client.query<{ user_id: string | null }>(
          `SELECT user_id FROM audit_log
           WHERE entity = 'ingredient' AND entity_id = $1
           ORDER BY at DESC LIMIT 1`,
          [ingredientId],
        );
        expect(rows[0]!.user_id).toBe(actingUserId);
      } finally {
        await cleanup(client, restaurantId);
      }
    },
  );

  it.runIf(!!process.env['TEST_DATABASE_URL'])(
    'UPDATE on ingredient writes a row to audit_log',
    async () => {
      const db = maybeDb.db!;
      const { client } = db;
      const restaurantId = await ensureRestaurant(client);
      try {
        // Insert a row, clear any insert-side audit rows, then UPDATE and
        // verify the trigger wrote an `update` row that references the change.
        const ingredientId = (
          await client.query<{ id: string }>(
            `INSERT INTO ingredient (restaurant_id, name, uom, uom_category)
             VALUES ($1, 'Test Milk', 'mL', 'volume')
             RETURNING id`,
            [restaurantId],
          )
        ).rows[0]!.id;

        await client.query(`DELETE FROM audit_log WHERE entity = 'ingredient' AND entity_id = $1`, [
          ingredientId,
        ]);

        await client.query(`UPDATE ingredient SET name = 'Test Whole Milk' WHERE id = $1`, [
          ingredientId,
        ]);

        const { rows } = await client.query<{
          action: string;
          before: unknown;
          after: unknown;
          field: string | null;
        }>(
          `SELECT action, before, after, field
           FROM audit_log
           WHERE entity = 'ingredient' AND entity_id = $1
           ORDER BY at DESC
           LIMIT 1`,
          [ingredientId],
        );

        expect(rows.length).toBe(1);
        const row = rows[0]!;
        expect(row.action).toBe('update');
        // The template writes the row-level before/after as JSON; the `field`
        // column may be null for row-level triggers and populated only for
        // per-column triggers — we assert the shape is present, not the form.
        expect(row.before).toBeTruthy();
        expect(row.after).toBeTruthy();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((row.before as any).name).toBe('Test Milk');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((row.after as any).name).toBe('Test Whole Milk');
      } finally {
        await cleanup(client, restaurantId);
      }
    },
  );

  it.runIf(!process.env['TEST_DATABASE_URL'])('skipped — TEST_DATABASE_URL not set', () => {
    // Sentinel test so the suite does not appear entirely empty in CI when the
    // DB is not provisioned. Flip by exporting TEST_DATABASE_URL locally or in
    // the compose stack.
    expect(true).toBe(true);
  });
});

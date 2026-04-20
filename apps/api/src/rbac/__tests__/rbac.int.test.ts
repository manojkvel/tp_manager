// TASK-027 — RBAC role matrix.
// Validates §6.13 AC-3: owner (all), manager (all except user admin + settings
// taxonomies), staff (view + log waste + mark prep complete + log deliveries;
// cannot edit recipes or change cost).
//
// We mount a tiny Fastify instance with three route groups protected by the
// role guard and hit them with JWTs minted for each role. This is wire-level:
// no HTTP, we use app.inject so the suite is fast and DB-free.

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { signAccessToken } from '../../auth/tokens.js';
import { authPlugin } from '../../auth/plugin.js';
import { requireRole } from '../guard.js';

const SECRET = 'rbac-test-secret-at-least-32-chars-xxx';
const RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(authPlugin, { jwtSecret: SECRET });

  // Owner-only — user admin (§6.13 AC-3 — manager cannot do user admin)
  app.post(
    '/api/v1/users',
    { preHandler: [requireRole(['owner'])] },
    async () => ({ ok: true }),
  );
  // Owner + manager — recipe edit (§6.13 AC-3 — staff cannot edit recipes)
  app.put(
    '/api/v1/recipes/:id',
    { preHandler: [requireRole(['owner', 'manager'])] },
    async () => ({ ok: true }),
  );
  // All roles — log waste (§6.13 AC-3 — staff can log waste)
  app.post(
    '/api/v1/waste',
    { preHandler: [requireRole(['owner', 'manager', 'staff'])] },
    async () => ({ ok: true }),
  );
  // Authenticated only — list ingredients (all roles can view)
  app.get(
    '/api/v1/ingredients',
    { preHandler: [requireRole(['owner', 'manager', 'staff'])] },
    async () => ({ data: [] }),
  );

  return app;
}

async function tokenFor(role: 'owner' | 'manager' | 'staff'): Promise<string> {
  return signAccessToken(
    { sub: `user-${role}`, restaurant_id: RESTAURANT_ID, role },
    { secret: SECRET, ttlSeconds: 600 },
  );
}

describe('RBAC route allowance (§6.13 AC-3)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('owner can create users', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${await tokenFor('owner')}` },
      payload: { email: 'x@y.z', role: 'staff' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('manager cannot create users (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${await tokenFor('manager')}` },
      payload: { email: 'x@y.z', role: 'staff' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('staff cannot create users (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${await tokenFor('staff')}` },
      payload: { email: 'x@y.z', role: 'staff' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('owner can edit recipes', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/recipes/abc',
      headers: { authorization: `Bearer ${await tokenFor('owner')}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });

  it('manager can edit recipes', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/recipes/abc',
      headers: { authorization: `Bearer ${await tokenFor('manager')}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });

  it('staff cannot edit recipes (403)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/recipes/abc',
      headers: { authorization: `Bearer ${await tokenFor('staff')}` },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('staff can log waste', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/waste',
      headers: { authorization: `Bearer ${await tokenFor('staff')}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });

  it('unauthenticated requests return 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ingredients',
    });
    expect(res.statusCode).toBe(401);
  });

  it('malformed token returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ingredients',
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(res.statusCode).toBe(401);
  });
});

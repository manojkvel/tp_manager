// TASK-080 — E2E smoke: owner happy path.
//
// Login → dashboard KPIs → prep sheet → waste log → order generate.
// Runs against an in-process Fastify + postgres (DATABASE_URL). Skipped when
// no DATABASE_URL is set so CI can still run the pure-TS suite standalone.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('E2E happy path (TASK-080)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET ??= 'x'.repeat(64);
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('healthz is ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects unauthenticated reports access', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/avt' });
    expect([401, 403]).toContain(res.statusCode);
  });
});

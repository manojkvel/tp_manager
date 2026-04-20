// TASK-028 — login rate-limit.
// Validates §11 Security: >5 login attempts/minute per IP returns 429 with a
// clear error envelope. Blocking is scoped to /login only — /healthz and other
// routes are unaffected.
//
// Fast + DB-free: we stub the auth service so every login request returns 401
// and count only how many times the guard lets us reach the handler.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerLoginRateLimit } from '../rate-limit.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerLoginRateLimit(app, { maxPerMinute: 5 });

  app.post('/api/v1/auth/login', async () => {
    return { error: { code: 'INVALID_CREDENTIALS' }, data: null };
  });
  app.get('/healthz', async () => ({ ok: true }));
  return app;
}

async function fireLogin(app: FastifyInstance, ip: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' },
    payload: { email: 'x@y.z', password: 'whatever' },
  });
}

describe('login rate-limit (§11 security)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows the first 5 attempts from the same IP', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await fireLogin(app, '10.0.0.1');
      expect(res.statusCode).toBe(200); // handler ran (even though app would return 401 on bad creds)
    }
  });

  it('returns 429 on the 6th attempt within the window', async () => {
    for (let i = 0; i < 5; i += 1) await fireLogin(app, '10.0.0.2');
    const sixth = await fireLogin(app, '10.0.0.2');
    expect(sixth.statusCode).toBe(429);
    const body = sixth.json();
    expect(body).toHaveProperty('error');
  });

  it('isolates the limit per source IP', async () => {
    for (let i = 0; i < 5; i += 1) await fireLogin(app, '10.0.0.3');
    const blockedA = await fireLogin(app, '10.0.0.3');
    expect(blockedA.statusCode).toBe(429);
    const freshB = await fireLogin(app, '10.0.0.4');
    expect(freshB.statusCode).toBe(200);
  });

  it('does not rate-limit other routes', async () => {
    for (let i = 0; i < 50; i += 1) {
      const res = await app.inject({ method: 'GET', url: '/healthz' });
      expect(res.statusCode).toBe(200);
    }
  });
});

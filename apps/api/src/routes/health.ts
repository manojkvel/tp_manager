import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'api',
    version: process.env.APP_VERSION ?? '0.1.0',
    timestamp: new Date().toISOString(),
  }));

  app.get('/readyz', async () => ({
    status: 'ready',
    service: 'api',
    checks: { db: 'skipped', blob: 'skipped' },
  }));
}

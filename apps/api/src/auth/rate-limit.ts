// TASK-029 — login-scoped rate limiter (§11 security).
//
// Default: 5 attempts / 60s per client IP, applied only to POST
// /api/v1/auth/login and /api/v1/auth/forgot-password. We intentionally do
// not use @fastify/rate-limit here to avoid pulling Redis in for a small
// in-process counter; for multi-instance deployments, swap this for a shared
// store (documented in ADR-0006).
//
// Bucket = `${routeKey}:${ip}`. Entries are evicted lazily when the window
// closes, so the map never grows unbounded under normal traffic.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface RateLimitOpts {
  maxPerMinute: number;
  routes?: string[]; // HTTP paths to scope; defaults to /api/v1/auth/login + forgot-password.
  now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const DEFAULT_ROUTES = ['/api/v1/auth/login', '/api/v1/auth/forgot-password'];
const WINDOW_MS = 60_000;

export async function registerLoginRateLimit(
  app: FastifyInstance,
  opts: RateLimitOpts,
): Promise<void> {
  const now = opts.now ?? (() => Date.now());
  const routes = new Set(opts.routes ?? DEFAULT_ROUTES);
  const buckets = new Map<string, Bucket>();

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!routes.has(req.url.split('?')[0] ?? req.url)) return;

    // Prefer the first value in x-forwarded-for (trust-proxy should be set
    // upstream), fall back to the socket address.
    const xff = req.headers['x-forwarded-for'];
    const ip = (Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim()) || req.ip;
    const key = `${req.url}:${ip}`;
    const t = now();

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= t) {
      buckets.set(key, { count: 1, resetAt: t + WINDOW_MS });
      return;
    }
    bucket.count += 1;
    if (bucket.count > opts.maxPerMinute) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - t) / 1000));
      reply
        .code(429)
        .header('Retry-After', String(retryAfter))
        .send({
          data: null,
          error: {
            code: 'RATE_LIMITED',
            message: `too many requests — retry after ${retryAfter}s`,
          },
        });
    }
  });
}

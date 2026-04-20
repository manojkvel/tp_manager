// TASK-029 — Auth HTTP routes (AD-6).
//
// POST /api/v1/auth/login             — email + password → access JWT (body)
//                                       + refresh cookie (httpOnly, secure, SameSite=Lax)
// POST /api/v1/auth/refresh           — refresh cookie → rotated cookie +
//                                       new access JWT in body
// POST /api/v1/auth/logout            — revoke the refresh cookie
// POST /api/v1/auth/forgot-password   — request a reset token (always 204)
// POST /api/v1/auth/reset-password    — apply a reset token + new password
//
// Responses use the CLAUDE.md envelope: `{ data, error }`. Refresh tokens
// never appear in the response body — only in the httpOnly cookie — so the
// PWA stores the access JWT in memory and relies on fetch(credentials)
// for the cookie roundtrip.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthService, InvalidCredentialsError, RefreshFailedError } from './service.js';

const REFRESH_COOKIE = 'tp_refresh';

export interface AuthRoutesOpts {
  service: AuthService;
  cookieSecure?: boolean; // defaults to NODE_ENV === 'production'
  cookieDomain?: string;
}

interface LoginBody { email: string; password: string }
interface ForgotBody { email: string }
interface ResetBody { userId: string; resetToken: string; newPassword: string }

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

function setRefreshCookie(reply: FastifyReply, token: string, expiresAt: Date, opts: AuthRoutesOpts): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: opts.cookieSecure ?? process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    path: '/api/v1/auth',
    expires: expiresAt,
    domain: opts.cookieDomain,
  });
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
}

export async function registerAuthRoutes(app: FastifyInstance, opts: AuthRoutesOpts): Promise<void> {
  app.post<{ Body: LoginBody }>('/api/v1/auth/login', async (req: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
    const { email, password } = req.body ?? ({} as LoginBody);
    if (!email || !password) {
      return reply.code(400).send(envelope(null, { code: 'INVALID_REQUEST', message: 'email and password required' }));
    }
    try {
      const result = await opts.service.login(email, password);
      setRefreshCookie(reply, result.refreshToken, result.refreshExpiresAt, opts);
      return reply.send(envelope({ accessToken: result.accessToken, user: result.user }, null));
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        return reply.code(401).send(envelope(null, { code: 'INVALID_CREDENTIALS', message: 'invalid email or password' }));
      }
      throw err;
    }
  });

  app.post('/api/v1/auth/refresh', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = (req.cookies as Record<string, string | undefined> | undefined)?.[REFRESH_COOKIE];
    if (!token) {
      return reply.code(401).send(envelope(null, { code: 'NO_REFRESH_TOKEN', message: 'refresh cookie missing' }));
    }
    try {
      const result = await opts.service.refresh(token);
      setRefreshCookie(reply, result.refreshToken, result.refreshExpiresAt, opts);
      return reply.send(envelope({ accessToken: result.accessToken, user: result.user }, null));
    } catch (err) {
      clearRefreshCookie(reply);
      if (err instanceof RefreshFailedError) {
        return reply.code(401).send(envelope(null, { code: 'REFRESH_FAILED', message: err.message }));
      }
      throw err;
    }
  });

  app.post('/api/v1/auth/logout', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = (req.cookies as Record<string, string | undefined> | undefined)?.[REFRESH_COOKIE];
    if (token) await opts.service.logout(token);
    clearRefreshCookie(reply);
    return reply.code(204).send();
  });

  app.post<{ Body: ForgotBody }>('/api/v1/auth/forgot-password', async (req: FastifyRequest<{ Body: ForgotBody }>, reply: FastifyReply) => {
    const email = req.body?.email;
    if (!email) {
      return reply.code(400).send(envelope(null, { code: 'INVALID_REQUEST', message: 'email required' }));
    }
    // Intentionally ignore the result — email dispatch is a separate hook
    // (docs/adr/0006). Always respond 204 so attackers can't enumerate users.
    await opts.service.forgotPassword(email);
    return reply.code(204).send();
  });

  app.post<{ Body: ResetBody }>('/api/v1/auth/reset-password', async (req: FastifyRequest<{ Body: ResetBody }>, reply: FastifyReply) => {
    const { userId, resetToken, newPassword } = req.body ?? ({} as ResetBody);
    if (!userId || !resetToken || !newPassword) {
      return reply.code(400).send(envelope(null, { code: 'INVALID_REQUEST', message: 'userId, resetToken, newPassword required' }));
    }
    try {
      await opts.service.resetPassword(userId, resetToken, newPassword);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof RefreshFailedError) {
        return reply.code(400).send(envelope(null, { code: 'RESET_FAILED', message: err.message }));
      }
      throw err;
    }
  });
}

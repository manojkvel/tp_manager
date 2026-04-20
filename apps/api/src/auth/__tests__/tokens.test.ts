// TASK-026 — JWT issue + refresh rotation unit tests.
// Validates AD-6 (JWT-only /api/v1) and §6.13 AC-2 (JWT for API).
//
// The token service has two responsibilities:
//   - signAccessToken / verifyAccessToken: short-lived HS256 JWT carrying
//     { sub, restaurant_id, role }.
//   - issueRefreshToken / rotateRefreshToken: opaque random tokens whose
//     sha256 is stored in `refresh_token.token_hash`. Rotation revokes the
//     old row and returns a new (token, hash) pair. The repo is injected so
//     this unit test stays DB-free.

import { describe, expect, it, beforeEach } from 'vitest';
import {
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  hashRefreshToken,
  type RefreshTokenRepo,
  type RefreshTokenRow,
} from '../tokens.js';

const SECRET = 'test-secret-at-least-32-chars-long-xxx';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';

function inMemoryRepo(): RefreshTokenRepo {
  const rows = new Map<string, RefreshTokenRow>();
  return {
    async insert(row) {
      rows.set(row.token_hash, { ...row });
    },
    async findByHash(token_hash) {
      return rows.get(token_hash) ?? null;
    },
    async revoke(token_hash, at) {
      const r = rows.get(token_hash);
      if (r) r.revoked_at = at;
    },
    _rows: rows,
  } as RefreshTokenRepo & { _rows: Map<string, RefreshTokenRow> };
}

describe('signAccessToken / verifyAccessToken', () => {
  it('issues a JWT that verifies with the same secret', async () => {
    const token = await signAccessToken(
      { sub: USER_ID, restaurant_id: RESTAURANT_ID, role: 'owner' },
      { secret: SECRET, ttlSeconds: 900 },
    );
    expect(token.split('.')).toHaveLength(3);
    const payload = await verifyAccessToken(token, { secret: SECRET });
    expect(payload.sub).toBe(USER_ID);
    expect(payload.restaurant_id).toBe(RESTAURANT_ID);
    expect(payload.role).toBe('owner');
  });

  it('rejects a JWT signed with a different secret', async () => {
    const token = await signAccessToken(
      { sub: USER_ID, restaurant_id: RESTAURANT_ID, role: 'staff' },
      { secret: SECRET, ttlSeconds: 900 },
    );
    await expect(
      verifyAccessToken(token, { secret: 'different-secret-at-least-32-chars-xxx' }),
    ).rejects.toThrow();
  });

  it('rejects an expired JWT', async () => {
    const token = await signAccessToken(
      { sub: USER_ID, restaurant_id: RESTAURANT_ID, role: 'staff' },
      { secret: SECRET, ttlSeconds: -1 },
    );
    await expect(verifyAccessToken(token, { secret: SECRET })).rejects.toThrow();
  });
});

describe('refresh token issue + rotate', () => {
  let repo: ReturnType<typeof inMemoryRepo>;

  beforeEach(() => {
    repo = inMemoryRepo();
  });

  it('issueRefreshToken stores a sha256 hash (never the raw token)', async () => {
    const { token, expires_at } = await issueRefreshToken(repo, {
      user_id: USER_ID,
      ttlSeconds: 60 * 60 * 24 * 30,
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(expires_at).toBeInstanceOf(Date);
    const stored = await repo.findByHash(hashRefreshToken(token));
    expect(stored).not.toBeNull();
    expect(stored!.user_id).toBe(USER_ID);
    expect(stored!.revoked_at).toBeNull();
  });

  it('rotate revokes the old token and issues a new one', async () => {
    const { token: t1 } = await issueRefreshToken(repo, {
      user_id: USER_ID,
      ttlSeconds: 3600,
    });
    const result = await rotateRefreshToken(repo, t1, {
      user_id: USER_ID,
      ttlSeconds: 3600,
    });
    expect(result.token).not.toBe(t1);
    const oldRow = await repo.findByHash(hashRefreshToken(t1));
    expect(oldRow!.revoked_at).not.toBeNull();
    const newRow = await repo.findByHash(hashRefreshToken(result.token));
    expect(newRow!.revoked_at).toBeNull();
  });

  it('rotate rejects an unknown token', async () => {
    await expect(
      rotateRefreshToken(repo, 'never-issued', { user_id: USER_ID, ttlSeconds: 3600 }),
    ).rejects.toThrow(/invalid refresh token/i);
  });

  it('rotate rejects an already-revoked token (reuse detection)', async () => {
    const { token: t1 } = await issueRefreshToken(repo, {
      user_id: USER_ID,
      ttlSeconds: 3600,
    });
    await rotateRefreshToken(repo, t1, { user_id: USER_ID, ttlSeconds: 3600 });
    await expect(
      rotateRefreshToken(repo, t1, { user_id: USER_ID, ttlSeconds: 3600 }),
    ).rejects.toThrow(/revoked|reuse/i);
  });

  it('rotate rejects an expired token', async () => {
    const { token } = await issueRefreshToken(repo, {
      user_id: USER_ID,
      ttlSeconds: -1,
    });
    await expect(
      rotateRefreshToken(repo, token, { user_id: USER_ID, ttlSeconds: 3600 }),
    ).rejects.toThrow(/expired/i);
  });
});

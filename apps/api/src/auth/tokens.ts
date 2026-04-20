// TASK-029 — JWT access tokens + rotating refresh tokens (AD-6).
//
// Access token: HS256 JWT (short-lived, default 15 min) carrying
// { sub, restaurant_id, role }. Signed + verified with `jose` so we get
// standards-compliant exp/nbf checks without a bespoke clock.
//
// Refresh token: opaque 32-byte random string, base64url encoded. The raw
// token is returned once to the client (in an httpOnly cookie) and never
// persisted. We persist `sha256(token)` in `refresh_token.token_hash` —
// leaks of the DB cannot be replayed as auth. Rotation revokes the prior
// row and issues a new one; replaying a revoked token is treated as reuse.
//
// The repo interface is injected so this module stays DB-free and can be
// unit-tested with an in-memory Map (see __tests__/tokens.test.ts).

import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@tp/types';

export interface AccessTokenClaims {
  sub: string;
  restaurant_id: string;
  role: Role;
}

export interface SignOpts {
  secret: string;
  ttlSeconds: number;
  issuer?: string;
  audience?: string;
}

export interface VerifyOpts {
  secret: string;
  issuer?: string;
  audience?: string;
}

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(
  claims: AccessTokenClaims,
  opts: SignOpts,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({
    restaurant_id: claims.restaurant_id,
    role: claims.role,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + opts.ttlSeconds);
  if (opts.issuer) jwt.setIssuer(opts.issuer);
  if (opts.audience) jwt.setAudience(opts.audience);
  return jwt.sign(encodeSecret(opts.secret));
}

export async function verifyAccessToken(
  token: string,
  opts: VerifyOpts,
): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, encodeSecret(opts.secret), {
    issuer: opts.issuer,
    audience: opts.audience,
    algorithms: ['HS256'],
  });
  if (typeof payload.sub !== 'string') throw new Error('jwt missing sub');
  if (typeof payload['restaurant_id'] !== 'string') throw new Error('jwt missing restaurant_id');
  const role = payload['role'];
  if (role !== 'owner' && role !== 'manager' && role !== 'staff') {
    throw new Error('jwt invalid role');
  }
  return {
    sub: payload.sub,
    restaurant_id: payload['restaurant_id'] as string,
    role,
  };
}

// ─── refresh tokens ────────────────────────────────────────────────────────

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

export interface RefreshTokenRepo {
  insert(row: RefreshTokenRow): Promise<void>;
  findByHash(token_hash: string): Promise<RefreshTokenRow | null>;
  revoke(token_hash: string, at: Date): Promise<void>;
}

export interface IssueOpts {
  user_id: string;
  ttlSeconds: number;
}

export interface IssueResult {
  token: string;
  expires_at: Date;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function genRawToken(): string {
  return randomBytes(32).toString('base64url');
}

function genId(): string {
  // RFC 4122 v4-ish — good enough for a non-colliding id without pulling
  // crypto.randomUUID type flavour into the public surface.
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function issueRefreshToken(
  repo: RefreshTokenRepo,
  opts: IssueOpts,
): Promise<IssueResult> {
  const token = genRawToken();
  const now = new Date();
  const expires_at = new Date(now.getTime() + opts.ttlSeconds * 1000);
  await repo.insert({
    id: genId(),
    user_id: opts.user_id,
    token_hash: hashRefreshToken(token),
    expires_at,
    revoked_at: null,
    created_at: now,
  });
  return { token, expires_at };
}

export async function rotateRefreshToken(
  repo: RefreshTokenRepo,
  presentedToken: string,
  opts: IssueOpts,
): Promise<IssueResult> {
  const oldHash = hashRefreshToken(presentedToken);
  const row = await repo.findByHash(oldHash);
  if (!row) throw new Error('invalid refresh token');
  if (row.user_id !== opts.user_id) throw new Error('invalid refresh token (subject mismatch)');
  if (row.revoked_at !== null) {
    throw new Error('refresh token already revoked — possible reuse');
  }
  if (row.expires_at.getTime() < Date.now()) {
    throw new Error('refresh token expired');
  }
  await repo.revoke(oldHash, new Date());
  return issueRefreshToken(repo, opts);
}

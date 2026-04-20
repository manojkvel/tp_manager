// TASK-029 — Auth orchestration (§6.13, AD-6).
//
// Wires the primitives (password, tokens) to the user + refresh-token repos.
// Repos are injected (Prisma implementation in prisma-repos.ts) so this layer
// stays easy to unit-test.
//
// login      — validates credentials, updates last_login_at, issues access +
//              refresh tokens. Unknown email / wrong password / inactive user
//              return the same generic "invalid credentials" error (no user
//              enumeration).
// refresh    — rotates the presented refresh token (AD-6). Reuse of a revoked
//              token throws and should trigger a 401 upstream.
// logout     — revokes the presented refresh token.
// forgotPassword — always returns void (same shape for unknown emails, no
//              enumeration). When the email matches, produces a short-lived
//              single-use reset token; delivery is the responsibility of the
//              caller (email hook is TODO — see docs/adr/0006).

import { hashPassword, verifyPassword } from './password.js';
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  hashRefreshToken,
  type AccessTokenClaims,
  type RefreshTokenRepo,
} from './tokens.js';
import type { Role } from '@tp/types';

export interface UserRow {
  id: string;
  restaurant_id: string;
  email: string;
  password_hash: string;
  role: Role;
  active: boolean;
}

export interface UserRepo {
  findByEmail(email: string): Promise<UserRow | null>;
  findById(id: string): Promise<UserRow | null>;
  updateLastLogin(user_id: string, at: Date): Promise<void>;
  updatePasswordHash(user_id: string, hash: string): Promise<void>;
}

export interface AuthServiceDeps {
  users: UserRepo;
  refreshTokens: RefreshTokenRepo;
  jwtSecret: string;
  accessTokenTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: Pick<UserRow, 'id' | 'restaurant_id' | 'email' | 'role'>;
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('invalid credentials');
    this.name = 'InvalidCredentialsError';
  }
}

export class RefreshFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefreshFailedError';
  }
}

const DEFAULT_ACCESS_TTL = 15 * 60;        // 15 min
const DEFAULT_REFRESH_TTL = 30 * 24 * 3600; // 30 days

export class AuthService {
  private readonly accessTtl: number;
  private readonly refreshTtl: number;

  constructor(private readonly deps: AuthServiceDeps) {
    this.accessTtl = deps.accessTokenTtlSeconds ?? DEFAULT_ACCESS_TTL;
    this.refreshTtl = deps.refreshTokenTtlSeconds ?? DEFAULT_REFRESH_TTL;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.deps.users.findByEmail(email.toLowerCase().trim());
    if (!user || !user.active) throw new InvalidCredentialsError();
    const ok = await verifyPassword(user.password_hash, password);
    if (!ok) throw new InvalidCredentialsError();

    await this.deps.users.updateLastLogin(user.id, new Date());
    return this.issueTokens(user);
  }

  async refresh(presentedToken: string): Promise<LoginResult> {
    const stored = await this.deps.refreshTokens.findByHash(hashRefreshToken(presentedToken));
    if (!stored) throw new RefreshFailedError('invalid refresh token');
    const user = await this.deps.users.findById(stored.user_id);
    if (!user || !user.active) throw new RefreshFailedError('user inactive');

    const rotated = await rotateRefreshToken(this.deps.refreshTokens, presentedToken, {
      user_id: user.id,
      ttlSeconds: this.refreshTtl,
    });

    const claims: AccessTokenClaims = {
      sub: user.id,
      restaurant_id: user.restaurant_id,
      role: user.role,
    };
    const accessToken = await signAccessToken(claims, {
      secret: this.deps.jwtSecret,
      ttlSeconds: this.accessTtl,
    });
    return {
      accessToken,
      refreshToken: rotated.token,
      refreshExpiresAt: rotated.expires_at,
      user: { id: user.id, restaurant_id: user.restaurant_id, email: user.email, role: user.role },
    };
  }

  async logout(presentedToken: string): Promise<void> {
    const hash = hashRefreshToken(presentedToken);
    const stored = await this.deps.refreshTokens.findByHash(hash);
    if (stored && stored.revoked_at === null) {
      await this.deps.refreshTokens.revoke(hash, new Date());
    }
  }

  /**
   * Forgot-password (§6.13 AC-1). Always resolves void — no enumeration of
   * valid emails. A reset token is produced only for active users; delivery
   * (email) is the caller's concern. Returning the token from the method is
   * intentional so the transport layer can dispatch an email without having
   * to reach back into the service state.
   */
  async forgotPassword(email: string): Promise<{ resetToken: string; userId: string } | null> {
    const user = await this.deps.users.findByEmail(email.toLowerCase().trim());
    if (!user || !user.active) return null;
    // Reset tokens piggy-back on the refresh-token table but with a 1h TTL
    // and a "reset:" prefix so they are distinguishable from session tokens.
    // (A dedicated table is a reasonable future refactor — see ADR-0006.)
    const issued = await issueRefreshToken(this.deps.refreshTokens, {
      user_id: user.id,
      ttlSeconds: 60 * 60,
    });
    return { resetToken: `reset:${issued.token}`, userId: user.id };
  }

  async resetPassword(userId: string, resetToken: string, newPassword: string): Promise<void> {
    if (!resetToken.startsWith('reset:')) throw new RefreshFailedError('invalid reset token');
    const raw = resetToken.slice('reset:'.length);
    const hash = hashRefreshToken(raw);
    const row = await this.deps.refreshTokens.findByHash(hash);
    if (!row || row.user_id !== userId) throw new RefreshFailedError('invalid reset token');
    if (row.revoked_at !== null) throw new RefreshFailedError('reset token already used');
    if (row.expires_at.getTime() < Date.now()) throw new RefreshFailedError('reset token expired');

    const newHash = await hashPassword(newPassword);
    await this.deps.users.updatePasswordHash(userId, newHash);
    await this.deps.refreshTokens.revoke(hash, new Date());
  }

  private async issueTokens(user: UserRow): Promise<LoginResult> {
    const claims: AccessTokenClaims = {
      sub: user.id,
      restaurant_id: user.restaurant_id,
      role: user.role,
    };
    const accessToken = await signAccessToken(claims, {
      secret: this.deps.jwtSecret,
      ttlSeconds: this.accessTtl,
    });
    const refresh = await issueRefreshToken(this.deps.refreshTokens, {
      user_id: user.id,
      ttlSeconds: this.refreshTtl,
    });
    return {
      accessToken,
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expires_at,
      user: { id: user.id, restaurant_id: user.restaurant_id, email: user.email, role: user.role },
    };
  }
}

// User-admin service (§6.11, §6.13) — owner-only endpoints for inviting,
// listing, role-changing, and deactivating users.
//
// MVP invite flow: the owner supplies email + role + name; the service creates
// the user with a random password_hash and issues a reset token so the invitee
// can set their own password on first login. Email delivery is out-of-band
// (see ADR-0006 — same pattern as forgot-password).

import { randomBytes } from 'node:crypto';
import type { Role } from '@tp/types';
import { hashPassword } from '../auth/password.js';
import { issueRefreshToken, type RefreshTokenRepo } from '../auth/tokens.js';

function uuidv4(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class DuplicateEmailError extends Error {
  constructor(email: string) { super(`user with email "${email}" already exists`); this.name = 'DuplicateEmailError'; }
}
export class UserNotFoundError extends Error {
  constructor(id: string) { super(`user ${id} not found`); this.name = 'UserNotFoundError'; }
}
export class CannotDemoteLastOwnerError extends Error {
  constructor() { super('cannot remove the last active owner'); this.name = 'CannotDemoteLastOwnerError'; }
}

export interface UserAdminRow {
  id: string;
  restaurant_id: string;
  email: string;
  name: string | null;
  role: Role;
  active: boolean;
  last_login_at: Date | null;
  created_at: Date;
}

export interface UserAdminRepo {
  list(restaurant_id: string, opts?: { includeInactive?: boolean }): Promise<UserAdminRow[]>;
  findById(id: string): Promise<UserAdminRow | null>;
  findByEmail(restaurant_id: string, email: string): Promise<UserAdminRow | null>;
  insert(row: UserAdminRow & { password_hash: string }): Promise<void>;
  updateRole(id: string, role: Role): Promise<void>;
  updateActive(id: string, active: boolean): Promise<void>;
  countActiveOwners(restaurant_id: string): Promise<number>;
}

export interface UserAdminServiceDeps {
  users: UserAdminRepo;
  refreshTokens: RefreshTokenRepo;
  now?: () => Date;
}

export interface InviteInput {
  email: string;
  name?: string;
  role: Role;
}

export interface InviteResult {
  user: UserAdminRow;
  /** `reset:<token>` — caller dispatches via email out-of-band (ADR-0006). */
  resetToken: string;
}

export class UserAdminService {
  private readonly now: () => Date;
  constructor(private readonly deps: UserAdminServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  list(rid: string, opts: { includeInactive?: boolean } = {}): Promise<UserAdminRow[]> {
    return this.deps.users.list(rid, opts);
  }

  async invite(rid: string, input: InviteInput): Promise<InviteResult> {
    const email = input.email.toLowerCase().trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('invalid email');
    if (await this.deps.users.findByEmail(rid, email)) throw new DuplicateEmailError(email);

    // Random password — invitee sets their own via the reset-token flow.
    const tempPwd = randomBytes(24).toString('base64url');
    const password_hash = await hashPassword(tempPwd);

    const row: UserAdminRow = {
      id: uuidv4(),
      restaurant_id: rid,
      email,
      name: input.name?.trim() || null,
      role: input.role,
      active: true,
      last_login_at: null,
      created_at: this.now(),
    };
    await this.deps.users.insert({ ...row, password_hash });

    const issued = await issueRefreshToken(this.deps.refreshTokens, {
      user_id: row.id,
      ttlSeconds: 7 * 24 * 3600, // invite tokens valid for 7 days
    });
    return { user: row, resetToken: `reset:${issued.token}` };
  }

  async setRole(rid: string, id: string, role: Role): Promise<UserAdminRow> {
    const row = await this.deps.users.findById(id);
    if (!row || row.restaurant_id !== rid) throw new UserNotFoundError(id);
    if (row.role === 'owner' && role !== 'owner') {
      const owners = await this.deps.users.countActiveOwners(rid);
      if (owners <= 1) throw new CannotDemoteLastOwnerError();
    }
    await this.deps.users.updateRole(id, role);
    return { ...row, role };
  }

  async deactivate(rid: string, id: string): Promise<void> {
    const row = await this.deps.users.findById(id);
    if (!row || row.restaurant_id !== rid) throw new UserNotFoundError(id);
    if (row.role === 'owner' && row.active) {
      const owners = await this.deps.users.countActiveOwners(rid);
      if (owners <= 1) throw new CannotDemoteLastOwnerError();
    }
    await this.deps.users.updateActive(id, false);
  }

  async reactivate(rid: string, id: string): Promise<void> {
    const row = await this.deps.users.findById(id);
    if (!row || row.restaurant_id !== rid) throw new UserNotFoundError(id);
    await this.deps.users.updateActive(id, true);
  }
}

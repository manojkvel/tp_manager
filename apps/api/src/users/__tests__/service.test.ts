// Unit tests for UserAdminService.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@tp/types';
import {
  UserAdminService,
  DuplicateEmailError, UserNotFoundError, CannotDemoteLastOwnerError,
  type UserAdminRepo, type UserAdminRow,
} from '../service.js';
import type { RefreshTokenRepo, RefreshTokenRow } from '../../auth/tokens.js';

const RID = '00000000-0000-0000-0000-0000000000aa';
const OTHER_RID = '00000000-0000-0000-0000-0000000000bb';
const NOW = new Date('2026-04-19T12:00:00Z');

function inMemoryUserRepo(): UserAdminRepo & {
  __rows: Map<string, UserAdminRow & { password_hash: string }>;
} {
  const rows = new Map<string, UserAdminRow & { password_hash: string }>();
  return {
    __rows: rows,
    async list(rid, opts) {
      return [...rows.values()]
        .filter((r) => r.restaurant_id === rid && (opts?.includeInactive || r.active))
        .map(({ password_hash: _ph, ...r }) => r);
    },
    async findById(id) {
      const r = rows.get(id);
      if (!r) return null;
      const { password_hash: _ph, ...rest } = r;
      return rest;
    },
    async findByEmail(rid, email) {
      const r = [...rows.values()].find(
        (x) => x.restaurant_id === rid && x.email.toLowerCase() === email.toLowerCase(),
      );
      if (!r) return null;
      const { password_hash: _ph, ...rest } = r;
      return rest;
    },
    async insert(row) { rows.set(row.id, { ...row }); },
    async updateRole(id, role) {
      const r = rows.get(id); if (r) rows.set(id, { ...r, role });
    },
    async updateActive(id, active) {
      const r = rows.get(id); if (r) rows.set(id, { ...r, active });
    },
    async countActiveOwners(rid) {
      return [...rows.values()].filter((r) => r.restaurant_id === rid && r.role === 'owner' && r.active).length;
    },
  };
}

function inMemoryTokenRepo(): RefreshTokenRepo & { __rows: RefreshTokenRow[] } {
  const storage: RefreshTokenRow[] = [];
  return {
    __rows: storage,
    async insert(row) { storage.push({ ...row }); },
    async findByHash(hash) { return storage.find((r) => r.token_hash === hash) ?? null; },
    async revoke(hash, at) {
      const idx = storage.findIndex((r) => r.token_hash === hash);
      if (idx >= 0) storage[idx] = { ...storage[idx]!, revoked_at: at };
    },
  };
}

function seedOwner(repo: ReturnType<typeof inMemoryUserRepo>, id: string, role: Role = 'owner'): void {
  repo.__rows.set(id, {
    id, restaurant_id: RID, email: `${id}@tp.test`, name: null,
    password_hash: 'x', role, active: true, last_login_at: null, created_at: NOW,
  });
}

describe('UserAdminService.invite', () => {
  let repo: ReturnType<typeof inMemoryUserRepo>;
  let tokens: ReturnType<typeof inMemoryTokenRepo>;
  let svc: UserAdminService;
  beforeEach(() => {
    repo = inMemoryUserRepo();
    tokens = inMemoryTokenRepo();
    svc = new UserAdminService({ users: repo, refreshTokens: tokens, now: () => NOW });
  });

  it('creates a user, normalises email to lowercase, and returns a reset-prefixed token', async () => {
    const { user, resetToken } = await svc.invite(RID, { email: ' Chef@TP.test ', role: 'manager' });
    expect(user.email).toBe('chef@tp.test');
    expect(user.role).toBe('manager');
    expect(user.active).toBe(true);
    expect(resetToken.startsWith('reset:')).toBe(true);
    expect(tokens.__rows).toHaveLength(1);
  });

  it('rejects invalid emails', async () => {
    await expect(svc.invite(RID, { email: 'not-an-email', role: 'staff' })).rejects.toThrow(/invalid email/);
  });

  it('rejects duplicate emails within a restaurant', async () => {
    await svc.invite(RID, { email: 'dup@tp.test', role: 'staff' });
    await expect(svc.invite(RID, { email: 'DUP@tp.test', role: 'manager' })).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it('allows the same email in a different restaurant', async () => {
    await svc.invite(RID, { email: 'same@tp.test', role: 'staff' });
    await expect(svc.invite(OTHER_RID, { email: 'same@tp.test', role: 'staff' })).resolves.toBeDefined();
  });
});

describe('UserAdminService.setRole', () => {
  let repo: ReturnType<typeof inMemoryUserRepo>;
  let svc: UserAdminService;
  beforeEach(() => {
    repo = inMemoryUserRepo();
    svc = new UserAdminService({ users: repo, refreshTokens: inMemoryTokenRepo(), now: () => NOW });
  });

  it('updates a user role', async () => {
    seedOwner(repo, 'u1', 'staff');
    const updated = await svc.setRole(RID, 'u1', 'manager');
    expect(updated.role).toBe('manager');
  });

  it('refuses to demote the last active owner', async () => {
    seedOwner(repo, 'owner-1', 'owner');
    seedOwner(repo, 'staff-1', 'staff');
    await expect(svc.setRole(RID, 'owner-1', 'manager')).rejects.toBeInstanceOf(CannotDemoteLastOwnerError);
  });

  it('allows demoting an owner when at least one other active owner exists', async () => {
    seedOwner(repo, 'owner-1', 'owner');
    seedOwner(repo, 'owner-2', 'owner');
    await expect(svc.setRole(RID, 'owner-1', 'manager')).resolves.toBeDefined();
  });

  it('throws NotFoundError for a user in another restaurant', async () => {
    repo.__rows.set('foreign', {
      id: 'foreign', restaurant_id: OTHER_RID, email: 'f@tp.test', name: null,
      password_hash: 'x', role: 'staff', active: true, last_login_at: null, created_at: NOW,
    });
    await expect(svc.setRole(RID, 'foreign', 'manager')).rejects.toBeInstanceOf(UserNotFoundError);
  });
});

describe('UserAdminService.deactivate + reactivate', () => {
  let repo: ReturnType<typeof inMemoryUserRepo>;
  let svc: UserAdminService;
  beforeEach(() => {
    repo = inMemoryUserRepo();
    svc = new UserAdminService({ users: repo, refreshTokens: inMemoryTokenRepo(), now: () => NOW });
  });

  it('deactivates a staff user and hides them from the default list', async () => {
    seedOwner(repo, 'owner-1', 'owner');
    seedOwner(repo, 'staff-1', 'staff');
    await svc.deactivate(RID, 'staff-1');
    expect(await svc.list(RID)).toHaveLength(1);
    expect(await svc.list(RID, { includeInactive: true })).toHaveLength(2);
  });

  it('refuses to deactivate the last active owner', async () => {
    seedOwner(repo, 'owner-1', 'owner');
    await expect(svc.deactivate(RID, 'owner-1')).rejects.toBeInstanceOf(CannotDemoteLastOwnerError);
  });

  it('reactivates a previously-deactivated user', async () => {
    seedOwner(repo, 'owner-1', 'owner');
    seedOwner(repo, 'staff-1', 'staff');
    await svc.deactivate(RID, 'staff-1');
    await svc.reactivate(RID, 'staff-1');
    expect(await svc.list(RID)).toHaveLength(2);
  });
});

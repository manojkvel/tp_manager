// TASK-029 — Prisma-backed implementations of UserRepo + RefreshTokenRepo.
//
// Kept separate from the service so tests can inject in-memory repos without
// pulling Prisma through the test runner. Production wiring passes a shared
// PrismaClient from apps/api/src/main.ts.

import type { PrismaClient } from '@prisma/client';
import type { UserRepo, UserRow } from './service.js';
import type { RefreshTokenRepo, RefreshTokenRow } from './tokens.js';
import type { Role } from '@tp/types';

export function prismaUserRepo(prisma: PrismaClient): UserRepo {
  return {
    async findByEmail(email) {
      const user = await prisma.user.findFirst({ where: { email } });
      return user ? mapUser(user) : null;
    },
    async findById(id) {
      const user = await prisma.user.findUnique({ where: { id } });
      return user ? mapUser(user) : null;
    },
    async updateLastLogin(user_id, at) {
      await prisma.user.update({ where: { id: user_id }, data: { last_login_at: at } });
    },
    async updatePasswordHash(user_id, hash) {
      await prisma.user.update({ where: { id: user_id }, data: { password_hash: hash } });
    },
  };
}

export function prismaRefreshTokenRepo(prisma: PrismaClient): RefreshTokenRepo {
  return {
    async insert(row: RefreshTokenRow) {
      await prisma.refreshToken.create({
        data: {
          id: row.id,
          user_id: row.user_id,
          token_hash: row.token_hash,
          expires_at: row.expires_at,
          revoked_at: row.revoked_at,
          created_at: row.created_at,
        },
      });
    },
    async findByHash(token_hash) {
      const row = await prisma.refreshToken.findUnique({ where: { token_hash } });
      return row
        ? {
            id: row.id,
            user_id: row.user_id,
            token_hash: row.token_hash,
            expires_at: row.expires_at,
            revoked_at: row.revoked_at,
            created_at: row.created_at,
          }
        : null;
    },
    async revoke(token_hash, at) {
      await prisma.refreshToken.update({ where: { token_hash }, data: { revoked_at: at } });
    },
  };
}

function mapUser(u: {
  id: string;
  restaurant_id: string;
  email: string;
  password_hash: string;
  role: string;
  active: boolean;
}): UserRow {
  return {
    id: u.id,
    restaurant_id: u.restaurant_id,
    email: u.email,
    password_hash: u.password_hash,
    role: u.role as Role,
    active: u.active,
  };
}

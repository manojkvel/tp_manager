// Prisma adapter for UserAdminRepo.

import type { PrismaClient } from '@prisma/client';
import type { Role } from '@tp/types';
import type { UserAdminRepo, UserAdminRow } from './service.js';

export function prismaUserAdminRepo(prisma: PrismaClient): UserAdminRepo {
  return {
    async list(restaurant_id, opts) {
      const where: Record<string, unknown> = { restaurant_id };
      if (!opts?.includeInactive) where['active'] = true;
      const rows = await prisma.user.findMany({
        where,
        orderBy: [{ active: 'desc' }, { email: 'asc' }],
      });
      return rows.map(mapUser);
    },
    async findById(id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- caller enforces tenant check
      const row = await prisma.user.findUnique({ where: { id } });
      return row ? mapUser(row) : null;
    },
    async findByEmail(restaurant_id, email) {
      const row = await prisma.user.findFirst({
        where: { restaurant_id, email: { equals: email, mode: 'insensitive' } },
      });
      return row ? mapUser(row) : null;
    },
    async insert(row) {
      await prisma.user.create({
        data: {
          id: row.id,
          restaurant_id: row.restaurant_id,
          email: row.email,
          name: row.name,
          password_hash: row.password_hash,
          role: row.role,
          active: row.active,
          created_at: row.created_at,
        },
      });
    },
    async updateRole(id, role) {
      await prisma.user.update({ where: { id }, data: { role } });
    },
    async updateActive(id, active) {
      await prisma.user.update({ where: { id }, data: { active } });
    },
    async countActiveOwners(restaurant_id) {
      return prisma.user.count({ where: { restaurant_id, role: 'owner', active: true } });
    },
  };
}

function mapUser(u: {
  id: string; restaurant_id: string; email: string; name: string | null;
  role: string; active: boolean; last_login_at: Date | null; created_at: Date;
}): UserAdminRow {
  return {
    id: u.id,
    restaurant_id: u.restaurant_id,
    email: u.email,
    name: u.name,
    role: u.role as Role,
    active: u.active,
    last_login_at: u.last_login_at,
    created_at: u.created_at,
  };
}

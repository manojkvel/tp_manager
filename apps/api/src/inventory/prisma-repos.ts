// TASK-053 — Prisma-backed repo for inventory counts.

import type { PrismaClient } from '@prisma/client';
import type {
  InventoryCountRepo, InventoryCount, InventoryCountLine, InventoryCountStatus,
} from './service.js';

export function prismaInventoryCountRepo(prisma: PrismaClient): InventoryCountRepo {
  return {
    async findById(id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- service enforces tenant check
      const row = await prisma.inventoryCount.findUnique({ where: { id } });
      return row ? map(row) : null;
    },
    async insert(row) {
      await prisma.inventoryCount.create({
        data: {
          id: row.id,
          restaurant_id: row.restaurant_id,
          date: row.date,
          status: row.status,
          started_by: row.started_by,
          completed_by: row.completed_by,
          amends_count_id: row.amends_count_id,
          created_at: row.created_at,
        },
      });
    },
    async updateStatus(id, status, completed_by) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- PK update after tenant check
      await prisma.inventoryCount.update({
        where: { id },
        data: { status, ...(completed_by !== undefined ? { completed_by } : {}) },
      });
    },
    async linesFor(count_id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped via count_id FK
      const rows = await prisma.inventoryCountLine.findMany({ where: { count_id } });
      return rows.map(mapLine);
    },
    async insertLine(line) {
      await prisma.inventoryCountLine.create({
        data: {
          id: line.id,
          count_id: line.count_id,
          ref_type: line.ref_type,
          ingredient_id: line.ingredient_id,
          recipe_version_id: line.recipe_version_id,
          location_id: line.location_id,
          expected_qty: line.expected_qty,
          actual_qty: line.actual_qty,
          unit_cost_cents: line.unit_cost_cents,
        },
      });
    },
    async replaceLine(line) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- PK update; count FK bounds tenant
      await prisma.inventoryCountLine.update({
        where: { id: line.id },
        data: {
          actual_qty: line.actual_qty,
          expected_qty: line.expected_qty,
          unit_cost_cents: line.unit_cost_cents,
          location_id: line.location_id,
        },
      });
    },
  };
}

function map(r: {
  id: string; restaurant_id: string; date: Date; status: string;
  started_by: string | null; completed_by: string | null;
  amends_count_id: string | null; created_at: Date;
}): InventoryCount {
  return {
    id: r.id,
    restaurant_id: r.restaurant_id,
    date: r.date,
    status: r.status as InventoryCountStatus,
    started_by: r.started_by,
    completed_by: r.completed_by,
    amends_count_id: r.amends_count_id,
    created_at: r.created_at,
  };
}

function mapLine(l: {
  id: string; count_id: string; ref_type: string;
  ingredient_id: string | null; recipe_version_id: string | null; location_id: string | null;
  expected_qty: unknown; actual_qty: unknown; unit_cost_cents: number | null;
}): InventoryCountLine {
  return {
    id: l.id,
    count_id: l.count_id,
    ref_type: l.ref_type as 'ingredient' | 'recipe',
    ingredient_id: l.ingredient_id,
    recipe_version_id: l.recipe_version_id,
    location_id: l.location_id,
    expected_qty: l.expected_qty == null ? null : Number(l.expected_qty),
    actual_qty: Number(l.actual_qty),
    unit_cost_cents: l.unit_cost_cents,
  };
}

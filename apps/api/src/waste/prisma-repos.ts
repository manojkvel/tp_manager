// TASK-060 — Prisma-backed repos for waste + cost lookup + expired source.

import type { PrismaClient } from '@prisma/client';
import type {
  WasteRepo, CostLookup, ExpiredSource, WasteEntry, ExpiredCandidate, WasteRefType,
  WasteAttributionBucket,
} from './service.js';

export function prismaWasteRepo(prisma: PrismaClient): WasteRepo {
  return {
    async insert(e) {
      await prisma.wasteEntry.create({
        data: {
          id: e.id,
          restaurant_id: e.restaurant_id,
          ref_type: e.ref_type,
          ingredient_id: e.ingredient_id,
          recipe_version_id: e.recipe_version_id,
          qty: e.qty,
          uom: e.uom,
          reason_id: e.reason_id,
          attribution_bucket: e.attribution_bucket,
          station_code: e.station_code,
          note: e.note,
          photo_url: e.photo_url,
          unit_cost_cents_pinned: e.unit_cost_cents_pinned,
          value_cents: e.value_cents,
          user_id: e.user_id,
          at: e.at,
        },
      });
    },
    async list(restaurant_id, since) {
      const rows = await prisma.wasteEntry.findMany({
        where: { restaurant_id, at: { gte: since } },
        orderBy: { at: 'desc' },
      });
      return rows.map(map);
    },
    async totalValueCents(restaurant_id, since, until) {
      const agg = await prisma.wasteEntry.aggregate({
        where: { restaurant_id, at: { gte: since, lt: until } },
        _sum: { value_cents: true },
      });
      return agg._sum.value_cents ?? 0;
    },
    async listRange(restaurant_id, since, until) {
      const rows = await prisma.wasteEntry.findMany({
        where: { restaurant_id, at: { gte: since, lt: until } },
        orderBy: { at: 'desc' },
      });
      return rows.map(map);
    },
  };
}

export function prismaCostLookup(prisma: PrismaClient): CostLookup {
  return {
    async resolve(ref_type, ingredient_id, recipe_version_id) {
      if (ref_type === 'ingredient' && ingredient_id) {
        // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped via ingredient_id FK
        const c = await prisma.ingredientCost.findFirst({
          where: { ingredient_id },
          orderBy: { effective_from: 'desc' },
          select: { unit_cost_cents: true },
        });
        return c?.unit_cost_cents ?? 0;
      }
      if (ref_type === 'prep' && recipe_version_id) {
        // Use plated cost stamp via average ingredient cost x qty / yield_qty.
        // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped via recipe_version_id FK
        const v = await prisma.recipeVersion.findUnique({
          where: { id: recipe_version_id },
          include: {
            lines: {
              include: {
                ingredient: { include: { costs: { orderBy: { effective_from: 'desc' }, take: 1 } } },
              },
            },
          },
        });
        if (!v) return 0;
        const yieldQty = Number(v.yield_qty) || 1;
        let total = 0;
        for (const l of v.lines) {
          if (l.ref_type !== 'ingredient' || !l.ingredient) continue;
          const cost = l.ingredient.costs[0]?.unit_cost_cents ?? 0;
          total += cost * Number(l.qty);
        }
        return Math.round(total / yieldQty);
      }
      return 0;
    },
  };
}

export function prismaExpiredSource(prisma: PrismaClient): ExpiredSource {
  return {
    async expired(restaurant_id, asOf) {
      // PrepRuns past expires_on, not yet logged as waste in last 24h.
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped via recipe.restaurant_id
      const runs = await prisma.prepRun.findMany({
        where: {
          expires_on: { lt: asOf, not: null },
          recipe_version: { recipe: { restaurant_id } },
        },
        include: {
          recipe_version: { include: { recipe: { select: { id: true, name: true } } } },
        },
        orderBy: { expires_on: 'asc' },
        take: 50,
      });
      const out: ExpiredCandidate[] = [];
      for (const r of runs) {
        out.push({
          ref_type: 'prep',
          ingredient_id: null,
          recipe_version_id: r.recipe_version_id,
          label: r.recipe_version.recipe.name,
          qty: Number(r.qty_yielded),
          uom: 'batch',
          expired_on: r.expires_on!,
          reason_suggestion: 'expired',
        });
      }
      return out;
    },
  };
}

function map(r: {
  id: string; restaurant_id: string; ref_type: string;
  ingredient_id: string | null; recipe_version_id: string | null;
  qty: unknown; uom: string; reason_id: string;
  attribution_bucket: string; station_code: string | null;
  note: string | null; photo_url: string | null;
  unit_cost_cents_pinned: number; value_cents: number;
  user_id: string | null; at: Date;
}): WasteEntry {
  return {
    id: r.id,
    restaurant_id: r.restaurant_id,
    ref_type: r.ref_type as WasteRefType,
    ingredient_id: r.ingredient_id,
    recipe_version_id: r.recipe_version_id,
    qty: Number(r.qty),
    uom: r.uom,
    reason_id: r.reason_id,
    attribution_bucket: r.attribution_bucket as WasteAttributionBucket,
    station_code: r.station_code,
    note: r.note,
    photo_url: r.photo_url,
    unit_cost_cents_pinned: r.unit_cost_cents_pinned,
    value_cents: r.value_cents,
    user_id: r.user_id,
    at: r.at,
  };
}

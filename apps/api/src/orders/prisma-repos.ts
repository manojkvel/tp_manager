// TASK-059 — Prisma-backed repos for orders.

import type { PrismaClient } from '@prisma/client';
import type {
  OrderRepo, SuggestionSource, SuggestionInput, Order, OrderLine, OrderStatus,
} from './service.js';

export function prismaOrderRepo(prisma: PrismaClient): OrderRepo {
  return {
    async insert(o) {
      await prisma.order.create({
        data: {
          id: o.id,
          restaurant_id: o.restaurant_id,
          supplier_id: o.supplier_id,
          status: o.status,
          sent_at: o.sent_at,
          expected_on: o.expected_on,
          created_at: o.created_at,
        },
      });
    },
    async insertLine(l) {
      await prisma.orderLine.create({
        data: {
          id: l.id,
          order_id: l.order_id,
          ingredient_id: l.ingredient_id,
          qty: l.qty,
          pack_size: l.pack_size,
          unit_cost_cents: l.unit_cost_cents,
        },
      });
    },
    async findById(id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- service enforces tenant check
      const row = await prisma.order.findUnique({ where: { id } });
      return row ? mapOrder(row) : null;
    },
    async linesFor(order_id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped via order_id FK
      const rows = await prisma.orderLine.findMany({ where: { order_id } });
      return rows.map(mapLine);
    },
    async updateStatus(id, status, sent_at) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- PK update after tenant check
      await prisma.order.update({ where: { id }, data: { status, sent_at } });
    },
    async list(restaurant_id, status) {
      const rows = await prisma.order.findMany({
        where: { restaurant_id, ...(status ? { status } : {}) },
        orderBy: { created_at: 'desc' },
      });
      return rows.map(mapOrder);
    },
  };
}

/** Suggestion source: derive ingredient demand from par + on-hand + in-transit. */
export function prismaSuggestionSource(prisma: PrismaClient): SuggestionSource {
  return {
    async candidates(restaurant_id) {
      const ingredients = await prisma.ingredient.findMany({
        where: { restaurant_id, is_archived: false, default_supplier_id: { not: null } },
        select: {
          id: true, name: true, pack_size: true, default_supplier_id: true,
          costs: { orderBy: { effective_from: 'desc' }, take: 1, select: { unit_cost_cents: true } },
        },
      });
      const out: SuggestionInput[] = [];
      for (const ing of ingredients) {
        const onHand = await onHandFor(prisma, ing.id);
        const inTransit = await inTransitFor(prisma, ing.id);
        const par = await derivedParFor(prisma, restaurant_id, ing.id);
        if (par <= 0) continue;
        out.push({
          ingredient_id: ing.id,
          ingredient_name: ing.name,
          par_qty: par,
          on_hand_qty: onHand,
          in_transit_qty: inTransit,
          pack_size: ing.pack_size == null ? null : Number(ing.pack_size),
          unit_cost_cents: ing.costs[0]?.unit_cost_cents ?? 0,
          supplier_id: ing.default_supplier_id!,
        });
      }
      return out;
    },
  };
}

async function onHandFor(prisma: PrismaClient, ingredient_id: string): Promise<number> {
  // Latest completed inventory count line for this ingredient.
  // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped via ingredient_id
  const line = await prisma.inventoryCountLine.findFirst({
    where: { ingredient_id, count: { status: 'completed' } },
    orderBy: { count: { date: 'desc' } },
    select: { actual_qty: true },
  });
  return line ? Number(line.actual_qty) : 0;
}

async function inTransitFor(prisma: PrismaClient, ingredient_id: string): Promise<number> {
  // Sum of order_line.qty for orders sent but not received.
  const sent = await prisma.orderLine.findMany({
    where: { ingredient_id, order: { status: 'sent' } },
    select: { qty: true },
  });
  return sent.reduce((acc, r) => acc + Number(r.qty), 0);
}

async function derivedParFor(
  prisma: PrismaClient, restaurant_id: string, ingredient_id: string,
): Promise<number> {
  // Sum of par_level qty across all recipes that reference this ingredient,
  // averaged across the week → per-day need scaled to a 7-day par buffer.
  // eslint-disable-next-line @tp/tp/require-restaurant-id -- restaurant_id is in the where
  const lines = await prisma.recipeLine.findMany({
    where: {
      ingredient_id,
      recipe_version: { recipe: { restaurant_id, is_archived: false }, is_current: true },
    },
    select: {
      qty: true,
      recipe_version: {
        select: {
          yield_qty: true,
          recipe: { select: { id: true, par_levels: { select: { qty: true } } } },
        },
      },
    },
  });
  let total = 0;
  for (const l of lines) {
    const yieldQty = Number(l.recipe_version.yield_qty) || 1;
    const perUnit = Number(l.qty) / yieldQty;
    const recipeWeeklyPar = l.recipe_version.recipe.par_levels.reduce((s, p) => s + Number(p.qty), 0);
    total += perUnit * recipeWeeklyPar;
  }
  return total;
}

function mapOrder(r: {
  id: string; restaurant_id: string; supplier_id: string; status: string;
  sent_at: Date | null; expected_on: Date | null; created_at: Date;
}): Order {
  return {
    id: r.id,
    restaurant_id: r.restaurant_id,
    supplier_id: r.supplier_id,
    status: r.status as OrderStatus,
    sent_at: r.sent_at,
    expected_on: r.expected_on,
    created_at: r.created_at,
  };
}

function mapLine(l: {
  id: string; order_id: string; ingredient_id: string;
  qty: unknown; pack_size: unknown; unit_cost_cents: number;
}): OrderLine {
  return {
    id: l.id,
    order_id: l.order_id,
    ingredient_id: l.ingredient_id,
    qty: Number(l.qty),
    pack_size: l.pack_size == null ? null : Number(l.pack_size),
    unit_cost_cents: l.unit_cost_cents,
  };
}

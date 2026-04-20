// TASK-035 — Prisma-backed repos for suppliers.

import type { PrismaClient } from '@prisma/client';
import type {
  SupplierRepo,
  SupplierOfferRepo,
  SupplierRow,
  SupplierOfferRow,
  ListSupplierFilters,
} from './service.js';

export function prismaSupplierRepo(prisma: PrismaClient): SupplierRepo {
  return {
    async list(restaurant_id: string, filters: ListSupplierFilters = {}) {
      const where: Record<string, unknown> = { restaurant_id };
      if (!filters.includeInactive) where['is_active'] = true;
      const rows = await prisma.supplier.findMany({ where, orderBy: { name: 'asc' } });
      return rows.map(mapSupplier);
    },
    async findById(id: string) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- service layer enforces restaurant_id check
      const row = await prisma.supplier.findUnique({ where: { id } });
      return row ? mapSupplier(row) : null;
    },
    async findByName(restaurant_id: string, name: string) {
      const row = await prisma.supplier.findFirst({
        where: { restaurant_id, name: { equals: name, mode: 'insensitive' } },
      });
      return row ? mapSupplier(row) : null;
    },
    async insert(row: SupplierRow) {
      await prisma.supplier.create({
        data: {
          id: row.id,
          restaurant_id: row.restaurant_id,
          name: row.name,
          contact_name: row.contact_name,
          email: row.email,
          phone: row.phone,
          lead_time_days: row.lead_time_days,
          min_order_cents: row.min_order_cents,
          order_cadence: row.order_cadence,
          is_active: row.is_active,
          created_at: row.created_at,
        },
      });
    },
    async update(id: string, patch: Partial<SupplierRow>) {
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) data[k] = v;
      await prisma.supplier.update({ where: { id }, data });
    },
    async deactivate(id: string) {
      await prisma.supplier.update({ where: { id }, data: { is_active: false } });
    },
  };
}

export function prismaSupplierOfferRepo(prisma: PrismaClient): SupplierOfferRepo {
  return {
    async offersForIngredient(ingredient_id: string) {
      const rows = await prisma.supplierIngredient.findMany({
        where: { ingredient_id, effective_until: null },
        orderBy: { rank: 'asc' },
      });
      return rows.map(mapOffer);
    },
    async offersForSupplier(supplier_id: string) {
      const rows = await prisma.supplierIngredient.findMany({
        where: { supplier_id, effective_until: null },
      });
      return rows.map(mapOffer);
    },
    async insert(row: SupplierOfferRow) {
      await prisma.supplierIngredient.create({
        data: {
          id: row.id,
          supplier_id: row.supplier_id,
          ingredient_id: row.ingredient_id,
          supplier_pack_size: row.supplier_pack_size,
          unit_cost_cents: row.unit_cost_cents,
          rank: row.rank,
          effective_from: row.effective_from,
          effective_until: row.effective_until,
          created_at: row.created_at,
        },
      });
    },
    async endCurrent(ingredient_id: string, supplier_id: string, at: Date) {
      await prisma.supplierIngredient.updateMany({
        where: { ingredient_id, supplier_id, effective_until: null },
        data: { effective_until: at },
      });
    },
    async historyForIngredient(ingredient_id: string) {
      const rows = await prisma.supplierIngredient.findMany({
        where: { ingredient_id },
        orderBy: { effective_from: 'asc' },
      });
      return rows.map(mapOffer);
    },
  };
}

function mapSupplier(row: {
  id: string; restaurant_id: string; name: string; contact_name: string | null;
  email: string | null; phone: string | null; lead_time_days: number;
  min_order_cents: number; order_cadence: string | null; is_active: boolean;
  created_at: Date;
}): SupplierRow {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    name: row.name,
    contact_name: row.contact_name,
    email: row.email,
    phone: row.phone,
    lead_time_days: row.lead_time_days,
    min_order_cents: row.min_order_cents,
    order_cadence: row.order_cadence,
    is_active: row.is_active,
    created_at: row.created_at,
  };
}

function mapOffer(row: {
  id: string; supplier_id: string; ingredient_id: string;
  supplier_pack_size: unknown; unit_cost_cents: number; rank: number;
  effective_from: Date; effective_until: Date | null; created_at: Date;
}): SupplierOfferRow {
  return {
    id: row.id,
    supplier_id: row.supplier_id,
    ingredient_id: row.ingredient_id,
    supplier_pack_size: row.supplier_pack_size == null ? null : Number(row.supplier_pack_size),
    unit_cost_cents: row.unit_cost_cents,
    rank: row.rank,
    effective_from: row.effective_from,
    effective_until: row.effective_until,
    created_at: row.created_at,
  };
}

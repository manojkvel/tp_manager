// TASK-036 — Prisma-backed repos for the settings catalogue (§6.11).

import type { PrismaClient } from '@prisma/client';
import type {
  LocationRepo, LocationRow, LocationKind,
  UtensilRepo, UtensilRow, UtensilKind,
  EquivalenceRepo, EquivalenceRow,
  WasteReasonRepo, WasteReasonRow,
  StationRepo, StationRow,
  ParLevelRepo, ParLevelRow,
} from './service.js';

export function prismaLocationRepo(prisma: PrismaClient): LocationRepo {
  return {
    async list(restaurant_id, includeArchived) {
      const where: Record<string, unknown> = { restaurant_id };
      if (!includeArchived) where['is_archived'] = false;
      const rows = await prisma.location.findMany({ where, orderBy: { name: 'asc' } });
      return rows.map(mapLocation);
    },
    async findById(id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- service enforces tenant check
      const row = await prisma.location.findUnique({ where: { id } });
      return row ? mapLocation(row) : null;
    },
    async findByName(restaurant_id, name) {
      const row = await prisma.location.findFirst({
        where: { restaurant_id, name: { equals: name, mode: 'insensitive' } },
      });
      return row ? mapLocation(row) : null;
    },
    async insert(row) {
      await prisma.location.create({
        data: {
          id: row.id,
          restaurant_id: row.restaurant_id,
          name: row.name,
          kind: row.kind,
          is_archived: row.is_archived,
          created_at: row.created_at,
        },
      });
    },
    async update(id, patch) {
      const data = stripUndefined(patch);
      await prisma.location.update({ where: { id }, data });
    },
    async archive(id) {
      await prisma.location.update({ where: { id }, data: { is_archived: true } });
    },
  };
}

export function prismaUtensilRepo(prisma: PrismaClient): UtensilRepo {
  return {
    async list(restaurant_id, includeArchived) {
      const where: Record<string, unknown> = { restaurant_id };
      if (!includeArchived) where['is_archived'] = false;
      const rows = await prisma.portionUtensil.findMany({ where, orderBy: { name: 'asc' } });
      return rows.map(mapUtensil);
    },
    async findById(id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- service enforces tenant check
      const row = await prisma.portionUtensil.findUnique({ where: { id } });
      return row ? mapUtensil(row) : null;
    },
    async findByName(restaurant_id, name) {
      const row = await prisma.portionUtensil.findFirst({
        where: { restaurant_id, name: { equals: name, mode: 'insensitive' } },
      });
      return row ? mapUtensil(row) : null;
    },
    async insert(row) {
      await prisma.portionUtensil.create({
        data: {
          id: row.id,
          restaurant_id: row.restaurant_id,
          name: row.name,
          label_colour: row.label_colour,
          kind: row.kind,
          default_uom: row.default_uom,
          default_qty: row.default_qty,
          is_archived: row.is_archived,
          created_at: row.created_at,
        },
      });
    },
    async update(id, patch) {
      await prisma.portionUtensil.update({ where: { id }, data: stripUndefined(patch) });
    },
    async archive(id) {
      await prisma.portionUtensil.update({ where: { id }, data: { is_archived: true } });
    },
  };
}

export function prismaEquivalenceRepo(prisma: PrismaClient): EquivalenceRepo {
  return {
    async forUtensil(utensil_id) {
      const rows = await prisma.utensilEquivalence.findMany({ where: { utensil_id } });
      return rows.map(mapEquivalence);
    },
    async findDefault(utensil_id) {
      const row = await prisma.utensilEquivalence.findFirst({
        where: { utensil_id, ingredient_id: null },
      });
      return row ? mapEquivalence(row) : null;
    },
    async findOverride(utensil_id, ingredient_id) {
      const row = await prisma.utensilEquivalence.findFirst({
        where: { utensil_id, ingredient_id },
      });
      return row ? mapEquivalence(row) : null;
    },
    async insert(row) {
      await prisma.utensilEquivalence.create({
        data: {
          id: row.id,
          utensil_id: row.utensil_id,
          ingredient_id: row.ingredient_id,
          equivalent_qty: row.equivalent_qty,
          equivalent_uom: row.equivalent_uom,
          source: row.source,
          created_at: row.created_at,
        },
      });
    },
    async update(id, patch) {
      await prisma.utensilEquivalence.update({ where: { id }, data: stripUndefined(patch) });
    },
    async remove(id) {
      await prisma.utensilEquivalence.delete({ where: { id } });
    },
  };
}

export function prismaWasteReasonRepo(prisma: PrismaClient): WasteReasonRepo {
  return {
    async list(restaurant_id, includeArchived) {
      const where: Record<string, unknown> = { restaurant_id };
      if (!includeArchived) where['is_archived'] = false;
      const rows = await prisma.wasteReason.findMany({ where, orderBy: { code: 'asc' } });
      return rows.map(mapWasteReason);
    },
    async findById(id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- service enforces tenant check
      const row = await prisma.wasteReason.findUnique({ where: { id } });
      return row ? mapWasteReason(row) : null;
    },
    async findByCode(restaurant_id, code) {
      const row = await prisma.wasteReason.findFirst({ where: { restaurant_id, code } });
      return row ? mapWasteReason(row) : null;
    },
    async insert(row) {
      await prisma.wasteReason.create({
        data: {
          id: row.id,
          restaurant_id: row.restaurant_id,
          code: row.code,
          label: row.label,
          is_archived: row.is_archived,
          created_at: row.created_at,
        },
      });
    },
    async update(id, patch) {
      await prisma.wasteReason.update({ where: { id }, data: stripUndefined(patch) });
    },
    async archive(id) {
      await prisma.wasteReason.update({ where: { id }, data: { is_archived: true } });
    },
  };
}

export function prismaStationRepo(prisma: PrismaClient): StationRepo {
  return {
    async list(restaurant_id, includeArchived) {
      const where: Record<string, unknown> = { restaurant_id };
      if (!includeArchived) where['is_archived'] = false;
      const rows = await prisma.station.findMany({
        where,
        orderBy: [{ sort_order: 'asc' }, { code: 'asc' }],
      });
      return rows.map(mapStation);
    },
    async findById(id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- service enforces tenant check
      const row = await prisma.station.findUnique({ where: { id } });
      return row ? mapStation(row) : null;
    },
    async findByCode(restaurant_id, code) {
      const row = await prisma.station.findFirst({ where: { restaurant_id, code } });
      return row ? mapStation(row) : null;
    },
    async insert(row) {
      await prisma.station.create({
        data: {
          id: row.id,
          restaurant_id: row.restaurant_id,
          code: row.code,
          label: row.label,
          sort_order: row.sort_order,
          is_archived: row.is_archived,
          archived_at: row.archived_at,
          created_at: row.created_at,
        },
      });
    },
    async update(id, patch) {
      await prisma.station.update({ where: { id }, data: stripUndefined(patch) });
    },
    async archive(id, archived_at) {
      await prisma.station.update({
        where: { id },
        data: { is_archived: true, archived_at },
      });
    },
  };
}

export function prismaParLevelRepo(prisma: PrismaClient): ParLevelRepo {
  return {
    async forRecipe(restaurant_id, recipe_id) {
      const rows = await prisma.parLevel.findMany({
        where: { restaurant_id, recipe_id },
        orderBy: { day_of_week: 'asc' },
      });
      return rows.map(mapParLevel);
    },
    async forRestaurant(restaurant_id) {
      const rows = await prisma.parLevel.findMany({
        where: { restaurant_id },
        orderBy: [{ recipe_id: 'asc' }, { day_of_week: 'asc' }],
      });
      return rows.map(mapParLevel);
    },
    async findByRecipeDay(restaurant_id, recipe_id, day_of_week) {
      const row = await prisma.parLevel.findFirst({
        where: { restaurant_id, recipe_id, day_of_week },
      });
      return row ? mapParLevel(row) : null;
    },
    async upsert(row) {
      await prisma.parLevel.upsert({
        where: { recipe_id_day_of_week: { recipe_id: row.recipe_id, day_of_week: row.day_of_week } },
        create: {
          id: row.id,
          restaurant_id: row.restaurant_id,
          recipe_id: row.recipe_id,
          day_of_week: row.day_of_week,
          qty: row.qty,
          updated_at: row.updated_at,
        },
        update: { qty: row.qty, updated_at: row.updated_at },
      });
    },
  };
}

function stripUndefined(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) out[k] = v;
  return out;
}

function mapLocation(row: {
  id: string; restaurant_id: string; name: string; kind: string;
  is_archived: boolean; created_at: Date;
}): LocationRow {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    name: row.name,
    kind: row.kind as LocationKind,
    is_archived: row.is_archived,
    created_at: row.created_at,
  };
}

function mapUtensil(row: {
  id: string; restaurant_id: string; name: string; label_colour: string | null;
  kind: string; default_uom: string; default_qty: unknown;
  is_archived: boolean; created_at: Date;
}): UtensilRow {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    name: row.name,
    label_colour: row.label_colour,
    kind: row.kind as UtensilKind,
    default_uom: row.default_uom,
    default_qty: Number(row.default_qty),
    is_archived: row.is_archived,
    created_at: row.created_at,
  };
}

function mapEquivalence(row: {
  id: string; utensil_id: string; ingredient_id: string | null;
  equivalent_qty: unknown; equivalent_uom: string; source: string; created_at: Date;
}): EquivalenceRow {
  return {
    id: row.id,
    utensil_id: row.utensil_id,
    ingredient_id: row.ingredient_id,
    equivalent_qty: Number(row.equivalent_qty),
    equivalent_uom: row.equivalent_uom,
    source: row.source as 'default' | 'override',
    created_at: row.created_at,
  };
}

function mapWasteReason(row: {
  id: string; restaurant_id: string; code: string; label: string;
  is_archived: boolean; created_at: Date;
}): WasteReasonRow {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    code: row.code,
    label: row.label,
    is_archived: row.is_archived,
    created_at: row.created_at,
  };
}

function mapStation(row: {
  id: string; restaurant_id: string; code: string; label: string;
  sort_order: number; is_archived: boolean; archived_at: Date | null; created_at: Date;
}): StationRow {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    code: row.code,
    label: row.label,
    sort_order: row.sort_order,
    is_archived: row.is_archived,
    archived_at: row.archived_at,
    created_at: row.created_at,
  };
}

function mapParLevel(row: {
  id: string; restaurant_id: string; recipe_id: string;
  day_of_week: number; qty: unknown; updated_at: Date;
}): ParLevelRow {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    recipe_id: row.recipe_id,
    day_of_week: row.day_of_week,
    qty: Number(row.qty),
    updated_at: row.updated_at,
  };
}

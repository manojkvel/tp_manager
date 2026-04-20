// TASK-036 — Settings catalogue unit tests (§6.11).
//
// Covers: locations CRUD + rename+archive, utensil + equivalence defaults &
// overrides, waste reasons uniqueness, par levels upsert with day-of-week
// validation.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  LocationsService, UtensilsService, WasteReasonsService, StationsService, ParLevelsService,
  DuplicateError, NotFoundError,
  type LocationRepo, type LocationRow,
  type UtensilRepo, type UtensilRow,
  type EquivalenceRepo, type EquivalenceRow,
  type WasteReasonRepo, type WasteReasonRow,
  type StationRepo, type StationRow,
  type ParLevelRepo, type ParLevelRow,
} from '../service.js';

const RID = '00000000-0000-0000-0000-0000000000cc';
const OTHER_RID = '00000000-0000-0000-0000-0000000000dd';
const NOW = new Date('2026-04-19T10:00:00Z');

function inMemoryLocationRepo(): LocationRepo {
  const rows = new Map<string, LocationRow>();
  return {
    async list(rid, includeArchived) {
      return [...rows.values()].filter((r) => r.restaurant_id === rid && (includeArchived || !r.is_archived));
    },
    async findById(id) { return rows.get(id) ?? null; },
    async findByName(rid, name) {
      return [...rows.values()].find((r) => r.restaurant_id === rid && r.name.toLowerCase() === name.toLowerCase()) ?? null;
    },
    async insert(row) { rows.set(row.id, row); },
    async update(id, patch) {
      const cur = rows.get(id);
      if (cur) rows.set(id, { ...cur, ...patch });
    },
    async archive(id) {
      const cur = rows.get(id);
      if (cur) rows.set(id, { ...cur, is_archived: true });
    },
  };
}

function inMemoryUtensilRepos() {
  const utensils = new Map<string, UtensilRow>();
  const eqs = new Map<string, EquivalenceRow>();
  const utensilRepo: UtensilRepo = {
    async list(rid, includeArchived) {
      return [...utensils.values()].filter((r) => r.restaurant_id === rid && (includeArchived || !r.is_archived));
    },
    async findById(id) { return utensils.get(id) ?? null; },
    async findByName(rid, name) {
      return [...utensils.values()].find((r) => r.restaurant_id === rid && r.name.toLowerCase() === name.toLowerCase()) ?? null;
    },
    async insert(row) { utensils.set(row.id, row); },
    async update(id, patch) {
      const cur = utensils.get(id);
      if (cur) utensils.set(id, { ...cur, ...patch });
    },
    async archive(id) {
      const cur = utensils.get(id);
      if (cur) utensils.set(id, { ...cur, is_archived: true });
    },
  };
  const eqRepo: EquivalenceRepo = {
    async forUtensil(utensil_id) { return [...eqs.values()].filter((r) => r.utensil_id === utensil_id); },
    async findDefault(utensil_id) {
      return [...eqs.values()].find((r) => r.utensil_id === utensil_id && r.ingredient_id === null) ?? null;
    },
    async findOverride(utensil_id, ingredient_id) {
      return [...eqs.values()].find((r) => r.utensil_id === utensil_id && r.ingredient_id === ingredient_id) ?? null;
    },
    async insert(row) { eqs.set(row.id, row); },
    async update(id, patch) {
      const cur = eqs.get(id);
      if (cur) eqs.set(id, { ...cur, ...patch });
    },
    async remove(id) { eqs.delete(id); },
  };
  return { utensilRepo, eqRepo };
}

function inMemoryWasteReasonRepo(): WasteReasonRepo {
  const rows = new Map<string, WasteReasonRow>();
  return {
    async list(rid, includeArchived) {
      return [...rows.values()].filter((r) => r.restaurant_id === rid && (includeArchived || !r.is_archived));
    },
    async findById(id) { return rows.get(id) ?? null; },
    async findByCode(rid, code) {
      return [...rows.values()].find((r) => r.restaurant_id === rid && r.code === code) ?? null;
    },
    async insert(row) { rows.set(row.id, row); },
    async update(id, patch) {
      const cur = rows.get(id);
      if (cur) rows.set(id, { ...cur, ...patch });
    },
    async archive(id) {
      const cur = rows.get(id);
      if (cur) rows.set(id, { ...cur, is_archived: true });
    },
  };
}

function inMemoryStationRepo(): StationRepo {
  const rows = new Map<string, StationRow>();
  return {
    async list(rid, includeArchived) {
      return [...rows.values()]
        .filter((r) => r.restaurant_id === rid && (includeArchived || !r.is_archived))
        .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
    },
    async findById(id) { return rows.get(id) ?? null; },
    async findByCode(rid, code) {
      return [...rows.values()].find((r) => r.restaurant_id === rid && r.code === code) ?? null;
    },
    async insert(row) { rows.set(row.id, row); },
    async update(id, patch) {
      const cur = rows.get(id);
      if (cur) rows.set(id, { ...cur, ...patch });
    },
    async archive(id, archived_at) {
      const cur = rows.get(id);
      if (cur) rows.set(id, { ...cur, is_archived: true, archived_at });
    },
  };
}

function inMemoryParLevelRepo(): ParLevelRepo {
  const rows = new Map<string, ParLevelRow>();
  const keyOf = (r: { recipe_id: string; day_of_week: number }) => `${r.recipe_id}:${r.day_of_week}`;
  return {
    async forRecipe(rid, recipe_id) {
      return [...rows.values()].filter((r) => r.restaurant_id === rid && r.recipe_id === recipe_id);
    },
    async forRestaurant(rid) {
      return [...rows.values()].filter((r) => r.restaurant_id === rid);
    },
    async findByRecipeDay(rid, recipe_id, day_of_week) {
      return [...rows.values()].find((r) => r.restaurant_id === rid && r.recipe_id === recipe_id && r.day_of_week === day_of_week) ?? null;
    },
    async upsert(row) {
      const existing = [...rows.entries()].find(([, r]) => keyOf(r) === keyOf(row));
      if (existing) rows.set(existing[0], row);
      else rows.set(row.id, row);
    },
  };
}

describe('LocationsService', () => {
  let svc: LocationsService;
  beforeEach(() => { svc = new LocationsService(inMemoryLocationRepo(), () => NOW); });

  it('creates a location and lists it, scoped to restaurant_id', async () => {
    await svc.create(RID, { name: 'Walk-in Cooler', kind: 'cold' });
    await svc.create(OTHER_RID, { name: 'Walk-in Cooler', kind: 'cold' });
    const rows = await svc.list(RID);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Walk-in Cooler');
  });

  it('rejects case-insensitive duplicate names in the same restaurant', async () => {
    await svc.create(RID, { name: 'Dry Storage', kind: 'dry' });
    await expect(svc.create(RID, { name: 'dry storage', kind: 'dry' })).rejects.toBeInstanceOf(DuplicateError);
  });

  it('renames, archives, and hides archived rows by default', async () => {
    const loc = await svc.create(RID, { name: 'Prep Fridge', kind: 'cold' });
    await svc.rename(RID, loc.id, 'Prep Refrigerator');
    await svc.archive(RID, loc.id);
    expect(await svc.list(RID)).toHaveLength(0);
    expect(await svc.list(RID, { includeArchived: true })).toHaveLength(1);
    expect((await svc.list(RID, { includeArchived: true }))[0]!.name).toBe('Prep Refrigerator');
  });

  it('rejects rename to an existing name belonging to a different row', async () => {
    const a = await svc.create(RID, { name: 'A', kind: 'dry' });
    await svc.create(RID, { name: 'B', kind: 'dry' });
    await expect(svc.rename(RID, a.id, 'B')).rejects.toBeInstanceOf(DuplicateError);
  });

  it('throws NotFoundError when archiving a location from a different restaurant', async () => {
    const loc = await svc.create(OTHER_RID, { name: 'Foreign', kind: 'dry' });
    await expect(svc.archive(RID, loc.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('UtensilsService', () => {
  let svc: UtensilsService;
  beforeEach(() => {
    const { utensilRepo, eqRepo } = inMemoryUtensilRepos();
    svc = new UtensilsService(utensilRepo, eqRepo, () => NOW);
  });

  it('creates a utensil and lists it', async () => {
    await svc.create(RID, { name: 'Blue Scoop', kind: 'scoop', default_uom: 'oz', default_qty: 2 });
    const rows = await svc.list(RID);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.default_qty).toBe(2);
    expect(rows[0]!.label_colour).toBeNull();
  });

  it('sets a default equivalence then a per-ingredient override, each addressable independently', async () => {
    const utensil = await svc.create(RID, { name: 'Blue Scoop', kind: 'scoop', default_uom: 'oz', default_qty: 2 });
    await svc.setEquivalence(RID, utensil.id, { ingredient_id: null, equivalent_qty: 56.7, equivalent_uom: 'g' });
    await svc.setEquivalence(RID, utensil.id, { ingredient_id: 'ing-granola', equivalent_qty: 40, equivalent_uom: 'g' });
    const all = await svc.equivalencesFor(utensil.id);
    expect(all).toHaveLength(2);
    expect(all.find((e) => e.ingredient_id === null)!.source).toBe('default');
    expect(all.find((e) => e.ingredient_id === 'ing-granola')!.source).toBe('override');
  });

  it('updates an existing override in place (no duplicates)', async () => {
    const utensil = await svc.create(RID, { name: 'Ladle 4oz', kind: 'ladle', default_uom: 'oz', default_qty: 4 });
    await svc.setEquivalence(RID, utensil.id, { ingredient_id: 'ing-1', equivalent_qty: 100, equivalent_uom: 'g' });
    await svc.setEquivalence(RID, utensil.id, { ingredient_id: 'ing-1', equivalent_qty: 110, equivalent_uom: 'g' });
    const all = await svc.equivalencesFor(utensil.id);
    expect(all).toHaveLength(1);
    expect(all[0]!.equivalent_qty).toBe(110);
  });

  it('rejects setting equivalence on a utensil from a different restaurant', async () => {
    const utensil = await svc.create(OTHER_RID, { name: 'Stranger', kind: 'scoop', default_uom: 'oz', default_qty: 1 });
    await expect(
      svc.setEquivalence(RID, utensil.id, { ingredient_id: null, equivalent_qty: 1, equivalent_uom: 'g' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('WasteReasonsService', () => {
  let svc: WasteReasonsService;
  beforeEach(() => { svc = new WasteReasonsService(inMemoryWasteReasonRepo(), () => NOW); });

  it('creates and lists waste reasons, unique by code within a restaurant', async () => {
    await svc.create(RID, { code: 'EXPIRED', label: 'Expired / past shelf-life' });
    await expect(svc.create(RID, { code: 'EXPIRED', label: 'Dup' })).rejects.toBeInstanceOf(DuplicateError);
  });

  it('updates label, archives, and hides archived rows by default', async () => {
    const r = await svc.create(RID, { code: 'DROPPED', label: 'Dropped' });
    await svc.update(RID, r.id, { label: 'Dropped on floor' });
    await svc.archive(RID, r.id);
    expect(await svc.list(RID)).toHaveLength(0);
    const all = await svc.list(RID, { includeArchived: true });
    expect(all[0]!.label).toBe('Dropped on floor');
  });
});

describe('StationsService', () => {
  let svc: StationsService;
  beforeEach(() => { svc = new StationsService(inMemoryStationRepo(), () => NOW); });

  it('creates a station, normalises code to lowercase, and lists it', async () => {
    await svc.create(RID, { code: 'Lunch', label: 'Lunch' });
    const rows = await svc.list(RID);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code).toBe('lunch');
    expect(rows[0]!.label).toBe('Lunch');
  });

  it('rejects duplicate codes within a restaurant', async () => {
    await svc.create(RID, { code: 'expo', label: 'Expo' });
    await expect(svc.create(RID, { code: 'EXPO', label: 'Dup' })).rejects.toBeInstanceOf(DuplicateError);
  });

  it('isolates station codes per restaurant', async () => {
    await svc.create(RID, { code: 'bar', label: 'Bar' });
    await svc.create(OTHER_RID, { code: 'bar', label: 'Bar' });
    expect(await svc.list(RID)).toHaveLength(1);
    expect(await svc.list(OTHER_RID)).toHaveLength(1);
  });

  it('rejects malformed codes (uppercase, spaces, too long)', async () => {
    await expect(svc.create(RID, { code: 'has space', label: 'X' })).rejects.toThrow(/code/);
    await expect(svc.create(RID, { code: 'a'.repeat(33), label: 'X' })).rejects.toThrow(/code/);
    await expect(svc.create(RID, { code: '-leading', label: 'X' })).rejects.toThrow(/code/);
  });

  it('rejects empty label on create and update', async () => {
    await expect(svc.create(RID, { code: 'egg', label: '   ' })).rejects.toThrow(/label/);
    const row = await svc.create(RID, { code: 'egg', label: 'Egg' });
    await expect(svc.update(RID, row.id, { label: '   ' })).rejects.toThrow(/label/);
  });

  it('updates label + sort_order, archives, and hides archived rows by default', async () => {
    const row = await svc.create(RID, { code: 'bakery', label: 'Bakery', sort_order: 5 });
    await svc.update(RID, row.id, { label: 'Bakery & Pastry', sort_order: 9 });
    await svc.archive(RID, row.id);
    expect(await svc.list(RID)).toHaveLength(0);
    const all = await svc.list(RID, { includeArchived: true });
    expect(all[0]!.label).toBe('Bakery & Pastry');
    expect(all[0]!.sort_order).toBe(9);
    expect(all[0]!.is_archived).toBe(true);
    expect(all[0]!.archived_at).toEqual(NOW);
  });

  it('throws NotFoundError when archiving a station belonging to another restaurant', async () => {
    const row = await svc.create(OTHER_RID, { code: 'foreign', label: 'Foreign' });
    await expect(svc.archive(RID, row.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns rows ordered by sort_order then code', async () => {
    await svc.create(RID, { code: 'expo', label: 'Expo', sort_order: 3 });
    await svc.create(RID, { code: 'bar', label: 'Bar', sort_order: 1 });
    await svc.create(RID, { code: 'egg', label: 'Egg', sort_order: 2 });
    const rows = await svc.list(RID);
    expect(rows.map((r) => r.code)).toEqual(['bar', 'egg', 'expo']);
  });
});

describe('ParLevelsService', () => {
  let svc: ParLevelsService;
  beforeEach(() => { svc = new ParLevelsService(inMemoryParLevelRepo(), () => NOW); });

  it('upserts par for (recipe, day_of_week) — second write overwrites first', async () => {
    await svc.set(RID, { recipe_id: 'rec-1', day_of_week: 1, qty: 10 });
    await svc.set(RID, { recipe_id: 'rec-1', day_of_week: 1, qty: 12 });
    const rows = await svc.list(RID, 'rec-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.qty).toBe(12);
  });

  it('stores distinct rows per day of the week', async () => {
    for (let d = 0; d < 7; d += 1) await svc.set(RID, { recipe_id: 'rec-1', day_of_week: d, qty: d * 2 });
    const rows = await svc.list(RID, 'rec-1');
    expect(rows).toHaveLength(7);
  });

  it('rejects day_of_week outside 0..6 and negative qty', async () => {
    await expect(svc.set(RID, { recipe_id: 'rec-1', day_of_week: 7, qty: 1 })).rejects.toThrow(/day_of_week/);
    await expect(svc.set(RID, { recipe_id: 'rec-1', day_of_week: -1, qty: 1 })).rejects.toThrow(/day_of_week/);
    await expect(svc.set(RID, { recipe_id: 'rec-1', day_of_week: 1, qty: -1 })).rejects.toThrow(/qty/);
  });
});

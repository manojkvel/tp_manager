// TASK-032 — Ingredients service unit tests (§6.1 AC-1..5).
//
// Service takes injected repo + cost-history repo + recipe-line repo so the
// module stays DB-free for unit testing. Covers:
//   AC-1: list search by name, filter by storage-location, filter by supplier
//   AC-2: create + edit fields (round-tripped through the service)
//   AC-3: cost history preserved — setCost writes a new IngredientCost row
//   AC-4: cannot hard-delete when referenced; soft-archive instead
//   AC-5: CSV import/export (columns from §6.1 AC-2)

import { beforeEach, describe, expect, it } from 'vitest';
import {
  IngredientsService,
  type IngredientRepo,
  type IngredientCostRepo,
  type RecipeLineRef,
  type IngredientRow,
  IngredientInUseError,
} from '../service.js';
import { ingredientsToCsv, csvToIngredients } from '../csv.js';

const RID = '00000000-0000-0000-0000-0000000000aa';

function inMemoryRepos(): {
  repo: IngredientRepo;
  costs: IngredientCostRepo;
  refs: RecipeLineRef;
  state: { rows: Map<string, IngredientRow>; costs: Array<{ ingredient_id: string; unit_cost_cents: number; effective_from: Date }> };
} {
  const rows = new Map<string, IngredientRow>();
  const costs: Array<{ ingredient_id: string; unit_cost_cents: number; effective_from: Date }> = [];
  const referenced = new Set<string>();

  const repo: IngredientRepo = {
    async list(restaurant_id, filters) {
      const all = [...rows.values()].filter((r) => r.restaurant_id === restaurant_id);
      return all.filter((r) => {
        if (filters?.includeArchived !== true && r.is_archived) return false;
        if (filters?.search && !r.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
        if (filters?.locationId && r.storage_location_id !== filters.locationId) return false;
        if (filters?.supplierId && r.default_supplier_id !== filters.supplierId) return false;
        return true;
      });
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByName(restaurant_id, name) {
      for (const r of rows.values()) {
        if (r.restaurant_id === restaurant_id && r.name.toLowerCase() === name.toLowerCase()) return r;
      }
      return null;
    },
    async insert(row) {
      rows.set(row.id, row);
    },
    async update(id, patch) {
      const current = rows.get(id);
      if (!current) throw new Error('not found');
      rows.set(id, { ...current, ...patch });
    },
    async archive(id, at) {
      const current = rows.get(id);
      if (!current) throw new Error('not found');
      rows.set(id, { ...current, is_archived: true, archived_at: at });
    },
    async remove(id) {
      rows.delete(id);
    },
  };

  const costsRepo: IngredientCostRepo = {
    async insert(row) {
      costs.push(row);
    },
    async latestCents(ingredient_id) {
      const sorted = costs
        .filter((c) => c.ingredient_id === ingredient_id)
        .sort((a, b) => b.effective_from.getTime() - a.effective_from.getTime());
      return sorted[0]?.unit_cost_cents ?? null;
    },
  };

  const refs: RecipeLineRef = {
    async isReferenced(id) {
      return referenced.has(id);
    },
    _mark(id: string) {
      referenced.add(id);
    },
  } as RecipeLineRef & { _mark: (id: string) => void };

  return { repo, costs: costsRepo, refs, state: { rows, costs } };
}

function makeSvc() {
  const { repo, costs, refs, state } = inMemoryRepos();
  return { svc: new IngredientsService({ repo, costs, refs, now: () => new Date('2026-04-19T10:00:00Z') }), refs, state };
}

describe('IngredientsService — list filters (§6.1 AC-1)', () => {
  let h = makeSvc();
  beforeEach(async () => {
    h = makeSvc();
    await h.svc.create(RID, { name: 'Milk', uom: 'mL', uom_category: 'volume', storage_location_id: 'loc-cold', default_supplier_id: 'sup-a' });
    await h.svc.create(RID, { name: 'Cilantro', uom: 'bunch', uom_category: 'count', storage_location_id: 'loc-cold', default_supplier_id: 'sup-b' });
    await h.svc.create(RID, { name: 'Flour', uom: 'g', uom_category: 'weight', storage_location_id: 'loc-dry', default_supplier_id: 'sup-a' });
  });

  it('search-by-name is case-insensitive substring', async () => {
    const hits = await h.svc.list(RID, { search: 'mil' });
    expect(hits.map((r) => r.name).sort()).toEqual(['Milk']);
  });

  it('filter by storage location', async () => {
    const hits = await h.svc.list(RID, { locationId: 'loc-cold' });
    expect(hits.map((r) => r.name).sort()).toEqual(['Cilantro', 'Milk']);
  });

  it('filter by supplier', async () => {
    const hits = await h.svc.list(RID, { supplierId: 'sup-a' });
    expect(hits.map((r) => r.name).sort()).toEqual(['Flour', 'Milk']);
  });

  it('archived rows are hidden by default', async () => {
    const [first] = await h.svc.list(RID, {});
    await h.svc.archive(RID, first!.id);
    const hits = await h.svc.list(RID, {});
    expect(hits.map((r) => r.name)).not.toContain(first!.name);
  });
});

describe('IngredientsService — create / update / cost history (§6.1 AC-2/3)', () => {
  it('creates with the required fields', async () => {
    const { svc } = makeSvc();
    const created = await svc.create(RID, {
      name: 'Butter',
      uom: 'g',
      uom_category: 'weight',
      pack_size: 500,
      shelf_life_days: 30,
      allergen_flags: ['dairy'],
    });
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(created.name).toBe('Butter');
    expect(created.allergen_flags).toEqual(['dairy']);
  });

  it('rejects duplicate names in the same restaurant', async () => {
    const { svc } = makeSvc();
    await svc.create(RID, { name: 'Butter', uom: 'g', uom_category: 'weight' });
    await expect(
      svc.create(RID, { name: 'butter', uom: 'g', uom_category: 'weight' }),
    ).rejects.toThrow(/already exists/i);
  });

  it('setCost writes a new history row with an effective_from stamp', async () => {
    const { svc, state } = makeSvc();
    const x = await svc.create(RID, { name: 'Oil', uom: 'mL', uom_category: 'volume' });
    await svc.setCost(RID, x.id, { unit_cost_cents: 500 });
    await svc.setCost(RID, x.id, { unit_cost_cents: 550, effective_from: new Date('2026-04-20T00:00:00Z') });
    const history = state.costs.filter((c) => c.ingredient_id === x.id);
    expect(history).toHaveLength(2);
    expect(history.map((c) => c.unit_cost_cents).sort((a, b) => a - b)).toEqual([500, 550]);
  });
});

describe('IngredientsService — archive semantics (§6.1 AC-4)', () => {
  it('cannot hard-delete when referenced; archive used instead', async () => {
    const { svc, refs } = makeSvc();
    const x = await svc.create(RID, { name: 'Eggs', uom: 'each', uom_category: 'count' });
    (refs as unknown as { _mark: (id: string) => void })._mark(x.id);
    await expect(svc.remove(RID, x.id)).rejects.toBeInstanceOf(IngredientInUseError);
    await svc.archive(RID, x.id);
    const fetched = await svc.get(RID, x.id);
    expect(fetched!.is_archived).toBe(true);
    expect(fetched!.archived_at).toBeInstanceOf(Date);
  });

  it('can hard-delete when unreferenced', async () => {
    const { svc } = makeSvc();
    const x = await svc.create(RID, { name: 'Salt', uom: 'g', uom_category: 'weight' });
    await svc.remove(RID, x.id);
    expect(await svc.get(RID, x.id)).toBeNull();
  });
});

describe('Ingredients CSV (§6.1 AC-5)', () => {
  it('round-trips a small list', () => {
    const rows: IngredientRow[] = [
      {
        id: '1', restaurant_id: RID, name: 'Milk', uom: 'mL', uom_category: 'volume',
        pack_size: 1000, storage_location_id: null, default_supplier_id: null,
        shelf_life_days: 7, allergen_flags: ['dairy'], density_g_per_ml: 1.03,
        par_qty: null, par_uom: null, culinary_category: null, photo_required: false, supplier_sku: null,
        is_archived: false, archived_at: null, created_at: new Date(), updated_at: new Date(),
      },
      {
        id: '2', restaurant_id: RID, name: 'Flour', uom: 'g', uom_category: 'weight',
        pack_size: 25000, storage_location_id: null, default_supplier_id: null,
        shelf_life_days: 365, allergen_flags: ['gluten'], density_g_per_ml: null,
        par_qty: null, par_uom: null, culinary_category: null, photo_required: false, supplier_sku: null,
        is_archived: false, archived_at: null, created_at: new Date(), updated_at: new Date(),
      },
    ];
    const csv = ingredientsToCsv(rows);
    const parsed = csvToIngredients(csv);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.name).toBe('Milk');
    expect(parsed[0]!.allergen_flags).toEqual(['dairy']);
    expect(parsed[1]!.name).toBe('Flour');
  });

  it('rejects CSVs missing the required header', () => {
    expect(() => csvToIngredients('bogus,columns\na,b')).toThrow(/required column/i);
  });
});

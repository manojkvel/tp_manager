// TASK-033 — Ingredients service (§6.1 AC-1..6).
//
// Pure service layer: repos are injected so it's unit-testable without Prisma.
// `now()` is injected so cost-history timestamps are deterministic in tests.

import { randomBytes } from 'node:crypto';
import type { UomCategory } from '@tp/types';

export interface IngredientRow {
  id: string;
  restaurant_id: string;
  name: string;
  uom: string;
  uom_category: UomCategory;
  pack_size: number | null;
  storage_location_id: string | null;
  default_supplier_id: string | null;
  shelf_life_days: number | null;
  allergen_flags: string[];
  density_g_per_ml: number | null;
  is_archived: boolean;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateIngredientInput {
  name: string;
  uom: string;
  uom_category: UomCategory;
  pack_size?: number | null;
  storage_location_id?: string | null;
  default_supplier_id?: string | null;
  shelf_life_days?: number | null;
  allergen_flags?: string[];
  density_g_per_ml?: number | null;
}

export type UpdateIngredientInput = Partial<Omit<CreateIngredientInput, 'uom_category'>> & { uom_category?: UomCategory };

export interface ListFilters {
  search?: string;
  locationId?: string;
  supplierId?: string;
  includeArchived?: boolean;
}

export interface IngredientRepo {
  list(restaurant_id: string, filters?: ListFilters): Promise<IngredientRow[]>;
  findById(id: string): Promise<IngredientRow | null>;
  findByName(restaurant_id: string, name: string): Promise<IngredientRow | null>;
  insert(row: IngredientRow): Promise<void>;
  update(id: string, patch: Partial<IngredientRow>): Promise<void>;
  archive(id: string, at: Date): Promise<void>;
  remove?(id: string): Promise<void>;
}

export interface IngredientCostRow {
  ingredient_id: string;
  unit_cost_cents: number;
  effective_from: Date;
  source: 'delivery' | 'manual' | 'migration';
  note: string | null;
}

export interface IngredientCostRepo {
  insert(row: { ingredient_id: string; unit_cost_cents: number; effective_from: Date; source?: 'delivery' | 'manual' | 'migration'; note?: string }): Promise<void>;
  latestCents(ingredient_id: string): Promise<number | null>;
  listHistory?(ingredient_id: string): Promise<IngredientCostRow[]>;
}

export interface RecipeUsage {
  recipe_id: string;
  recipe_name: string;
  version: number;
  qty: number;
  uom: string | null;
}

export interface RecipeLineRef {
  isReferenced(ingredient_id: string): Promise<boolean>;
  listUsingIngredient?(ingredient_id: string): Promise<RecipeUsage[]>;
}

export class IngredientInUseError extends Error {
  constructor(ingredientId: string) {
    super(`ingredient ${ingredientId} is referenced by a recipe — use archive instead`);
    this.name = 'IngredientInUseError';
  }
}

export class DuplicateIngredientError extends Error {
  constructor(name: string) {
    super(`ingredient "${name}" already exists in this restaurant`);
    this.name = 'DuplicateIngredientError';
  }
}

function uuidv4(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface IngredientsServiceDeps {
  repo: IngredientRepo;
  costs: IngredientCostRepo;
  refs: RecipeLineRef;
  now?: () => Date;
}

export class IngredientsService {
  private readonly now: () => Date;

  constructor(private readonly deps: IngredientsServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async list(restaurant_id: string, filters: ListFilters = {}): Promise<IngredientRow[]> {
    return this.deps.repo.list(restaurant_id, filters);
  }

  async get(restaurant_id: string, id: string): Promise<IngredientRow | null> {
    const row = await this.deps.repo.findById(id);
    if (!row || row.restaurant_id !== restaurant_id) return null;
    return row;
  }

  async create(restaurant_id: string, input: CreateIngredientInput): Promise<IngredientRow> {
    const existing = await this.deps.repo.findByName(restaurant_id, input.name);
    if (existing) throw new DuplicateIngredientError(input.name);
    const now = this.now();
    const row: IngredientRow = {
      id: uuidv4(),
      restaurant_id,
      name: input.name,
      uom: input.uom,
      uom_category: input.uom_category,
      pack_size: input.pack_size ?? null,
      storage_location_id: input.storage_location_id ?? null,
      default_supplier_id: input.default_supplier_id ?? null,
      shelf_life_days: input.shelf_life_days ?? null,
      allergen_flags: input.allergen_flags ?? [],
      density_g_per_ml: input.density_g_per_ml ?? null,
      is_archived: false,
      archived_at: null,
      created_at: now,
      updated_at: now,
    };
    await this.deps.repo.insert(row);
    return row;
  }

  async update(restaurant_id: string, id: string, input: UpdateIngredientInput): Promise<IngredientRow> {
    const current = await this.get(restaurant_id, id);
    if (!current) throw new Error(`ingredient ${id} not found`);
    await this.deps.repo.update(id, { ...input, updated_at: this.now() });
    const updated = await this.deps.repo.findById(id);
    return updated!;
  }

  async costHistory(restaurant_id: string, id: string): Promise<IngredientCostRow[]> {
    const current = await this.get(restaurant_id, id);
    if (!current) return [];
    return this.deps.costs.listHistory ? this.deps.costs.listHistory(id) : [];
  }

  async latestCostCents(restaurant_id: string, id: string): Promise<number | null> {
    const current = await this.get(restaurant_id, id);
    if (!current) return null;
    return this.deps.costs.latestCents(id);
  }

  async recipesUsing(restaurant_id: string, id: string): Promise<RecipeUsage[]> {
    const current = await this.get(restaurant_id, id);
    if (!current) return [];
    return this.deps.refs.listUsingIngredient ? this.deps.refs.listUsingIngredient(id) : [];
  }

  /** §6.1 AC-3 — every cost change creates a new history row. */
  async setCost(
    restaurant_id: string,
    id: string,
    input: { unit_cost_cents: number; effective_from?: Date; source?: 'delivery' | 'manual' | 'migration'; note?: string },
  ): Promise<void> {
    const current = await this.get(restaurant_id, id);
    if (!current) throw new Error(`ingredient ${id} not found`);
    await this.deps.costs.insert({
      ingredient_id: id,
      unit_cost_cents: input.unit_cost_cents,
      effective_from: input.effective_from ?? this.now(),
      source: input.source ?? 'manual',
      note: input.note,
    });
  }

  /** §6.1 AC-4 — soft-archive preserves references. */
  async archive(restaurant_id: string, id: string): Promise<void> {
    const current = await this.get(restaurant_id, id);
    if (!current) throw new Error(`ingredient ${id} not found`);
    await this.deps.repo.archive(id, this.now());
  }

  /** §6.1 AC-4 — hard-delete only when no recipe references the row. */
  async remove(restaurant_id: string, id: string): Promise<void> {
    const current = await this.get(restaurant_id, id);
    if (!current) return;
    if (await this.deps.refs.isReferenced(id)) {
      throw new IngredientInUseError(id);
    }
    if (this.deps.repo.remove) {
      await this.deps.repo.remove(id);
    } else {
      // fallback — archive permanently if the repo does not support hard delete.
      await this.deps.repo.archive(id, this.now());
    }
  }
}

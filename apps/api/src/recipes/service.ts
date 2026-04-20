// TASK-040/041 — Recipes service.
//
// Handles CRUD over Recipe + RecipeVersion (append-only, §6.3 AC-5 / DEC-014)
// and exposes plated-cost computation through the pure `cost.ts` module.

import { randomBytes } from 'node:crypto';
import {
  computePlatedCost, detectCycle,
  type CostContext, type RecipeVersionRow, type RecipeLineRow, type PlatedCostResult,
} from './cost.js';
import { stationView, type StationRecipe, type StationViewRow } from './station.js';

export type RecipeType = 'prep' | 'menu';

export interface RecipeRow {
  id: string;
  restaurant_id: string;
  type: RecipeType;
  name: string;
  is_archived: boolean;
  created_at: Date;
}

export interface CreateRecipeInput {
  type: RecipeType;
  name: string;
  initial_version: Omit<NewVersionInput, 'recipe_id'>;
}

export interface NewVersionInput {
  recipe_id: string;
  yield_qty: number;
  yield_uom: string;
  shelf_life_days?: number | null;
  equipment?: string[];
  procedure?: string;
  photo_url?: string | null;
  is_portion_bag_prep?: boolean;
  portion_bag_content_json?: unknown;
  lines: Array<Omit<RecipeLineRow, 'id' | 'recipe_version_id'>>;
  created_by_user_id?: string | null;
}

export interface ListFilters {
  type?: RecipeType;
  search?: string;
  station?: string;
  includeArchived?: boolean;
}

export interface RecipeRepo {
  list(restaurant_id: string, filters?: ListFilters): Promise<RecipeRow[]>;
  findById(id: string): Promise<RecipeRow | null>;
  findByName(restaurant_id: string, type: RecipeType, name: string): Promise<RecipeRow | null>;
  insert(row: RecipeRow): Promise<void>;
  archive(id: string): Promise<void>;
}

export interface RecipeVersionFull {
  version: RecipeVersionRow & {
    shelf_life_days: number | null;
    equipment: string[];
    procedure: string;
    photo_url: string | null;
    is_portion_bag_prep: boolean;
    portion_bag_content_json: unknown;
    created_by_user_id: string | null;
    created_at: Date;
  };
  lines: RecipeLineRow[];
}

export interface RecipeVersionRepo {
  current(recipe_id: string): Promise<RecipeVersionFull | null>;
  byId(version_id: string): Promise<RecipeVersionFull | null>;
  list(recipe_id: string): Promise<RecipeVersionFull[]>;
  /** Inserts the version + lines and sets it as current (atomically) per DEC-014. */
  appendAndPromote(full: RecipeVersionFull): Promise<void>;
}

export class DuplicateRecipeError extends Error {
  constructor(name: string, type: RecipeType) {
    super(`${type} recipe "${name}" already exists`);
    this.name = 'DuplicateRecipeError';
  }
}

export class RecipeNotFoundError extends Error {
  constructor(id: string) {
    super(`recipe ${id} not found`);
    this.name = 'RecipeNotFoundError';
  }
}

export { RecipeCycleError } from './cost.js';

function uuidv4(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface RecipesServiceDeps {
  recipes: RecipeRepo;
  versions: RecipeVersionRepo;
  costs: CostContext;
  now?: () => Date;
}

export class RecipesService {
  private readonly now: () => Date;
  constructor(private readonly deps: RecipesServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  list(restaurant_id: string, filters: ListFilters = {}): Promise<RecipeRow[]> {
    return this.deps.recipes.list(restaurant_id, filters);
  }

  async get(restaurant_id: string, id: string): Promise<RecipeRow | null> {
    const row = await this.deps.recipes.findById(id);
    if (!row || row.restaurant_id !== restaurant_id) return null;
    return row;
  }

  /** §6.3 AC-1 + AC-5 — create the recipe with its v1 version in one shot. */
  async create(restaurant_id: string, input: CreateRecipeInput): Promise<{ recipe: RecipeRow; version: RecipeVersionFull }> {
    const existing = await this.deps.recipes.findByName(restaurant_id, input.type, input.name);
    if (existing) throw new DuplicateRecipeError(input.name, input.type);
    const recipe: RecipeRow = {
      id: uuidv4(),
      restaurant_id,
      type: input.type,
      name: input.name,
      is_archived: false,
      created_at: this.now(),
    };
    await this.deps.recipes.insert(recipe);
    const version = await this.appendVersion(restaurant_id, { ...input.initial_version, recipe_id: recipe.id });
    return { recipe, version };
  }

  /** §6.3 AC-5 — every edit creates a new version; prior versions stay intact. */
  async appendVersion(restaurant_id: string, input: NewVersionInput): Promise<RecipeVersionFull> {
    const recipe = await this.get(restaurant_id, input.recipe_id);
    if (!recipe) throw new RecipeNotFoundError(input.recipe_id);
    const existing = await this.deps.versions.list(input.recipe_id);
    const nextNumber = existing.length === 0 ? 1 : Math.max(...existing.map((v) => v.version.version)) + 1;
    const version_id = uuidv4();
    const now = this.now();
    const full: RecipeVersionFull = {
      version: {
        id: version_id,
        recipe_id: input.recipe_id,
        version: nextNumber,
        is_current: true,
        yield_qty: input.yield_qty,
        yield_uom: input.yield_uom,
        shelf_life_days: input.shelf_life_days ?? null,
        equipment: input.equipment ?? [],
        procedure: input.procedure ?? '',
        photo_url: input.photo_url ?? null,
        is_portion_bag_prep: input.is_portion_bag_prep ?? false,
        portion_bag_content_json: input.portion_bag_content_json ?? null,
        created_by_user_id: input.created_by_user_id ?? null,
        created_at: now,
      },
      lines: input.lines.map((l, i) => ({
        ...l,
        id: uuidv4(),
        recipe_version_id: version_id,
        position: l.position ?? i,
      })),
    };

    // Pre-insert cycle check (DB-only check would still catch, but failing
    // before persisting keeps history uncontaminated).
    const cycle = await detectCycle(input.recipe_id, async (rid) => {
      if (rid === input.recipe_id) {
        return { lines: full.lines.map((l) => ({ ref_type: l.ref_type, ref_recipe_id: l.ref_recipe_id })) };
      }
      const v = await this.deps.versions.current(rid);
      if (!v) return null;
      return { lines: v.lines.map((l) => ({ ref_type: l.ref_type, ref_recipe_id: l.ref_recipe_id })) };
    });
    if (cycle) {
      const err = new Error(`recipe graph contains a cycle: ${cycle.join(' → ')}`);
      err.name = 'RecipeCycleError';
      throw err;
    }

    await this.deps.versions.appendAndPromote(full);
    return full;
  }

  async archive(restaurant_id: string, id: string): Promise<void> {
    const recipe = await this.get(restaurant_id, id);
    if (!recipe) throw new RecipeNotFoundError(id);
    await this.deps.recipes.archive(id);
  }

  /** §6.3 AC-4 — plated cost for the current version. */
  async platedCost(restaurant_id: string, recipe_id: string): Promise<PlatedCostResult> {
    const recipe = await this.get(restaurant_id, recipe_id);
    if (!recipe) throw new RecipeNotFoundError(recipe_id);
    const current = await this.deps.versions.current(recipe_id);
    if (!current) throw new Error(`recipe ${recipe_id} has no current version`);
    return computePlatedCost(current.version, current.lines, this.deps.costs);
  }

  /** §6.3 AC-5 — plated cost for a specific version (for historical reads). */
  async platedCostForVersion(restaurant_id: string, version_id: string): Promise<PlatedCostResult> {
    const v = await this.deps.versions.byId(version_id);
    if (!v) throw new RecipeNotFoundError(version_id);
    const recipe = await this.deps.recipes.findById(v.version.recipe_id);
    if (!recipe || recipe.restaurant_id !== restaurant_id) {
      throw new RecipeNotFoundError(version_id);
    }
    return computePlatedCost(v.version, v.lines, this.deps.costs);
  }

  /** §6.3b — station-filtered view of current menu recipes. */
  async stationView(restaurant_id: string, station: string): Promise<StationViewRow[]> {
    const menu = await this.deps.recipes.list(restaurant_id, { type: 'menu' });
    const gathered: StationRecipe[] = [];
    for (const r of menu) {
      const cur = await this.deps.versions.current(r.id);
      if (!cur) continue;
      gathered.push({
        recipe_id: r.id,
        recipe_name: r.name,
        station,
        version_id: cur.version.id,
        yield_qty: cur.version.yield_qty,
        yield_uom: cur.version.yield_uom,
        lines: cur.lines,
      });
    }
    return stationView(gathered, station);
  }

  versions(recipe_id: string): Promise<RecipeVersionFull[]> {
    return this.deps.versions.list(recipe_id);
  }
}

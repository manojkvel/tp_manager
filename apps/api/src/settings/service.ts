// TASK-036 — Settings catalogue services (§6.11).
//
// Thin CRUD over the catalogue entities that the rest of the app references:
// Locations, Portion Utensils (+ per-ingredient equivalences), Waste Reasons,
// Par Levels. Each sub-service takes a repo so the unit tests can drive them
// with in-memory fakes.

import { randomBytes } from 'node:crypto';

function uuidv4(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class DuplicateError extends Error {
  constructor(label: string) { super(`${label} already exists`); this.name = 'DuplicateError'; }
}
export class NotFoundError extends Error {
  constructor(label: string) { super(`${label} not found`); this.name = 'NotFoundError'; }
}

// ─── Locations ──────────────────────────────────────────────────────────────

export type LocationKind = 'dry' | 'cold' | 'freezer' | 'bar' | 'prep';

export interface LocationRow {
  id: string;
  restaurant_id: string;
  name: string;
  kind: LocationKind;
  is_archived: boolean;
  created_at: Date;
}

export interface LocationRepo {
  list(restaurant_id: string, includeArchived?: boolean): Promise<LocationRow[]>;
  findById(id: string): Promise<LocationRow | null>;
  findByName(restaurant_id: string, name: string): Promise<LocationRow | null>;
  insert(row: LocationRow): Promise<void>;
  update(id: string, patch: Partial<LocationRow>): Promise<void>;
  archive(id: string): Promise<void>;
}

export class LocationsService {
  constructor(private readonly repo: LocationRepo, private readonly now: () => Date = () => new Date()) {}

  list(rid: string, opts: { includeArchived?: boolean } = {}) {
    return this.repo.list(rid, opts.includeArchived);
  }

  async create(rid: string, input: { name: string; kind: LocationKind }): Promise<LocationRow> {
    if (await this.repo.findByName(rid, input.name)) throw new DuplicateError(`location "${input.name}"`);
    const row: LocationRow = {
      id: uuidv4(),
      restaurant_id: rid,
      name: input.name,
      kind: input.kind,
      is_archived: false,
      created_at: this.now(),
    };
    await this.repo.insert(row);
    return row;
  }

  async rename(rid: string, id: string, name: string): Promise<LocationRow> {
    const row = await this.repo.findById(id);
    if (!row || row.restaurant_id !== rid) throw new NotFoundError('location');
    const dup = await this.repo.findByName(rid, name);
    if (dup && dup.id !== id) throw new DuplicateError(`location "${name}"`);
    await this.repo.update(id, { name });
    return { ...row, name };
  }

  async archive(rid: string, id: string): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row || row.restaurant_id !== rid) throw new NotFoundError('location');
    await this.repo.archive(id);
  }
}

// ─── Portion Utensils + Equivalences ────────────────────────────────────────

export type UtensilKind = 'scoop' | 'ladle' | 'bag' | 'spoon' | 'cap';

export interface UtensilRow {
  id: string;
  restaurant_id: string;
  name: string;
  label_colour: string | null;
  kind: UtensilKind;
  default_uom: string;
  default_qty: number;
  is_archived: boolean;
  created_at: Date;
}

export interface EquivalenceRow {
  id: string;
  utensil_id: string;
  ingredient_id: string | null; // NULL => utensil default
  equivalent_qty: number;
  equivalent_uom: string;
  source: 'default' | 'override';
  created_at: Date;
}

export interface UtensilRepo {
  list(restaurant_id: string, includeArchived?: boolean): Promise<UtensilRow[]>;
  findById(id: string): Promise<UtensilRow | null>;
  findByName(restaurant_id: string, name: string): Promise<UtensilRow | null>;
  insert(row: UtensilRow): Promise<void>;
  update(id: string, patch: Partial<UtensilRow>): Promise<void>;
  archive(id: string): Promise<void>;
}

export interface EquivalenceRepo {
  forUtensil(utensil_id: string): Promise<EquivalenceRow[]>;
  findDefault(utensil_id: string): Promise<EquivalenceRow | null>;
  findOverride(utensil_id: string, ingredient_id: string): Promise<EquivalenceRow | null>;
  insert(row: EquivalenceRow): Promise<void>;
  update(id: string, patch: Partial<EquivalenceRow>): Promise<void>;
  remove(id: string): Promise<void>;
}

export class UtensilsService {
  constructor(
    private readonly repo: UtensilRepo,
    private readonly equivalences: EquivalenceRepo,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(rid: string, opts: { includeArchived?: boolean } = {}) {
    return this.repo.list(rid, opts.includeArchived);
  }

  async create(rid: string, input: {
    name: string; kind: UtensilKind; default_uom: string; default_qty: number; label_colour?: string | null;
  }): Promise<UtensilRow> {
    if (await this.repo.findByName(rid, input.name)) throw new DuplicateError(`utensil "${input.name}"`);
    const row: UtensilRow = {
      id: uuidv4(),
      restaurant_id: rid,
      name: input.name,
      label_colour: input.label_colour ?? null,
      kind: input.kind,
      default_uom: input.default_uom,
      default_qty: input.default_qty,
      is_archived: false,
      created_at: this.now(),
    };
    await this.repo.insert(row);
    return row;
  }

  async archive(rid: string, id: string): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row || row.restaurant_id !== rid) throw new NotFoundError('utensil');
    await this.repo.archive(id);
  }

  equivalencesFor(utensil_id: string): Promise<EquivalenceRow[]> {
    return this.equivalences.forUtensil(utensil_id);
  }

  /**
   * Set (or update) a per-ingredient override. Passing `ingredient_id=null`
   * targets the utensil's default equivalence row.
   */
  async setEquivalence(rid: string, utensil_id: string, input: {
    ingredient_id: string | null; equivalent_qty: number; equivalent_uom: string;
  }): Promise<EquivalenceRow> {
    const utensil = await this.repo.findById(utensil_id);
    if (!utensil || utensil.restaurant_id !== rid) throw new NotFoundError('utensil');
    const existing = input.ingredient_id
      ? await this.equivalences.findOverride(utensil_id, input.ingredient_id)
      : await this.equivalences.findDefault(utensil_id);
    if (existing) {
      await this.equivalences.update(existing.id, {
        equivalent_qty: input.equivalent_qty,
        equivalent_uom: input.equivalent_uom,
      });
      return { ...existing, equivalent_qty: input.equivalent_qty, equivalent_uom: input.equivalent_uom };
    }
    const row: EquivalenceRow = {
      id: uuidv4(),
      utensil_id,
      ingredient_id: input.ingredient_id,
      equivalent_qty: input.equivalent_qty,
      equivalent_uom: input.equivalent_uom,
      source: input.ingredient_id ? 'override' : 'default',
      created_at: this.now(),
    };
    await this.equivalences.insert(row);
    return row;
  }
}

// ─── Waste Reasons ──────────────────────────────────────────────────────────

export interface WasteReasonRow {
  id: string;
  restaurant_id: string;
  code: string;
  label: string;
  is_archived: boolean;
  created_at: Date;
}

export interface WasteReasonRepo {
  list(restaurant_id: string, includeArchived?: boolean): Promise<WasteReasonRow[]>;
  findById(id: string): Promise<WasteReasonRow | null>;
  findByCode(restaurant_id: string, code: string): Promise<WasteReasonRow | null>;
  insert(row: WasteReasonRow): Promise<void>;
  update(id: string, patch: Partial<WasteReasonRow>): Promise<void>;
  archive(id: string): Promise<void>;
}

export class WasteReasonsService {
  constructor(private readonly repo: WasteReasonRepo, private readonly now: () => Date = () => new Date()) {}

  list(rid: string, opts: { includeArchived?: boolean } = {}) {
    return this.repo.list(rid, opts.includeArchived);
  }

  async create(rid: string, input: { code: string; label: string }): Promise<WasteReasonRow> {
    if (await this.repo.findByCode(rid, input.code)) throw new DuplicateError(`waste reason "${input.code}"`);
    const row: WasteReasonRow = {
      id: uuidv4(),
      restaurant_id: rid,
      code: input.code,
      label: input.label,
      is_archived: false,
      created_at: this.now(),
    };
    await this.repo.insert(row);
    return row;
  }

  async update(rid: string, id: string, patch: { label?: string }): Promise<WasteReasonRow> {
    const row = await this.repo.findById(id);
    if (!row || row.restaurant_id !== rid) throw new NotFoundError('waste reason');
    await this.repo.update(id, patch);
    return { ...row, ...patch };
  }

  async archive(rid: string, id: string): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row || row.restaurant_id !== rid) throw new NotFoundError('waste reason');
    await this.repo.archive(id);
  }
}

// ─── Stations ───────────────────────────────────────────────────────────────
// §6.11 — kitchen stations are an editable per-restaurant catalogue.
// RecipeLine.station holds the station's `code` as plain text (no FK), so a
// rename or archive never orphans recipe history.

export interface StationRow {
  id: string;
  restaurant_id: string;
  code: string;
  label: string;
  sort_order: number;
  is_archived: boolean;
  archived_at: Date | null;
  created_at: Date;
}

export interface StationRepo {
  list(restaurant_id: string, includeArchived?: boolean): Promise<StationRow[]>;
  findById(id: string): Promise<StationRow | null>;
  findByCode(restaurant_id: string, code: string): Promise<StationRow | null>;
  insert(row: StationRow): Promise<void>;
  update(id: string, patch: Partial<StationRow>): Promise<void>;
  archive(id: string, archived_at: Date): Promise<void>;
}

const STATION_CODE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export class StationsService {
  constructor(private readonly repo: StationRepo, private readonly now: () => Date = () => new Date()) {}

  list(rid: string, opts: { includeArchived?: boolean } = {}) {
    return this.repo.list(rid, opts.includeArchived);
  }

  async create(rid: string, input: { code: string; label: string; sort_order?: number }): Promise<StationRow> {
    const code = input.code.trim().toLowerCase();
    if (!STATION_CODE_RE.test(code)) {
      throw new Error('station code must be lowercase alphanumeric with optional `-`/`_`, ≤32 chars');
    }
    const label = input.label.trim();
    if (!label) throw new Error('station label is required');
    if (await this.repo.findByCode(rid, code)) throw new DuplicateError(`station "${code}"`);
    const row: StationRow = {
      id: uuidv4(),
      restaurant_id: rid,
      code,
      label,
      sort_order: input.sort_order ?? 0,
      is_archived: false,
      archived_at: null,
      created_at: this.now(),
    };
    await this.repo.insert(row);
    return row;
  }

  async update(rid: string, id: string, patch: { label?: string; sort_order?: number }): Promise<StationRow> {
    const row = await this.repo.findById(id);
    if (!row || row.restaurant_id !== rid) throw new NotFoundError('station');
    const next: Partial<StationRow> = {};
    if (patch.label !== undefined) {
      const label = patch.label.trim();
      if (!label) throw new Error('station label is required');
      next.label = label;
    }
    if (patch.sort_order !== undefined) next.sort_order = patch.sort_order;
    await this.repo.update(id, next);
    return { ...row, ...next };
  }

  async archive(rid: string, id: string): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row || row.restaurant_id !== rid) throw new NotFoundError('station');
    await this.repo.archive(id, this.now());
  }
}

// ─── Par Levels ─────────────────────────────────────────────────────────────
// §6.11 — par levels by day-of-week, per recipe. 0=Sun…6=Sat.

export interface ParLevelRow {
  id: string;
  restaurant_id: string;
  recipe_id: string;
  day_of_week: number;
  qty: number;
  updated_at: Date;
}

export interface ParLevelRepo {
  forRecipe(restaurant_id: string, recipe_id: string): Promise<ParLevelRow[]>;
  forRestaurant(restaurant_id: string): Promise<ParLevelRow[]>;
  upsert(row: ParLevelRow): Promise<void>;
  findByRecipeDay(restaurant_id: string, recipe_id: string, day_of_week: number): Promise<ParLevelRow | null>;
}

export class ParLevelsService {
  constructor(private readonly repo: ParLevelRepo, private readonly now: () => Date = () => new Date()) {}

  list(rid: string, recipe_id?: string): Promise<ParLevelRow[]> {
    return recipe_id ? this.repo.forRecipe(rid, recipe_id) : this.repo.forRestaurant(rid);
  }

  /**
   * Upsert a par level. A restaurant has at most one row per (recipe, day).
   * We update the existing row in place — pars aren't history-bearing like costs.
   */
  async set(rid: string, input: { recipe_id: string; day_of_week: number; qty: number }): Promise<ParLevelRow> {
    if (input.day_of_week < 0 || input.day_of_week > 6) {
      throw new Error(`day_of_week must be 0..6, got ${input.day_of_week}`);
    }
    if (input.qty < 0) throw new Error('qty must be non-negative');
    const existing = await this.repo.findByRecipeDay(rid, input.recipe_id, input.day_of_week);
    const row: ParLevelRow = existing
      ? { ...existing, qty: input.qty, updated_at: this.now() }
      : {
          id: uuidv4(),
          restaurant_id: rid,
          recipe_id: input.recipe_id,
          day_of_week: input.day_of_week,
          qty: input.qty,
          updated_at: this.now(),
        };
    await this.repo.upsert(row);
    return row;
  }
}

// ─── Aggregate ──────────────────────────────────────────────────────────────

export interface SettingsServices {
  locations: LocationsService;
  utensils: UtensilsService;
  wasteReasons: WasteReasonsService;
  stations: StationsService;
  parLevels: ParLevelsService;
}

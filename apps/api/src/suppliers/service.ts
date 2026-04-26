// TASK-035 — Suppliers service (§6.2 AC-1..5).

import { randomBytes } from 'node:crypto';

// v1.7 — supplier KPI taxonomy.
export type SupplierCategory =
  | 'broadline' | 'produce' | 'beverage' | 'bakery' | 'dairy' | 'specialty' | 'other';
export type SupplierStatus = 'active' | 'review' | 'inactive';

export interface SupplierRow {
  id: string;
  restaurant_id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  lead_time_days: number;
  min_order_cents: number;
  order_cadence: string | null;
  is_active: boolean;
  // v1.7 additions
  category: SupplierCategory | null;
  star_rating: number | null;
  delivery_days: number[];
  cutoff_time: string | null;
  status: SupplierStatus;
  created_at: Date;
}

export interface SupplierOfferRow {
  id: string;
  supplier_id: string;
  ingredient_id: string;
  supplier_pack_size: number | null;
  unit_cost_cents: number;
  rank: number;
  effective_from: Date;
  effective_until: Date | null;
  created_at: Date;
}

export interface CreateSupplierInput {
  name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  lead_time_days?: number;
  min_order_cents?: number;
  order_cadence?: string | null;
  category?: SupplierCategory | null;
  star_rating?: number | null;
  delivery_days?: number[];
  cutoff_time?: string | null;
  status?: SupplierStatus;
}
export type UpdateSupplierInput = Partial<Omit<CreateSupplierInput, 'name'>> & { name?: string };

export interface ListSupplierFilters { includeInactive?: boolean }

export interface SupplierRepo {
  list(restaurant_id: string, filters?: ListSupplierFilters): Promise<SupplierRow[]>;
  findById(id: string): Promise<SupplierRow | null>;
  findByName(restaurant_id: string, name: string): Promise<SupplierRow | null>;
  insert(row: SupplierRow): Promise<void>;
  update(id: string, patch: Partial<SupplierRow>): Promise<void>;
  deactivate(id: string): Promise<void>;
}

export interface UpsertOfferInput {
  supplier_id: string;
  ingredient_id: string;
  unit_cost_cents: number;
  rank?: number;
  supplier_pack_size?: number | null;
  effective_from?: Date;
}

export interface SupplierOfferRepo {
  offersForIngredient(ingredient_id: string): Promise<SupplierOfferRow[]>;
  offersForSupplier(supplier_id: string): Promise<SupplierOfferRow[]>;
  insert(row: SupplierOfferRow): Promise<void>;
  endCurrent(ingredient_id: string, supplier_id: string, at: Date): Promise<void>;
  historyForIngredient(ingredient_id: string): Promise<SupplierOfferRow[]>;
}

export class DuplicateSupplierError extends Error {
  constructor(name: string) {
    super(`supplier "${name}" already exists`);
    this.name = 'DuplicateSupplierError';
  }
}

function uuidv4(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface SuppliersServiceDeps {
  repo: SupplierRepo;
  offers: SupplierOfferRepo;
  now?: () => Date;
}

export class SuppliersService {
  private readonly now: () => Date;

  constructor(private readonly deps: SuppliersServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  list(restaurant_id: string, filters?: ListSupplierFilters): Promise<SupplierRow[]> {
    return this.deps.repo.list(restaurant_id, filters);
  }

  async get(restaurant_id: string, id: string): Promise<SupplierRow | null> {
    const row = await this.deps.repo.findById(id);
    if (!row || row.restaurant_id !== restaurant_id) return null;
    return row;
  }

  async create(restaurant_id: string, input: CreateSupplierInput): Promise<SupplierRow> {
    const existing = await this.deps.repo.findByName(restaurant_id, input.name);
    if (existing) throw new DuplicateSupplierError(input.name);
    const row: SupplierRow = {
      id: uuidv4(),
      restaurant_id,
      name: input.name,
      contact_name: input.contact_name ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      lead_time_days: input.lead_time_days ?? 1,
      min_order_cents: input.min_order_cents ?? 0,
      order_cadence: input.order_cadence ?? null,
      is_active: true,
      category: input.category ?? null,
      star_rating: input.star_rating ?? null,
      delivery_days: input.delivery_days ?? [],
      cutoff_time: input.cutoff_time ?? null,
      status: input.status ?? 'active',
      created_at: this.now(),
    };
    await this.deps.repo.insert(row);
    return row;
  }

  async update(restaurant_id: string, id: string, input: UpdateSupplierInput): Promise<SupplierRow> {
    const current = await this.get(restaurant_id, id);
    if (!current) throw new Error(`supplier ${id} not found`);
    await this.deps.repo.update(id, input);
    return (await this.deps.repo.findById(id))!;
  }

  async deactivate(restaurant_id: string, id: string): Promise<void> {
    const current = await this.get(restaurant_id, id);
    if (!current) throw new Error(`supplier ${id} not found`);
    await this.deps.repo.deactivate(id);
  }

  /**
   * §6.2 AC-3 — upsert an offer. If an active offer exists for the
   * (supplier, ingredient) pair we close it (`effective_until`) and insert a new
   * active row. History is preserved — no row is ever mutated, only closed.
   */
  async upsertOffer(_restaurant_id: string, input: UpsertOfferInput): Promise<SupplierOfferRow> {
    const now = input.effective_from ?? this.now();
    await this.deps.offers.endCurrent(input.ingredient_id, input.supplier_id, now);
    const row: SupplierOfferRow = {
      id: uuidv4(),
      supplier_id: input.supplier_id,
      ingredient_id: input.ingredient_id,
      supplier_pack_size: input.supplier_pack_size ?? null,
      unit_cost_cents: input.unit_cost_cents,
      rank: input.rank ?? 1,
      effective_from: now,
      effective_until: null,
      created_at: now,
    };
    await this.deps.offers.insert(row);
    return row;
  }

  rankedOffersForIngredient(ingredient_id: string): Promise<SupplierOfferRow[]> {
    return this.deps.offers.offersForIngredient(ingredient_id);
  }

  offersForSupplier(supplier_id: string): Promise<SupplierOfferRow[]> {
    return this.deps.offers.offersForSupplier(supplier_id);
  }

  /**
   * §6.2 AC-3 — reorder. We close every current active offer for the ingredient
   * and re-insert them with new ranks so history stays append-only.
   */
  async reorderOffers(_restaurant_id: string, ingredient_id: string, supplierOrder: string[]): Promise<void> {
    const current = await this.deps.offers.offersForIngredient(ingredient_id);
    const now = this.now();
    const bySupplier = new Map(current.map((o) => [o.supplier_id, o]));
    for (const o of current) {
      await this.deps.offers.endCurrent(ingredient_id, o.supplier_id, now);
    }
    let rank = 1;
    for (const supplierId of supplierOrder) {
      const old = bySupplier.get(supplierId);
      if (!old) continue;
      await this.deps.offers.insert({
        id: uuidv4(),
        supplier_id: supplierId,
        ingredient_id,
        supplier_pack_size: old.supplier_pack_size,
        unit_cost_cents: old.unit_cost_cents,
        rank,
        effective_from: now,
        effective_until: null,
        created_at: now,
      });
      rank += 1;
    }
  }
}

// ─── Price Creep (§6.2 AC-5) ────────────────────────────────────────────────

export interface PriceCreepOpts {
  windowDays: number;
  thresholdPct: number;
  now?: Date;
}

export interface PriceCreepResult {
  ingredient_id: string;
  supplier_id: string;
  earliest_cents: number;
  latest_cents: number;
  pct_change: number;
}

/**
 * Flags ingredient/supplier pairs whose cost rose by more than `thresholdPct`
 * over the last `windowDays`. Only considers offers whose `effective_from` is
 * inside the window (or the nearest-earlier offer is used as the baseline).
 */
export function priceCreep(offers: SupplierOfferRow[], opts: PriceCreepOpts): PriceCreepResult[] {
  const now = opts.now ?? new Date();
  const windowStart = new Date(now.getTime() - opts.windowDays * 24 * 3600 * 1000);

  const groups = new Map<string, SupplierOfferRow[]>();
  for (const o of offers) {
    const key = `${o.ingredient_id}:${o.supplier_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }

  const out: PriceCreepResult[] = [];
  for (const [key, group] of groups) {
    const inWindow = group
      .filter((o) => o.effective_from >= windowStart && o.effective_from <= now)
      .sort((a, b) => a.effective_from.getTime() - b.effective_from.getTime());
    if (inWindow.length < 2) continue;
    const earliest = inWindow[0]!;
    const latest = inWindow[inWindow.length - 1]!;
    if (earliest.unit_cost_cents === 0) continue;
    const pctChange = ((latest.unit_cost_cents - earliest.unit_cost_cents) / earliest.unit_cost_cents) * 100;
    if (pctChange > opts.thresholdPct) {
      const [ingredient_id, supplier_id] = key.split(':');
      out.push({
        ingredient_id: ingredient_id!,
        supplier_id: supplier_id!,
        earliest_cents: earliest.unit_cost_cents,
        latest_cents: latest.unit_cost_cents,
        pct_change: pctChange,
      });
    }
  }
  return out;
}

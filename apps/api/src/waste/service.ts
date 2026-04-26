// TASK-060 — Waste service (§6.8).
//
// Logs ingredient OR prep waste with a reason. unit_cost is pinned at log time
// so historical reports stay stable when costs change later. Partial portion-
// bag entries (§6.3a) are accepted via the `qty < 1` path on a prep ref.

import { randomBytes } from 'node:crypto';

export type WasteRefType = 'ingredient' | 'prep';

// v1.7 — attribution bucket captures "who ate the cost" (accounting view),
// distinct from WasteReason which captures the operational "why".
export type WasteAttributionBucket =
  | 'spoilage'
  | 'prep_waste'
  | 'comped_meals'
  | 'theft_suspected';

export interface WasteEntry {
  id: string;
  restaurant_id: string;
  ref_type: WasteRefType;
  ingredient_id: string | null;
  recipe_version_id: string | null;
  qty: number;
  uom: string;
  reason_id: string;
  attribution_bucket: WasteAttributionBucket;
  station_code: string | null;
  note: string | null;
  photo_url: string | null;
  unit_cost_cents_pinned: number;
  value_cents: number;
  user_id: string | null;
  at: Date;
}

export interface CreateWasteInput {
  ref_type: WasteRefType;
  ingredient_id?: string | null;
  recipe_version_id?: string | null;
  qty: number;
  uom: string;
  reason_id: string;
  attribution_bucket: WasteAttributionBucket;
  station_code?: string | null;
  note?: string | null;
  photo_url?: string | null;
  user_id?: string | null;
}

export interface WasteRepo {
  insert(e: WasteEntry): Promise<void>;
  list(restaurant_id: string, since: Date): Promise<WasteEntry[]>;
  totalValueCents(restaurant_id: string, since: Date, until: Date): Promise<number>;
  listRange(restaurant_id: string, since: Date, until: Date): Promise<WasteEntry[]>;
}

export interface BucketBreakdown {
  bucket: WasteAttributionBucket;
  value_cents: number;
  entry_count: number;
}

export interface BucketRollup {
  total_value_cents: number;
  total_entries: number;
  by_bucket: BucketBreakdown[];
  since: Date;
  until: Date;
}

export interface CostLookup {
  /** Returns the most-recent unit_cost_cents for an ingredient or prep recipe (per yield-unit). */
  resolve(ref_type: WasteRefType, ingredient_id: string | null, recipe_version_id: string | null): Promise<number>;
}

export interface ExpiredCandidate {
  ref_type: WasteRefType;
  ingredient_id: string | null;
  recipe_version_id: string | null;
  label: string;
  qty: number;
  uom: string;
  expired_on: Date;
  reason_suggestion: string;
}

export interface ExpiredSource {
  /** Returns prep runs past expires_on that have not been counted in the latest inventory count. */
  expired(restaurant_id: string, asOf: Date): Promise<ExpiredCandidate[]>;
}

export class WasteValidationError extends Error {
  constructor(msg: string) { super(msg); this.name = 'WasteValidationError'; }
}

function uuidv4(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface WasteServiceDeps {
  repo: WasteRepo;
  costs: CostLookup;
  expired?: ExpiredSource;
  now?: () => Date;
}

export class WasteService {
  private readonly now: () => Date;
  constructor(private readonly deps: WasteServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async log(restaurant_id: string, input: CreateWasteInput): Promise<WasteEntry> {
    if (input.qty <= 0) throw new WasteValidationError('qty must be > 0');
    if (input.ref_type === 'ingredient' && !input.ingredient_id) {
      throw new WasteValidationError('ingredient_id required when ref_type=ingredient');
    }
    if (input.ref_type === 'prep' && !input.recipe_version_id) {
      throw new WasteValidationError('recipe_version_id required when ref_type=prep');
    }
    const unit = await this.deps.costs.resolve(
      input.ref_type, input.ingredient_id ?? null, input.recipe_version_id ?? null,
    );
    const entry: WasteEntry = {
      id: uuidv4(),
      restaurant_id,
      ref_type: input.ref_type,
      ingredient_id: input.ingredient_id ?? null,
      recipe_version_id: input.recipe_version_id ?? null,
      qty: input.qty,
      uom: input.uom,
      reason_id: input.reason_id,
      attribution_bucket: input.attribution_bucket,
      station_code: input.station_code ?? null,
      note: input.note ?? null,
      photo_url: input.photo_url ?? null,
      unit_cost_cents_pinned: unit,
      value_cents: Math.round(unit * input.qty),
      user_id: input.user_id ?? null,
      at: this.now(),
    };
    await this.deps.repo.insert(entry);
    return entry;
  }

  list(restaurant_id: string, since: Date): Promise<WasteEntry[]> {
    return this.deps.repo.list(restaurant_id, since);
  }

  totalValueCents(restaurant_id: string, since: Date, until: Date): Promise<number> {
    return this.deps.repo.totalValueCents(restaurant_id, since, until);
  }

  /** §6.8 AC-3 — items past their shelf-life that have not yet been wasted/counted. */
  async expiredSuggestions(restaurant_id: string): Promise<ExpiredCandidate[]> {
    if (!this.deps.expired) return [];
    return this.deps.expired.expired(restaurant_id, this.now());
  }

  /** v1.7 §6.8 AC-6 — attribution-bucket rollup for the Waste & Loss report donut. */
  async byBucket(restaurant_id: string, since: Date, until: Date): Promise<BucketRollup> {
    const rows = await this.deps.repo.listRange(restaurant_id, since, until);
    const buckets: WasteAttributionBucket[] = ['spoilage', 'prep_waste', 'comped_meals', 'theft_suspected'];
    const totals = new Map<WasteAttributionBucket, { value_cents: number; entry_count: number }>();
    for (const b of buckets) totals.set(b, { value_cents: 0, entry_count: 0 });
    let grandTotal = 0;
    for (const r of rows) {
      const cur = totals.get(r.attribution_bucket)!;
      cur.value_cents += r.value_cents;
      cur.entry_count += 1;
      grandTotal += r.value_cents;
    }
    return {
      total_value_cents: grandTotal,
      total_entries: rows.length,
      by_bucket: buckets.map((b) => ({ bucket: b, ...totals.get(b)! })),
      since,
      until,
    };
  }
}

// TASK-069 — Reports service (§6.9).
//
// Three reports for v1.6:
//   1. AvT (Actual vs Theoretical) — variance per menu item, current period
//   2. Price Creep — ingredients whose latest cost > prior cost by ≥ threshold
//   3. Waste — totals by reason / by recipe

export interface AvtRow {
  menu_recipe_id: string;
  menu_recipe_name: string;
  qty_sold: number;
  theoretical_cost_cents: number;
  actual_cost_cents: number;
  variance_cents: number;
  variance_pct: number;
}

export interface PriceCreepRow {
  ingredient_id: string;
  ingredient_name: string;
  previous_cents: number;
  latest_cents: number;
  delta_pct: number;
  observed_at: Date;
}

export interface WasteByReasonRow {
  reason_id: string;
  reason_label: string;
  total_value_cents: number;
  entries: number;
}

export interface ReportsRepo {
  avt(restaurant_id: string, since: Date, until: Date): Promise<AvtRow[]>;
  priceCreep(restaurant_id: string, sinceDays: number, threshold_pct: number): Promise<PriceCreepRow[]>;
  wasteByReason(restaurant_id: string, since: Date, until: Date): Promise<WasteByReasonRow[]>;
}

export interface ReportsServiceDeps {
  repo: ReportsRepo;
  now?: () => Date;
}

export class ReportsService {
  private readonly now: () => Date;
  constructor(private readonly deps: ReportsServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** §6.9 — AvT for an arbitrary period (defaults to last 7 days). */
  async avt(restaurant_id: string, opts: { since?: Date; until?: Date } = {}): Promise<AvtRow[]> {
    const until = opts.until ?? this.now();
    const since = opts.since ?? new Date(until.getTime() - 7 * 86_400_000);
    return this.deps.repo.avt(restaurant_id, since, until);
  }

  /** §6.9 — Price creep over the trailing window (default 30 days, 5% threshold). */
  async priceCreep(restaurant_id: string, opts: { sinceDays?: number; threshold_pct?: number } = {}): Promise<PriceCreepRow[]> {
    return this.deps.repo.priceCreep(restaurant_id, opts.sinceDays ?? 30, opts.threshold_pct ?? 5);
  }

  /** §6.9 — Waste totals by reason for the period. */
  async wasteByReason(restaurant_id: string, opts: { since?: Date; until?: Date } = {}): Promise<WasteByReasonRow[]> {
    const until = opts.until ?? this.now();
    const since = opts.since ?? new Date(until.getTime() - 7 * 86_400_000);
    return this.deps.repo.wasteByReason(restaurant_id, since, until);
  }
}

// TASK-069 — Reports service (§6.9).
//
// Three reports for v1.6:
//   1. AvT (Actual vs Theoretical) — variance per menu item, current period
//   2. Price Creep — ingredients whose latest cost > prior cost by ≥ threshold
//   3. Waste — totals by reason / by recipe

export type AvtTier = 'critical' | 'warning' | 'ok';

export interface AvtRow {
  menu_recipe_id: string;
  menu_recipe_name: string;
  qty_sold: number;
  theoretical_cost_cents: number;
  actual_cost_cents: number;
  variance_cents: number;
  variance_pct: number;
  tier?: AvtTier;
}

export interface AvtSummary {
  total_theoretical_cents: number;
  total_actual_cents: number;
  total_variance_cents: number;
  items_over_threshold: number;
  rows: AvtRow[];
}

export interface PriceCreepTrendPoint {
  observed_at: Date;
  unit_cost_cents: number;
}

export interface PriceCreepWithTrend {
  ingredient_id: string;
  ingredient_name: string;
  previous_cents: number;
  latest_cents: number;
  delta_pct: number;
  observed_at: Date;
  deliveries: PriceCreepTrendPoint[];
  /**
   * Projected monthly cost impact of the most recent price jump, in cents.
   * Computed as `(latest_cents - previous_cents) × usage_last_30_days`.
   * Null when usage data isn't available (e.g. no POS sales yet).
   */
  monthly_impact_cents: number | null;
  usage_last_30_days: number | null;
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

export interface WasteAttributionRow {
  bucket: string;
  total_value_cents: number;
  entries: number;
}

export interface WasteLossReport {
  total_value_cents: number;
  total_entries: number;
  by_bucket: WasteAttributionRow[];
  by_reason: WasteByReasonRow[];
  since: Date;
  until: Date;
}

export interface FoodCostPctReport {
  period_start: Date;
  period_end: Date;
  actual_cost_cents: number;
  sales_cents: number;
  food_cost_pct: number | null;
}

export interface InventoryCostWeeklyPoint {
  week_start: Date;
  total_value_cents: number;
}

export interface AvtDailyPoint {
  business_date: Date;
  theoretical_cost_cents: number;
  actual_cost_cents: number;
}

export interface IngredientUsage {
  ingredient_id: string;
  qty: number;
}

export interface LatestCountQty {
  ingredient_id: string;
  actual_qty: number;
  counted_at: Date;
}

export interface StockIntelligenceRow {
  ingredient_id: string;
  ingredient_name: string;
  on_hand_qty: number | null;
  counted_at: Date | null;
  usage_last_30_days: number | null;
  daily_usage: number | null;
  par_qty: number | null;
  days_of_stock: number | null;
  shortage_flag: 'out' | 'critical' | 'low' | 'ok' | 'unknown';
}

export interface MenuContributionRow {
  menu_recipe_id: string;
  menu_recipe_name: string;
  qty_sold: number;
  revenue_cents: number;
  theoretical_cost_cents: number;
  margin_cents: number;
  margin_pct: number;
  cost_pct: number;
  share_of_profit_pct: number;
}

export interface DeadStockRow {
  ingredient_id: string;
  ingredient_name: string;
  on_hand_qty: number;
  counted_at: Date;
  unit_cost_cents: number | null;
  idle_value_cents: number | null;
  last_waste_at: Date | null;
}

export interface ReportsRepo {
  avt(restaurant_id: string, since: Date, until: Date): Promise<AvtRow[]>;
  priceCreep(restaurant_id: string, sinceDays: number, threshold_pct: number): Promise<PriceCreepRow[]>;
  priceCreepTrend?(restaurant_id: string, ingredient_id: string, limit: number): Promise<PriceCreepTrendPoint[]>;
  wasteByReason(restaurant_id: string, since: Date, until: Date): Promise<WasteByReasonRow[]>;
  wasteByBucket?(restaurant_id: string, since: Date, until: Date): Promise<WasteAttributionRow[]>;
  foodCostPct?(restaurant_id: string, since: Date, until: Date): Promise<{ actual_cost_cents: number; sales_cents: number }>;
  inventoryCostWeekly?(restaurant_id: string, sinceDays: number): Promise<InventoryCostWeeklyPoint[]>;
  avtDaily?(restaurant_id: string, since: Date, until: Date): Promise<AvtDailyPoint[]>;
  /**
   * Ingredient usage (in the recipe-line's native uom) over a window.
   * Derived from `PosSale × AlohaMenuMap × current RecipeVersion lines`.
   * Prep-recipe recursion is not expanded in v1 — direct ingredient lines only.
   */
  ingredientUsage?(restaurant_id: string, since: Date, until: Date): Promise<IngredientUsage[]>;

  /** Latest counted quantity per ingredient from the most recent completed count. */
  latestCountQty?(restaurant_id: string): Promise<LatestCountQty[]>;

  /** Most recent waste entry timestamp per ingredient (for dead-stock detection). */
  lastWasteAt?(restaurant_id: string): Promise<Array<{ ingredient_id: string; last_waste_at: Date }>>;

  /**
   * Per-menu-item revenue + theoretical cost aggregate for contribution analysis.
   * Reuses pos_sale × aloha_menu_map × recipe_version.plated_cost_cents.
   */
  menuContribution?(restaurant_id: string, since: Date, until: Date): Promise<Array<{
    menu_recipe_id: string;
    menu_recipe_name: string;
    qty_sold: number;
    revenue_cents: number;
    theoretical_cost_cents: number;
  }>>;
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
    const rows = await this.deps.repo.avt(restaurant_id, since, until);
    return rows.map((r) => ({ ...r, tier: classifyAvt(r.variance_pct) }));
  }

  /** v1.7 — AvT with per-row tiers + restaurant totals. */
  async avtSummary(restaurant_id: string, opts: { since?: Date; until?: Date } = {}): Promise<AvtSummary> {
    const rows = await this.avt(restaurant_id, opts);
    let theoretical = 0;
    let actual = 0;
    let variance = 0;
    let over = 0;
    for (const r of rows) {
      theoretical += r.theoretical_cost_cents;
      actual += r.actual_cost_cents;
      variance += r.variance_cents;
      if (r.tier === 'critical' || r.tier === 'warning') over += 1;
    }
    return {
      total_theoretical_cents: theoretical,
      total_actual_cents: actual,
      total_variance_cents: variance,
      items_over_threshold: over,
      rows,
    };
  }

  /** §6.9 — Price creep over the trailing window (default 30 days, 5% threshold). */
  async priceCreep(restaurant_id: string, opts: { sinceDays?: number; threshold_pct?: number } = {}): Promise<PriceCreepRow[]> {
    return this.deps.repo.priceCreep(restaurant_id, opts.sinceDays ?? 30, opts.threshold_pct ?? 5);
  }

  /** v1.7 §6.9 — price creep enriched with last-3-delivery trend + projected
   *  monthly $ impact (delta × 30-day usage) per flagged item. */
  async priceCreepWithTrend(
    restaurant_id: string,
    opts: { sinceDays?: number; threshold_pct?: number } = {},
  ): Promise<PriceCreepWithTrend[]> {
    const flagged = await this.priceCreep(restaurant_id, opts);
    if (flagged.length === 0) return [];
    const trendFn = this.deps.repo.priceCreepTrend;
    const usageFn = this.deps.repo.ingredientUsage;

    const until = this.now();
    const since = new Date(until.getTime() - 30 * 86_400_000);
    const usageMap = usageFn
      ? new Map((await usageFn(restaurant_id, since, until)).map((u) => [u.ingredient_id, u.qty]))
      : new Map<string, number>();

    const out: PriceCreepWithTrend[] = [];
    for (const row of flagged) {
      const deliveries = trendFn ? await trendFn(restaurant_id, row.ingredient_id, 3) : [];
      const usage = usageMap.get(row.ingredient_id);
      const monthly_impact_cents = usage != null
        ? Math.round((row.latest_cents - row.previous_cents) * usage)
        : null;
      out.push({
        ...row,
        deliveries,
        usage_last_30_days: usage ?? null,
        monthly_impact_cents,
      });
    }
    return out;
  }

  /** §6.9 — Waste totals by reason for the period. */
  async wasteByReason(restaurant_id: string, opts: { since?: Date; until?: Date } = {}): Promise<WasteByReasonRow[]> {
    const until = opts.until ?? this.now();
    const since = opts.since ?? new Date(until.getTime() - 7 * 86_400_000);
    return this.deps.repo.wasteByReason(restaurant_id, since, until);
  }

  /** v1.7 §6.9 — waste-loss rollup (bucket + reason + totals). */
  async wasteLoss(restaurant_id: string, opts: { since?: Date; until?: Date } = {}): Promise<WasteLossReport> {
    const until = opts.until ?? this.now();
    const since = opts.since ?? new Date(until.getTime() - 30 * 86_400_000);
    const [by_reason, by_bucket_raw] = await Promise.all([
      this.deps.repo.wasteByReason(restaurant_id, since, until),
      this.deps.repo.wasteByBucket ? this.deps.repo.wasteByBucket(restaurant_id, since, until) : Promise.resolve([]),
    ]);
    const total_entries = by_reason.reduce((s, r) => s + r.entries, 0);
    const total_value_cents = by_reason.reduce((s, r) => s + r.total_value_cents, 0);
    return { total_value_cents, total_entries, by_bucket: by_bucket_raw, by_reason, since, until };
  }

  /** v1.7 §6.10 — food-cost %: actual_cost / sales over period. */
  async foodCostPct(
    restaurant_id: string,
    opts: { since?: Date; until?: Date } = {},
  ): Promise<FoodCostPctReport> {
    const until = opts.until ?? this.now();
    const since = opts.since ?? new Date(until.getTime() - 30 * 86_400_000);
    const totals = this.deps.repo.foodCostPct
      ? await this.deps.repo.foodCostPct(restaurant_id, since, until)
      : { actual_cost_cents: 0, sales_cents: 0 };
    const food_cost_pct = totals.sales_cents > 0
      ? Math.round((totals.actual_cost_cents / totals.sales_cents) * 1000) / 10
      : null;
    return {
      period_start: since,
      period_end: until,
      actual_cost_cents: totals.actual_cost_cents,
      sales_cents: totals.sales_cents,
      food_cost_pct,
    };
  }

  /** v1.7 §6.10 — weekly inventory value (last N weeks). */
  async inventoryCostWeekly(
    restaurant_id: string, opts: { sinceDays?: number } = {},
  ): Promise<InventoryCostWeeklyPoint[]> {
    if (!this.deps.repo.inventoryCostWeekly) return [];
    return this.deps.repo.inventoryCostWeekly(restaurant_id, opts.sinceDays ?? 56);
  }

  /** v1.7 §6.10 — daily AvT aggregate for the dashboard's Mon-Sun bars. */
  async avtDaily(
    restaurant_id: string, opts: { since?: Date; until?: Date } = {},
  ): Promise<AvtDailyPoint[]> {
    if (!this.deps.repo.avtDaily) return [];
    const until = opts.until ?? this.now();
    const since = opts.since ?? new Date(until.getTime() - 7 * 86_400_000);
    return this.deps.repo.avtDaily(restaurant_id, since, until);
  }

  /**
   * v1.8 — per-ingredient stock intelligence. Joins latest count qty with
   * 30-day usage → daily rate → days of stock on hand. Shortage flags use
   * days_of_stock vs PAR and a simple threshold scale.
   *
   * Requires: `ingredientUsage` + `latestCountQty` repo methods. Returns one
   * row per ingredient supplied by `nameResolver`.
   */
  async stockIntelligence(
    restaurant_id: string,
    nameResolver: (ids: string[]) => Promise<Array<{ id: string; name: string; par_qty: number | null }>>,
  ): Promise<StockIntelligenceRow[]> {
    const usageFn = this.deps.repo.ingredientUsage;
    const countFn = this.deps.repo.latestCountQty;
    if (!usageFn || !countFn) return [];

    const until = this.now();
    const since = new Date(until.getTime() - 30 * 86_400_000);
    const [usage, counts] = await Promise.all([
      usageFn(restaurant_id, since, until),
      countFn(restaurant_id),
    ]);
    const usageMap = new Map(usage.map((u) => [u.ingredient_id, u.qty]));
    const countMap = new Map(counts.map((c) => [c.ingredient_id, c]));

    const ids = Array.from(new Set([...usageMap.keys(), ...countMap.keys()]));
    const ingredients = await nameResolver(ids);

    return ingredients.map((ing) => {
      const usage30 = usageMap.get(ing.id);
      const count = countMap.get(ing.id);
      const daily = usage30 != null ? usage30 / 30 : null;
      const onHand = count?.actual_qty ?? null;
      const days = onHand != null && daily != null && daily > 0
        ? onHand / daily
        : null;
      let flag: StockIntelligenceRow['shortage_flag'] = 'unknown';
      if (onHand === 0) flag = 'out';
      else if (days != null) {
        if (days < 1) flag = 'critical';
        else if (days < 3) flag = 'low';
        else flag = 'ok';
      } else if (ing.par_qty != null && onHand != null) {
        flag = onHand < ing.par_qty ? 'low' : 'ok';
      }

      return {
        ingredient_id: ing.id,
        ingredient_name: ing.name,
        on_hand_qty: onHand,
        counted_at: count?.counted_at ?? null,
        usage_last_30_days: usage30 ?? null,
        daily_usage: daily,
        par_qty: ing.par_qty,
        days_of_stock: days != null ? Math.round(days * 10) / 10 : null,
        shortage_flag: flag,
      };
    });
  }

  /**
   * v1.8 — dead stock: ingredients with on-hand > 0 but zero computed usage
   * AND zero waste in last 30 days. Sorted by idle_value desc.
   */
  async deadStock(
    restaurant_id: string,
    nameResolver: (ids: string[]) => Promise<Array<{
      id: string; name: string; latest_unit_cost_cents: number | null;
    }>>,
  ): Promise<DeadStockRow[]> {
    const usageFn = this.deps.repo.ingredientUsage;
    const countFn = this.deps.repo.latestCountQty;
    const wasteFn = this.deps.repo.lastWasteAt;
    if (!countFn) return [];

    const until = this.now();
    const since = new Date(until.getTime() - 30 * 86_400_000);

    const [usage, counts, waste] = await Promise.all([
      usageFn ? usageFn(restaurant_id, since, until) : Promise.resolve([]),
      countFn(restaurant_id),
      wasteFn ? wasteFn(restaurant_id) : Promise.resolve([]),
    ]);
    const usageSet = new Set(usage.filter((u) => u.qty > 0).map((u) => u.ingredient_id));
    const wasteMap = new Map(waste.map((w) => [w.ingredient_id, w.last_waste_at]));

    const candidates = counts.filter((c) => c.actual_qty > 0 && !usageSet.has(c.ingredient_id));

    const filteredCandidates = candidates.filter((c) => {
      const w = wasteMap.get(c.ingredient_id);
      return !w || w.getTime() < since.getTime();
    });

    const ingredients = await nameResolver(filteredCandidates.map((c) => c.ingredient_id));
    const ingMap = new Map(ingredients.map((i) => [i.id, i]));

    const rows: DeadStockRow[] = filteredCandidates.map((c) => {
      const ing = ingMap.get(c.ingredient_id);
      const unitCost = ing?.latest_unit_cost_cents ?? null;
      const idleValue = unitCost != null ? Math.round(c.actual_qty * unitCost) : null;
      return {
        ingredient_id: c.ingredient_id,
        ingredient_name: ing?.name ?? 'Unknown',
        on_hand_qty: c.actual_qty,
        counted_at: c.counted_at,
        unit_cost_cents: unitCost,
        idle_value_cents: idleValue,
        last_waste_at: wasteMap.get(c.ingredient_id) ?? null,
      };
    });

    rows.sort((a, b) => (b.idle_value_cents ?? 0) - (a.idle_value_cents ?? 0));
    return rows;
  }

  /**
   * Menu-item contribution ranking: revenue, theoretical cost, gross margin,
   * and each item's share of total profit over the window. Helps the owner see
   * which menu items actually pay the rent (high qty × high margin) vs stars
   * with thin margins or slow-movers with fat margins.
   */
  async menuContribution(
    restaurant_id: string,
    opts: { since?: Date; until?: Date } = {},
  ): Promise<MenuContributionRow[]> {
    const fn = this.deps.repo.menuContribution;
    if (!fn) return [];
    const until = opts.until ?? this.now();
    const since = opts.since ?? new Date(until.getTime() - 30 * 86_400_000);
    const raw = await fn(restaurant_id, since, until);
    const totalProfit = raw.reduce((s, r) => s + (r.revenue_cents - r.theoretical_cost_cents), 0);
    return raw
      .map((r) => {
        const margin = r.revenue_cents - r.theoretical_cost_cents;
        const margin_pct = r.revenue_cents > 0 ? (margin / r.revenue_cents) * 100 : 0;
        const cost_pct = r.revenue_cents > 0 ? (r.theoretical_cost_cents / r.revenue_cents) * 100 : 0;
        const share = totalProfit > 0 ? (margin / totalProfit) * 100 : 0;
        return {
          menu_recipe_id: r.menu_recipe_id,
          menu_recipe_name: r.menu_recipe_name,
          qty_sold: r.qty_sold,
          revenue_cents: r.revenue_cents,
          theoretical_cost_cents: r.theoretical_cost_cents,
          margin_cents: margin,
          margin_pct: Math.round(margin_pct * 10) / 10,
          cost_pct: Math.round(cost_pct * 10) / 10,
          share_of_profit_pct: Math.round(share * 10) / 10,
        };
      })
      .sort((a, b) => b.margin_cents - a.margin_cents);
  }
}

export function classifyAvt(variance_pct: number): AvtTier {
  const abs = Math.abs(variance_pct);
  if (abs > 10) return 'critical';
  if (abs >= 5) return 'warning';
  return 'ok';
}

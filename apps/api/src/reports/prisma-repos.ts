// TASK-069 — Prisma-backed Reports repo (AvT, Price Creep, Waste-by-reason).

import type { PrismaClient } from '@prisma/client';
import type {
  ReportsRepo, AvtRow, PriceCreepRow, WasteByReasonRow,
  WasteAttributionRow, PriceCreepTrendPoint, InventoryCostWeeklyPoint,
  AvtDailyPoint, IngredientUsage,
} from './service.js';

interface AvtSqlRow {
  menu_recipe_id: string;
  menu_recipe_name: string;
  qty_sold: number;
  theoretical_cost_cents: number | string;
  actual_cost_cents: number | string;
}

interface CreepSqlRow {
  ingredient_id: string;
  ingredient_name: string;
  previous_cents: number;
  latest_cents: number;
  observed_at: Date;
}

interface WasteSqlRow {
  reason_id: string;
  reason_label: string;
  total_value_cents: number | string;
  entries: number | string;
}

export function prismaReportsRepo(prisma: PrismaClient): ReportsRepo {
  return {
    async avt(restaurant_id, since, until): Promise<AvtRow[]> {
      // Theoretical plated cost is rolled up on the fly from recipe_line × latest
      // IngredientCost (there is no materialised plated_cost_cents column; see the
      // recipe_plated CTE). Actual cost column in this report carries item_sales_cents
      // so consumers can show theoretical vs revenue/actual side by side.
      const rows = await prisma.$queryRaw<AvtSqlRow[]>`
        WITH recipe_plated AS (
          SELECT rv.id AS recipe_version_id,
                 COALESCE(SUM(rl.qty * COALESCE(
                   (SELECT ic.unit_cost_cents FROM ingredient_cost ic
                    WHERE ic.ingredient_id = rl.ingredient_id
                    ORDER BY ic.effective_from DESC LIMIT 1), 0)), 0)::bigint AS plated_cost_cents
          FROM recipe_version rv
          LEFT JOIN recipe_line rl ON rl.recipe_version_id = rv.id AND rl.ref_type = 'ingredient'
          WHERE rv.is_current
          GROUP BY rv.id
        )
        SELECT
          rv.recipe_id AS menu_recipe_id,
          r.name AS menu_recipe_name,
          COALESCE(SUM(ps.qty), 0)::float AS qty_sold,
          COALESCE(SUM(ps.qty * rp.plated_cost_cents), 0)::bigint AS theoretical_cost_cents,
          COALESCE(SUM(ps.item_sales_cents), 0)::bigint AS actual_cost_cents
        FROM pos_sale ps
        JOIN aloha_menu_map mm
          ON mm.restaurant_id = ps.restaurant_id
         AND mm.aloha_item_name = ps.aloha_item_name
         AND (mm.effective_until IS NULL OR mm.effective_until >= ps.business_date)
         AND mm.effective_from <= ps.business_date
        JOIN recipe r ON r.id = mm.menu_recipe_id
        JOIN recipe_version rv ON rv.recipe_id = r.id AND rv.is_current = true
        JOIN recipe_plated rp ON rp.recipe_version_id = rv.id
        WHERE ps.restaurant_id = ${restaurant_id}::uuid
          AND ps.row_kind = 'item'
          AND ps.business_date >= ${since}
          AND ps.business_date <= ${until}
        GROUP BY rv.recipe_id, r.name
        ORDER BY r.name
      `;
      return rows.map((r) => {
        const theo = Number(r.theoretical_cost_cents);
        const actual = Number(r.actual_cost_cents);
        const variance_cents = actual - theo;
        const variance_pct = theo > 0 ? (variance_cents / theo) * 100 : 0;
        return {
          menu_recipe_id: r.menu_recipe_id,
          menu_recipe_name: r.menu_recipe_name,
          qty_sold: Number(r.qty_sold),
          theoretical_cost_cents: theo,
          actual_cost_cents: actual,
          variance_cents,
          variance_pct: Math.round(variance_pct * 100) / 100,
        };
      });
    },

    async priceCreep(restaurant_id, sinceDays, threshold_pct): Promise<PriceCreepRow[]> {
      // Window function: latest vs previous IngredientCost per ingredient.
      const rows = await prisma.$queryRaw<CreepSqlRow[]>`
        WITH ranked AS (
          SELECT
            ic.ingredient_id,
            i.name AS ingredient_name,
            ic.unit_cost_cents,
            ic.effective_from,
            ROW_NUMBER() OVER (PARTITION BY ic.ingredient_id ORDER BY ic.effective_from DESC) AS rn
          FROM ingredient_cost ic
          JOIN ingredient i ON i.id = ic.ingredient_id
          WHERE i.restaurant_id = ${restaurant_id}::uuid
            AND ic.effective_from >= NOW() - (${sinceDays}::int * INTERVAL '1 day')
        )
        SELECT
          r1.ingredient_id,
          r1.ingredient_name,
          r2.unit_cost_cents AS previous_cents,
          r1.unit_cost_cents AS latest_cents,
          r1.effective_from AS observed_at
        FROM ranked r1
        JOIN ranked r2 ON r2.ingredient_id = r1.ingredient_id AND r2.rn = 2
        WHERE r1.rn = 1
      `;
      return rows
        .map((r) => {
          const delta_pct = r.previous_cents > 0
            ? ((r.latest_cents - r.previous_cents) / r.previous_cents) * 100
            : 0;
          return {
            ingredient_id: r.ingredient_id,
            ingredient_name: r.ingredient_name,
            previous_cents: r.previous_cents,
            latest_cents: r.latest_cents,
            delta_pct: Math.round(delta_pct * 100) / 100,
            observed_at: r.observed_at,
          };
        })
        .filter((r) => r.delta_pct >= threshold_pct);
    },

    async wasteByBucket(restaurant_id, since, until): Promise<WasteAttributionRow[]> {
      const rows = await prisma.wasteEntry.groupBy({
        by: ['attribution_bucket'],
        where: { restaurant_id, at: { gte: since, lt: until } },
        _sum: { value_cents: true },
        _count: { _all: true },
      });
      return rows.map((r) => ({
        bucket: String(r.attribution_bucket),
        total_value_cents: r._sum.value_cents ?? 0,
        entries: r._count._all,
      }));
    },

    async priceCreepTrend(restaurant_id, ingredient_id, limit): Promise<PriceCreepTrendPoint[]> {
      const rows = await prisma.ingredientCost.findMany({
        where: { ingredient_id, ingredient: { restaurant_id } },
        orderBy: { effective_from: 'desc' },
        take: limit,
        select: { unit_cost_cents: true, effective_from: true },
      });
      return rows.map((r) => ({ observed_at: r.effective_from, unit_cost_cents: r.unit_cost_cents }));
    },

    async foodCostPct(restaurant_id, since, until): Promise<{ actual_cost_cents: number; sales_cents: number }> {
      // Actual cost sum comes from pos_sale.item_sales_cents minus margin (approx with AvT flavor).
      // For a v1 approximation, sum theoretical cost from joined recipe_version plated cost and
      // pair it with pos_sale.item_sales_cents for the same window.
      const rows = await prisma.$queryRaw<Array<{ actual_cost_cents: string | number; sales_cents: string | number }>>`
        WITH recipe_plated AS (
          SELECT rv.id AS recipe_version_id,
                 COALESCE(SUM(rl.qty * COALESCE(
                   (SELECT ic.unit_cost_cents FROM ingredient_cost ic
                    WHERE ic.ingredient_id = rl.ingredient_id
                    ORDER BY ic.effective_from DESC LIMIT 1), 0)), 0)::bigint AS plated_cost_cents
          FROM recipe_version rv
          LEFT JOIN recipe_line rl ON rl.recipe_version_id = rv.id AND rl.ref_type = 'ingredient'
          WHERE rv.is_current
          GROUP BY rv.id
        )
        SELECT
          COALESCE(SUM(ps.qty * rp.plated_cost_cents), 0)::bigint AS actual_cost_cents,
          COALESCE(SUM(ps.item_sales_cents), 0)::bigint AS sales_cents
        FROM pos_sale ps
        JOIN aloha_menu_map mm
          ON mm.restaurant_id = ps.restaurant_id
         AND mm.aloha_item_name = ps.aloha_item_name
         AND (mm.effective_until IS NULL OR mm.effective_until >= ps.business_date)
         AND mm.effective_from <= ps.business_date
        JOIN recipe_version rv ON rv.recipe_id = mm.menu_recipe_id AND rv.is_current = true
        JOIN recipe_plated rp ON rp.recipe_version_id = rv.id
        WHERE ps.restaurant_id = ${restaurant_id}::uuid
          AND ps.row_kind = 'item'
          AND ps.business_date >= ${since}
          AND ps.business_date <= ${until}
      `;
      const r = rows[0] ?? { actual_cost_cents: 0, sales_cents: 0 };
      return { actual_cost_cents: Number(r.actual_cost_cents), sales_cents: Number(r.sales_cents) };
    },

    async inventoryCostWeekly(restaurant_id, sinceDays): Promise<InventoryCostWeeklyPoint[]> {
      const rows = await prisma.$queryRaw<Array<{ week_start: Date; total_value_cents: string | number }>>`
        SELECT
          date_trunc('week', ic.date)::date AS week_start,
          COALESCE(SUM(icl.actual_qty * icl.unit_cost_cents), 0)::bigint AS total_value_cents
        FROM inventory_count ic
        JOIN inventory_count_line icl ON icl.count_id = ic.id
        WHERE ic.restaurant_id = ${restaurant_id}::uuid
          AND ic.status = 'completed'
          AND ic.date >= CURRENT_DATE - (${sinceDays}::int * INTERVAL '1 day')
        GROUP BY week_start
        ORDER BY week_start
      `;
      return rows.map((r) => ({
        week_start: r.week_start,
        total_value_cents: Number(r.total_value_cents),
      }));
    },

    async avtDaily(restaurant_id, since, until): Promise<AvtDailyPoint[]> {
      const rows = await prisma.$queryRaw<Array<{
        business_date: Date; theoretical_cost_cents: string | number; actual_cost_cents: string | number;
      }>>`
        WITH recipe_plated AS (
          SELECT rv.id AS recipe_version_id,
                 COALESCE(SUM(rl.qty * COALESCE(
                   (SELECT ic.unit_cost_cents FROM ingredient_cost ic
                    WHERE ic.ingredient_id = rl.ingredient_id
                    ORDER BY ic.effective_from DESC LIMIT 1), 0)), 0)::bigint AS plated_cost_cents
          FROM recipe_version rv
          LEFT JOIN recipe_line rl ON rl.recipe_version_id = rv.id AND rl.ref_type = 'ingredient'
          WHERE rv.is_current
          GROUP BY rv.id
        )
        SELECT
          ps.business_date,
          COALESCE(SUM(ps.qty * rp.plated_cost_cents), 0)::bigint AS theoretical_cost_cents,
          COALESCE(SUM(ps.item_sales_cents), 0)::bigint AS actual_cost_cents
        FROM pos_sale ps
        JOIN aloha_menu_map mm
          ON mm.restaurant_id = ps.restaurant_id
         AND mm.aloha_item_name = ps.aloha_item_name
         AND (mm.effective_until IS NULL OR mm.effective_until >= ps.business_date)
         AND mm.effective_from <= ps.business_date
        JOIN recipe_version rv ON rv.recipe_id = mm.menu_recipe_id AND rv.is_current = true
        JOIN recipe_plated rp ON rp.recipe_version_id = rv.id
        WHERE ps.restaurant_id = ${restaurant_id}::uuid
          AND ps.row_kind = 'item'
          AND ps.business_date >= ${since}
          AND ps.business_date <= ${until}
        GROUP BY ps.business_date
        ORDER BY ps.business_date
      `;
      return rows.map((r) => ({
        business_date: r.business_date,
        theoretical_cost_cents: Number(r.theoretical_cost_cents),
        actual_cost_cents: Number(r.actual_cost_cents),
      }));
    },

    async latestCountQty(restaurant_id) {
      // For each ingredient, pick the most recent completed count and read the
      // actual_qty on the line belonging to that count. DISTINCT ON keeps the
      // query to one row per ingredient without a subquery.
      const rows = await prisma.$queryRaw<Array<{
        ingredient_id: string; actual_qty: string | number; counted_at: Date;
      }>>`
        SELECT DISTINCT ON (icl.ingredient_id)
          icl.ingredient_id,
          icl.actual_qty::float AS actual_qty,
          ic.date AS counted_at
        FROM inventory_count_line icl
        JOIN inventory_count ic ON ic.id = icl.count_id
        WHERE ic.restaurant_id = ${restaurant_id}::uuid
          AND ic.status IN ('completed', 'amended')
          AND icl.ingredient_id IS NOT NULL
          AND icl.ref_type = 'ingredient'
        ORDER BY icl.ingredient_id, ic.date DESC
      `;
      return rows.map((r) => ({
        ingredient_id: r.ingredient_id,
        actual_qty: Number(r.actual_qty),
        counted_at: r.counted_at,
      }));
    },

    async lastWasteAt(restaurant_id) {
      const rows = await prisma.wasteEntry.groupBy({
        by: ['ingredient_id'],
        where: { restaurant_id, ingredient_id: { not: null } },
        _max: { at: true },
      });
      return rows
        .filter((r) => r.ingredient_id && r._max.at)
        .map((r) => ({ ingredient_id: r.ingredient_id!, last_waste_at: r._max.at! }));
    },

    async menuContribution(restaurant_id, since, until) {
      const rows = await prisma.$queryRaw<Array<{
        menu_recipe_id: string; menu_recipe_name: string;
        qty_sold: number | string;
        revenue_cents: number | string;
        theoretical_cost_cents: number | string;
      }>>`
        WITH recipe_plated AS (
          SELECT rv.id AS recipe_version_id,
                 COALESCE(SUM(rl.qty * COALESCE(
                   (SELECT ic.unit_cost_cents FROM ingredient_cost ic
                    WHERE ic.ingredient_id = rl.ingredient_id
                    ORDER BY ic.effective_from DESC LIMIT 1), 0)), 0)::bigint AS plated_cost_cents
          FROM recipe_version rv
          LEFT JOIN recipe_line rl ON rl.recipe_version_id = rv.id AND rl.ref_type = 'ingredient'
          WHERE rv.is_current
          GROUP BY rv.id
        )
        SELECT
          rv.recipe_id AS menu_recipe_id,
          r.name AS menu_recipe_name,
          COALESCE(SUM(ps.qty), 0)::float AS qty_sold,
          COALESCE(SUM(ps.item_sales_cents), 0)::bigint AS revenue_cents,
          COALESCE(SUM(ps.qty * rp.plated_cost_cents), 0)::bigint AS theoretical_cost_cents
        FROM pos_sale ps
        JOIN aloha_menu_map mm
          ON mm.restaurant_id = ps.restaurant_id
         AND mm.aloha_item_name = ps.aloha_item_name
         AND (mm.effective_until IS NULL OR mm.effective_until >= ps.business_date)
         AND mm.effective_from <= ps.business_date
        JOIN recipe r ON r.id = mm.menu_recipe_id
        JOIN recipe_version rv ON rv.recipe_id = r.id AND rv.is_current = true
        JOIN recipe_plated rp ON rp.recipe_version_id = rv.id
        WHERE ps.restaurant_id = ${restaurant_id}::uuid
          AND ps.row_kind = 'item'
          AND ps.business_date >= ${since}
          AND ps.business_date <= ${until}
        GROUP BY rv.recipe_id, r.name
      `;
      return rows.map((r) => ({
        menu_recipe_id: r.menu_recipe_id,
        menu_recipe_name: r.menu_recipe_name,
        qty_sold: Number(r.qty_sold),
        revenue_cents: Number(r.revenue_cents),
        theoretical_cost_cents: Number(r.theoretical_cost_cents),
      }));
    },

    async ingredientUsage(restaurant_id, since, until): Promise<IngredientUsage[]> {
      // Sum of (ps.qty × rl.qty) per ingredient across all menu recipes whose
      // aloha-map is active for the given business_date. Prep-recipe recursion
      // is intentionally skipped in v1 (see docstring on ReportsRepo).
      const rows = await prisma.$queryRaw<Array<{ ingredient_id: string; qty: string | number }>>`
        SELECT
          rl.ingredient_id,
          COALESCE(SUM(ps.qty * rl.qty), 0)::float AS qty
        FROM pos_sale ps
        JOIN aloha_menu_map mm
          ON mm.restaurant_id = ps.restaurant_id
         AND mm.aloha_item_name = ps.aloha_item_name
         AND (mm.effective_until IS NULL OR mm.effective_until >= ps.business_date)
         AND mm.effective_from <= ps.business_date
        JOIN recipe_version rv ON rv.recipe_id = mm.menu_recipe_id AND rv.is_current = true
        JOIN recipe_line rl ON rl.recipe_version_id = rv.id AND rl.ref_type = 'ingredient'
        WHERE ps.restaurant_id = ${restaurant_id}::uuid
          AND ps.row_kind = 'item'
          AND ps.business_date >= ${since}
          AND ps.business_date <= ${until}
          AND rl.ingredient_id IS NOT NULL
        GROUP BY rl.ingredient_id
      `;
      return rows.map((r) => ({ ingredient_id: r.ingredient_id, qty: Number(r.qty) }));
    },

    async wasteByReason(restaurant_id, since, until): Promise<WasteByReasonRow[]> {
      const rows = await prisma.$queryRaw<WasteSqlRow[]>`
        SELECT
          wr.id AS reason_id,
          wr.label AS reason_label,
          COALESCE(SUM(we.value_cents), 0)::bigint AS total_value_cents,
          COUNT(we.id)::bigint AS entries
        FROM waste_reason wr
        LEFT JOIN waste_entry we
          ON we.reason_id = wr.id
         AND we.restaurant_id = ${restaurant_id}::uuid
         AND we.at >= ${since}
         AND we.at < ${until}
        WHERE wr.restaurant_id = ${restaurant_id}::uuid
        GROUP BY wr.id, wr.label
        ORDER BY total_value_cents DESC
      `;
      return rows.map((r) => ({
        reason_id: r.reason_id,
        reason_label: r.reason_label,
        total_value_cents: Number(r.total_value_cents),
        entries: Number(r.entries),
      }));
    },
  };
}

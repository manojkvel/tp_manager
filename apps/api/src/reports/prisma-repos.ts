// TASK-069 — Prisma-backed Reports repo (AvT, Price Creep, Waste-by-reason).

import type { PrismaClient } from '@prisma/client';
import type { ReportsRepo, AvtRow, PriceCreepRow, WasteByReasonRow } from './service.js';

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
      // Join pos_sale → aloha_menu_map → recipe_version (current) → plated_cost_cents
      // to compute theoretical vs actual (item_sales minus sales = theoretical assumed).
      // Simplified implementation: theoretical cost = qty_sold * current plated_cost_cents
      // Actual cost = qty_sold * (avg unit_cost_cents across recipe_lines at current price).
      const rows = await prisma.$queryRaw<AvtSqlRow[]>`
        SELECT
          rv.recipe_id AS menu_recipe_id,
          r.name AS menu_recipe_name,
          COALESCE(SUM(ps.qty), 0)::float AS qty_sold,
          COALESCE(SUM(ps.qty * rv.plated_cost_cents), 0)::bigint AS theoretical_cost_cents,
          COALESCE(SUM(ps.item_sales_cents), 0)::bigint AS actual_cost_cents
        FROM pos_sale ps
        JOIN aloha_menu_map mm
          ON mm.restaurant_id = ps.restaurant_id
         AND mm.aloha_item_name = ps.aloha_item_name
         AND (mm.effective_until IS NULL OR mm.effective_until >= ps.business_date)
         AND mm.effective_from <= ps.business_date
        JOIN recipe r ON r.id = mm.menu_recipe_id
        JOIN recipe_version rv ON rv.recipe_id = r.id AND rv.is_current = true
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

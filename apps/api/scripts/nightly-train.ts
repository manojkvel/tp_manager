// §6.12b — nightly ML retrain orchestrator.
//
// Walks every menu-recipe mapped to Aloha pmix and retrains the per-recipe
// daily-demand forecaster. Idempotent per run; safe to re-invoke. Records a
// ForecastModel audit row per successful train.
//
// Usage (one-shot):
//   set -a && source .env && set +a && \
//     pnpm --filter @tp/api exec tsx scripts/nightly-train.ts
//
// Scheduling (prod): docker-compose.scheduler.yml wires ofelia to run this
// nightly at 02:00 restaurant-local time. No args, no state outside the DB.

import { PrismaClient, Prisma } from '@prisma/client';
import { createForecastClient } from '../src/forecast-proxy/client.js';

const MIN_HISTORY_DAYS = 14;
const WINDOW_DAYS = 180;

interface DailyRow {
  menu_recipe_id: string;
  menu_recipe_name: string;
  business_date: Date;
  qty: number;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const mlBaseUrl = process.env.ML_BASE_URL || process.env.ML_SERVICE_URL || 'http://ml:8000';
  const client = createForecastClient({ baseUrl: mlBaseUrl, timeoutMs: 15_000 });

  const restaurants = await prisma.restaurant.findMany({ select: { id: true, name: true } });
  console.log(`nightly-train: ${restaurants.length} restaurant(s), ML at ${mlBaseUrl}`);

  let totalTrained = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  try {
    for (const r of restaurants) {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - WINDOW_DAYS);
      const sinceStr = since.toISOString().slice(0, 10);

      const rows = await prisma.$queryRaw<DailyRow[]>`
        SELECT
          mm.menu_recipe_id,
          rec.name AS menu_recipe_name,
          ps.business_date,
          COALESCE(SUM(ps.qty), 0)::float AS qty
        FROM pos_sale ps
        JOIN aloha_menu_map mm
          ON mm.restaurant_id = ps.restaurant_id
         AND mm.aloha_item_name = ps.aloha_item_name
         AND mm.effective_from <= ps.business_date
         AND (mm.effective_until IS NULL OR mm.effective_until >= ps.business_date)
        JOIN recipe rec ON rec.id = mm.menu_recipe_id
        WHERE ps.restaurant_id = ${r.id}::uuid
          AND ps.row_kind = 'item'
          AND ps.business_date >= ${sinceStr}::date
        GROUP BY mm.menu_recipe_id, rec.name, ps.business_date
        ORDER BY mm.menu_recipe_id, ps.business_date
      `;

      // Bucket rows per recipe, then zero-fill missing dates to get a contiguous
      // daily series the ML service can season on.
      const byRecipe = new Map<string, { name: string; points: Array<[Date, number]> }>();
      for (const row of rows) {
        const bucket = byRecipe.get(row.menu_recipe_id) ?? { name: row.menu_recipe_name, points: [] };
        bucket.points.push([new Date(row.business_date), Number(row.qty)]);
        byRecipe.set(row.menu_recipe_id, bucket);
      }

      for (const [menu_recipe_id, { name, points }] of byRecipe) {
        if (points.length < MIN_HISTORY_DAYS) {
          totalSkipped += 1;
          continue;
        }
        const history = zeroFillDaily(points);
        if (history.length < MIN_HISTORY_DAYS) {
          totalSkipped += 1;
          continue;
        }
        try {
          const result = await client.train(r.id, 'recipe', menu_recipe_id, history);
          if (!result) {
            console.warn(`  [${r.name}] ${name}: ML returned null (skipped)`);
            totalFailed += 1;
            continue;
          }
          const trainedStart = points[0]![0];
          const trainedEnd = points[points.length - 1]![0];
          await prisma.forecastModel.create({
            data: {
              restaurant_id: r.id,
              entity_type: 'recipe',
              entity_id: menu_recipe_id,
              algorithm: result.algorithm,
              trained_on_start: trainedStart,
              trained_on_end: trainedEnd,
              holdout_mape: result.holdout_mape == null ? null : new Prisma.Decimal(result.holdout_mape),
              artefact_ref: `ml-cache://${r.id}/recipe/${menu_recipe_id}`,
            },
          });
          totalTrained += 1;
        } catch (err) {
          console.error(`  [${r.name}] ${name}: train failed`, err);
          totalFailed += 1;
        }
      }
    }

    console.log('---');
    console.log(`trained:  ${totalTrained}`);
    console.log(`skipped:  ${totalSkipped} (insufficient history)`);
    console.log(`failed:   ${totalFailed}`);
  } finally {
    await prisma.$disconnect();
  }
}

function zeroFillDaily(points: Array<[Date, number]>): number[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a[0].getTime() - b[0].getTime());
  const start = stripToDate(sorted[0]![0]);
  const end = stripToDate(sorted[sorted.length - 1]![0]);
  const byKey = new Map(sorted.map(([d, q]) => [stripToDate(d).toISOString().slice(0, 10), q]));
  const out: number[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const key = new Date(t).toISOString().slice(0, 10);
    out.push(byKey.get(key) ?? 0);
  }
  return out;
}

function stripToDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

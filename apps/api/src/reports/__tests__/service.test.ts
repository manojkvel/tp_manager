// TASK-065 — Reports tests: AvT variance + price-creep threshold (§6.9).

import { describe, it, expect } from 'vitest';
import {
  ReportsService,
  type ReportsRepo, type AvtRow, type PriceCreepRow, type WasteByReasonRow,
} from '../service.js';

function memRepo(seed: {
  avt?: AvtRow[];
  creep?: PriceCreepRow[];
  waste?: WasteByReasonRow[];
} = {}): ReportsRepo & { _avtArgs: unknown[]; _creepArgs: unknown[]; _wasteArgs: unknown[] } {
  const avtArgs: unknown[] = [];
  const creepArgs: unknown[] = [];
  const wasteArgs: unknown[] = [];
  return {
    _avtArgs: avtArgs, _creepArgs: creepArgs, _wasteArgs: wasteArgs,
    async avt(rid, since, until) { avtArgs.push({ rid, since, until }); return seed.avt ?? []; },
    async priceCreep(rid, days, threshold) { creepArgs.push({ rid, days, threshold }); return seed.creep ?? []; },
    async wasteByReason(rid, since, until) { wasteArgs.push({ rid, since, until }); return seed.waste ?? []; },
  };
}

const RID = 'rrrrrrrr-0000-4000-8000-000000000000';
const NOW = new Date('2026-04-19T10:00:00Z');

describe('ReportsService.avt', () => {
  it('returns variance rows with computed percentage', async () => {
    const rows: AvtRow[] = [
      { menu_recipe_id: 'm1', menu_recipe_name: 'Burger', qty_sold: 10,
        theoretical_cost_cents: 3000, actual_cost_cents: 3600, variance_cents: 600, variance_pct: 20 },
    ];
    const svc = new ReportsService({ repo: memRepo({ avt: rows }), now: () => NOW });
    const out = await svc.avt(RID);
    expect(out[0]!.variance_pct).toBe(20);
    expect(out[0]!.variance_cents).toBe(600);
    expect(out[0]!.tier).toBe('critical');
  });

  it('avtSummary aggregates totals and counts items over threshold (v1.7)', async () => {
    const rows: AvtRow[] = [
      { menu_recipe_id: 'm1', menu_recipe_name: 'A', qty_sold: 1,
        theoretical_cost_cents: 1000, actual_cost_cents: 1300, variance_cents: 300, variance_pct: 30 },
      { menu_recipe_id: 'm2', menu_recipe_name: 'B', qty_sold: 1,
        theoretical_cost_cents: 1000, actual_cost_cents: 1070, variance_cents: 70, variance_pct: 7 },
      { menu_recipe_id: 'm3', menu_recipe_name: 'C', qty_sold: 1,
        theoretical_cost_cents: 1000, actual_cost_cents: 1020, variance_cents: 20, variance_pct: 2 },
    ];
    const svc = new ReportsService({ repo: memRepo({ avt: rows }), now: () => NOW });
    const s = await svc.avtSummary(RID);
    expect(s.total_theoretical_cents).toBe(3000);
    expect(s.total_variance_cents).toBe(390);
    expect(s.items_over_threshold).toBe(2);
    expect(s.rows.map((r) => r.tier)).toEqual(['critical', 'warning', 'ok']);
  });

  it('defaults window to trailing 7 days', async () => {
    const repo = memRepo({ avt: [] });
    const svc = new ReportsService({ repo, now: () => NOW });
    await svc.avt(RID);
    const { since, until } = repo._avtArgs[0] as { since: Date; until: Date };
    expect(until.getTime() - since.getTime()).toBe(7 * 86_400_000);
  });
});

describe('ReportsService.priceCreep', () => {
  it('passes default threshold 5% and window 30d', async () => {
    const repo = memRepo({ creep: [] });
    const svc = new ReportsService({ repo, now: () => NOW });
    await svc.priceCreep(RID);
    expect(repo._creepArgs[0]).toEqual({ rid: RID, days: 30, threshold: 5 });
  });

  it('forwards caller-specified threshold + window', async () => {
    const repo = memRepo({ creep: [] });
    const svc = new ReportsService({ repo, now: () => NOW });
    await svc.priceCreep(RID, { sinceDays: 60, threshold_pct: 10 });
    expect(repo._creepArgs[0]).toEqual({ rid: RID, days: 60, threshold: 10 });
  });

  it('returns rows where delta exceeds threshold', async () => {
    const rows: PriceCreepRow[] = [
      { ingredient_id: 'i1', ingredient_name: 'Beef', previous_cents: 500, latest_cents: 600,
        delta_pct: 20, observed_at: NOW },
    ];
    const svc = new ReportsService({ repo: memRepo({ creep: rows }), now: () => NOW });
    const out = await svc.priceCreep(RID);
    expect(out).toHaveLength(1);
    expect(out[0]!.delta_pct).toBeGreaterThanOrEqual(5);
  });
});

describe('ReportsService.wasteByReason', () => {
  it('sums value and entries per reason', async () => {
    const rows: WasteByReasonRow[] = [
      { reason_id: 'r1', reason_label: 'Expired', total_value_cents: 1200, entries: 4 },
      { reason_id: 'r2', reason_label: 'Dropped', total_value_cents: 300, entries: 1 },
    ];
    const svc = new ReportsService({ repo: memRepo({ waste: rows }), now: () => NOW });
    const out = await svc.wasteByReason(RID);
    expect(out.reduce((s, r) => s + r.total_value_cents, 0)).toBe(1500);
  });
});

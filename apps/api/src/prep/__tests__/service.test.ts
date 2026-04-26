// TASK-049 — Prep sheet tests (§6.4 AC-2/4/5/6).

import { beforeEach, describe, it, expect } from 'vitest';
import {
  PrepService, PrepSheetNotFoundError, SkipReasonRequiredError,
  type PrepSheetRepo, type PrepRunRepo, type ParRepo, type PrepSheet, type PrepRun, type ParForDay,
} from '../service.js';

const RID = '00000000-0000-0000-0000-0000000000aa';
const OTHER_RID = '00000000-0000-0000-0000-0000000000bb';

function inMemory(opts: {
  pars?: ParForDay[];
  onHand?: Map<string, number>;
} = {}) {
  const sheets = new Map<string, PrepSheet>();
  const runs: PrepRun[] = [];

  const sheetRepo: PrepSheetRepo = {
    async findByDate(rid, date) {
      for (const s of sheets.values()) {
        if (s.restaurant_id === rid && s.date.getTime() === date.getTime()) return s;
      }
      return null;
    },
    async insert(sheet) { sheets.set(sheet.id, sheet); },
    async getRow(id) {
      for (const s of sheets.values()) {
        const r = s.rows.find((x) => x.id === id);
        if (r) return { row: r, restaurant_id: s.restaurant_id };
      }
      return null;
    },
    async updateRow(id, patch) {
      for (const s of sheets.values()) {
        const idx = s.rows.findIndex((x) => x.id === id);
        if (idx >= 0) {
          s.rows[idx] = { ...s.rows[idx]!, ...patch };
          return;
        }
      }
    },
  };

  const runRepo: PrepRunRepo = {
    async insert(run) { runs.push(run); },
    async onHandWithinShelfLife(vid) {
      return opts.onHand?.get(vid) ?? 0;
    },
  };

  const parRepo: ParRepo = {
    async forDayOfWeek() { return opts.pars ?? []; },
  };

  return { sheetRepo, runRepo, parRepo, _state: { sheets, runs } };
}

describe('PrepService.generate', () => {
  it('emits needed = par − on_hand for each par row (AC-2)', async () => {
    const mem = inMemory({
      pars: [
        { recipe_id: 'r1', recipe_version_id: 'v1', recipe_name: 'Pico', qty: 10, shelf_life_days: 2 },
        { recipe_id: 'r2', recipe_version_id: 'v2', recipe_name: 'Salsa', qty: 5, shelf_life_days: 3 },
      ],
      onHand: new Map([['v1', 3]]),
    });
    const svc = new PrepService({ sheets: mem.sheetRepo, runs: mem.runRepo, pars: mem.parRepo });
    const sheet = await svc.generate(RID, new Date('2026-04-20T08:00:00Z'));
    expect(sheet.rows).toHaveLength(2);
    const pico = sheet.rows.find((r) => r.recipe_name === 'Pico')!;
    const salsa = sheet.rows.find((r) => r.recipe_name === 'Salsa')!;
    expect(pico.needed_qty).toBe(7); // 10 − 3
    expect(salsa.needed_qty).toBe(5); // 5 − 0
    expect(pico.status).toBe('pending');
  });

  it('clamps needed at 0 (on-hand > par → omitted)', async () => {
    const mem = inMemory({
      pars: [{ recipe_id: 'r1', recipe_version_id: 'v1', recipe_name: 'Pico', qty: 10, shelf_life_days: 2 }],
      onHand: new Map([['v1', 20]]),
    });
    const svc = new PrepService({ sheets: mem.sheetRepo, runs: mem.runRepo, pars: mem.parRepo });
    const sheet = await svc.generate(RID, new Date('2026-04-20T08:00:00Z'));
    expect(sheet.rows).toHaveLength(0);
  });

  it('is idempotent per (restaurant_id, date)', async () => {
    const mem = inMemory({ pars: [{ recipe_id: 'r1', recipe_version_id: 'v1', recipe_name: 'A', qty: 1, shelf_life_days: null }] });
    const svc = new PrepService({ sheets: mem.sheetRepo, runs: mem.runRepo, pars: mem.parRepo });
    const a = await svc.generate(RID, new Date('2026-04-20T08:00:00Z'));
    const b = await svc.generate(RID, new Date('2026-04-20T23:30:00Z'));
    expect(a.id).toBe(b.id);
  });
});

describe('PrepService.markComplete (§6.4 AC-4)', () => {
  it('creates a PrepRun + marks row complete + stamps completed_at', async () => {
    const mem = inMemory({
      pars: [{ recipe_id: 'r1', recipe_version_id: 'v1', recipe_name: 'Pico', qty: 10, shelf_life_days: 2 }],
    });
    const fixedNow = new Date('2026-04-20T14:00:00Z');
    const svc = new PrepService({ sheets: mem.sheetRepo, runs: mem.runRepo, pars: mem.parRepo, now: () => fixedNow });
    const sheet = await svc.generate(RID, fixedNow);
    const run = await svc.markComplete(RID, sheet.rows[0]!.id, 'user-1', 2);
    expect(run.qty_yielded).toBe(10);
    expect(run.recipe_version_id).toBe('v1');
    expect(run.expires_on?.toISOString().slice(0, 10)).toBe('2026-04-22');
    const refreshed = await mem.sheetRepo.getRow(sheet.rows[0]!.id);
    expect(refreshed?.row.status).toBe('complete');
    expect(refreshed?.row.completed_at).toEqual(fixedNow);
  });

  it('null shelf life → no expiry stamp', async () => {
    const mem = inMemory({ pars: [{ recipe_id: 'r1', recipe_version_id: 'v1', recipe_name: 'A', qty: 1, shelf_life_days: null }] });
    const svc = new PrepService({ sheets: mem.sheetRepo, runs: mem.runRepo, pars: mem.parRepo });
    const sheet = await svc.generate(RID, new Date('2026-04-20T08:00:00Z'));
    const run = await svc.markComplete(RID, sheet.rows[0]!.id, null, null);
    expect(run.expires_on).toBeNull();
  });

  it('rejects cross-tenant row ids (DEC-012)', async () => {
    const mem = inMemory({ pars: [{ recipe_id: 'r1', recipe_version_id: 'v1', recipe_name: 'A', qty: 1, shelf_life_days: null }] });
    const svc = new PrepService({ sheets: mem.sheetRepo, runs: mem.runRepo, pars: mem.parRepo });
    const sheet = await svc.generate(RID, new Date('2026-04-20T08:00:00Z'));
    await expect(svc.markComplete(OTHER_RID, sheet.rows[0]!.id, null, null))
      .rejects.toThrow(PrepSheetNotFoundError);
  });
});

describe('PrepService.patchRow + signQc (v1.7 §6.4 AC-6/7)', () => {
  it('patchRow updates assignee + temp', async () => {
    const mem = inMemory({ pars: [{ recipe_id: 'r1', recipe_version_id: 'v1', recipe_name: 'A', qty: 1, shelf_life_days: null }] });
    const svc = new PrepService({ sheets: mem.sheetRepo, runs: mem.runRepo, pars: mem.parRepo });
    const sheet = await svc.generate(RID, new Date('2026-04-20T08:00:00Z'));
    await svc.patchRow(RID, sheet.rows[0]!.id, { assigned_to_user_id: 'u1', temp_f: 38.5 });
    const refreshed = await mem.sheetRepo.getRow(sheet.rows[0]!.id);
    expect(refreshed?.row.assigned_to_user_id).toBe('u1');
    expect(refreshed?.row.temp_f).toBe(38.5);
  });

  it('signQc stamps qc_signed_* and keeps temp', async () => {
    const mem = inMemory({ pars: [{ recipe_id: 'r1', recipe_version_id: 'v1', recipe_name: 'A', qty: 1, shelf_life_days: null }] });
    const now = new Date('2026-04-20T15:00:00Z');
    const svc = new PrepService({ sheets: mem.sheetRepo, runs: mem.runRepo, pars: mem.parRepo, now: () => now });
    const sheet = await svc.generate(RID, now);
    await svc.signQc(RID, sheet.rows[0]!.id, 'chef-1', 40);
    const refreshed = await mem.sheetRepo.getRow(sheet.rows[0]!.id);
    expect(refreshed?.row.qc_signed_by_user_id).toBe('chef-1');
    expect(refreshed?.row.qc_signed_at).toEqual(now);
    expect(refreshed?.row.temp_f).toBe(40);
  });

  it('summarise returns completion % and pending/below-PAR counts', async () => {
    const mem = inMemory({
      pars: [
        { recipe_id: 'r1', recipe_version_id: 'v1', recipe_name: 'A', qty: 1, shelf_life_days: null },
        { recipe_id: 'r2', recipe_version_id: 'v2', recipe_name: 'B', qty: 1, shelf_life_days: null },
      ],
    });
    const svc = new PrepService({ sheets: mem.sheetRepo, runs: mem.runRepo, pars: mem.parRepo });
    const sheet = await svc.generate(RID, new Date('2026-04-20T08:00:00Z'));
    await svc.markComplete(RID, sheet.rows[0]!.id, 'u1', null);
    // Re-read the sheet so the completed row is reflected in summary.
    const refreshed = (await mem.sheetRepo.findByDate(RID, sheet.date))!;
    const summary = svc.summarise(refreshed);
    expect(summary.total_rows).toBe(2);
    expect(summary.completed_rows).toBe(1);
    expect(summary.completion_pct).toBe(50);
    expect(summary.below_par).toBe(1);
  });
});

describe('PrepService.markSkipped (§6.4 AC-5)', () => {
  it('requires a reason', async () => {
    const mem = inMemory({ pars: [{ recipe_id: 'r1', recipe_version_id: 'v1', recipe_name: 'A', qty: 1, shelf_life_days: null }] });
    const svc = new PrepService({ sheets: mem.sheetRepo, runs: mem.runRepo, pars: mem.parRepo });
    const sheet = await svc.generate(RID, new Date('2026-04-20T08:00:00Z'));
    await expect(svc.markSkipped(RID, sheet.rows[0]!.id, '  ')).rejects.toThrow(SkipReasonRequiredError);
  });

  it('persists status + reason', async () => {
    const mem = inMemory({ pars: [{ recipe_id: 'r1', recipe_version_id: 'v1', recipe_name: 'A', qty: 1, shelf_life_days: null }] });
    const svc = new PrepService({ sheets: mem.sheetRepo, runs: mem.runRepo, pars: mem.parRepo });
    const sheet = await svc.generate(RID, new Date('2026-04-20T08:00:00Z'));
    await svc.markSkipped(RID, sheet.rows[0]!.id, 'ingredient shortage');
    const refreshed = await mem.sheetRepo.getRow(sheet.rows[0]!.id);
    expect(refreshed?.row.status).toBe('skipped');
    expect(refreshed?.row.skip_reason).toBe('ingredient shortage');
  });
});

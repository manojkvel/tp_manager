// TASK-057 — Tests for waste log + expired-auto-suggest (§6.8 AC-1..4, §6.3a partial bag).

import { describe, it, expect } from 'vitest';
import {
  WasteService, WasteValidationError,
  type WasteEntry, type WasteRepo, type CostLookup, type ExpiredSource, type ExpiredCandidate,
} from '../service.js';

function memRepo(): WasteRepo & { _all: WasteEntry[] } {
  const all: WasteEntry[] = [];
  return {
    _all: all,
    async insert(e) { all.push({ ...e }); },
    async list(rid) { return all.filter((x) => x.restaurant_id === rid); },
    async totalValueCents(rid, since, until) {
      return all
        .filter((x) => x.restaurant_id === rid && x.at >= since && x.at < until)
        .reduce((s, e) => s + e.value_cents, 0);
    },
  };
}

const fixedCost: CostLookup = { async resolve() { return 250; } };
const RID = 'rrrrrrrr-0000-4000-8000-000000000000';
const NOW = new Date('2026-04-19T10:00:00Z');

describe('WasteService.log', () => {
  it('pins unit cost at log time and computes value_cents', async () => {
    const svc = new WasteService({ repo: memRepo(), costs: fixedCost, now: () => NOW });
    const e = await svc.log(RID, {
      ref_type: 'ingredient', ingredient_id: 'i1', qty: 2, uom: 'oz', reason_id: 'r1',
    });
    expect(e.unit_cost_cents_pinned).toBe(250);
    expect(e.value_cents).toBe(500);
    expect(e.at).toEqual(NOW);
  });

  it('accepts partial portion-bag entry (qty < 1) on a prep ref', async () => {
    const svc = new WasteService({ repo: memRepo(), costs: fixedCost, now: () => NOW });
    const e = await svc.log(RID, {
      ref_type: 'prep', recipe_version_id: 'rv1', qty: 0.4, uom: 'bag', reason_id: 'r1',
    });
    expect(e.qty).toBe(0.4);
    expect(e.value_cents).toBe(100); // round(250 * 0.4)
  });

  it('rejects qty <= 0', async () => {
    const svc = new WasteService({ repo: memRepo(), costs: fixedCost });
    await expect(svc.log(RID, {
      ref_type: 'ingredient', ingredient_id: 'i1', qty: 0, uom: 'oz', reason_id: 'r1',
    })).rejects.toBeInstanceOf(WasteValidationError);
  });

  it('rejects ingredient ref without ingredient_id', async () => {
    const svc = new WasteService({ repo: memRepo(), costs: fixedCost });
    await expect(svc.log(RID, {
      ref_type: 'ingredient', qty: 1, uom: 'oz', reason_id: 'r1',
    })).rejects.toBeInstanceOf(WasteValidationError);
  });
});

describe('WasteService.expiredSuggestions', () => {
  it('returns expired candidates from the source', async () => {
    const cands: ExpiredCandidate[] = [
      { ref_type: 'prep', ingredient_id: null, recipe_version_id: 'rv1', label: 'Salsa', qty: 2, uom: 'qt', expired_on: new Date('2026-04-18'), reason_suggestion: 'expired' },
    ];
    const expired: ExpiredSource = { async expired() { return cands; } };
    const svc = new WasteService({ repo: memRepo(), costs: fixedCost, expired, now: () => NOW });
    const out = await svc.expiredSuggestions(RID);
    expect(out).toHaveLength(1);
    expect(out[0]!.label).toBe('Salsa');
  });

  it('returns empty when no source wired', async () => {
    const svc = new WasteService({ repo: memRepo(), costs: fixedCost });
    expect(await svc.expiredSuggestions(RID)).toEqual([]);
  });
});

describe('WasteService.totalValueCents', () => {
  it('sums value within the time window', async () => {
    const repo = memRepo();
    const svc = new WasteService({ repo, costs: fixedCost, now: () => NOW });
    await svc.log(RID, { ref_type: 'ingredient', ingredient_id: 'i1', qty: 1, uom: 'oz', reason_id: 'r1' });
    await svc.log(RID, { ref_type: 'ingredient', ingredient_id: 'i2', qty: 3, uom: 'oz', reason_id: 'r1' });
    const total = await svc.totalValueCents(RID, new Date('2026-04-01'), new Date('2026-05-01'));
    expect(total).toBe(1000);
  });
});

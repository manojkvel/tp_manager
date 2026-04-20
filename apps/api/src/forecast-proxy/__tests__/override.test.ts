// GAP-04 — Forecast override capture (§6.12b AC-5).
//
// The owner/kitchen lead can override any advisory forecast; the override
// is captured with expected vs override vs (later) actual so Phase 2 can
// learn from disagreement. Payload lands in ForecastOverride.

import { describe, it, expect } from 'vitest';
import { inMemoryOverrideRepo, OverrideService } from '../override.js';

describe('OverrideService (§6.12b AC-5)', () => {
  it('captures expected / override / reason for a target date', async () => {
    const repo = inMemoryOverrideRepo();
    const svc = new OverrideService({ repo, now: () => new Date('2026-05-01T12:00Z') });

    const row = await svc.capture('r1', {
      entity_type: 'ingredient',
      entity_id: '11111111-1111-1111-1111-111111111111',
      target_date: '2026-05-05',
      expected_qty: 10,
      override_qty: 14,
      reason: 'school event tomorrow',
      user_id: '22222222-2222-2222-2222-222222222222',
    });

    expect(row.restaurant_id).toBe('r1');
    expect(row.expected_qty).toBe(10);
    expect(row.override_qty).toBe(14);
    expect(row.actual_qty).toBeNull();
    expect(row.reason).toBe('school event tomorrow');
  });

  it('rejects override_qty that is negative', async () => {
    const repo = inMemoryOverrideRepo();
    const svc = new OverrideService({ repo });

    await expect(svc.capture('r1', {
      entity_type: 'ingredient',
      entity_id: '11111111-1111-1111-1111-111111111111',
      target_date: '2026-05-05',
      expected_qty: 10,
      override_qty: -1,
    })).rejects.toThrow(/override_qty/);
  });

  it('lists overrides for a given entity + date range', async () => {
    const repo = inMemoryOverrideRepo();
    const svc = new OverrideService({ repo });
    await svc.capture('r1', {
      entity_type: 'recipe', entity_id: 'a',
      target_date: '2026-05-05', expected_qty: 5, override_qty: 7,
    });
    await svc.capture('r1', {
      entity_type: 'recipe', entity_id: 'a',
      target_date: '2026-05-12', expected_qty: 6, override_qty: 6,
    });
    await svc.capture('r1', {
      entity_type: 'recipe', entity_id: 'b',
      target_date: '2026-05-05', expected_qty: 9, override_qty: 10,
    });

    const rows = await svc.list('r1', { entity_type: 'recipe', entity_id: 'a' });
    expect(rows).toHaveLength(2);
  });

  it('is restaurant-scoped — cannot read across restaurants', async () => {
    const repo = inMemoryOverrideRepo();
    const svc = new OverrideService({ repo });
    await svc.capture('r1', {
      entity_type: 'recipe', entity_id: 'a',
      target_date: '2026-05-05', expected_qty: 5, override_qty: 7,
    });

    const rows = await svc.list('r2', { entity_type: 'recipe', entity_id: 'a' });
    expect(rows).toHaveLength(0);
  });

  it('records actual_qty after the fact (for training signal)', async () => {
    const repo = inMemoryOverrideRepo();
    const svc = new OverrideService({ repo });
    const row = await svc.capture('r1', {
      entity_type: 'ingredient', entity_id: 'x',
      target_date: '2026-05-05', expected_qty: 5, override_qty: 7,
    });
    const updated = await svc.recordActual('r1', row.id, 6.5);
    expect(updated.actual_qty).toBe(6.5);
  });
});

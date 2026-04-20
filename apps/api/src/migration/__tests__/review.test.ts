// TASK-058 — Tests for migration review (§6.14 AC-6 approve all-or-nothing, AC-7 rollback within 14d).

import { describe, it, expect } from 'vitest';
import {
  MigrationReviewService, ReviewBatchAlreadyProcessedError, ReviewRollbackWindowError,
  type StagedBatch, type StagedItem, type ReviewBatchRepo, type CanonicalSource, type PromotionWriter,
} from '../review.js';
import type { CanonicalCandidate } from '../dedupe.js';

function memRepo(): ReviewBatchRepo & { _b: StagedBatch[]; _i: StagedItem[] } {
  const b: StagedBatch[] = [];
  const i: StagedItem[] = [];
  return {
    _b: b, _i: i,
    async insertBatch(x) { b.push({ ...x }); },
    async findBatch(id) { return b.find((x) => x.id === id) ?? null; },
    async listBatches(rid) { return b.filter((x) => x.restaurant_id === rid); },
    async updateBatch(id, patch) { Object.assign(b.find((x) => x.id === id)!, patch); },
    async insertItem(item) { i.push({ ...item }); },
    async itemsFor(batch_id) { return i.filter((x) => x.batch_id === batch_id); },
    async updateItem(id, patch) { Object.assign(i.find((x) => x.id === id)!, patch); },
  };
}

function memCanonical(items: CanonicalCandidate[]): CanonicalSource {
  return { async ingredients() { return items; } };
}

interface CountingWriter extends PromotionWriter { promoted: number; rolled: number }
function makeWriter(): CountingWriter {
  const w: CountingWriter = {
    promoted: 0,
    rolled: 0,
    async promote() { w.promoted += 1; return { inserted: 1, merged: 1 }; },
    async rollback() { w.rolled += 1; return { removed: 2 }; },
  };
  return w;
}

const RID = 'rrrrrrrr-0000-4000-8000-000000000000';
const NOW = new Date('2026-04-19T10:00:00Z');

describe('MigrationReviewService', () => {
  it('buckets a probe matching an existing canonical row as matched (decision = merge)', async () => {
    const svc = new MigrationReviewService({
      repo: memRepo(), canonical: memCanonical([{ id: 'ing-1', name: 'Tomato', uom: 'oz' }]),
      writer: makeWriter(), now: () => NOW,
    });
    const { items } = await svc.stage(RID, {
      source_file: 'recipes.xlsx', parser_version: '1',
      ingredients: [{ probe: { name: 'Tomato', uom: 'oz' }, payload: {} }],
    });
    expect(items[0]!.bucket).toBe('matched');
    expect(items[0]!.decision).toBe('merge');
    expect(items[0]!.decision_target_id).toBe('ing-1');
  });

  it('buckets a totally new probe as new (decision pending)', async () => {
    const svc = new MigrationReviewService({
      repo: memRepo(), canonical: memCanonical([]),
      writer: makeWriter(), now: () => NOW,
    });
    const { items } = await svc.stage(RID, {
      source_file: 'r.xlsx', parser_version: '1',
      ingredients: [{ probe: { name: 'Some Novel Spice' }, payload: {} }],
    });
    expect(items[0]!.bucket).toBe('new');
    expect(items[0]!.decision).toBe('pending');
  });

  it('refuses approval if items are still pending', async () => {
    const repo = memRepo();
    const svc = new MigrationReviewService({
      repo, canonical: memCanonical([]), writer: makeWriter(), now: () => NOW,
    });
    const { batch } = await svc.stage(RID, {
      source_file: 'r.xlsx', parser_version: '1',
      ingredients: [{ probe: { name: 'Spice' }, payload: {} }],
    });
    await expect(svc.approve(RID, batch.id, 'u1')).rejects.toThrow(/pending decision/);
  });

  it('approves a batch all-or-nothing once all items resolved', async () => {
    const repo = memRepo();
    const w = makeWriter();
    const svc = new MigrationReviewService({
      repo, canonical: memCanonical([{ id: 'ing-1', name: 'Tomato', uom: 'oz' }]),
      writer: w, now: () => NOW,
    });
    const { batch, items } = await svc.stage(RID, {
      source_file: 'r.xlsx', parser_version: '1',
      ingredients: [{ probe: { name: 'Tomato', uom: 'oz' }, payload: {} }],
    });
    await svc.setItemDecision(RID, batch.id, items[0]!.id, 'merge', 'ing-1');
    const out = await svc.approve(RID, batch.id, 'u1');
    expect(out).toEqual({ inserted: 1, merged: 1 });
    expect(w.promoted).toBe(1);
    const after = await svc.getBatch(RID, batch.id);
    expect(after.batch.status).toBe('approved');
  });

  it('allows rollback within 14 days', async () => {
    const repo = memRepo();
    const w = makeWriter();
    let clock = NOW.getTime();
    const svc = new MigrationReviewService({
      repo, canonical: memCanonical([{ id: 'ing-1', name: 'Tomato', uom: 'oz' }]),
      writer: w, now: () => new Date(clock),
    });
    const { batch, items } = await svc.stage(RID, {
      source_file: 'r.xlsx', parser_version: '1',
      ingredients: [{ probe: { name: 'Tomato', uom: 'oz' }, payload: {} }],
    });
    await svc.setItemDecision(RID, batch.id, items[0]!.id, 'merge', 'ing-1');
    await svc.approve(RID, batch.id, 'u1');
    clock += 13 * 86_400_000;
    const out = await svc.rollback(RID, batch.id);
    expect(out.removed).toBe(2);
  });

  it('rejects rollback after 14 days', async () => {
    const repo = memRepo();
    const w = makeWriter();
    let clock = NOW.getTime();
    const svc = new MigrationReviewService({
      repo, canonical: memCanonical([{ id: 'ing-1', name: 'Tomato', uom: 'oz' }]),
      writer: w, now: () => new Date(clock),
    });
    const { batch, items } = await svc.stage(RID, {
      source_file: 'r.xlsx', parser_version: '1',
      ingredients: [{ probe: { name: 'Tomato', uom: 'oz' }, payload: {} }],
    });
    await svc.setItemDecision(RID, batch.id, items[0]!.id, 'merge', 'ing-1');
    await svc.approve(RID, batch.id, 'u1');
    clock += 15 * 86_400_000;
    await expect(svc.rollback(RID, batch.id)).rejects.toBeInstanceOf(ReviewRollbackWindowError);
  });

  it('refuses double approval', async () => {
    const repo = memRepo();
    const w = makeWriter();
    const svc = new MigrationReviewService({
      repo, canonical: memCanonical([{ id: 'ing-1', name: 'Tomato', uom: 'oz' }]),
      writer: w, now: () => NOW,
    });
    const { batch, items } = await svc.stage(RID, {
      source_file: 'r.xlsx', parser_version: '1',
      ingredients: [{ probe: { name: 'Tomato', uom: 'oz' }, payload: {} }],
    });
    await svc.setItemDecision(RID, batch.id, items[0]!.id, 'merge', 'ing-1');
    await svc.approve(RID, batch.id, 'u1');
    await expect(svc.approve(RID, batch.id, 'u1')).rejects.toBeInstanceOf(ReviewBatchAlreadyProcessedError);
  });
});

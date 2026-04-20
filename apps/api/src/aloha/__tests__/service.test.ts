// TASK-063, TASK-064 — Tests for Aloha import (idempotent re-import; row classification).

import { describe, it, expect } from 'vitest';
import {
  AlohaService,
  type AlohaRepo, type AlohaImportRun, type PosSaleRow, type CoverCount,
  type StockoutEvent, type ReconciliationItem,
} from '../service.js';

function memRepo(): AlohaRepo & {
  _runs: AlohaImportRun[];
  _pos: PosSaleRow[];
  _covers: CoverCount[];
  _stockouts: StockoutEvent[];
  _reconcile: ReconciliationItem[];
} {
  const runs: AlohaImportRun[] = [];
  const pos: PosSaleRow[] = [];
  const covers: CoverCount[] = [];
  const stockouts: StockoutEvent[] = [];
  const reconcile: ReconciliationItem[] = [];
  return {
    _runs: runs, _pos: pos, _covers: covers, _stockouts: stockouts, _reconcile: reconcile,
    async insertRun(r) { runs.push({ ...r }); },
    async updateRun(id, patch) { Object.assign(runs.find((r) => r.id === id)!, patch); },
    async replaceDay(rid, day, op) {
      // simulate transactional delete-then-insert
      for (let i = pos.length - 1; i >= 0; i -= 1) {
        if (pos[i]!.restaurant_id === rid && pos[i]!.business_date.getTime() === day.getTime()) {
          pos.splice(i, 1);
        }
      }
      for (let i = covers.length - 1; i >= 0; i -= 1) {
        if (covers[i]!.restaurant_id === rid && covers[i]!.business_date.getTime() === day.getTime()) {
          covers.splice(i, 1);
        }
      }
      for (let i = stockouts.length - 1; i >= 0; i -= 1) {
        if (stockouts[i]!.restaurant_id === rid && stockouts[i]!.business_date.getTime() === day.getTime()) {
          stockouts.splice(i, 1);
        }
      }
      const out = await op();
      pos.push(...out.pos_sales);
      if (out.covers) covers.push(out.covers);
      stockouts.push(...out.stockouts);
    },
    async recentRuns(rid, limit) { return runs.filter((r) => r.restaurant_id === rid).slice(0, limit); },
    async enqueueReconciliation(items) { reconcile.push(...items); },
  };
}

const RID = 'rrrrrrrr-0000-4000-8000-000000000000';
const NOW = new Date('2026-04-19T10:00:00Z');

const SAMPLE: readonly (readonly string[])[] = [
  ['business_date', 'name', 'qty_sold', 'net_sales'],
  ['2026-04-18', 'Burger', '12', '120.00'],
  ['2026-04-18', 'MOD: Cheese', '4', '4.00'],
  ['2026-04-18', '86 Burger', '0', '0'],
  ['2026-04-18', 'COVERS', '85', '0'],
];

describe('AlohaService.importPmix', () => {
  it('classifies items / modifiers / 86 / covers', async () => {
    const repo = memRepo();
    const svc = new AlohaService({ repo, now: () => NOW });
    await svc.importPmix(RID, 'manual_upload', SAMPLE);

    expect(repo._pos.find((p) => p.aloha_item_name === 'Burger')!.row_kind).toBe('item');
    expect(repo._pos.find((p) => p.aloha_item_name === 'Cheese')!.row_kind).toBe('modifier');
    expect(repo._pos.find((p) => p.aloha_item_name === 'Burger' && p.qty === 0)?.row_kind).toBe('stockout_86');
    expect(repo._covers).toHaveLength(1);
    expect(repo._covers[0]!.covers).toBe(85);
    expect(repo._stockouts).toHaveLength(1);
  });

  it('is idempotent on re-import for the same business_date', async () => {
    const repo = memRepo();
    const svc = new AlohaService({ repo, now: () => NOW });
    await svc.importPmix(RID, 'manual_upload', SAMPLE);
    const before = repo._pos.length;
    await svc.importPmix(RID, 'manual_upload', SAMPLE);
    expect(repo._pos.length).toBe(before); // replaced, not duplicated
    expect(repo._covers.length).toBe(1);
    expect(repo._runs.length).toBe(2); // run history preserved
  });

  it('enqueues unmapped items + modifiers for reconciliation', async () => {
    const repo = memRepo();
    const svc = new AlohaService({ repo, now: () => NOW });
    await svc.importPmix(RID, 'manual_upload', SAMPLE);
    expect(repo._reconcile.length).toBeGreaterThan(0);
    const burger = repo._reconcile.find((r) => r.aloha_item_name === 'Burger');
    expect(burger?.row_kind).toBe('item');
  });

  it('marks the run as failed and rethrows when the writer throws', async () => {
    const repo = memRepo();
    repo.replaceDay = async () => { throw new Error('db down'); };
    const svc = new AlohaService({ repo, now: () => NOW });
    await expect(svc.importPmix(RID, 'manual_upload', SAMPLE)).rejects.toThrow();
    expect(repo._runs[0]!.status).toBe('failed');
  });
});

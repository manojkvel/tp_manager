// TASK-050 — Inventory-count tests (§6.5 AC-4/5).

import { describe, it, expect } from 'vitest';
import {
  InventoryService, InventoryCountNotFoundError, InventoryCountImmutableError, InvalidCountTransitionError,
  type InventoryCountRepo, type InventoryCount, type InventoryCountLine,
} from '../service.js';

const RID = '00000000-0000-0000-0000-0000000000aa';
const OTHER_RID = '00000000-0000-0000-0000-0000000000bb';

function inMemory() {
  const counts = new Map<string, InventoryCount>();
  const lines = new Map<string, InventoryCountLine[]>();
  const repo: InventoryCountRepo = {
    async findById(id) { return counts.get(id) ?? null; },
    async insert(row) { counts.set(row.id, row); lines.set(row.id, []); },
    async updateStatus(id, status, completed_by) {
      const c = counts.get(id);
      if (c) counts.set(id, { ...c, status, completed_by: completed_by ?? c.completed_by });
    },
    async linesFor(count_id) { return [...(lines.get(count_id) ?? [])]; },
    async insertLine(line) { lines.get(line.count_id)?.push(line); },
    async replaceLine(line) {
      const list = lines.get(line.count_id) ?? [];
      const idx = list.findIndex((l) => l.id === line.id);
      if (idx >= 0) list[idx] = line;
    },
  };
  return { repo, _state: { counts, lines } };
}

describe('InventoryService.pause/resume (§6.5 AC-4)', () => {
  it('pauses an open count and resumes it', async () => {
    const mem = inMemory();
    const svc = new InventoryService({ counts: mem.repo });
    const c = await svc.start(RID, new Date('2026-04-20T08:00:00Z'), 'user-1');
    await svc.pause(RID, c.id);
    expect((await mem.repo.findById(c.id))?.status).toBe('paused');
    await svc.resume(RID, c.id);
    expect((await mem.repo.findById(c.id))?.status).toBe('open');
  });

  it('cannot pause a completed count', async () => {
    const mem = inMemory();
    const svc = new InventoryService({ counts: mem.repo });
    const c = await svc.start(RID, new Date(), null);
    await svc.complete(RID, c.id, 'u');
    await expect(svc.pause(RID, c.id)).rejects.toThrow(InvalidCountTransitionError);
  });

  it('rejects cross-tenant access', async () => {
    const mem = inMemory();
    const svc = new InventoryService({ counts: mem.repo });
    const c = await svc.start(RID, new Date(), null);
    await expect(svc.pause(OTHER_RID, c.id)).rejects.toThrow(InventoryCountNotFoundError);
  });
});

describe('InventoryService.addLine', () => {
  it('accepts lines on open/paused counts and rejects on completed', async () => {
    const mem = inMemory();
    const svc = new InventoryService({ counts: mem.repo });
    const c = await svc.start(RID, new Date(), null);
    await svc.addLine(RID, c.id, { ref_type: 'ingredient', ingredient_id: 'ing-1', actual_qty: 5 });
    await svc.pause(RID, c.id);
    await svc.addLine(RID, c.id, { ref_type: 'ingredient', ingredient_id: 'ing-2', actual_qty: 3 });
    expect(await mem.repo.linesFor(c.id)).toHaveLength(2);
    await svc.resume(RID, c.id);
    await svc.complete(RID, c.id, null);
    await expect(svc.addLine(RID, c.id, { ref_type: 'ingredient', ingredient_id: 'x', actual_qty: 1 }))
      .rejects.toThrow(InventoryCountImmutableError);
  });
});

describe('InventoryService.amend (§6.5 AC-5)', () => {
  it('creates a new count referencing the prior and carrying its lines', async () => {
    const mem = inMemory();
    const svc = new InventoryService({ counts: mem.repo });
    const c = await svc.start(RID, new Date('2026-04-20T08:00:00Z'), 'u1');
    await svc.addLine(RID, c.id, { ref_type: 'ingredient', ingredient_id: 'ing-1', actual_qty: 5 });
    await svc.addLine(RID, c.id, { ref_type: 'ingredient', ingredient_id: 'ing-2', actual_qty: 3 });
    await svc.complete(RID, c.id, 'u1');

    const amendment = await svc.amend(RID, c.id, 'u2');
    expect(amendment.amends_count_id).toBe(c.id);
    expect(amendment.status).toBe('open');
    expect((await mem.repo.findById(c.id))?.status).toBe('amended');
    const copiedLines = await mem.repo.linesFor(amendment.id);
    expect(copiedLines).toHaveLength(2);
    expect(copiedLines[0]!.id).not.toBe((await mem.repo.linesFor(c.id))[0]!.id);
  });

  it('cannot amend a non-completed count', async () => {
    const mem = inMemory();
    const svc = new InventoryService({ counts: mem.repo });
    const c = await svc.start(RID, new Date(), null);
    await expect(svc.amend(RID, c.id, null)).rejects.toThrow(InvalidCountTransitionError);
  });
});

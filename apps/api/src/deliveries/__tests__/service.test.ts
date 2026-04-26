// TASK-051 — Deliveries tests (§6.6 AC-3/4/5).

import { describe, it, expect } from 'vitest';
import {
  DeliveriesService, DeliveryNotFoundError, DeliveryAlreadyProcessedError,
  type DeliveryRepo, type IngredientCostRepo, type Delivery, type DeliveryLine,
} from '../service.js';

const RID = '00000000-0000-0000-0000-0000000000aa';

function inMemory(opts: { costs?: Map<string, number> } = {}) {
  const deliveries = new Map<string, Delivery>();
  const lines = new Map<string, DeliveryLine[]>();
  const costHistory: Array<{ ingredient_id: string; unit_cost_cents: number; effective_from: Date; source: string; note?: string }> = [];
  const latest = new Map<string, number>(opts.costs ?? []);

  const deliveryRepo: DeliveryRepo = {
    async findById(id) { return deliveries.get(id) ?? null; },
    async insert(row) { deliveries.set(row.id, row); lines.set(row.id, []); },
    async updateStatus(id, status) {
      const d = deliveries.get(id);
      if (d) deliveries.set(id, { ...d, status });
    },
    async updateDiscrepancyCount(id, count) {
      const d = deliveries.get(id);
      if (d) deliveries.set(id, { ...d, discrepancy_count: count });
    },
    async attachInvoiceScan(id, url, ocr_status) {
      const d = deliveries.get(id);
      if (d) deliveries.set(id, { ...d, invoice_scan_url: url, ocr_status });
    },
    async updateOcrStatus(id, status) {
      const d = deliveries.get(id);
      if (d) deliveries.set(id, { ...d, ocr_status: status });
    },
    async listByRestaurant(rid) {
      return [...deliveries.values()].filter((d) => d.restaurant_id === rid);
    },
    async linesFor(id) { return [...(lines.get(id) ?? [])]; },
    async insertLine(line) { lines.get(line.delivery_id)?.push(line); },
  };
  const costRepo: IngredientCostRepo = {
    async latestCents(ingredient_id) { return latest.get(ingredient_id) ?? null; },
    async insert(row) {
      costHistory.push(row);
      latest.set(row.ingredient_id, row.unit_cost_cents);
    },
  };
  return { deliveryRepo, costRepo, _state: { deliveries, lines, costHistory, latest } };
}

describe('DeliveriesService.verify (§6.6 AC-3/4)', () => {
  it('marks verified when all lines match — and appends cost history where unit cost drifted', async () => {
    const mem = inMemory({ costs: new Map([['ing-1', 100]]) });
    const svc = new DeliveriesService({ deliveries: mem.deliveryRepo, costs: mem.costRepo });
    const d = await svc.create(RID, {
      supplier_id: 'sup-1',
      received_on: new Date('2026-04-20T10:00:00Z'),
      lines: [
        { ingredient_id: 'ing-1', ordered_qty: 10, received_qty: 10, unit_cost_cents: 110, note: null },
        { ingredient_id: 'ing-2', ordered_qty: 5, received_qty: 5, unit_cost_cents: 500, note: null },
      ],
    });
    const res = await svc.verify(RID, d.id);
    expect(res.status).toBe('verified');
    expect(res.disputes).toHaveLength(0);
    expect(res.cost_updates).toHaveLength(2); // ing-1 changed 100→110, ing-2 new
    expect(mem._state.latest.get('ing-1')).toBe(110);
    expect(mem._state.latest.get('ing-2')).toBe(500);
  });

  it('marks disputed when any line is outside tolerance — no cost updates', async () => {
    const mem = inMemory({ costs: new Map([['ing-1', 100]]) });
    const svc = new DeliveriesService({ deliveries: mem.deliveryRepo, costs: mem.costRepo });
    const d = await svc.create(RID, {
      supplier_id: 'sup-1',
      received_on: new Date('2026-04-20T10:00:00Z'),
      lines: [
        { ingredient_id: 'ing-1', ordered_qty: 10, received_qty: 7, unit_cost_cents: 110, note: 'short' },
        { ingredient_id: 'ing-2', ordered_qty: 5, received_qty: 5, unit_cost_cents: 500, note: null },
      ],
    });
    const res = await svc.verify(RID, d.id);
    expect(res.status).toBe('disputed');
    expect(res.disputes).toHaveLength(1);
    expect(res.disputes[0]!.delta).toBe(-3);
    expect(res.cost_updates).toHaveLength(0);
    expect(mem._state.latest.get('ing-1')).toBe(100); // untouched — dispute halts cost roll
  });

  it('honours tolerance — within-tolerance drift does NOT dispute', async () => {
    const mem = inMemory();
    const svc = new DeliveriesService({ deliveries: mem.deliveryRepo, costs: mem.costRepo });
    const d = await svc.create(RID, {
      supplier_id: 'sup-1',
      received_on: new Date(),
      lines: [{ ingredient_id: 'ing-1', ordered_qty: 100, received_qty: 99, unit_cost_cents: 500, note: null }],
    });
    const res = await svc.verify(RID, d.id, { tolerance: 0.02 }); // 2% → 2 unit slack
    expect(res.status).toBe('verified');
  });

  it('no cost insert when unit cost equals latest (already current)', async () => {
    const mem = inMemory({ costs: new Map([['ing-1', 500]]) });
    const svc = new DeliveriesService({ deliveries: mem.deliveryRepo, costs: mem.costRepo });
    const d = await svc.create(RID, {
      supplier_id: 'sup-1',
      received_on: new Date(),
      lines: [{ ingredient_id: 'ing-1', ordered_qty: 10, received_qty: 10, unit_cost_cents: 500, note: null }],
    });
    await svc.verify(RID, d.id);
    expect(mem._state.costHistory).toHaveLength(0);
  });

  it('rejects re-verification', async () => {
    const mem = inMemory();
    const svc = new DeliveriesService({ deliveries: mem.deliveryRepo, costs: mem.costRepo });
    const d = await svc.create(RID, {
      supplier_id: 'sup-1',
      received_on: new Date(),
      lines: [{ ingredient_id: 'ing-1', ordered_qty: 1, received_qty: 1, unit_cost_cents: 100, note: null }],
    });
    await svc.verify(RID, d.id);
    await expect(svc.verify(RID, d.id)).rejects.toThrow(DeliveryAlreadyProcessedError);
  });

  it('rejects cross-tenant access', async () => {
    const mem = inMemory();
    const svc = new DeliveriesService({ deliveries: mem.deliveryRepo, costs: mem.costRepo });
    const d = await svc.create(RID, {
      supplier_id: 'sup-1',
      received_on: new Date(),
      lines: [{ ingredient_id: 'ing-1', ordered_qty: 1, received_qty: 1, unit_cost_cents: 100, note: null }],
    });
    await expect(svc.verify('00000000-0000-0000-0000-0000000000bb', d.id))
      .rejects.toThrow(DeliveryNotFoundError);
  });
});

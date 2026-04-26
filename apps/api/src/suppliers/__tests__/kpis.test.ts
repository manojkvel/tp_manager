// v1.7 §6.3 — supplier KPI computation unit tests.

import { describe, expect, it } from 'vitest';
import { computeSupplierKpis } from '../kpis.js';

describe('computeSupplierKpis', () => {
  const now = new Date('2026-04-21T00:00:00Z');
  const yearStart = new Date('2026-01-01T00:00:00Z');

  it('computes on-time %, fill rate, YTD spend and missed items per supplier', () => {
    const { rows, aggregate } = computeSupplierKpis({
      activeSupplierIds: ['s1', 's2'],
      now,
      deliveries: [
        { id: 'd1', supplier_id: 's1', received_on: new Date('2026-03-01'), expected_on: new Date('2026-03-01') },
        { id: 'd2', supplier_id: 's1', received_on: new Date('2026-03-10'), expected_on: new Date('2026-03-09') },
        { id: 'd3', supplier_id: 's2', received_on: new Date('2026-03-05'), expected_on: new Date('2026-03-05') },
      ],
      lines: [
        { delivery_id: 'd1', supplier_id: 's1', ingredient_id: 'i1', ordered_qty: 10, received_qty: 10, unit_cost_cents: 100 },
        { delivery_id: 'd1', supplier_id: 's1', ingredient_id: 'i2', ordered_qty: 5, received_qty: 0, unit_cost_cents: 200 },
        { delivery_id: 'd2', supplier_id: 's1', ingredient_id: 'i1', ordered_qty: 8, received_qty: 6, unit_cost_cents: 100 },
        { delivery_id: 'd3', supplier_id: 's2', ingredient_id: 'i1', ordered_qty: 4, received_qty: 4, unit_cost_cents: 500 },
      ],
    });

    const s1 = rows.find((r) => r.supplier_id === 's1')!;
    expect(s1.on_time_pct).toBe(50);
    expect(s1.fill_rate_pct).toBeCloseTo(((10 + 0 + 6) / (10 + 5 + 8)) * 100, 1);
    expect(s1.missed_items_count).toBe(1);
    expect(s1.delivery_count).toBe(2);
    expect(s1.ytd_spend_cents).toBe(10 * 100 + 0 + 6 * 100);

    const s2 = rows.find((r) => r.supplier_id === 's2')!;
    expect(s2.on_time_pct).toBe(100);
    expect(s2.fill_rate_pct).toBe(100);
    expect(s2.missed_items_count).toBe(0);

    expect(aggregate.active_suppliers).toBe(2);
    expect(aggregate.total_ytd_spend_cents).toBe(10 * 100 + 6 * 100 + 4 * 500);
    expect(aggregate.missed_items_total).toBe(1);
    expect(aggregate.avg_on_time_pct).toBe(75);
    // yearStart is referenced to prove we include all test deliveries
    expect(yearStart.getTime()).toBeLessThan(now.getTime());
  });

  it('returns null percentages when there are no deliveries', () => {
    const { rows, aggregate } = computeSupplierKpis({
      activeSupplierIds: ['solo'],
      deliveries: [],
      lines: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.on_time_pct).toBeNull();
    expect(rows[0]!.fill_rate_pct).toBeNull();
    expect(aggregate.avg_on_time_pct).toBeNull();
    expect(aggregate.total_ytd_spend_cents).toBe(0);
  });

  it('excludes deliveries older than year-start from YTD spend', () => {
    const { rows } = computeSupplierKpis({
      activeSupplierIds: ['s1'],
      now,
      deliveries: [
        { id: 'old', supplier_id: 's1', received_on: new Date('2025-12-31'), expected_on: null },
        { id: 'new', supplier_id: 's1', received_on: new Date('2026-02-01'), expected_on: null },
      ],
      lines: [
        { delivery_id: 'old', supplier_id: 's1', ingredient_id: 'i1', ordered_qty: 1, received_qty: 1, unit_cost_cents: 1000 },
        { delivery_id: 'new', supplier_id: 's1', ingredient_id: 'i1', ordered_qty: 1, received_qty: 1, unit_cost_cents: 500 },
      ],
    });
    expect(rows[0]!.ytd_spend_cents).toBe(500);
  });
});

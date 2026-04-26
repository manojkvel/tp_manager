// v1.7 §6.3 — Supplier KPI computation.
//
// Pure functions that take normalised delivery + order line data and compute
// per-supplier performance rollups plus restaurant aggregates. Isolated from
// Prisma so the unit tests stay DB-free.

export interface DeliveryHeader {
  id: string;
  supplier_id: string;
  received_on: Date;
  expected_on: Date | null;
}

export interface DeliveryLineFact {
  delivery_id: string;
  supplier_id: string;
  ingredient_id: string;
  ordered_qty: number | null;
  received_qty: number;
  unit_cost_cents: number;
}

export interface SupplierKpiRow {
  supplier_id: string;
  on_time_pct: number | null;
  fill_rate_pct: number | null;
  ytd_spend_cents: number;
  missed_items_count: number;
  delivery_count: number;
}

export interface SupplierKpiAggregate {
  active_suppliers: number;
  total_ytd_spend_cents: number;
  avg_on_time_pct: number | null;
  missed_items_total: number;
}

export interface ComputeKpisInput {
  deliveries: DeliveryHeader[];
  lines: DeliveryLineFact[];
  activeSupplierIds: string[];
  now?: Date;
}

/**
 * On-time: ratio of deliveries whose received_on ≤ expected_on (treating
 * null-expected as "unknown" → excluded from denominator).
 * Fill-rate: sum(received_qty) / sum(ordered_qty) across all lines of the
 * supplier's deliveries. Lines with null ordered_qty are skipped.
 * Missed items: count of lines where ordered_qty > 0 and received_qty === 0.
 * YTD spend: sum(received_qty * unit_cost_cents) for the current year.
 */
export function computeSupplierKpis(input: ComputeKpisInput): {
  rows: SupplierKpiRow[];
  aggregate: SupplierKpiAggregate;
} {
  const now = input.now ?? new Date();
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

  const rowsBySupplier = new Map<string, SupplierKpiRow>();
  const ensureRow = (supplier_id: string): SupplierKpiRow => {
    let row = rowsBySupplier.get(supplier_id);
    if (!row) {
      row = {
        supplier_id,
        on_time_pct: null,
        fill_rate_pct: null,
        ytd_spend_cents: 0,
        missed_items_count: 0,
        delivery_count: 0,
      };
      rowsBySupplier.set(supplier_id, row);
    }
    return row;
  };

  const onTimeCounts = new Map<string, { hits: number; total: number }>();
  const fillRateSums = new Map<string, { ordered: number; received: number }>();

  for (const d of input.deliveries) {
    const row = ensureRow(d.supplier_id);
    row.delivery_count += 1;
    if (d.expected_on) {
      const tally = onTimeCounts.get(d.supplier_id) ?? { hits: 0, total: 0 };
      tally.total += 1;
      if (d.received_on.getTime() <= d.expected_on.getTime()) tally.hits += 1;
      onTimeCounts.set(d.supplier_id, tally);
    }
  }

  for (const l of input.lines) {
    const row = ensureRow(l.supplier_id);
    const delivery = input.deliveries.find((d) => d.id === l.delivery_id);
    if (delivery && delivery.received_on.getTime() >= yearStart.getTime()) {
      row.ytd_spend_cents += Math.round(l.received_qty * l.unit_cost_cents);
    }
    if (l.ordered_qty != null && l.ordered_qty > 0) {
      const sums = fillRateSums.get(l.supplier_id) ?? { ordered: 0, received: 0 };
      sums.ordered += l.ordered_qty;
      sums.received += l.received_qty;
      fillRateSums.set(l.supplier_id, sums);
      if (l.received_qty === 0) row.missed_items_count += 1;
    }
  }

  for (const [sid, tally] of onTimeCounts) {
    if (tally.total === 0) continue;
    ensureRow(sid).on_time_pct = round1((tally.hits / tally.total) * 100);
  }
  for (const [sid, sums] of fillRateSums) {
    if (sums.ordered === 0) continue;
    ensureRow(sid).fill_rate_pct = round1((sums.received / sums.ordered) * 100);
  }

  for (const sid of input.activeSupplierIds) ensureRow(sid);

  const rows = [...rowsBySupplier.values()];
  const active = rows.filter((r) => input.activeSupplierIds.includes(r.supplier_id));
  const onTimeSamples = active.map((r) => r.on_time_pct).filter((v): v is number => v != null);
  const aggregate: SupplierKpiAggregate = {
    active_suppliers: input.activeSupplierIds.length,
    total_ytd_spend_cents: active.reduce((s, r) => s + r.ytd_spend_cents, 0),
    avg_on_time_pct:
      onTimeSamples.length === 0 ? null : round1(onTimeSamples.reduce((a, b) => a + b, 0) / onTimeSamples.length),
    missed_items_total: active.reduce((s, r) => s + r.missed_items_count, 0),
  };

  return { rows, aggregate };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

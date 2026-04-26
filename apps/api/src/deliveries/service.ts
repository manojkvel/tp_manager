// TASK-054 — Deliveries service (§6.6).
//
// On `verify`, any line whose `received_qty` diverges from `ordered_qty` by
// more than the tolerance puts the delivery into `disputed` status (which the
// dashboard surfaces as an alert, §6.6 AC-5). Verified deliveries append a new
// IngredientCost row for any line whose charged unit cost differs from the
// current cost (§6.6 AC-4 + ingredient cost-history append-only rule).

import { randomBytes } from 'node:crypto';

export type DeliveryStatus = 'pending' | 'verified' | 'disputed';

export type OcrStatus = 'none' | 'processing' | 'parsed' | 'failed';

export interface Delivery {
  id: string;
  restaurant_id: string;
  supplier_id: string;
  po_id: string | null;
  received_on: Date;
  status: DeliveryStatus;
  received_by: string | null;
  invoice_scan_url: string | null;
  ocr_status: OcrStatus;
  discrepancy_count: number;
  created_at: Date;
}

export interface DeliveryLine {
  id: string;
  delivery_id: string;
  ingredient_id: string;
  ordered_qty: number | null;
  received_qty: number;
  unit_cost_cents: number;
  note: string | null;
}

export interface CreateDeliveryInput {
  supplier_id: string;
  po_id?: string | null;
  received_on: Date;
  received_by?: string | null;
  lines: Array<Omit<DeliveryLine, 'id' | 'delivery_id'>>;
}

export interface VerifyOpts {
  /** Fractional tolerance on received_qty vs ordered_qty. 0.01 → 1% drift allowed. Default 0. */
  tolerance?: number;
}

export interface VerifyResult {
  status: DeliveryStatus;
  disputes: Array<{ line_id: string; ingredient_id: string; ordered: number | null; received: number; delta: number }>;
  cost_updates: Array<{ ingredient_id: string; previous_cents: number | null; new_cents: number }>;
}

export interface DeliveryRepo {
  findById(id: string): Promise<Delivery | null>;
  insert(row: Delivery): Promise<void>;
  updateStatus(id: string, status: DeliveryStatus): Promise<void>;
  updateDiscrepancyCount(id: string, count: number): Promise<void>;
  attachInvoiceScan(id: string, url: string, ocr_status: OcrStatus): Promise<void>;
  updateOcrStatus(id: string, status: OcrStatus, extracted?: unknown): Promise<void>;
  linesFor(delivery_id: string): Promise<DeliveryLine[]>;
  insertLine(line: DeliveryLine): Promise<void>;
  listByRestaurant(restaurant_id: string): Promise<Delivery[]>;
}

export interface IngredientCostRepo {
  latestCents(ingredient_id: string): Promise<number | null>;
  insert(row: {
    ingredient_id: string;
    unit_cost_cents: number;
    effective_from: Date;
    source: 'delivery' | 'manual' | 'migration';
    note?: string;
  }): Promise<void>;
}

export class DeliveryNotFoundError extends Error {
  constructor(id: string) { super(`delivery ${id} not found`); this.name = 'DeliveryNotFoundError'; }
}

export class DeliveryAlreadyProcessedError extends Error {
  constructor(id: string, status: string) { super(`delivery ${id} is already ${status}`); this.name = 'DeliveryAlreadyProcessedError'; }
}

function uuidv4(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stripToDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export interface DeliveriesServiceDeps {
  deliveries: DeliveryRepo;
  costs: IngredientCostRepo;
  now?: () => Date;
}

export class DeliveriesService {
  private readonly now: () => Date;
  constructor(private readonly deps: DeliveriesServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  private async ownedOrThrow(restaurant_id: string, id: string): Promise<Delivery> {
    const d = await this.deps.deliveries.findById(id);
    if (!d || d.restaurant_id !== restaurant_id) throw new DeliveryNotFoundError(id);
    return d;
  }

  async create(restaurant_id: string, input: CreateDeliveryInput): Promise<Delivery> {
    const row: Delivery = {
      id: uuidv4(),
      restaurant_id,
      supplier_id: input.supplier_id,
      po_id: input.po_id ?? null,
      received_on: stripToDate(input.received_on),
      status: 'pending',
      received_by: input.received_by ?? null,
      invoice_scan_url: null,
      ocr_status: 'none',
      discrepancy_count: 0,
      created_at: this.now(),
    };
    await this.deps.deliveries.insert(row);
    for (const l of input.lines) {
      await this.deps.deliveries.insertLine({
        id: uuidv4(),
        delivery_id: row.id,
        ingredient_id: l.ingredient_id,
        ordered_qty: l.ordered_qty,
        received_qty: l.received_qty,
        unit_cost_cents: l.unit_cost_cents,
        note: l.note,
      });
    }
    return row;
  }

  /** §6.6 AC-3/4 — verify → disputed|verified; on verified, append cost history for drift. */
  async verify(restaurant_id: string, id: string, opts: VerifyOpts = {}): Promise<VerifyResult> {
    const d = await this.ownedOrThrow(restaurant_id, id);
    if (d.status !== 'pending') throw new DeliveryAlreadyProcessedError(id, d.status);

    const tolerance = opts.tolerance ?? 0;
    const lines = await this.deps.deliveries.linesFor(id);
    const disputes: VerifyResult['disputes'] = [];
    for (const l of lines) {
      if (l.ordered_qty == null) continue; // ad-hoc delivery line → no dispute check
      const delta = l.received_qty - l.ordered_qty;
      const allowed = Math.abs(l.ordered_qty) * tolerance;
      if (Math.abs(delta) > allowed) {
        disputes.push({ line_id: l.id, ingredient_id: l.ingredient_id, ordered: l.ordered_qty, received: l.received_qty, delta });
      }
    }

    const nextStatus: DeliveryStatus = disputes.length > 0 ? 'disputed' : 'verified';
    await this.deps.deliveries.updateStatus(id, nextStatus);
    // v1.7 — denormalise discrepancy count so dashboard/list don't need joins.
    await this.deps.deliveries.updateDiscrepancyCount(id, disputes.length);

    const cost_updates: VerifyResult['cost_updates'] = [];
    if (nextStatus === 'verified') {
      const now = this.now();
      for (const l of lines) {
        const previous = await this.deps.costs.latestCents(l.ingredient_id);
        if (previous !== l.unit_cost_cents) {
          await this.deps.costs.insert({
            ingredient_id: l.ingredient_id,
            unit_cost_cents: l.unit_cost_cents,
            effective_from: now,
            source: 'delivery',
            note: `delivery ${id}`,
          });
          cost_updates.push({ ingredient_id: l.ingredient_id, previous_cents: previous, new_cents: l.unit_cost_cents });
        }
      }
    }

    return { status: nextStatus, disputes, cost_updates };
  }

  get(restaurant_id: string, id: string): Promise<Delivery> {
    return this.ownedOrThrow(restaurant_id, id);
  }

  linesFor(delivery_id: string): Promise<DeliveryLine[]> {
    return this.deps.deliveries.linesFor(delivery_id);
  }

  list(restaurant_id: string): Promise<Delivery[]> {
    return this.deps.deliveries.listByRestaurant(restaurant_id);
  }

  /** v1.7 §6.6 AC-5 — attach invoice scan URL and mark OCR as queued. */
  async attachInvoiceScan(restaurant_id: string, id: string, url: string): Promise<Delivery> {
    const d = await this.ownedOrThrow(restaurant_id, id);
    await this.deps.deliveries.attachInvoiceScan(id, url, 'processing');
    return { ...d, invoice_scan_url: url, ocr_status: 'processing' };
  }

  /** v1.7 — called by worker after OCR completes to persist extracted lines. */
  async recordOcrResult(
    restaurant_id: string, id: string, status: OcrStatus, extracted?: unknown,
  ): Promise<void> {
    await this.ownedOrThrow(restaurant_id, id);
    await this.deps.deliveries.updateOcrStatus(id, status, extracted);
  }
}

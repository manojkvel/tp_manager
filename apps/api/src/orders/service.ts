// TASK-059 — Orders service (§6.7).
//
// Suggestion engine: for each ingredient referenced by a recipe (or directly
// par-tracked) we compute `need = par − on_hand − in_transit`, round up to the
// supplier's pack size, and group by supplier into draft Orders. The user can
// then send / mark-received from the PWA.

import { randomBytes } from 'node:crypto';

export type OrderStatus = 'draft' | 'sent' | 'received';

export interface Order {
  id: string;
  restaurant_id: string;
  supplier_id: string;
  status: OrderStatus;
  sent_at: Date | null;
  expected_on: Date | null;
  created_at: Date;
}

export interface OrderLine {
  id: string;
  order_id: string;
  ingredient_id: string;
  qty: number;
  pack_size: number | null;
  unit_cost_cents: number;
}

export interface SuggestionInput {
  ingredient_id: string;
  ingredient_name: string;
  par_qty: number;
  on_hand_qty: number;
  in_transit_qty: number;
  pack_size: number | null;
  unit_cost_cents: number;
  supplier_id: string;
}

export interface OrderSuggestion {
  supplier_id: string;
  ingredient_id: string;
  ingredient_name: string;
  needed_qty: number;
  rounded_qty: number;
  pack_size: number | null;
  unit_cost_cents: number;
}

export interface CreateDraftInput {
  supplier_id: string;
  expected_on?: Date | null;
  lines: Array<Omit<OrderLine, 'id' | 'order_id'>>;
}

export interface OrderRepo {
  insert(o: Order): Promise<void>;
  insertLine(l: OrderLine): Promise<void>;
  findById(id: string): Promise<Order | null>;
  linesFor(order_id: string): Promise<OrderLine[]>;
  updateStatus(id: string, status: OrderStatus, sent_at: Date | null): Promise<void>;
  list(restaurant_id: string, status?: OrderStatus): Promise<Order[]>;
}

export interface SuggestionSource {
  /** All ingredients with par > 0 (or active recipe demand) for this restaurant. */
  candidates(restaurant_id: string): Promise<SuggestionInput[]>;
}

export class OrderNotFoundError extends Error {
  constructor(id: string) { super(`order ${id} not found`); this.name = 'OrderNotFoundError'; }
}

export class InvalidOrderTransitionError extends Error {
  constructor(from: string, to: string) { super(`cannot transition order from ${from} to ${to}`); this.name = 'InvalidOrderTransitionError'; }
}

function uuidv4(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface OrdersServiceDeps {
  orders: OrderRepo;
  source: SuggestionSource;
  now?: () => Date;
}

export class OrdersService {
  private readonly now: () => Date;
  constructor(private readonly deps: OrdersServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** §6.7 AC-1 — par − on-hand − in-transit, rounded up to pack size. */
  async suggest(restaurant_id: string): Promise<OrderSuggestion[]> {
    const cands = await this.deps.source.candidates(restaurant_id);
    const out: OrderSuggestion[] = [];
    for (const c of cands) {
      const need = c.par_qty - c.on_hand_qty - c.in_transit_qty;
      if (need <= 0) continue;
      const rounded = c.pack_size && c.pack_size > 0
        ? Math.ceil(need / c.pack_size) * c.pack_size
        : need;
      out.push({
        supplier_id: c.supplier_id,
        ingredient_id: c.ingredient_id,
        ingredient_name: c.ingredient_name,
        needed_qty: need,
        rounded_qty: rounded,
        pack_size: c.pack_size,
        unit_cost_cents: c.unit_cost_cents,
      });
    }
    return out;
  }

  /**
   * v1.7 §6.7 AC-7 — auto-generate draft orders from PAR shortfalls, one per
   * supplier. Uses `suggest()` so PAR source (ingredient PAR vs recipe-derived)
   * stays consistent with the preview endpoint.
   */
  async autoGenerate(restaurant_id: string): Promise<Order[]> {
    const suggestions = await this.suggest(restaurant_id);
    const bySupplier = new Map<string, OrderSuggestion[]>();
    for (const s of suggestions) {
      if (!bySupplier.has(s.supplier_id)) bySupplier.set(s.supplier_id, []);
      bySupplier.get(s.supplier_id)!.push(s);
    }
    const orders: Order[] = [];
    for (const [supplier_id, lines] of bySupplier) {
      const draft = await this.createDraft(restaurant_id, {
        supplier_id,
        lines: lines.map((l) => ({
          ingredient_id: l.ingredient_id,
          qty: l.rounded_qty,
          pack_size: l.pack_size,
          unit_cost_cents: l.unit_cost_cents,
        })),
      });
      orders.push(draft);
    }
    return orders;
  }

  async createDraft(restaurant_id: string, input: CreateDraftInput): Promise<Order> {
    const order: Order = {
      id: uuidv4(),
      restaurant_id,
      supplier_id: input.supplier_id,
      status: 'draft',
      sent_at: null,
      expected_on: input.expected_on ?? null,
      created_at: this.now(),
    };
    await this.deps.orders.insert(order);
    for (const l of input.lines) {
      await this.deps.orders.insertLine({
        id: uuidv4(),
        order_id: order.id,
        ingredient_id: l.ingredient_id,
        qty: l.qty,
        pack_size: l.pack_size,
        unit_cost_cents: l.unit_cost_cents,
      });
    }
    return order;
  }

  private async ownedOrThrow(restaurant_id: string, id: string): Promise<Order> {
    const o = await this.deps.orders.findById(id);
    if (!o || o.restaurant_id !== restaurant_id) throw new OrderNotFoundError(id);
    return o;
  }

  async send(restaurant_id: string, id: string): Promise<Order> {
    const o = await this.ownedOrThrow(restaurant_id, id);
    if (o.status !== 'draft') throw new InvalidOrderTransitionError(o.status, 'sent');
    const sentAt = this.now();
    await this.deps.orders.updateStatus(id, 'sent', sentAt);
    return { ...o, status: 'sent', sent_at: sentAt };
  }

  async markReceived(restaurant_id: string, id: string): Promise<Order> {
    const o = await this.ownedOrThrow(restaurant_id, id);
    if (o.status !== 'sent') throw new InvalidOrderTransitionError(o.status, 'received');
    await this.deps.orders.updateStatus(id, 'received', o.sent_at);
    return { ...o, status: 'received' };
  }

  get(restaurant_id: string, id: string): Promise<Order> {
    return this.ownedOrThrow(restaurant_id, id);
  }

  linesFor(order_id: string): Promise<OrderLine[]> {
    return this.deps.orders.linesFor(order_id);
  }

  list(restaurant_id: string, status?: OrderStatus): Promise<Order[]> {
    return this.deps.orders.list(restaurant_id, status);
  }

  /** §6.7 AC-3 — render order as CSV (supplier-friendly export). */
  static toCsv(order: Order, lines: Array<OrderLine & { ingredient_name?: string }>): string {
    const header = 'ingredient_id,ingredient_name,qty,pack_size,unit_cost_cents';
    const rows = lines.map((l) =>
      [l.ingredient_id, l.ingredient_name ?? '', l.qty, l.pack_size ?? '', l.unit_cost_cents].join(','),
    );
    return [`# order ${order.id} status=${order.status}`, header, ...rows].join('\n');
  }
}

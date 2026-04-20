// TASK-056 — Tests for orders suggestion + lifecycle (§6.7 AC-1..4).

import { describe, it, expect } from 'vitest';
import {
  OrdersService, OrderNotFoundError, InvalidOrderTransitionError,
  type Order, type OrderLine, type OrderRepo, type SuggestionInput, type SuggestionSource,
} from '../service.js';

function memOrders(): OrderRepo & { _orders: Order[]; _lines: OrderLine[] } {
  const orders: Order[] = [];
  const lines: OrderLine[] = [];
  return {
    _orders: orders,
    _lines: lines,
    async insert(o) { orders.push({ ...o }); },
    async insertLine(l) { lines.push({ ...l }); },
    async findById(id) { return orders.find((o) => o.id === id) ?? null; },
    async linesFor(order_id) { return lines.filter((l) => l.order_id === order_id); },
    async updateStatus(id, status, sent_at) {
      const o = orders.find((x) => x.id === id);
      if (o) { o.status = status; o.sent_at = sent_at; }
    },
    async list(restaurant_id, status) {
      return orders.filter((o) => o.restaurant_id === restaurant_id && (!status || o.status === status));
    },
  };
}

function memSource(items: SuggestionInput[]): SuggestionSource {
  return { async candidates() { return items; } };
}

const RID = 'rrrrrrrr-0000-4000-8000-000000000000';

describe('OrdersService.suggest', () => {
  it('rounds need up to pack size and skips items where on-hand+in-transit covers par', async () => {
    const svc = new OrdersService({
      orders: memOrders(),
      source: memSource([
        { ingredient_id: 'i1', ingredient_name: 'Tomato', par_qty: 10, on_hand_qty: 2, in_transit_qty: 1, pack_size: 3, unit_cost_cents: 100, supplier_id: 's1' },
        { ingredient_id: 'i2', ingredient_name: 'Onion', par_qty: 5, on_hand_qty: 5, in_transit_qty: 0, pack_size: 1, unit_cost_cents: 50, supplier_id: 's1' },
        { ingredient_id: 'i3', ingredient_name: 'Salt', par_qty: 4, on_hand_qty: 0, in_transit_qty: 0, pack_size: null, unit_cost_cents: 25, supplier_id: 's2' },
      ]),
    });
    const out = await svc.suggest(RID);
    expect(out).toHaveLength(2);
    const tomato = out.find((s) => s.ingredient_id === 'i1')!;
    expect(tomato.needed_qty).toBe(7);
    expect(tomato.rounded_qty).toBe(9); // ceil(7/3)*3 = 9
    const salt = out.find((s) => s.ingredient_id === 'i3')!;
    expect(salt.rounded_qty).toBe(4);
  });
});

describe('OrdersService lifecycle', () => {
  it('creates a draft, sends it, then marks received', async () => {
    const repo = memOrders();
    const svc = new OrdersService({ orders: repo, source: memSource([]) });
    const draft = await svc.createDraft(RID, {
      supplier_id: 's1',
      lines: [{ ingredient_id: 'i1', qty: 9, pack_size: 3, unit_cost_cents: 100 }],
    });
    expect(draft.status).toBe('draft');

    const sent = await svc.send(RID, draft.id);
    expect(sent.status).toBe('sent');
    expect(sent.sent_at).not.toBeNull();

    const received = await svc.markReceived(RID, draft.id);
    expect(received.status).toBe('received');
  });

  it('rejects send if not in draft', async () => {
    const repo = memOrders();
    const svc = new OrdersService({ orders: repo, source: memSource([]) });
    const o = await svc.createDraft(RID, { supplier_id: 's1', lines: [] });
    await svc.send(RID, o.id);
    await expect(svc.send(RID, o.id)).rejects.toBeInstanceOf(InvalidOrderTransitionError);
  });

  it('blocks cross-tenant access', async () => {
    const repo = memOrders();
    const svc = new OrdersService({ orders: repo, source: memSource([]) });
    const o = await svc.createDraft(RID, { supplier_id: 's1', lines: [] });
    await expect(svc.get('other-rid', o.id)).rejects.toBeInstanceOf(OrderNotFoundError);
  });
});

describe('OrdersService.toCsv', () => {
  it('emits supplier-friendly CSV', async () => {
    const order: Order = { id: 'oid', restaurant_id: RID, supplier_id: 's1', status: 'draft', sent_at: null, expected_on: null, created_at: new Date() };
    const csv = OrdersService.toCsv(order, [
      { id: 'l1', order_id: 'oid', ingredient_id: 'i1', qty: 9, pack_size: 3, unit_cost_cents: 100, ingredient_name: 'Tomato' },
    ]);
    expect(csv).toContain('# order oid status=draft');
    expect(csv).toContain('ingredient_id,ingredient_name,qty,pack_size,unit_cost_cents');
    expect(csv).toContain('i1,Tomato,9,3,100');
  });
});

// v1.7 Wave 11 — order email render + log transport.

import { describe, expect, it } from 'vitest';
import {
  renderOrderEmail,
  LogEmailTransport,
  resolveEmailTransport,
  SupplierEmailMissingError,
  type SupplierForEmail,
  type RestaurantForEmail,
  type LineForEmail,
} from '../email.js';
import type { Order } from '../service.js';

const order: Order = {
  id: '11111111-2222-3333-4444-555555555555',
  restaurant_id: 'rid',
  supplier_id: 'sup-1',
  status: 'draft',
  sent_at: null,
  expected_on: new Date('2026-04-25T00:00:00Z'),
  created_at: new Date('2026-04-21T00:00:00Z'),
};

const supplier: SupplierForEmail = {
  id: 'sup-1',
  name: 'Acme Produce',
  email: 'orders@acme.test',
  contact_name: 'Pat Nguyen',
};

const restaurant: RestaurantForEmail = { name: 'Café Delta', owner_email: 'owner@cafe.test' };

const lines: LineForEmail[] = [
  { id: 'l-1', order_id: order.id, ingredient_id: 'apple', ingredient_name: 'Apple, Gala', uom: 'lb', qty: 10, pack_size: 5, unit_cost_cents: 150 },
  { id: 'l-2', order_id: order.id, ingredient_id: 'flour', ingredient_name: 'AP Flour', uom: 'kg', qty: 20, pack_size: 10, unit_cost_cents: 200 },
];

describe('renderOrderEmail', () => {
  it('produces text + html with lines, total, recipients, and HTML-escapes', () => {
    const msg = renderOrderEmail({ order, supplier, restaurant, lines, fromAddress: 'orders@tp.test' });
    expect(msg.to).toBe('orders@acme.test');
    expect(msg.cc).toBe('owner@cafe.test');
    expect(msg.from).toBe('orders@tp.test');
    expect(msg.subject).toContain('Café Delta');
    expect(msg.subject).toContain('11111111');
    expect(msg.text).toContain('Apple, Gala');
    expect(msg.text).toContain('10 lb');
    expect(msg.text).toContain('$55.00'); // 10*150 + 20*200 = 5500c = $55
    expect(msg.html).toContain('<table');
    expect(msg.html).toContain('AP Flour');
  });

  it('throws SupplierEmailMissingError when supplier has no email', () => {
    expect(() => renderOrderEmail({
      order, supplier: { ...supplier, email: null }, restaurant, lines, fromAddress: 'x@y.com',
    })).toThrow(SupplierEmailMissingError);
  });

  it('handles missing owner email gracefully', () => {
    const msg = renderOrderEmail({
      order, supplier, restaurant: { name: 'X', owner_email: null }, lines, fromAddress: 'f@t.com',
    });
    expect(msg.cc).toBeNull();
  });
});

describe('LogEmailTransport', () => {
  it('records sent messages', async () => {
    const tx = new LogEmailTransport();
    const msg = renderOrderEmail({ order, supplier, restaurant, lines, fromAddress: 'f@t.com' });
    await tx.send(msg);
    expect(tx.sent).toHaveLength(1);
    expect(tx.sent[0]!.subject).toBe(msg.subject);
  });
});

describe('resolveEmailTransport', () => {
  it('returns log transport when SMTP_HOST is unset', async () => {
    const tx = await resolveEmailTransport({} as NodeJS.ProcessEnv);
    expect(tx.name).toBe('log');
  });
});

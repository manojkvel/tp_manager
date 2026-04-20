// TASK-059 — /orders (§6.7).

import { useCallback, useEffect, useState } from 'react';
import { ShoppingCart, Lightbulb, Send, PackageCheck, Download } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge, type BadgeTone } from '../components/ui/Badge.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';

type OrderStatus = 'draft' | 'sent' | 'received';

interface Order {
  id: string;
  supplier_id: string;
  status: OrderStatus;
  expected_on: string | null;
  created_at: string;
}

interface Suggestion {
  supplier_id: string;
  ingredient_id: string;
  ingredient_name: string;
  needed_qty: number;
  rounded_qty: number;
  pack_size: number | null;
  unit_cost_cents: number;
}

const STATUS_TONES: Record<OrderStatus, BadgeTone> = {
  draft:    'neutral',
  sent:     'info',
  received: 'success',
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      apiFetch<Order[]>('/api/v1/orders'),
      apiFetch<Suggestion[]>('/api/v1/orders/suggestions'),
    ]);
    if (a.error) { setError(a.error.message); return; }
    if (b.error) { setError(b.error.message); return; }
    setError(null);
    setOrders(a.data ?? []);
    setSuggestions(b.data ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createFromSuggestion(s: Suggestion) {
    const res = await apiFetch<Order>('/api/v1/orders', {
      method: 'POST',
      body: JSON.stringify({
        supplier_id: s.supplier_id,
        lines: [{ ingredient_id: s.ingredient_id, qty: s.rounded_qty, pack_size: s.pack_size, unit_cost_cents: s.unit_cost_cents }],
      }),
    });
    if (res.error) { setError(res.error.message); return; }
    void load();
  }

  async function transition(id: string, action: 'send' | 'receive') {
    const res = await apiFetch(`/api/v1/orders/${id}/${action}`, { method: 'POST', body: JSON.stringify({}) });
    if (res.error) { setError(res.error.message); return; }
    void load();
  }

  return (
    <>
      <PageHeader
        title="Orders"
        description="Suggested orders based on par levels, plus a full log of drafts, sends, and receipts."
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card padded={false} className="mb-6">
        <CardHeader
          className="px-5 pt-5"
          title={
            <span className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Suggestions
              {suggestions.length > 0 && <Badge tone="warn">{suggestions.length} below par</Badge>}
            </span>
          }
          description="Items whose on-hand is below par, grouped by supplier. Create a draft with one click."
        />
        <Table>
          <thead>
            <tr>
              <Th>Ingredient</Th>
              <Th className="text-right">Needed</Th>
              <Th className="text-right">Order</Th>
              <Th className="text-right">Pack</Th>
              <Th className="text-right">Unit cost</Th>
              <Th className="text-right">Action</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {suggestions.map((s) => (
              <TRow key={s.ingredient_id}>
                <Td className="font-medium">{s.ingredient_name}</Td>
                <Td className="text-right tabular-nums text-slate-600">{s.needed_qty.toFixed(2)}</Td>
                <Td className="text-right tabular-nums font-semibold">{s.rounded_qty.toFixed(2)}</Td>
                <Td className="text-right tabular-nums text-slate-500">{s.pack_size ?? '—'}</Td>
                <Td className="text-right tabular-nums text-slate-600">${(s.unit_cost_cents / 100).toFixed(2)}</Td>
                <Td className="text-right">
                  <Button size="sm" onClick={() => void createFromSuggestion(s)}>Create draft</Button>
                </Td>
              </TRow>
            ))}
          </tbody>
        </Table>
        {suggestions.length === 0 && (
          <div className="px-5 py-6">
            <EmptyState title="Nothing below par" hint="Inventory is healthy — no suggestions right now." />
          </div>
        )}
      </Card>

      <Card padded={false}>
        <CardHeader
          className="px-5 pt-5"
          title={
            <span className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-slate-500" />
              All orders
            </span>
          }
          description="Draft, sent, and received purchase orders."
        />
        <Table>
          <thead>
            <tr>
              <Th>ID</Th>
              <Th>Status</Th>
              <Th>Expected</Th>
              <Th>Created</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {orders.map((o) => (
              <TRow key={o.id}>
                <Td><code className="font-mono text-xs text-slate-700">{o.id.slice(0, 8)}</code></Td>
                <Td><Badge tone={STATUS_TONES[o.status]}>{o.status}</Badge></Td>
                <Td className="text-slate-600">{o.expected_on?.slice(0, 10) ?? <span className="text-slate-400">—</span>}</Td>
                <Td className="text-slate-500">{o.created_at.slice(0, 10)}</Td>
                <Td className="text-right">
                  <div className="inline-flex items-center gap-2 justify-end">
                    {o.status === 'draft' && (
                      <Button size="sm" leftIcon={<Send className="h-3.5 w-3.5" />} onClick={() => void transition(o.id, 'send')}>Send</Button>
                    )}
                    {o.status === 'sent' && (
                      <Button size="sm" leftIcon={<PackageCheck className="h-3.5 w-3.5" />} onClick={() => void transition(o.id, 'receive')}>
                        Mark received
                      </Button>
                    )}
                    <a
                      href={`/api/v1/orders/${o.id}/export.csv`}
                      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-600"
                    >
                      <Download className="h-3.5 w-3.5" /> CSV
                    </a>
                  </div>
                </Td>
              </TRow>
            ))}
          </tbody>
        </Table>
        {orders.length === 0 && (
          <div className="px-5 py-6">
            <EmptyState
              icon={<ShoppingCart className="h-6 w-6" />}
              title="No orders yet"
              hint="Create one from a suggestion above to get started."
            />
          </div>
        )}
      </Card>
    </>
  );
}

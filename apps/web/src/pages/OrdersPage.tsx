// v1.7 Wave 11 — Order Forms. Supplier-grouped card stack with auto-generate
// and email send actions.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ShoppingCart, Zap, Plus, Mail, Eye, Download, PackageCheck, Clock, FileText,
} from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge, type BadgeTone } from '../components/ui/Badge.js';
import { Input, Select, Field } from '../components/ui/Input.js';
import { Modal } from '../components/ui/Modal.js';
import { EmptyState } from '../components/ui/Table.js';
import { KPIStrip } from '../components/charts/KPIStrip.js';

type OrderStatus = 'draft' | 'sent' | 'received';

interface Order {
  id: string;
  supplier_id: string;
  status: OrderStatus;
  expected_on: string | null;
  created_at: string;
  sent_at: string | null;
}

interface OrderLine {
  id: string;
  order_id: string;
  ingredient_id: string;
  qty: number;
  pack_size: number | null;
  unit_cost_cents: number;
}

interface Supplier {
  id: string;
  name: string;
  email: string | null;
  contact_name: string | null;
  category: string | null;
}

interface Ingredient {
  id: string;
  name: string;
  uom: string | null;
}

const STATUS_TONES: Record<OrderStatus, BadgeTone> = {
  draft:    'neutral',
  sent:     'info',
  received: 'success',
};

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function lineTotalCents(line: Pick<OrderLine, 'qty' | 'unit_cost_cents'>): number {
  return Math.round(line.qty * line.unit_cost_cents);
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [linesByOrder, setLinesByOrder] = useState<Record<string, OrderLine[]>>({});
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const ingredientById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const loadLinesFor = useCallback(async (orderId: string) => {
    const res = await apiFetch<{ order: Order; lines: OrderLine[] }>(`/api/v1/orders/${orderId}`);
    if (res.data) setLinesByOrder((m) => ({ ...m, [orderId]: res.data!.lines }));
  }, []);

  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      apiFetch<Order[]>('/api/v1/orders'),
      apiFetch<Supplier[]>('/api/v1/suppliers'),
      apiFetch<{ data?: Ingredient[] } | Ingredient[]>('/api/v1/ingredients'),
    ]);
    if (a.error) { setError(a.error.message); return; }
    if (b.error) { setError(b.error.message); return; }
    if (c.error) { setError(c.error.message); return; }
    setError(null);
    const orderRows = a.data ?? [];
    setOrders(orderRows);
    setSuppliers(b.data ?? []);
    const ings = Array.isArray(c.data) ? c.data : (c.data?.data ?? []);
    setIngredients(ings as Ingredient[]);
    await Promise.all(orderRows.map((o) => loadLinesFor(o.id)));
  }, [loadLinesFor]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const bySupplier = new Map<string, Order[]>();
    for (const o of orders) {
      if (!bySupplier.has(o.supplier_id)) bySupplier.set(o.supplier_id, []);
      bySupplier.get(o.supplier_id)!.push(o);
    }
    for (const list of bySupplier.values()) {
      list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    return [...bySupplier.entries()].sort(([aId], [bId]) => {
      const an = supplierById.get(aId)?.name ?? aId;
      const bn = supplierById.get(bId)?.name ?? bId;
      return an.localeCompare(bn);
    });
  }, [orders, supplierById]);

  const kpiCards = useMemo(() => {
    const draftCount = orders.filter((o) => o.status === 'draft').length;
    const sentCount = orders.filter((o) => o.status === 'sent').length;
    const pendingValue = orders
      .filter((o) => o.status !== 'received')
      .flatMap((o) => linesByOrder[o.id] ?? [])
      .reduce((sum, l) => sum + lineTotalCents(l), 0);
    return [
      { label: 'Draft orders',    value: String(draftCount), icon: FileText, tone: 'neutral' as const },
      { label: 'Awaiting delivery', value: String(sentCount), icon: Clock, tone: 'brand' as const },
      { label: 'Open order value', value: usd(pendingValue), icon: ShoppingCart, tone: 'brand' as const },
      { label: 'Suppliers',        value: String(grouped.length), icon: PackageCheck, tone: 'neutral' as const },
    ];
  }, [orders, linesByOrder, grouped.length]);

  async function handleAutoGenerate() {
    setAutoLoading(true);
    try {
      const res = await apiFetch<{ orders: Order[]; count: number }>(
        '/api/v1/orders/auto-generate',
        { method: 'POST', body: JSON.stringify({}) },
      );
      if (res.error) { setError(res.error.message); return; }
      setInfo(`Generated ${res.data?.count ?? 0} draft order(s) from PAR shortfall.`);
      await load();
    } finally {
      setAutoLoading(false);
    }
  }

  async function handleEmail(order: Order, resend = false) {
    const supplier = supplierById.get(order.supplier_id);
    if (!supplier) return;
    if (!supplier.email) {
      setError(`Supplier "${supplier.name}" has no email on file. Add one on the Suppliers page first.`);
      return;
    }
    const res = await apiFetch<{ order: Order; transport: string; to: string; cc: string | null }>(
      `/api/v1/orders/${order.id}/email`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    if (res.error) { setError(res.error.message); return; }
    setError(null);
    setInfo(`${resend ? 'Resent' : 'Sent'} order to ${res.data?.to} via ${res.data?.transport}.`);
    await load();
  }

  async function handleReceive(order: Order) {
    const res = await apiFetch<Order>(`/api/v1/orders/${order.id}/receive`, {
      method: 'POST', body: JSON.stringify({}),
    });
    if (res.error) { setError(res.error.message); return; }
    await load();
  }

  return (
    <>
      <PageHeader
        title="Order Forms"
        description="Auto-generate draft orders from PAR shortfalls, then send to suppliers by email."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => setCreateOpen(true)}
            >
              New Manual Order
            </Button>
            <Button
              leftIcon={<Zap className="h-4 w-4" />}
              onClick={() => void handleAutoGenerate()}
              disabled={autoLoading}
            >
              {autoLoading ? 'Generating…' : 'Auto-Generate Orders'}
            </Button>
          </div>
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {info && (
        <div role="status" className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {info}
        </div>
      )}

      <KPIStrip cards={kpiCards} className="mb-4" />

      {grouped.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShoppingCart className="h-6 w-6" />}
            title="No orders yet"
            hint="Use Auto-Generate Orders to create draft POs from current PAR shortfalls, or build one manually."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {grouped.map(([supplierId, supplierOrders]) => {
            const supplier = supplierById.get(supplierId);
            const supplierTotal = supplierOrders
              .flatMap((o) => linesByOrder[o.id] ?? [])
              .reduce((sum, l) => sum + lineTotalCents(l), 0);
            return (
              <Card key={supplierId}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">
                      {supplier?.name ?? 'Unknown supplier'}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {supplier?.email ?? <span className="text-amber-600">No email on file</span>}
                      {supplier?.category && <span className="ml-2">• {supplier.category}</span>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900 tabular-nums">{usd(supplierTotal)}</p>
                    <p className="text-xs text-slate-500">{supplierOrders.length} order{supplierOrders.length === 1 ? '' : 's'}</p>
                  </div>
                </div>

                <div className="divide-y divide-surface-border">
                  {supplierOrders.map((order) => {
                    const lines = linesByOrder[order.id] ?? [];
                    const total = lines.reduce((sum, l) => sum + lineTotalCents(l), 0);
                    return (
                      <div key={order.id} className="py-3 flex flex-wrap items-center gap-3">
                        <code className="font-mono text-xs text-slate-600 shrink-0">
                          {order.id.slice(0, 8)}
                        </code>
                        <Badge tone={STATUS_TONES[order.status]}>{order.status}</Badge>
                        <span className="text-sm text-slate-600">{lines.length} line{lines.length === 1 ? '' : 's'}</span>
                        <span className="text-sm font-medium text-slate-900 tabular-nums">{usd(total)}</span>
                        {order.expected_on && (
                          <span className="text-xs text-slate-500">
                            Expected {order.expected_on.slice(0, 10)}
                          </span>
                        )}
                        <div className="flex items-center gap-2 ml-auto">
                          <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={<Eye className="h-3.5 w-3.5" />}
                            onClick={() => setPreviewOrder(order)}
                          >
                            Preview
                          </Button>
                          {order.status === 'draft' && (
                            <Button
                              size="sm"
                              leftIcon={<Mail className="h-3.5 w-3.5" />}
                              onClick={() => void handleEmail(order)}
                            >
                              Send to Supplier
                            </Button>
                          )}
                          {order.status === 'sent' && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                leftIcon={<Mail className="h-3.5 w-3.5" />}
                                onClick={() => void handleEmail(order, true)}
                              >
                                Resend
                              </Button>
                              <Button
                                size="sm"
                                leftIcon={<PackageCheck className="h-3.5 w-3.5" />}
                                onClick={() => void handleReceive(order)}
                              >
                                Mark received
                              </Button>
                            </>
                          )}
                          <a
                            href={`/api/v1/orders/${order.id}/export.csv`}
                            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-600"
                          >
                            <Download className="h-3.5 w-3.5" /> CSV
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <OrderPreviewModal
        order={previewOrder}
        lines={previewOrder ? (linesByOrder[previewOrder.id] ?? []) : []}
        supplier={previewOrder ? supplierById.get(previewOrder.supplier_id) ?? null : null}
        ingredientById={ingredientById}
        onClose={() => setPreviewOrder(null)}
      />

      <CreateOrderModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        suppliers={suppliers}
        ingredients={ingredients}
        onCreated={async () => {
          setCreateOpen(false);
          await load();
        }}
      />
    </>
  );
}

function OrderPreviewModal({ order, lines, supplier, ingredientById, onClose }: {
  order: Order | null;
  lines: OrderLine[];
  supplier: Supplier | null;
  ingredientById: Map<string, Ingredient>;
  onClose: () => void;
}) {
  if (!order) return null;
  const total = lines.reduce((sum, l) => sum + lineTotalCents(l), 0);
  return (
    <Modal
      open={!!order}
      onClose={onClose}
      size="lg"
      title={`Order ${order.id.slice(0, 8)}`}
      description={supplier ? supplier.name : 'Unknown supplier'}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      <dl className="grid grid-cols-2 gap-3 text-sm mb-4">
        <div>
          <dt className="text-xs uppercase text-slate-500">Status</dt>
          <dd><Badge tone={STATUS_TONES[order.status]}>{order.status}</Badge></dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-slate-500">Expected</dt>
          <dd className="text-slate-700">{order.expected_on?.slice(0, 10) ?? 'ASAP'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-slate-500">Created</dt>
          <dd className="text-slate-700">{order.created_at.slice(0, 10)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-slate-500">Sent</dt>
          <dd className="text-slate-700">{order.sent_at?.slice(0, 10) ?? '—'}</dd>
        </div>
      </dl>
      <table className="w-full text-sm border-collapse">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="text-left px-3 py-2">Ingredient</th>
            <th className="text-right px-3 py-2">Qty</th>
            <th className="text-right px-3 py-2">Unit</th>
            <th className="text-right px-3 py-2">Line total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-border">
          {lines.map((l) => {
            const ing = ingredientById.get(l.ingredient_id);
            return (
              <tr key={l.id}>
                <td className="px-3 py-2 text-slate-900">{ing?.name ?? l.ingredient_id}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {l.qty.toFixed(2)} {ing?.uom ?? ''}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{usd(l.unit_cost_cents)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {usd(lineTotalCents(l))}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-surface-border">
            <td colSpan={3} className="px-3 py-2 text-right font-semibold text-slate-700">Total</td>
            <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">{usd(total)}</td>
          </tr>
        </tfoot>
      </table>
    </Modal>
  );
}

interface ManualLine {
  ingredient_id: string;
  qty: string;
  unit_cost_cents: string;
}

function CreateOrderModal({ open, onClose, suppliers, ingredients, onCreated }: {
  open: boolean;
  onClose: () => void;
  suppliers: Supplier[];
  ingredients: Ingredient[];
  onCreated: () => Promise<void>;
}) {
  const [supplierId, setSupplierId] = useState('');
  const [expectedOn, setExpectedOn] = useState('');
  const [lines, setLines] = useState<ManualLine[]>([{ ingredient_id: '', qty: '', unit_cost_cents: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSupplierId('');
      setExpectedOn('');
      setLines([{ ingredient_id: '', qty: '', unit_cost_cents: '' }]);
      setErr(null);
    }
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supplierId) { setErr('Pick a supplier.'); return; }
    const parsedLines = lines
      .filter((l) => l.ingredient_id && l.qty)
      .map((l) => ({
        ingredient_id: l.ingredient_id,
        qty: Number(l.qty),
        pack_size: null as number | null,
        unit_cost_cents: Math.round(Number(l.unit_cost_cents || '0') * 100),
      }));
    if (parsedLines.length === 0) { setErr('Add at least one line.'); return; }
    setSubmitting(true);
    try {
      const res = await apiFetch<Order>('/api/v1/orders', {
        method: 'POST',
        body: JSON.stringify({
          supplier_id: supplierId,
          expected_on: expectedOn || null,
          lines: parsedLines,
        }),
      });
      if (res.error) { setErr(res.error.message); return; }
      await onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="New manual order"
      description="Build an order without auto-generate — useful for one-off purchases."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="order-form" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create draft'}
          </Button>
        </>
      }
    >
      <form id="order-form" onSubmit={onSubmit} className="space-y-4">
        {err && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {err}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Supplier" required>
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
              <option value="">Select supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Expected delivery">
            <Input type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} />
          </Field>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-2">Lines</h4>
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_90px_110px_40px] gap-2">
                <Select
                  value={line.ingredient_id}
                  onChange={(e) => setLines((xs) => xs.map((x, i) => i === idx ? { ...x, ingredient_id: e.target.value } : x))}
                >
                  <option value="">Select ingredient…</option>
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </Select>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Qty"
                  value={line.qty}
                  onChange={(e) => setLines((xs) => xs.map((x, i) => i === idx ? { ...x, qty: e.target.value } : x))}
                />
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Unit $"
                  value={line.unit_cost_cents}
                  onChange={(e) => setLines((xs) => xs.map((x, i) => i === idx ? { ...x, unit_cost_cents: e.target.value } : x))}
                />
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setLines((xs) => xs.filter((_, i) => i !== idx))}
                  disabled={lines.length === 1}
                >
                  ×
                </Button>
              </div>
            ))}
          </div>
          <Button
            variant="ghost"
            type="button"
            className="mt-2"
            leftIcon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setLines((xs) => [...xs, { ingredient_id: '', qty: '', unit_cost_cents: '' }])}
          >
            Add line
          </Button>
        </div>
      </form>
    </Modal>
  );
}

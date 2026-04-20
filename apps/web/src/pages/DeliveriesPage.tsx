// TASK-055 — /deliveries (§6.6).

import { useCallback, useEffect, useState } from 'react';
import { PackageCheck, Plus, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge, type BadgeTone } from '../components/ui/Badge.js';
import { Input, Field } from '../components/ui/Input.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';
import { IngredientPicker, SupplierPicker } from '../components/ui/EntityPicker.js';

type DeliveryStatus = 'pending' | 'verified' | 'disputed';

interface Delivery {
  id: string;
  supplier_id: string;
  received_on: string;
  status: DeliveryStatus;
}

interface Line {
  id: string;
  ingredient_id: string;
  ordered_qty: number | null;
  received_qty: number;
  unit_cost_cents: number;
  note: string | null;
}

interface VerifyResult {
  status: DeliveryStatus;
  disputes: Array<{ line_id: string; ingredient_id: string; ordered: number | null; received: number; delta: number }>;
  cost_updates: Array<{ ingredient_id: string; previous_cents: number | null; new_cents: number }>;
}

const STATUS_TONES: Record<DeliveryStatus, BadgeTone> = {
  pending:  'warn',
  verified: 'success',
  disputed: 'danger',
};

interface IngredientLite { id: string; name: string; uom: string }

export default function DeliveriesPage() {
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [ingredientId, setIngredientId] = useState<string | null>(null);
  const [orderedQty, setOrderedQty] = useState('');
  const [receivedQty, setReceivedQty] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [ingredientMap, setIngredientMap] = useState<Map<string, IngredientLite>>(new Map());

  useEffect(() => {
    (async () => {
      const res = await apiFetch<IngredientLite[]>('/api/v1/ingredients');
      if (res.data) {
        const m = new Map<string, IngredientLite>();
        for (const i of res.data) m.set(i.id, i);
        setIngredientMap(m);
      }
    })();
  }, []);

  const load = useCallback(async (id: string) => {
    const res = await apiFetch<{ delivery: Delivery; lines: Line[] }>(`/api/v1/deliveries/${id}`);
    if (res.error) { setError(res.error.message); return; }
    setError(null);
    setDelivery(res.data?.delivery ?? null);
    setLines(res.data?.lines ?? []);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem('active_delivery_id');
    if (stored) void load(stored);
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId || !ingredientId) { setError('Pick a supplier and ingredient.'); return; }
    const body = {
      supplier_id: supplierId,
      received_on: new Date().toISOString(),
      lines: [{
        ingredient_id: ingredientId,
        ordered_qty: Number(orderedQty || 0),
        received_qty: Number(receivedQty || 0),
        unit_cost_cents: Math.round(Number(unitCost || 0) * 100),
        note: null,
      }],
    };
    const res = await apiFetch<Delivery>('/api/v1/deliveries', { method: 'POST', body: JSON.stringify(body) });
    if (res.error) { setError(res.error.message); return; }
    if (res.data) {
      window.localStorage.setItem('active_delivery_id', res.data.id);
      setVerifyResult(null);
      await load(res.data.id);
    }
    setSupplierId(null);
    setIngredientId(null);
    setOrderedQty('');
    setReceivedQty('');
    setUnitCost('');
  }

  async function verify() {
    if (!delivery) return;
    const res = await apiFetch<VerifyResult>(`/api/v1/deliveries/${delivery.id}/verify`, {
      method: 'POST', body: JSON.stringify({ tolerance: 0 }),
    });
    if (res.error) { setError(res.error.message); return; }
    setVerifyResult(res.data ?? null);
    void load(delivery.id);
  }

  return (
    <>
      <PageHeader
        title="Deliveries"
        description="Receive invoices line-by-line, flag disputes, and roll fresh cost into the ingredient ledger."
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card className="mb-4">
        <CardHeader title="New delivery" description="Record the first line now — you can add more after the record is created." />
        <form onSubmit={create} className="mt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Field label="Supplier" required className="lg:col-span-3">
              <SupplierPicker value={supplierId} onChange={(v) => setSupplierId(v)} />
            </Field>
            <Field label="Ingredient" required className="lg:col-span-3">
              <IngredientPicker value={ingredientId} onChange={(v) => setIngredientId(v)} />
            </Field>
            <Field label="Ordered qty" required>
              <Input type="number" step="0.01" required value={orderedQty} onChange={(e) => setOrderedQty(e.target.value)} />
            </Field>
            <Field label="Received qty" required>
              <Input type="number" step="0.01" required value={receivedQty} onChange={(e) => setReceivedQty(e.target.value)} />
            </Field>
            <Field label="Unit cost ($)" required>
              <Input type="number" step="0.01" required value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            </Field>
          </div>
          <div className="mt-4">
            <Button type="submit" leftIcon={<Plus className="h-4 w-4" />}>Create delivery</Button>
          </div>
        </form>
      </Card>

      {delivery && (
        <Card padded={false} className="mb-4">
          <div className="px-5 pt-5 flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Active delivery</div>
              <div className="mt-1 flex items-center gap-3">
                <code className="text-sm font-mono text-slate-900">{delivery.id.slice(0, 8)}</code>
                <Badge tone={STATUS_TONES[delivery.status]}>{delivery.status}</Badge>
                <span className="text-xs text-slate-500">Received {delivery.received_on.slice(0, 10)}</span>
              </div>
            </div>
            {delivery.status === 'pending' && (
              <Button leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => void verify()}>Verify</Button>
            )}
          </div>
          <Table className="mt-4">
            <thead>
              <tr>
                <Th>Ingredient</Th>
                <Th className="text-right">Ordered</Th>
                <Th className="text-right">Received</Th>
                <Th className="text-right">Unit cost</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {lines.map((l) => {
                const ing = ingredientMap.get(l.ingredient_id);
                return (
                  <TRow key={l.id}>
                    <Td className="text-slate-900">
                      {ing ? <span className="font-medium">{ing.name} <span className="text-xs text-slate-500">/ {ing.uom}</span></span>
                        : <span className="font-mono text-xs text-slate-500">{l.ingredient_id.slice(0, 8)}</span>}
                    </Td>
                    <Td className="text-right tabular-nums">{l.ordered_qty ?? <span className="text-slate-400">—</span>}</Td>
                    <Td className="text-right tabular-nums font-medium">{l.received_qty}</Td>
                    <Td className="text-right tabular-nums">${(l.unit_cost_cents / 100).toFixed(2)}</Td>
                  </TRow>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      {!delivery && (
        <EmptyState
          icon={<PackageCheck className="h-6 w-6" />}
          title="No active delivery"
          hint="Create one above to start receiving."
        />
      )}

      {verifyResult && (
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                Verify result <Badge tone={STATUS_TONES[verifyResult.status]}>{verifyResult.status}</Badge>
              </span>
            }
            description={verifyResult.status === 'verified' ? 'All lines within tolerance — cost ledger updated.' : 'Review disputes and reconcile with the supplier.'}
          />
          {verifyResult.disputes.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Disputes
              </h3>
              <ul className="space-y-1 text-sm">
                {verifyResult.disputes.map((d) => {
                  const ing = ingredientMap.get(d.ingredient_id);
                  return (
                    <li key={d.line_id} className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800">
                      <span className="font-medium">{ing?.name ?? d.ingredient_id.slice(0, 8)}</span>
                      <span>ordered <span className="font-semibold">{d.ordered ?? '—'}</span> / received <span className="font-semibold">{d.received}</span></span>
                      <Badge tone="danger">Δ {d.delta}</Badge>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {verifyResult.cost_updates.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Cost updates</h3>
              <ul className="space-y-1 text-sm">
                {verifyResult.cost_updates.map((u) => {
                  const ing = ingredientMap.get(u.ingredient_id);
                  return (
                    <li key={u.ingredient_id} className="flex items-center gap-2 text-slate-700">
                      <span className="font-medium">{ing?.name ?? u.ingredient_id.slice(0, 8)}</span>
                      <span className="text-slate-500">{u.previous_cents == null ? 'new' : `$${(u.previous_cents / 100).toFixed(2)}`}</span>
                      <span className="text-slate-400">→</span>
                      <span className="font-semibold text-slate-900">${(u.new_cents / 100).toFixed(2)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

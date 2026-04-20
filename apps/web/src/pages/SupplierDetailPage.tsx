// Supplier detail — contact info + offers this supplier fulfills.

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Mail, Phone, Clock, Plus, Package } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';
import { Input, Field } from '../components/ui/Input.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';
import { IngredientPicker } from '../components/ui/EntityPicker.js';

interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  lead_time_days: number;
  min_order_cents: number;
  order_cadence: string | null;
  is_active: boolean;
  offers: Offer[];
}

interface Offer {
  id: string;
  supplier_id: string;
  ingredient_id: string;
  supplier_pack_size: number | null;
  unit_cost_cents: number;
  rank: number;
  effective_from: string;
  effective_until: string | null;
}

interface IngredientLite {
  id: string;
  name: string;
  uom: string;
}

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [ingredientNames, setIngredientNames] = useState<Map<string, IngredientLite>>(new Map());
  const [error, setError] = useState<string | null>(null);

  // New offer form
  const [newIngredientId, setNewIngredientId] = useState<string | null>(null);
  const [costDollars, setCostDollars] = useState('');
  const [packSize, setPackSize] = useState('');
  const [rank, setRank] = useState('1');

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    const [s, ings] = await Promise.all([
      apiFetch<Supplier>(`/api/v1/suppliers/${id}`),
      apiFetch<IngredientLite[]>('/api/v1/ingredients'),
    ]);
    if (s.error || !s.data) { setError(s.error?.message ?? 'supplier not found'); return; }
    setSupplier(s.data);
    const map = new Map<string, IngredientLite>();
    for (const i of ings.data ?? []) map.set(i.id, i);
    setIngredientNames(map);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function addOffer(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !newIngredientId) { setError('Pick an ingredient first.'); return; }
    const dollars = Number(costDollars);
    if (!Number.isFinite(dollars) || dollars < 0) { setError('Unit cost must be a non-negative number.'); return; }
    const res = await apiFetch(`/api/v1/ingredients/${newIngredientId}/offers`, {
      method: 'POST',
      body: JSON.stringify({
        supplier_id: id,
        unit_cost_cents: Math.round(dollars * 100),
        supplier_pack_size: packSize ? Number(packSize) : undefined,
        rank: Number(rank) || 1,
      }),
    });
    if (res.error) { setError(res.error.message); return; }
    setNewIngredientId(null);
    setCostDollars('');
    setPackSize('');
    setRank('1');
    void load();
  }

  if (!supplier) return <p>{error ?? 'Loading…'}</p>;

  return (
    <>
      <PageHeader
        title={supplier.name}
        description={supplier.contact_name ?? undefined}
        actions={
          <Link to="/suppliers" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft className="h-4 w-4" /> All suppliers
          </Link>
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Contact" />
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Status</dt>
            <dd><Badge tone={supplier.is_active ? 'success' : 'neutral'}>{supplier.is_active ? 'Active' : 'Inactive'}</Badge></dd>
            <dt className="text-slate-500">Email</dt>
            <dd>{supplier.email
              ? <a href={`mailto:${supplier.email}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline"><Mail className="h-3.5 w-3.5" />{supplier.email}</a>
              : <span className="text-slate-400">—</span>}</dd>
            <dt className="text-slate-500">Phone</dt>
            <dd>{supplier.phone
              ? <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5 text-slate-400" />{supplier.phone}</span>
              : <span className="text-slate-400">—</span>}</dd>
            <dt className="text-slate-500">Lead time</dt>
            <dd className="inline-flex items-center gap-1 tabular-nums"><Clock className="h-3.5 w-3.5 text-slate-400" />{supplier.lead_time_days} days</dd>
            <dt className="text-slate-500">Min order</dt>
            <dd className="tabular-nums">{supplier.min_order_cents > 0 ? `$${(supplier.min_order_cents / 100).toFixed(2)}` : '—'}</dd>
            <dt className="text-slate-500">Cadence</dt>
            <dd>{supplier.order_cadence ?? <span className="text-slate-400">—</span>}</dd>
          </dl>
        </Card>

        <Card>
          <CardHeader
            title={<span className="inline-flex items-center gap-2"><Plus className="h-4 w-4" />Add offer</span>}
            description="Link this supplier to an ingredient with a unit cost and rank."
          />
          <form onSubmit={addOffer} className="grid gap-3 sm:grid-cols-2">
            <Field label="Ingredient" required className="sm:col-span-2">
              <IngredientPicker value={newIngredientId} onChange={(v) => setNewIngredientId(v)} />
            </Field>
            <Field label="Unit cost ($)" required>
              <Input
                type="number" min="0" step="0.01" inputMode="decimal"
                value={costDollars}
                onChange={(e) => setCostDollars(e.target.value)}
                required
              />
            </Field>
            <Field label="Supplier pack size" hint="Optional">
              <Input
                type="number" min="0" step="any" inputMode="decimal"
                value={packSize}
                onChange={(e) => setPackSize(e.target.value)}
              />
            </Field>
            <Field label="Rank" hint="1 = preferred supplier">
              <Input
                type="number" min="1" step="1"
                value={rank}
                onChange={(e) => setRank(e.target.value)}
              />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit">Save offer</Button>
            </div>
          </form>
        </Card>
      </div>

      <Card className="mt-4" padded={false}>
        <div className="p-5 border-b border-surface-border">
          <CardHeader
            title={<span className="inline-flex items-center gap-2"><Package className="h-4 w-4" />Offers</span>}
            description={`${supplier.offers.length} ingredient${supplier.offers.length === 1 ? '' : 's'} fulfilled by this supplier.`}
            className="mb-0"
          />
        </div>
        {supplier.offers.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={<Package className="h-6 w-6" />} title="No offers yet" hint="Add an offer above to start tracking what this supplier fulfills." />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Ingredient</Th>
                <Th className="text-right">Rank</Th>
                <Th className="text-right">Unit cost</Th>
                <Th className="text-right">Pack size</Th>
                <Th>Effective from</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {supplier.offers.map((o) => {
                const ing = ingredientNames.get(o.ingredient_id);
                return (
                  <TRow key={o.id}>
                    <Td className="font-medium">
                      {ing
                        ? <Link to={`/ingredients/${o.ingredient_id}`} className="text-brand-700 hover:underline">{ing.name}</Link>
                        : <span className="text-slate-500 font-mono text-xs">{o.ingredient_id.slice(0, 8)}</span>}
                      {ing && <span className="ml-1 text-xs text-slate-500">/ {ing.uom}</span>}
                    </Td>
                    <Td className="text-right tabular-nums">{o.rank}</Td>
                    <Td className="text-right tabular-nums">${(o.unit_cost_cents / 100).toFixed(2)}</Td>
                    <Td className="text-right tabular-nums">{o.supplier_pack_size ?? '—'}</Td>
                    <Td className="tabular-nums text-slate-600">{new Date(o.effective_from).toISOString().slice(0, 10)}</Td>
                  </TRow>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

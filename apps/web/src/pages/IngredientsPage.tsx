// TASK-037 — /ingredients list + add.
//
// MVP functionality: list ingredients, search, create, archive. CSV export is
// a direct <a> download so the browser handles auth via cookie + bearer
// forwarding is skipped (owner-accessible route; shows the raw CSV).

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Archive as ArchiveIcon, Package } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Button } from '../components/ui/Button.js';
import { Card } from '../components/ui/Card.js';
import { Badge, type BadgeTone } from '../components/ui/Badge.js';
import { Input, Select, Field } from '../components/ui/Input.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';
import { LocationPicker, SupplierPicker } from '../components/ui/EntityPicker.js';

interface Ingredient {
  id: string;
  name: string;
  uom: string;
  uom_category: string;
  pack_size: number | null;
  shelf_life_days: number | null;
  allergen_flags: string[];
  storage_location_id: string | null;
  default_supplier_id: string | null;
  is_archived: boolean;
}

const ALLERGENS = ['gluten', 'dairy', 'egg', 'soy', 'peanut', 'tree_nut', 'fish', 'shellfish', 'sesame'] as const;

interface CreateForm {
  name: string;
  uom: string;
  uom_category: string;
  pack_size: string;
  shelf_life_days: string;
  storage_location_id: string | null;
  default_supplier_id: string | null;
  allergens: string[];
  unit_cost_dollars: string;
}

const EMPTY_CREATE: CreateForm = {
  name: '',
  uom: '',
  uom_category: 'weight',
  pack_size: '',
  shelf_life_days: '',
  storage_location_id: null,
  default_supplier_id: null,
  allergens: [],
  unit_cost_dollars: '',
};

const UOM_CATEGORIES = ['weight', 'volume', 'each', 'utensil'] as const;

const CATEGORY_TONES: Record<string, BadgeTone> = {
  weight:  'info',
  volume:  'brand',
  each:    'neutral',
  utensil: 'warn',
};

export default function IngredientsPage() {
  const [rows, setRows] = useState<Ingredient[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_CREATE);

  const load = useCallback(async () => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    const res = await apiFetch<Ingredient[]>(`/api/v1/ingredients${qs}`);
    if (res.error) setError(res.error.message);
    else { setError(null); setRows(res.data ?? []); }
  }, [search]);

  useEffect(() => { void load(); }, [load]);

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim() || !form.uom.trim()) {
      setError('Name and unit of measure are required.');
      return;
    }
    const body = {
      name: form.name.trim(),
      uom: form.uom.trim(),
      uom_category: form.uom_category,
      pack_size: form.pack_size ? Number(form.pack_size) : undefined,
      shelf_life_days: form.shelf_life_days ? Number(form.shelf_life_days) : undefined,
      storage_location_id: form.storage_location_id ?? undefined,
      default_supplier_id: form.default_supplier_id ?? undefined,
      allergen_flags: form.allergens.length ? form.allergens : undefined,
    };
    const res = await apiFetch<Ingredient>('/api/v1/ingredients', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (res.error || !res.data) { setError(res.error?.message ?? 'create failed'); return; }
    if (form.unit_cost_dollars) {
      const cents = Math.round(Number(form.unit_cost_dollars) * 100);
      if (Number.isFinite(cents) && cents >= 0) {
        await apiFetch(`/api/v1/ingredients/${res.data.id}/cost`, {
          method: 'POST',
          body: JSON.stringify({ unit_cost_cents: cents, source: 'manual', note: 'initial cost' }),
        });
      }
    }
    setCreating(false);
    setForm(EMPTY_CREATE);
    void load();
  }

  function toggleAllergen(name: string) {
    setForm((f) => ({
      ...f,
      allergens: f.allergens.includes(name)
        ? f.allergens.filter((a) => a !== name)
        : [...f.allergens, name],
    }));
  }

  async function archive(id: string) {
    const res = await apiFetch(`/api/v1/ingredients/${id}/archive`, { method: 'POST' });
    if (res.error) setError(res.error.message);
    else void load();
  }

  return (
    <>
      <PageHeader
        title="Ingredients"
        description={`${rows.length} ingredient${rows.length === 1 ? '' : 's'} — the raw materials that roll up into recipe cost.`}
        actions={
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : 'New ingredient'}
          </Button>
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card padded={false} className="mb-4">
        <div className="p-4 border-b border-surface-border">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="search"
              placeholder="Search ingredients by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-surface-border bg-white pl-8 pr-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
        </div>

        {creating && (
          <form onSubmit={onCreate} className="p-5 border-b border-surface-border bg-slate-50">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="Name" required>
                <Input
                  required
                  placeholder="e.g. Olive oil, extra virgin"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="Unit of measure" required hint="g, mL, each…">
                <Input
                  required
                  placeholder="g"
                  value={form.uom}
                  onChange={(e) => setForm({ ...form, uom: e.target.value })}
                />
              </Field>
              <Field label="Category">
                <Select
                  value={form.uom_category}
                  onChange={(e) => setForm({ ...form, uom_category: e.target.value })}
                >
                  {UOM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="Pack size" hint="Units per purchasing pack (e.g. 1000 g per case)">
                <Input
                  type="number" min="0" step="any" inputMode="decimal"
                  value={form.pack_size}
                  onChange={(e) => setForm({ ...form, pack_size: e.target.value })}
                  placeholder="e.g. 1000"
                />
              </Field>
              <Field label="Shelf life (days)" hint="Used for waste forecasting">
                <Input
                  type="number" min="0" step="1"
                  value={form.shelf_life_days}
                  onChange={(e) => setForm({ ...form, shelf_life_days: e.target.value })}
                  placeholder="e.g. 7"
                />
              </Field>
              <Field label="Initial unit cost ($)" hint="Optional — appends a cost-history row">
                <Input
                  type="number" min="0" step="0.01" inputMode="decimal"
                  value={form.unit_cost_dollars}
                  onChange={(e) => setForm({ ...form, unit_cost_dollars: e.target.value })}
                  placeholder="e.g. 12.50"
                />
              </Field>
              <Field label="Storage location">
                <LocationPicker
                  value={form.storage_location_id}
                  onChange={(id) => setForm({ ...form, storage_location_id: id })}
                />
              </Field>
              <Field label="Default supplier">
                <SupplierPicker
                  value={form.default_supplier_id}
                  onChange={(id) => setForm({ ...form, default_supplier_id: id })}
                />
              </Field>
              <Field label="Allergens" className="sm:col-span-2 lg:col-span-3">
                <div className="flex flex-wrap gap-2">
                  {ALLERGENS.map((a) => {
                    const on = form.allergens.includes(a);
                    return (
                      <button
                        type="button"
                        key={a}
                        onClick={() => toggleAllergen(a)}
                        className={`rounded-full px-3 py-1 text-xs ${on ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-white text-slate-600 border border-slate-300'}`}
                      >
                        {a.replace('_', ' ')}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Button type="submit">Create ingredient</Button>
              <Button type="button" variant="ghost" onClick={() => { setCreating(false); setForm(EMPTY_CREATE); }}>Cancel</Button>
            </div>
          </form>
        )}

        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>UoM</Th>
              <Th>Pack</Th>
              <Th>Category</Th>
              <Th>Allergens</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {rows.map((r) => (
              <TRow key={r.id}>
                <Td className="font-medium text-slate-900">
                  <Link to={`/ingredients/${r.id}`} className="text-brand-700 hover:underline">{r.name}</Link>
                </Td>
                <Td className="text-slate-600 tabular-nums">{r.uom}</Td>
                <Td className="text-slate-600 tabular-nums">{r.pack_size ?? '—'}</Td>
                <Td>
                  <Badge tone={CATEGORY_TONES[r.uom_category] ?? 'neutral'}>{r.uom_category}</Badge>
                </Td>
                <Td>
                  {r.allergen_flags.length === 0 ? <span className="text-slate-400 text-xs">—</span> : (
                    <div className="flex flex-wrap gap-1">
                      {r.allergen_flags.map((a) => <Badge key={a} tone="warn">{a}</Badge>)}
                    </div>
                  )}
                </Td>
                <Td className="text-right">
                  <Button
                    variant="ghost" size="sm"
                    leftIcon={<ArchiveIcon className="h-3.5 w-3.5" />}
                    onClick={() => void archive(r.id)}
                  >
                    Archive
                  </Button>
                </Td>
              </TRow>
            ))}
          </tbody>
        </Table>
        {rows.length === 0 && (
          <div className="p-6">
            <EmptyState
              icon={<Package className="h-6 w-6" />}
              title={search ? 'No matches' : 'No ingredients yet'}
              hint={search ? 'Try a different search term.' : 'Add your first ingredient to start tracking cost.'}
            />
          </div>
        )}
      </Card>
    </>
  );
}

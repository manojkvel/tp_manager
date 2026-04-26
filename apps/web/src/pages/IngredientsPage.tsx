// TASK-037 + v1.7 Wave 5 — Ingredients list (PO design).
//
// Columns: Name · Category · Supplier · Unit Cost · PAR Level · Recipes · Actions.
// Filter drawer: culinary category + supplier + below-PAR. Create/edit lives in
// a Modal per the PO surface; archive is a soft-delete via the trash action.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Search, Package, Pencil, Trash2, SlidersHorizontal, Camera, AlertTriangle,
} from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Button } from '../components/ui/Button.js';
import { Card } from '../components/ui/Card.js';
import { Badge, type BadgeTone } from '../components/ui/Badge.js';
import { Input, Select, Field } from '../components/ui/Input.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';
import { LocationPicker, SupplierPicker } from '../components/ui/EntityPicker.js';
import { Modal } from '../components/ui/Modal.js';
import { PhotoBadge } from '../components/ui/PhotoBadge.js';

type CulinaryCategory =
  | 'proteins' | 'dairy' | 'produce' | 'grains' | 'spirits'
  | 'oils' | 'condiments' | 'beverage' | 'bakery' | 'other';

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
  par_qty: number | null;
  par_uom: string | null;
  culinary_category: CulinaryCategory | null;
  photo_required: boolean;
  supplier_sku: string | null;
  is_archived: boolean;
  // enriched (include_kpis=true)
  supplier_name?: string | null;
  latest_unit_cost_cents?: number | null;
  recipes_using_count?: number;
}

type ShortageFlag = 'out' | 'critical' | 'low' | 'ok' | 'unknown';

interface StockRow {
  ingredient_id: string;
  on_hand: number | null;
  daily_usage: number | null;
  days_of_stock: number | null;
  shortage_flag: ShortageFlag;
}

const ALLERGENS = ['gluten', 'dairy', 'egg', 'soy', 'peanut', 'tree_nut', 'fish', 'shellfish', 'sesame'] as const;

const CULINARY_CATEGORIES: CulinaryCategory[] = [
  'proteins', 'dairy', 'produce', 'grains', 'spirits',
  'oils', 'condiments', 'beverage', 'bakery', 'other',
];

const UOM_CATEGORIES = ['weight', 'volume', 'each', 'utensil'] as const;

function categoryTone(c: CulinaryCategory | null): BadgeTone {
  if (!c || c === 'other') return 'neutral';
  return c as BadgeTone;
}

function usd(cents: number | null | undefined, uom: string): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}/${uom}`;
}

function daysLabel(stock?: StockRow): { text: string; className: string } {
  if (!stock || stock.shortage_flag === 'unknown' || stock.days_of_stock == null) {
    return { text: '—', className: 'text-slate-400' };
  }
  const d = stock.days_of_stock;
  switch (stock.shortage_flag) {
    case 'out': return { text: 'Out', className: 'text-red-700 font-semibold' };
    case 'critical': return { text: `${d.toFixed(1)}d`, className: 'text-red-700 font-semibold' };
    case 'low': return { text: `${d.toFixed(1)}d`, className: 'text-amber-700 font-semibold' };
    case 'ok': return { text: d > 99 ? '99+d' : `${d.toFixed(0)}d`, className: 'text-emerald-700' };
    default: return { text: '—', className: 'text-slate-400' };
  }
}

interface CreateForm {
  id?: string;
  name: string;
  uom: string;
  uom_category: string;
  pack_size: string;
  shelf_life_days: string;
  storage_location_id: string | null;
  default_supplier_id: string | null;
  allergens: string[];
  unit_cost_dollars: string;
  par_qty: string;
  par_uom: string;
  culinary_category: CulinaryCategory | '';
  photo_required: boolean;
  supplier_sku: string;
}

const EMPTY_FORM: CreateForm = {
  name: '',
  uom: '',
  uom_category: 'weight',
  pack_size: '',
  shelf_life_days: '',
  storage_location_id: null,
  default_supplier_id: null,
  allergens: [],
  unit_cost_dollars: '',
  par_qty: '',
  par_uom: '',
  culinary_category: '',
  photo_required: false,
  supplier_sku: '',
};

export default function IngredientsPage() {
  const [rows, setRows] = useState<Ingredient[]>([]);
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CulinaryCategory | ''>('');
  const [belowPar, setBelowPar] = useState(false);
  const [runningOut, setRunningOut] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [confirmDelete, setConfirmDelete] = useState<Ingredient | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (categoryFilter) params.set('culinary_category', categoryFilter);
    if (belowPar) params.set('below_par', 'true');
    params.set('include_kpis', 'true');
    const [ing, stock] = await Promise.all([
      apiFetch<Ingredient[]>(`/api/v1/ingredients?${params.toString()}`),
      apiFetch<StockRow[]>('/api/v1/reports/stock-intelligence'),
    ]);
    if (ing.error) setError(ing.error.message);
    else { setError(null); setRows(ing.data ?? []); }
    setStockRows(stock.data ?? []);
  }, [search, categoryFilter, belowPar]);

  useEffect(() => { void load(); }, [load]);

  const stockByIngredient = useMemo(() => {
    const m = new Map<string, StockRow>();
    for (const s of stockRows) m.set(s.ingredient_id, s);
    return m;
  }, [stockRows]);

  const visibleRows = useMemo(() => {
    if (!runningOut) return rows;
    return rows.filter((r) => {
      const s = stockByIngredient.get(r.id);
      return s && (s.shortage_flag === 'out' || s.shortage_flag === 'critical' || s.shortage_flag === 'low');
    });
  }, [rows, runningOut, stockByIngredient]);

  const runningOutCount = useMemo(() => {
    let n = 0;
    for (const r of rows) {
      const s = stockByIngredient.get(r.id);
      if (s && (s.shortage_flag === 'out' || s.shortage_flag === 'critical' || s.shortage_flag === 'low')) n += 1;
    }
    return n;
  }, [rows, stockByIngredient]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(r: Ingredient) {
    setEditing(r);
    setForm({
      id: r.id,
      name: r.name,
      uom: r.uom,
      uom_category: r.uom_category,
      pack_size: r.pack_size?.toString() ?? '',
      shelf_life_days: r.shelf_life_days?.toString() ?? '',
      storage_location_id: r.storage_location_id,
      default_supplier_id: r.default_supplier_id,
      allergens: r.allergen_flags,
      unit_cost_dollars: '',
      par_qty: r.par_qty?.toString() ?? '',
      par_uom: r.par_uom ?? '',
      culinary_category: r.culinary_category ?? '',
      photo_required: r.photo_required,
      supplier_sku: r.supplier_sku ?? '',
    });
    setModalOpen(true);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
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
      par_qty: form.par_qty ? Number(form.par_qty) : undefined,
      par_uom: form.par_uom.trim() || undefined,
      culinary_category: form.culinary_category || undefined,
      photo_required: form.photo_required,
      supplier_sku: form.supplier_sku.trim() || undefined,
    };
    let targetId = editing?.id;
    if (editing) {
      const res = await apiFetch<Ingredient>(`/api/v1/ingredients/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      if (res.error) { setError(res.error.message); return; }
    } else {
      const res = await apiFetch<Ingredient>('/api/v1/ingredients', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (res.error || !res.data) { setError(res.error?.message ?? 'create failed'); return; }
      targetId = res.data.id;
    }
    if (form.unit_cost_dollars && targetId) {
      const cents = Math.round(Number(form.unit_cost_dollars) * 100);
      if (Number.isFinite(cents) && cents >= 0) {
        await apiFetch(`/api/v1/ingredients/${targetId}/cost`, {
          method: 'POST',
          body: JSON.stringify({ unit_cost_cents: cents, source: 'manual', note: editing ? 'updated via edit' : 'initial cost' }),
        });
      }
    }
    setModalOpen(false);
    setForm(EMPTY_FORM);
    setEditing(null);
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

  async function doArchive() {
    if (!confirmDelete) return;
    const res = await apiFetch(`/api/v1/ingredients/${confirmDelete.id}/archive`, { method: 'POST' });
    if (res.error) setError(res.error.message);
    setConfirmDelete(null);
    void load();
  }

  const activeFilters = (categoryFilter ? 1 : 0) + (belowPar ? 1 : 0) + (runningOut ? 1 : 0);

  return (
    <>
      <PageHeader
        title="Ingredients"
        description={`${rows.length} ingredient${rows.length === 1 ? '' : 's'} — the raw materials that roll up into recipe cost.`}
        actions={
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
            New ingredient
          </Button>
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card padded={false} className="mb-4">
        <div className="p-4 border-b border-surface-border flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="search"
              placeholder="Search ingredients by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-surface-border bg-white pl-8 pr-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          {runningOutCount > 0 && (
            <button
              type="button"
              onClick={() => setRunningOut((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                runningOut
                  ? 'border-red-300 bg-red-50 text-red-700'
                  : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
              title="Show only ingredients running out within 3 days"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {runningOutCount} running out
            </button>
          )}
          <Button
            variant="secondary"
            leftIcon={<SlidersHorizontal className="h-4 w-4" />}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            Filters{activeFilters > 0 && <span className="ml-1 rounded-full bg-brand-100 text-brand-700 px-1.5 py-0.5 text-xs">{activeFilters}</span>}
          </Button>
        </div>

        {filtersOpen && (
          <div className="p-4 border-b border-surface-border bg-slate-50 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Culinary category">
              <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as CulinaryCategory | '')}>
                <option value="">All categories</option>
                {CULINARY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Below-PAR only">
              <label className="inline-flex items-center gap-2 text-sm pt-2">
                <input type="checkbox" checked={belowPar} onChange={(e) => setBelowPar(e.target.checked)} className="rounded" />
                <span className="text-slate-700">Only show ingredients with PAR set</span>
              </label>
            </Field>
            <Field label="Stock status">
              <label className="inline-flex items-center gap-2 text-sm pt-2">
                <input type="checkbox" checked={runningOut} onChange={(e) => setRunningOut(e.target.checked)} className="rounded" />
                <span className="text-slate-700">Running out within 3 days</span>
              </label>
            </Field>
            <Field label=" ">
              <Button variant="ghost" size="sm" onClick={() => { setCategoryFilter(''); setBelowPar(false); setRunningOut(false); }}>Reset</Button>
            </Field>
          </div>
        )}

        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Category</Th>
              <Th>Supplier</Th>
              <Th className="text-right">Unit Cost</Th>
              <Th className="text-right">PAR Level</Th>
              <Th className="text-right" title="Estimated days of stock remaining at current usage rate">Days stock</Th>
              <Th className="text-right">Recipes</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {visibleRows.map((r) => {
              const stock = stockByIngredient.get(r.id);
              const days = daysLabel(stock);
              return (
              <TRow key={r.id}>
                <Td className="font-medium text-slate-900">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link to={`/ingredients/${r.id}`} className="text-brand-700 hover:underline">{r.name}</Link>
                    {r.photo_required && <PhotoBadge />}
                  </div>
                  {r.supplier_sku && <div className="text-xs text-slate-500 mt-0.5">SKU: {r.supplier_sku}</div>}
                </Td>
                <Td>
                  {r.culinary_category
                    ? <Badge tone={categoryTone(r.culinary_category)}>{r.culinary_category}</Badge>
                    : <span className="text-slate-400 text-xs">—</span>}
                </Td>
                <Td className="text-slate-700">{r.supplier_name ?? <span className="text-slate-400 text-xs">—</span>}</Td>
                <Td className="text-right tabular-nums text-slate-700">{usd(r.latest_unit_cost_cents, r.uom)}</Td>
                <Td className="text-right tabular-nums text-slate-700">
                  {r.par_qty != null ? `${r.par_qty} ${r.par_uom ?? r.uom}` : <span className="text-slate-400 text-xs">—</span>}
                </Td>
                <Td className={`text-right tabular-nums ${days.className}`}>
                  {days.text}
                  {stock && stock.on_hand != null && stock.on_hand > 0 && stock.daily_usage != null && stock.daily_usage > 0 && (
                    <div className="text-[10px] font-normal text-slate-400 mt-0.5">
                      {stock.on_hand.toFixed(0)} on hand · {stock.daily_usage.toFixed(1)}/d
                    </div>
                  )}
                </Td>
                <Td className="text-right tabular-nums">
                  {r.recipes_using_count != null && r.recipes_using_count > 0
                    ? <Link to={`/recipes?ingredient_id=${r.id}`} className="text-brand-700 hover:underline">{r.recipes_using_count}</Link>
                    : <span className="text-slate-400">0</span>}
                </Td>
                <Td className="text-right">
                  <div className="inline-flex gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700"
                      aria-label={`Edit ${r.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(r)}
                      className="p-1.5 rounded hover:bg-red-50 text-slate-500 hover:text-red-600"
                      aria-label={`Archive ${r.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </Td>
              </TRow>
              );
            })}
          </tbody>
        </Table>
        {visibleRows.length === 0 && (
          <div className="p-6">
            <EmptyState
              icon={<Package className="h-6 w-6" />}
              title={search || activeFilters > 0 ? 'No matches' : 'No ingredients yet'}
              hint={search || activeFilters > 0 ? 'Try a different search or clear filters.' : 'Add your first ingredient to start tracking cost.'}
            />
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); setForm(EMPTY_FORM); }}
        title={editing ? `Edit ${editing.name}` : 'New ingredient'}
        size="xl"
      >
        <form id="ingredient-form" onSubmit={onSubmit}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Field label="Name" required>
              <Input required placeholder="e.g. Olive oil, extra virgin"
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Culinary category" hint="Pills group by kitchen station">
              <Select value={form.culinary_category} onChange={(e) => setForm({ ...form, culinary_category: e.target.value as CulinaryCategory | '' })}>
                <option value="">(none)</option>
                {CULINARY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Unit of measure" required>
              <Input required placeholder="g" value={form.uom}
                onChange={(e) => setForm({ ...form, uom: e.target.value })} />
            </Field>
            <Field label="UoM category">
              <Select value={form.uom_category} onChange={(e) => setForm({ ...form, uom_category: e.target.value })}>
                {UOM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Pack size">
              <Input type="number" min="0" step="any" value={form.pack_size}
                onChange={(e) => setForm({ ...form, pack_size: e.target.value })} placeholder="e.g. 1000" />
            </Field>
            <Field label="Shelf life (days)">
              <Input type="number" min="0" step="1" value={form.shelf_life_days}
                onChange={(e) => setForm({ ...form, shelf_life_days: e.target.value })} placeholder="e.g. 7" />
            </Field>
            <Field label="PAR qty" hint="Auto-order fires when below this">
              <Input type="number" min="0" step="any" value={form.par_qty}
                onChange={(e) => setForm({ ...form, par_qty: e.target.value })} />
            </Field>
            <Field label="PAR unit" hint="Blank = same as UoM">
              <Input placeholder="cases, kg…" value={form.par_uom}
                onChange={(e) => setForm({ ...form, par_uom: e.target.value })} />
            </Field>
            <Field label="Initial unit cost ($)" hint="Appends a cost-history row">
              <Input type="number" min="0" step="0.01" value={form.unit_cost_dollars}
                onChange={(e) => setForm({ ...form, unit_cost_dollars: e.target.value })} placeholder="e.g. 12.50" />
            </Field>
            <Field label="Storage location">
              <LocationPicker value={form.storage_location_id}
                onChange={(id) => setForm({ ...form, storage_location_id: id })} />
            </Field>
            <Field label="Default supplier">
              <SupplierPicker value={form.default_supplier_id}
                onChange={(id) => setForm({ ...form, default_supplier_id: id })} />
            </Field>
            <Field label="Supplier SKU">
              <Input placeholder="e.g. OIL-EXV-1L" value={form.supplier_sku}
                onChange={(e) => setForm({ ...form, supplier_sku: e.target.value })} />
            </Field>
            <Field label="Photo on count" className="sm:col-span-2 lg:col-span-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox"
                  checked={form.photo_required}
                  onChange={(e) => setForm({ ...form, photo_required: e.target.checked })}
                  className="rounded" />
                <Camera className="h-4 w-4 text-orange-600" />
                <span className="text-slate-700">Require a photo at every inventory count</span>
              </label>
            </Field>
            <Field label="Allergens" className="sm:col-span-2 lg:col-span-3">
              <div className="flex flex-wrap gap-2">
                {ALLERGENS.map((a) => {
                  const on = form.allergens.includes(a);
                  return (
                    <button type="button" key={a} onClick={() => toggleAllergen(a)}
                      className={`rounded-full px-3 py-1 text-xs ${on ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-white text-slate-600 border border-slate-300'}`}>
                      {a.replace('_', ' ')}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2 pt-4 border-t border-surface-border">
            <Button type="button" variant="ghost" onClick={() => { setModalOpen(false); setEditing(null); setForm(EMPTY_FORM); }}>Cancel</Button>
            <Button type="submit">{editing ? 'Save changes' : 'Create ingredient'}</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={confirmDelete != null}
        onClose={() => setConfirmDelete(null)}
        title="Archive ingredient?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={doArchive}>Archive</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          {confirmDelete ? `${confirmDelete.name} will be archived and hidden from this list. Recipes that reference it keep working.` : ''}
        </p>
      </Modal>
    </>
  );
}

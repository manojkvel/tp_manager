// v1.7 Wave 12 — Prep Items library. Lists prep recipes with category, batch
// yield, ingredient chips, shelf life (hours), and storage temp.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Plus } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge, type BadgeTone } from '../components/ui/Badge.js';
import { Input, Select } from '../components/ui/Input.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';

type PrepCategory =
  | 'sauces' | 'mise_en_place' | 'dressings' | 'marinades' | 'stocks'
  | 'doughs_batters' | 'proteins_cooked' | 'vegetables_prepped' | 'other';

interface PrepItem {
  recipe_id: string;
  name: string;
  prep_category: PrepCategory | null;
  is_archived: boolean;
  batch_yield_qty: number | null;
  batch_yield_uom: string | null;
  shelf_life_hours: number | null;
  shelf_life_days: number | null;
  storage_temp_f: number | null;
  ingredients: Array<{ id: string; name: string }>;
  ingredient_overflow: number;
}

const CATEGORY_META: Record<PrepCategory, { label: string; tone: BadgeTone }> = {
  sauces:             { label: 'Sauces',            tone: 'condiments' },
  mise_en_place:      { label: 'Mise en Place',     tone: 'neutral' },
  dressings:          { label: 'Dressings',         tone: 'oils' },
  marinades:          { label: 'Marinades',         tone: 'spirits' },
  stocks:             { label: 'Stocks',            tone: 'proteins' },
  doughs_batters:     { label: 'Doughs & Batters',  tone: 'grains' },
  proteins_cooked:    { label: 'Proteins, cooked',  tone: 'proteins' },
  vegetables_prepped: { label: 'Vegetables, prepped', tone: 'produce' },
  other:              { label: 'Other',             tone: 'neutral' },
};

function shelfLifeLabel(item: PrepItem): string {
  if (item.shelf_life_hours != null) {
    if (item.shelf_life_hours < 24) return `${item.shelf_life_hours}h`;
    const days = item.shelf_life_hours / 24;
    return days % 1 === 0 ? `${days}d` : `${days.toFixed(1)}d`;
  }
  if (item.shelf_life_days != null) return `${item.shelf_life_days}d`;
  return '—';
}

export default function PrepItemsPage() {
  const [rows, setRows] = useState<PrepItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<PrepCategory | ''>('');

  const load = useCallback(async () => {
    const qs = category ? `?category=${category}` : '';
    const res = await apiFetch<PrepItem[]>(`/api/v1/prep-items${qs}`);
    if (res.error) setError(res.error.message);
    else { setError(null); setRows(res.data ?? []); }
  }, [category]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <>
      <PageHeader
        title="Prep Items"
        description="Reusable sub-recipes — sauces, mise, marinades — built once and assembled into menu items."
        actions={
          <Link to="/recipes?type=prep&new=1">
            <Button leftIcon={<Plus className="h-4 w-4" />}>New Prep Item</Button>
          </Link>
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card padded={false}>
        <CardHeader
          className="px-5 pt-5"
          title="All prep items"
          description="Filter by culinary category or search by name."
          actions={
            <div className="flex items-center gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-48"
              />
              <Select
                value={category}
                onChange={(e) => setCategory(e.target.value as PrepCategory | '')}
                className="w-48"
              >
                <option value="">All categories</option>
                {(Object.keys(CATEGORY_META) as PrepCategory[]).map((k) => (
                  <option key={k} value={k}>{CATEGORY_META[k].label}</option>
                ))}
              </Select>
            </div>
          }
        />
        {filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<ClipboardList className="h-6 w-6" />}
              title={rows.length === 0 ? 'No prep items yet' : 'No matches'}
              hint={rows.length === 0
                ? 'Create your first prep recipe to get started.'
                : 'Try a broader search or clear the category filter.'}
            />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Prep item</Th>
                <Th>Category</Th>
                <Th className="text-right">Batch yield</Th>
                <Th>Ingredients</Th>
                <Th className="text-right">Shelf life</Th>
                <Th className="text-right">Storage temp</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {filtered.map((r) => (
                <TRow key={r.recipe_id}>
                  <Td>
                    <Link
                      to={`/recipes/${r.recipe_id}`}
                      className="font-medium text-slate-900 hover:text-brand-600"
                    >
                      {r.name}
                    </Link>
                  </Td>
                  <Td>
                    {r.prep_category
                      ? <Badge tone={CATEGORY_META[r.prep_category].tone}>{CATEGORY_META[r.prep_category].label}</Badge>
                      : <span className="text-slate-300">—</span>}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {r.batch_yield_qty != null
                      ? <>{r.batch_yield_qty} <span className="text-slate-500 text-xs">{r.batch_yield_uom}</span></>
                      : <span className="text-slate-300">—</span>}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1">
                      {r.ingredients.map((i) => (
                        <span
                          key={i.id}
                          className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                        >
                          {i.name}
                        </span>
                      ))}
                      {r.ingredient_overflow > 0 && (
                        <span className="inline-flex items-center rounded-md bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
                          +{r.ingredient_overflow}
                        </span>
                      )}
                      {r.ingredients.length === 0 && (
                        <span className="text-slate-400 text-xs">no lines</span>
                      )}
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums">{shelfLifeLabel(r)}</Td>
                  <Td className="text-right tabular-nums">
                    {r.storage_temp_f != null
                      ? <>{r.storage_temp_f.toFixed(0)}°F</>
                      : <span className="text-slate-300">—</span>}
                  </Td>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

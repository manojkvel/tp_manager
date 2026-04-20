// Ingredient detail — cost history, basic properties, recipes-using list.

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, History, Plus, Utensils } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';
import { Input, Field } from '../components/ui/Input.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';

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

interface CostHistoryRow {
  unit_cost_cents: number;
  effective_from: string;
  source: 'delivery' | 'manual' | 'migration';
  note: string | null;
}

interface CostHistoryResponse {
  latest_cents: number | null;
  history: CostHistoryRow[];
}

interface RecipeUsage {
  recipe_id: string;
  recipe_name: string;
  version: number;
  qty: number;
  uom: string | null;
}

export default function IngredientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [ing, setIng] = useState<Ingredient | null>(null);
  const [costs, setCosts] = useState<CostHistoryResponse | null>(null);
  const [recipes, setRecipes] = useState<RecipeUsage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newCost, setNewCost] = useState('');
  const [costNote, setCostNote] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    const [a, b, c] = await Promise.all([
      apiFetch<Ingredient>(`/api/v1/ingredients/${id}`),
      apiFetch<CostHistoryResponse>(`/api/v1/ingredients/${id}/cost-history`),
      apiFetch<RecipeUsage[]>(`/api/v1/ingredients/${id}/recipes`),
    ]);
    if (a.error) { setError(a.error.message); return; }
    setIng(a.data);
    setCosts(b.data);
    setRecipes(c.data ?? []);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function appendCost(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    const dollars = Number(newCost);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setError('Cost must be a non-negative number.');
      return;
    }
    const res = await apiFetch(`/api/v1/ingredients/${id}/cost`, {
      method: 'POST',
      body: JSON.stringify({
        unit_cost_cents: Math.round(dollars * 100),
        source: 'manual',
        note: costNote.trim() || undefined,
      }),
    });
    if (res.error) { setError(res.error.message); return; }
    setNewCost('');
    setCostNote('');
    void load();
  }

  if (!ing) return <p>{error ?? 'Loading…'}</p>;

  return (
    <>
      <PageHeader
        title={ing.name}
        description={`${ing.uom} · ${ing.uom_category}${ing.pack_size ? ` · pack ${ing.pack_size}` : ''}`}
        actions={
          <Link to="/ingredients" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft className="h-4 w-4" /> All ingredients
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
          <CardHeader title="Properties" />
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">Status</dt>
            <dd>{ing.is_archived ? <Badge tone="warn">archived</Badge> : <Badge tone="success">active</Badge>}</dd>
            <dt className="text-slate-500">Pack size</dt>
            <dd className="tabular-nums">{ing.pack_size ?? '—'}</dd>
            <dt className="text-slate-500">Shelf life</dt>
            <dd className="tabular-nums">{ing.shelf_life_days != null ? `${ing.shelf_life_days} days` : '—'}</dd>
            <dt className="text-slate-500">Latest cost</dt>
            <dd className="tabular-nums">
              {costs?.latest_cents != null ? `$${(costs.latest_cents / 100).toFixed(2)} / ${ing.uom}` : '—'}
            </dd>
            <dt className="text-slate-500">Allergens</dt>
            <dd>
              {ing.allergen_flags.length === 0
                ? <span className="text-slate-400">none</span>
                : <div className="flex flex-wrap gap-1">{ing.allergen_flags.map((a) => <Badge key={a} tone="warn">{a}</Badge>)}</div>}
            </dd>
          </dl>
        </Card>

        <Card>
          <CardHeader
            title={<span className="inline-flex items-center gap-2"><Plus className="h-4 w-4" />Append cost</span>}
            description="A new row is added each time. Historical cost is preserved for audit."
          />
          <form onSubmit={appendCost} className="grid gap-3 sm:grid-cols-2">
            <Field label={`Unit cost ($ per ${ing.uom})`} required>
              <Input
                type="number" min="0" step="0.01" inputMode="decimal"
                value={newCost}
                onChange={(e) => setNewCost(e.target.value)}
                required
              />
            </Field>
            <Field label="Note">
              <Input
                placeholder="e.g. price bump Q2"
                value={costNote}
                onChange={(e) => setCostNote(e.target.value)}
              />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit">Save cost</Button>
            </div>
          </form>
        </Card>
      </div>

      <Card className="mt-4" padded={false}>
        <div className="p-5 border-b border-surface-border">
          <CardHeader
            title={<span className="inline-flex items-center gap-2"><History className="h-4 w-4" />Cost history</span>}
            className="mb-0"
          />
        </div>
        {costs && costs.history.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <Th>Effective from</Th>
                <Th className="text-right">Unit cost</Th>
                <Th>Source</Th>
                <Th>Note</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {costs.history.map((c, i) => (
                <TRow key={`${c.effective_from}-${i}`}>
                  <Td className="tabular-nums">{new Date(c.effective_from).toISOString().slice(0, 10)}</Td>
                  <Td className="text-right tabular-nums font-medium">${(c.unit_cost_cents / 100).toFixed(2)}</Td>
                  <Td><Badge tone={c.source === 'delivery' ? 'info' : c.source === 'migration' ? 'neutral' : 'brand'}>{c.source}</Badge></Td>
                  <Td className="text-slate-600">{c.note ?? '—'}</Td>
                </TRow>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-6">
            <EmptyState icon={<History className="h-6 w-6" />} title="No cost recorded yet" />
          </div>
        )}
      </Card>

      <Card className="mt-4" padded={false}>
        <div className="p-5 border-b border-surface-border">
          <CardHeader
            title={<span className="inline-flex items-center gap-2"><Utensils className="h-4 w-4" />Used in recipes</span>}
            description={`${recipes.length} recipe line${recipes.length === 1 ? '' : 's'} reference this ingredient.`}
            className="mb-0"
          />
        </div>
        {recipes.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={<Utensils className="h-6 w-6" />} title="Not referenced by any recipe" />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Recipe</Th>
                <Th>Version</Th>
                <Th className="text-right">Qty</Th>
                <Th>UoM</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {recipes.map((r, i) => (
                <TRow key={`${r.recipe_id}-${r.version}-${i}`}>
                  <Td className="font-medium">
                    <Link to={`/recipes/${r.recipe_id}`} className="text-brand-700 hover:underline">{r.recipe_name}</Link>
                  </Td>
                  <Td className="tabular-nums">v{r.version}</Td>
                  <Td className="text-right tabular-nums">{r.qty.toFixed(2)}</Td>
                  <Td className="text-slate-600">{r.uom ?? '—'}</Td>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

// TASK-062 — /prep/waste (§6.8).

import { useCallback, useEffect, useState } from 'react';
import { Trash2, AlertTriangle, Plus } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge } from '../components/ui/Badge.js';
import { Input, Select, Field } from '../components/ui/Input.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';
import { IngredientPicker, RecipePicker, WasteReasonPicker } from '../components/ui/EntityPicker.js';

interface WasteEntry {
  id: string;
  ref_type: 'ingredient' | 'prep';
  ingredient_id: string | null;
  recipe_version_id: string | null;
  qty: number;
  uom: string;
  reason_id: string;
  value_cents: number;
  at: string;
}

interface ExpiredCandidate {
  ref_type: 'ingredient' | 'prep';
  ingredient_id: string | null;
  recipe_version_id: string | null;
  label: string;
  qty: number;
  uom: string;
  expired_on: string;
  reason_suggestion: string;
}

export default function WastePage() {
  const [entries, setEntries] = useState<WasteEntry[]>([]);
  const [expired, setExpired] = useState<ExpiredCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refType, setRefType] = useState<'ingredient' | 'prep'>('ingredient');
  const [ingredientId, setIngredientId] = useState<string | null>(null);
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  const [uom, setUom] = useState('oz');

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      apiFetch<WasteEntry[]>('/api/v1/waste'),
      apiFetch<ExpiredCandidate[]>('/api/v1/waste/expired-suggestions'),
    ]);
    if (a.error) { setError(a.error.message); return; }
    if (b.error) { setError(b.error.message); return; }
    setError(null);
    setEntries(a.data ?? []);
    setExpired(b.data ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function logEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!reasonId) { setError('Pick a reason.'); return; }
    if (refType === 'ingredient' && !ingredientId) { setError('Pick an ingredient.'); return; }
    if (refType === 'prep' && !recipeId) { setError('Pick a recipe.'); return; }
    const q = Number(qty);
    if (!Number.isFinite(q)) { setError('Quantity is required.'); return; }
    const body = {
      ref_type: refType,
      ingredient_id: refType === 'ingredient' ? ingredientId : null,
      recipe_version_id: refType === 'prep' ? recipeId : null,
      qty: q,
      uom,
      reason_id: reasonId,
    };
    const res = await apiFetch('/api/v1/waste', { method: 'POST', body: JSON.stringify(body) });
    if (res.error) { setError(res.error.message); return; }
    setIngredientId(null);
    setRecipeId(null);
    setQty('');
    void load();
  }

  const totalValueCents = entries.reduce((acc, e) => acc + e.value_cents, 0);

  return (
    <>
      <PageHeader
        title="Waste log"
        description={`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} — $${(totalValueCents / 100).toFixed(2)} discarded product.`}
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {expired.length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-amber-900">
                {expired.length} item{expired.length === 1 ? '' : 's'} past shelf-life
              </div>
              <ul className="mt-2 space-y-1 text-sm text-amber-900">
                {expired.map((c, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="font-medium">{c.label}</span>
                    <span className="text-amber-700">{c.qty} {c.uom}</span>
                    <Badge tone="warn">expired {c.expired_on.slice(0, 10)}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader title="Log waste" description="Record discarded product so AvT and cost reports stay accurate." />
        <form onSubmit={logEntry} className="mt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <Field label="Type">
              <Select value={refType} onChange={(e) => setRefType(e.target.value as 'ingredient' | 'prep')}>
                <option value="ingredient">Ingredient</option>
                <option value="prep">Prep</option>
              </Select>
            </Field>
            <Field label={refType === 'ingredient' ? 'Ingredient' : 'Recipe'} required className="lg:col-span-3">
              {refType === 'ingredient'
                ? <IngredientPicker value={ingredientId} onChange={setIngredientId} />
                : <RecipePicker value={recipeId} onChange={setRecipeId} />}
            </Field>
            <Field label="Qty" required>
              <Input type="number" step="0.01" required value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="UoM" required>
              <Input required value={uom} onChange={(e) => setUom(e.target.value)} />
            </Field>
            <Field label="Reason" required className="lg:col-span-6">
              <WasteReasonPicker value={reasonId} onChange={setReasonId} />
            </Field>
          </div>
          <div className="mt-4">
            <Button type="submit" leftIcon={<Plus className="h-4 w-4" />}>Log waste</Button>
          </div>
        </form>
      </Card>

      <Card padded={false}>
        <CardHeader className="px-5 pt-5" title="Recent entries" />
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Type</Th>
              <Th className="text-right">Qty</Th>
              <Th className="text-right">Value</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {entries.map((e) => (
              <TRow key={e.id}>
                <Td className="text-slate-600 tabular-nums">{e.at.slice(0, 16).replace('T', ' ')}</Td>
                <Td><Badge tone={e.ref_type === 'ingredient' ? 'info' : 'brand'}>{e.ref_type}</Badge></Td>
                <Td className="text-right tabular-nums">{e.qty} {e.uom}</Td>
                <Td className="text-right tabular-nums font-semibold text-slate-800">${(e.value_cents / 100).toFixed(2)}</Td>
              </TRow>
            ))}
          </tbody>
        </Table>
        {entries.length === 0 && (
          <div className="p-6">
            <EmptyState
              icon={<Trash2 className="h-6 w-6" />}
              title="Nothing logged yet"
              hint="Use the form above to record discarded ingredients or prep."
            />
          </div>
        )}
      </Card>
    </>
  );
}

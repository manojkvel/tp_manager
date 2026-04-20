// TASK-042 — /recipes/:id detail + plated cost + line editor.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Printer, Save, Trash2, GripVertical } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge } from '../components/ui/Badge.js';
import { Input, Select, Field } from '../components/ui/Input.js';
import { Table, Th, Td, TRow } from '../components/ui/Table.js';
import { IngredientPicker, RecipePicker } from '../components/ui/EntityPicker.js';

interface RecipeLine {
  id: string;
  position: number;
  ref_type: 'ingredient' | 'recipe';
  ingredient_id: string | null;
  ref_recipe_id: string | null;
  qty: number;
  qty_text: string | null;
  uom: string | null;
  station: string | null;
  step_order: number | null;
  utensil_id?: string | null;
  note?: string | null;
}

interface Version {
  version: {
    id: string;
    version: number;
    is_current: boolean;
    yield_qty: number;
    yield_uom: string;
    procedure: string;
    shelf_life_days?: number | null;
  };
  lines: RecipeLine[];
}

interface Detail {
  recipe: { id: string; type: string; name: string };
  versions: Version[];
}

interface Cost {
  total_cents: number;
  per_yield_unit_cents: number;
  lines: Array<{ line_id: string; cents: number; skipped: string | null }>;
}

interface EditLine {
  ref_type: 'ingredient' | 'recipe';
  ingredient_id: string | null;
  ref_recipe_id: string | null;
  qty: string;
  uom: string;
  station: string;
  note: string;
}

function toEditLine(l: RecipeLine): EditLine {
  return {
    ref_type: l.ref_type,
    ingredient_id: l.ingredient_id,
    ref_recipe_id: l.ref_recipe_id,
    qty: String(l.qty),
    uom: l.uom ?? '',
    station: l.station ?? '',
    note: l.note ?? '',
  };
}

function emptyLine(): EditLine {
  return { ref_type: 'ingredient', ingredient_id: null, ref_recipe_id: null, qty: '', uom: '', station: '', note: '' };
}

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [cost, setCost] = useState<Cost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditLine[]>([]);
  const [yieldQty, setYieldQty] = useState('');
  const [yieldUom, setYieldUom] = useState('');
  const [procedure, setProcedure] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    const res = await apiFetch<Detail>(`/api/v1/recipes/${id}`);
    if (res.error) { setError(res.error.message); return; }
    setDetail(res.data ?? null);
    const cres = await apiFetch<Cost>(`/api/v1/recipes/${id}/cost`);
    setCost(cres.error ? null : cres.data ?? null);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const current = useMemo(
    () => detail?.versions.find((v) => v.version.is_current),
    [detail],
  );

  function beginEdit() {
    if (!current) return;
    setDraft(current.lines.map(toEditLine));
    setYieldQty(String(current.version.yield_qty));
    setYieldUom(current.version.yield_uom);
    setProcedure(current.version.procedure ?? '');
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  function updateDraft(i: number, patch: Partial<EditLine>) {
    setDraft((d) => d.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function removeLine(i: number) {
    setDraft((d) => d.filter((_, idx) => idx !== i));
  }

  function addLine() {
    setDraft((d) => [...d, emptyLine()]);
  }

  function moveLine(i: number, dir: -1 | 1) {
    setDraft((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.length) return d;
      const copy = d.slice();
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      return copy;
    });
  }

  async function saveNewVersion() {
    if (!id) return;
    setError(null);
    const yieldQ = Number(yieldQty);
    if (!Number.isFinite(yieldQ) || yieldQ <= 0) { setError('Yield qty must be > 0.'); return; }
    if (!yieldUom.trim()) { setError('Yield unit is required.'); return; }
    const lines = draft.map((l, position) => {
      const qty = Number(l.qty);
      return {
        position,
        ref_type: l.ref_type,
        ingredient_id: l.ref_type === 'ingredient' ? l.ingredient_id : null,
        ref_recipe_id: l.ref_type === 'recipe' ? l.ref_recipe_id : null,
        qty: Number.isFinite(qty) ? qty : 0,
        qty_text: null,
        uom: l.uom.trim() || null,
        note: l.note.trim() || null,
        station: l.station.trim() || null,
        step_order: null,
        utensil_id: null,
      };
    });
    for (const l of lines) {
      if (l.ref_type === 'ingredient' && !l.ingredient_id) { setError('Every ingredient line needs an ingredient.'); return; }
      if (l.ref_type === 'recipe' && !l.ref_recipe_id) { setError('Every sub-recipe line needs a recipe.'); return; }
    }
    const res = await apiFetch(`/api/v1/recipes/${id}/versions`, {
      method: 'POST',
      body: JSON.stringify({
        yield_qty: yieldQ,
        yield_uom: yieldUom.trim(),
        procedure: procedure.trim() || undefined,
        lines,
      }),
    });
    if (res.error) { setError(res.error.message); return; }
    setEditing(false);
    void load();
  }

  if (!detail) return <p>{error ?? 'Loading…'}</p>;

  return (
    <>
      <PageHeader
        title={detail.recipe.name}
        description={
          <span className="inline-flex items-center gap-2">
            <Badge tone={detail.recipe.type === 'menu' ? 'brand' : 'info'}>{detail.recipe.type}</Badge>
            {current && <span>v{current.version.version} · yields {current.version.yield_qty} {current.version.yield_uom}</span>}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <a
              href={`/api/v1/recipes/${detail.recipe.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
            >
              <Printer className="h-4 w-4" /> Flash card
            </a>
            <Link to="/recipes" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
              <ArrowLeft className="h-4 w-4" /> All recipes
            </Link>
          </div>
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {current && !editing && (
        <>
          <Card className="mb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardHeader title={`Current version (v${current.version.version})`} description={`Yields ${current.version.yield_qty} ${current.version.yield_uom}`} className="mb-2" />
                {cost && (
                  <p className="text-sm text-slate-700">
                    <span className="font-semibold">Plated cost:</span> ${(cost.total_cents / 100).toFixed(2)}{' '}
                    <span className="text-slate-500">(${(cost.per_yield_unit_cents / 100).toFixed(2)} per {current.version.yield_uom})</span>
                  </p>
                )}
              </div>
              <Button onClick={beginEdit}>Edit lines → new version</Button>
            </div>
          </Card>

          <Card padded={false} className="mb-4">
            <div className="p-5 border-b border-surface-border">
              <CardHeader title="Lines" description={`${current.lines.length} line${current.lines.length === 1 ? '' : 's'}`} className="mb-0" />
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Reference</Th>
                  <Th className="text-right">Qty</Th>
                  <Th>UoM</Th>
                  <Th>Station</Th>
                  <Th className="text-right">Cost</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {current.lines.map((l) => {
                  const lc = cost?.lines.find((c) => c.line_id === l.id);
                  return (
                    <TRow key={l.id}>
                      <Td className="tabular-nums">{l.position + 1}</Td>
                      <Td>
                        <Badge tone={l.ref_type === 'ingredient' ? 'info' : 'brand'}>{l.ref_type}</Badge>{' '}
                        {l.ref_type === 'ingredient' && l.ingredient_id
                          ? <Link to={`/ingredients/${l.ingredient_id}`} className="text-brand-700 hover:underline">view</Link>
                          : l.ref_type === 'recipe' && l.ref_recipe_id
                          ? <Link to={`/recipes/${l.ref_recipe_id}`} className="text-brand-700 hover:underline">view</Link>
                          : '—'}
                      </Td>
                      <Td className="text-right tabular-nums">{l.qty_text ?? l.qty}</Td>
                      <Td>{l.uom ?? '—'}</Td>
                      <Td>{l.station ?? '—'}</Td>
                      <Td className="text-right tabular-nums">
                        {lc ? `$${(lc.cents / 100).toFixed(2)}${lc.skipped ? ` (${lc.skipped})` : ''}` : '—'}
                      </Td>
                    </TRow>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          {current.version.procedure && (
            <Card className="mb-4">
              <CardHeader title="Procedure" />
              <pre className="whitespace-pre-wrap text-sm text-slate-800">{current.version.procedure}</pre>
            </Card>
          )}
        </>
      )}

      {editing && (
        <Card className="mb-4">
          <CardHeader
            title="Edit lines → new version"
            description="Each save creates a new version. Historical versions are preserved."
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Yield qty" required>
              <Input type="number" min="0" step="0.01" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} />
            </Field>
            <Field label="Yield unit" required>
              <Input value={yieldUom} onChange={(e) => setYieldUom(e.target.value)} placeholder="each, g, mL…" />
            </Field>
          </div>

          <div className="mt-4 space-y-2">
            {draft.map((l, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[auto,120px,1fr,100px,100px,140px,1fr,auto] items-end rounded-md border border-slate-200 p-3">
                <div className="flex flex-col items-center">
                  <button type="button" className="text-slate-400 hover:text-slate-700" onClick={() => moveLine(i, -1)} aria-label="Move up">▲</button>
                  <GripVertical className="h-4 w-4 text-slate-300" />
                  <button type="button" className="text-slate-400 hover:text-slate-700" onClick={() => moveLine(i, 1)} aria-label="Move down">▼</button>
                </div>
                <Field label="Kind">
                  <Select value={l.ref_type} onChange={(e) => updateDraft(i, { ref_type: e.target.value as 'ingredient' | 'recipe', ingredient_id: null, ref_recipe_id: null })}>
                    <option value="ingredient">Ingredient</option>
                    <option value="recipe">Sub-recipe</option>
                  </Select>
                </Field>
                <Field label="Reference" required>
                  {l.ref_type === 'ingredient'
                    ? <IngredientPicker value={l.ingredient_id} onChange={(v) => updateDraft(i, { ingredient_id: v })} />
                    : <RecipePicker value={l.ref_recipe_id} onChange={(v) => updateDraft(i, { ref_recipe_id: v })} />}
                </Field>
                <Field label="Qty" required>
                  <Input type="number" step="0.01" value={l.qty} onChange={(e) => updateDraft(i, { qty: e.target.value })} />
                </Field>
                <Field label="UoM">
                  <Input value={l.uom} onChange={(e) => updateDraft(i, { uom: e.target.value })} />
                </Field>
                <Field label="Station">
                  <Input value={l.station} onChange={(e) => updateDraft(i, { station: e.target.value })} placeholder="e.g. grill" />
                </Field>
                <Field label="Note">
                  <Input value={l.note} onChange={(e) => updateDraft(i, { note: e.target.value })} />
                </Field>
                <Button type="button" variant="ghost" size="sm" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => removeLine(i)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-3">
            <Button type="button" variant="secondary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={addLine}>
              Add line
            </Button>
          </div>

          <div className="mt-4">
            <Field label="Procedure">
              <textarea
                className="w-full rounded-md border border-surface-border px-3 py-2 text-sm shadow-sm min-h-[100px]"
                value={procedure}
                onChange={(e) => setProcedure(e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-4 flex gap-2">
            <Button onClick={() => void saveNewVersion()} leftIcon={<Save className="h-4 w-4" />}>Save as new version</Button>
            <Button variant="ghost" onClick={cancelEdit}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div className="p-5 border-b border-surface-border">
          <CardHeader title="Version history" className="mb-0" />
        </div>
        <ul className="divide-y divide-surface-border">
          {detail.versions.map((v) => (
            <li key={v.version.id} className="px-5 py-3 flex items-center gap-3 text-sm">
              <span className="font-medium">v{v.version.version}</span>
              {v.version.is_current ? <Badge tone="success">current</Badge> : <Badge tone="neutral">archived</Badge>}
              <span className="text-slate-500">{v.lines.length} line{v.lines.length === 1 ? '' : 's'}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

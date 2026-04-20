// TASK-055 — /inventory (§6.5).

import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Play, Pause, Check, RotateCcw, Plus } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge, type BadgeTone } from '../components/ui/Badge.js';
import { Input, Field } from '../components/ui/Input.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';
import { IngredientPicker } from '../components/ui/EntityPicker.js';

type CountStatus = 'open' | 'paused' | 'completed' | 'amended';

interface Count {
  id: string;
  date: string;
  status: CountStatus;
  amends_count_id: string | null;
}

interface Line {
  id: string;
  ingredient_id: string | null;
  actual_qty: number;
  location_id: string | null;
}

interface IngredientLite {
  id: string;
  name: string;
  uom: string;
}

const STATUS_TONES: Record<CountStatus, BadgeTone> = {
  open:      'info',
  paused:    'warn',
  completed: 'success',
  amended:   'neutral',
};

export default function InventoryPage() {
  const [count, setCount] = useState<Count | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pickedIngredient, setPickedIngredient] = useState<string | null>(null);
  const [pickedQty, setPickedQty] = useState('');
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

  const loadCount = useCallback(async (id: string) => {
    const res = await apiFetch<{ count: Count; lines: Line[] }>(`/api/v1/inventory/counts/${id}`);
    if (res.error) { setError(res.error.message); return; }
    setError(null);
    setCount(res.data?.count ?? null);
    setLines(res.data?.lines ?? []);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem('active_count_id');
    if (stored) void loadCount(stored);
  }, [loadCount]);

  async function start() {
    const res = await apiFetch<Count>('/api/v1/inventory/counts', { method: 'POST', body: JSON.stringify({}) });
    if (res.error) { setError(res.error.message); return; }
    if (res.data) {
      window.localStorage.setItem('active_count_id', res.data.id);
      setCount(res.data);
      setLines([]);
    }
  }

  async function action(path: 'pause' | 'resume' | 'complete' | 'amend') {
    if (!count) return;
    const res = await apiFetch(`/api/v1/inventory/counts/${count.id}/${path}`, { method: 'POST', body: JSON.stringify({}) });
    if (res.error) { setError(res.error.message); return; }
    if (path === 'amend' && (res.data as Count | null)?.id) {
      const next = res.data as Count;
      window.localStorage.setItem('active_count_id', next.id);
      setCount(next);
      await loadCount(next.id);
    } else {
      void loadCount(count.id);
    }
  }

  async function addLine(e: React.FormEvent) {
    e.preventDefault();
    if (!count) return;
    if (!pickedIngredient) { setError('Pick an ingredient first.'); return; }
    const qty = Number(pickedQty);
    if (!Number.isFinite(qty)) { setError('Quantity is required.'); return; }
    const res = await apiFetch(`/api/v1/inventory/counts/${count.id}/lines`, {
      method: 'POST',
      body: JSON.stringify({ ref_type: 'ingredient', ingredient_id: pickedIngredient, actual_qty: qty }),
    });
    if (res.error) { setError(res.error.message); return; }
    setPickedIngredient(null);
    setPickedQty('');
    void loadCount(count.id);
  }

  return (
    <>
      <PageHeader
        title="Inventory count"
        description="Stock-take the shelves. Pause mid-count if you need to; amend a completed count to correct mistakes."
        actions={
          !count && (
            <Button leftIcon={<Play className="h-4 w-4" />} onClick={() => void start()}>
              Start new count
            </Button>
          )
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {!count && (
        <EmptyState
          icon={<ClipboardList className="h-6 w-6" />}
          title="No active count"
          hint="Start a count when you're ready to stock-take. All progress auto-saves as you add lines."
        />
      )}

      {count && (
        <>
          <Card className="mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Active count</div>
                <div className="mt-1 flex items-center gap-3">
                  <code className="text-sm text-slate-900 font-mono">{count.id.slice(0, 8)}</code>
                  <Badge tone={STATUS_TONES[count.status]}>{count.status}</Badge>
                  {count.amends_count_id && (
                    <span className="text-xs text-slate-500">
                      amends <code>{count.amends_count_id.slice(0, 8)}</code>
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-slate-500">Started {count.date.slice(0, 10)} — {lines.length} line{lines.length === 1 ? '' : 's'}</div>
              </div>
              <div className="flex items-center gap-2">
                {count.status === 'open' && (
                  <Button variant="secondary" size="sm" leftIcon={<Pause className="h-3.5 w-3.5" />} onClick={() => void action('pause')}>Pause</Button>
                )}
                {count.status === 'paused' && (
                  <Button variant="secondary" size="sm" leftIcon={<Play className="h-3.5 w-3.5" />} onClick={() => void action('resume')}>Resume</Button>
                )}
                {(count.status === 'open' || count.status === 'paused') && (
                  <Button size="sm" leftIcon={<Check className="h-3.5 w-3.5" />} onClick={() => void action('complete')}>Complete</Button>
                )}
                {count.status === 'completed' && (
                  <Button variant="secondary" size="sm" leftIcon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => void action('amend')}>Amend</Button>
                )}
              </div>
            </div>
          </Card>

          {(count.status === 'open' || count.status === 'paused') && (
            <Card className="mb-4">
              <form onSubmit={addLine}>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr,160px,auto] gap-3 items-end">
                  <Field label="Ingredient" required>
                    <IngredientPicker value={pickedIngredient} onChange={(v) => setPickedIngredient(v)} />
                  </Field>
                  <Field label="Qty" required>
                    <Input
                      type="number" step="0.01" required inputMode="decimal"
                      value={pickedQty}
                      onChange={(e) => setPickedQty(e.target.value)}
                    />
                  </Field>
                  <Button type="submit" leftIcon={<Plus className="h-4 w-4" />}>Add line</Button>
                </div>
              </form>
            </Card>
          )}

          <Card padded={false}>
            <CardHeader className="px-5 pt-5" title="Lines" description="Quantities recorded so far" />
            <Table>
              <thead>
                <tr>
                  <Th>Ingredient</Th>
                  <Th className="text-right">Quantity</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {lines.map((l) => {
                  const ing = l.ingredient_id ? ingredientMap.get(l.ingredient_id) : null;
                  return (
                    <TRow key={l.id}>
                      <Td className="text-slate-900">
                        {ing ? (
                          <span><span className="font-medium">{ing.name}</span> <span className="text-xs text-slate-500">/ {ing.uom}</span></span>
                        ) : l.ingredient_id ? (
                          <span className="font-mono text-xs text-slate-500">{l.ingredient_id.slice(0, 8)}</span>
                        ) : <span className="text-slate-400">—</span>}
                      </Td>
                      <Td className="text-right tabular-nums">{l.actual_qty}</Td>
                    </TRow>
                  );
                })}
              </tbody>
            </Table>
            {lines.length === 0 && (
              <div className="p-6">
                <EmptyState title="No lines yet" hint="Add your first line above to start recording counts." />
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}

// v1.7 Wave 8 — Waste Log with KPI strip, bucket distribution, and Modal-driven entry.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trash2, AlertTriangle, Plus } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge, type BadgeTone } from '../components/ui/Badge.js';
import { Input, Select, Field } from '../components/ui/Input.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';
import { IngredientPicker, RecipePicker, WasteReasonPicker } from '../components/ui/EntityPicker.js';
import { Modal } from '../components/ui/Modal.js';
import { KPIStrip } from '../components/charts/KPIStrip.js';
import { HorizontalBarChart, type HBarPoint } from '../components/charts/HorizontalBarChart.js';

type Bucket = 'spoilage' | 'prep_waste' | 'comped_meals' | 'theft_suspected';

interface WasteEntry {
  id: string;
  ref_type: 'ingredient' | 'prep';
  ingredient_id: string | null;
  recipe_version_id: string | null;
  qty: number;
  uom: string;
  reason_id: string;
  attribution_bucket: Bucket;
  station_code: string | null;
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

interface Station { id: string; code: string; label: string }
interface WasteReason { id: string; label: string }

const BUCKET_META: Record<Bucket, { label: string; tone: BadgeTone }> = {
  spoilage:        { label: 'Spoilage',          tone: 'spoilage' },
  prep_waste:      { label: 'Prep waste',        tone: 'prep_waste' },
  comped_meals:    { label: 'Comped / training', tone: 'comped_meals' },
  theft_suspected: { label: 'Theft suspected',   tone: 'theft_suspected' },
};

function usd(cents: number): string { return `$${(cents / 100).toFixed(2)}`; }

export default function WastePage() {
  const [entries, setEntries] = useState<WasteEntry[]>([]);
  const [expired, setExpired] = useState<ExpiredCandidate[]>([]);
  const [reasons, setReasons] = useState<WasteReason[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [reasonFilter, setReasonFilter] = useState<string>('');

  // Form state (only live while modal open).
  const [refType, setRefType] = useState<'ingredient' | 'prep'>('ingredient');
  const [ingredientId, setIngredientId] = useState<string | null>(null);
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket>('spoilage');
  const [stationCode, setStationCode] = useState('');
  const [qty, setQty] = useState('');
  const [uom, setUom] = useState('oz');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const [a, b, r, s] = await Promise.all([
      apiFetch<WasteEntry[]>('/api/v1/waste'),
      apiFetch<ExpiredCandidate[]>('/api/v1/waste/expired-suggestions'),
      apiFetch<WasteReason[]>('/api/v1/settings/waste-reasons'),
      apiFetch<Station[]>('/api/v1/settings/stations'),
    ]);
    if (a.error) { setError(a.error.message); return; }
    setError(null);
    setEntries(a.data ?? []);
    setExpired(b.data ?? []);
    setReasons(r.data ?? []);
    setStations(s.data ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function resetForm() {
    setRefType('ingredient');
    setIngredientId(null);
    setRecipeId(null);
    setReasonId(null);
    setBucket('spoilage');
    setStationCode('');
    setQty('');
    setUom('oz');
    setNote('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reasonId) { setError('Pick a reason.'); return; }
    if (refType === 'ingredient' && !ingredientId) { setError('Pick an ingredient.'); return; }
    if (refType === 'prep' && !recipeId) { setError('Pick a recipe.'); return; }
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) { setError('Quantity must be > 0.'); return; }

    const body = {
      ref_type: refType,
      ingredient_id: refType === 'ingredient' ? ingredientId : null,
      recipe_version_id: refType === 'prep' ? recipeId : null,
      qty: q,
      uom,
      reason_id: reasonId,
      attribution_bucket: bucket,
      station_code: stationCode || null,
      note: note || null,
    };
    const res = await apiFetch('/api/v1/waste', { method: 'POST', body: JSON.stringify(body) });
    if (res.error) { setError(res.error.message); return; }
    setError(null);
    setModalOpen(false);
    resetForm();
    void load();
  }

  // KPI aggregates from current list.
  const totals = useMemo(() => {
    const per: Record<Bucket, { value: number; count: number }> = {
      spoilage: { value: 0, count: 0 },
      prep_waste: { value: 0, count: 0 },
      comped_meals: { value: 0, count: 0 },
      theft_suspected: { value: 0, count: 0 },
    };
    let grand = 0;
    for (const e of entries) {
      per[e.attribution_bucket].value += e.value_cents;
      per[e.attribution_bucket].count += 1;
      grand += e.value_cents;
    }
    return { per, grand };
  }, [entries]);

  const kpis = [
    { label: 'Total waste cost', value: usd(totals.grand), hint: `${entries.length} entries`, icon: Trash2, tone: 'danger' as const },
    { label: 'Spoilage', value: usd(totals.per.spoilage.value), hint: `${totals.per.spoilage.count} entries`, tone: 'warn' as const },
    { label: 'Prep waste', value: usd(totals.per.prep_waste.value), hint: `${totals.per.prep_waste.count} entries`, tone: 'warn' as const },
    { label: 'Comped / training', value: usd(totals.per.comped_meals.value), hint: `${totals.per.comped_meals.count} entries`, tone: 'brand' as const },
  ];

  // "Loss by reason" horizontal bar data — aggregate from visible entries.
  const lossByReason: HBarPoint[] = useMemo(() => {
    const byReason = new Map<string, { label: string; value: number }>();
    for (const e of entries) {
      const label = reasons.find((r) => r.id === e.reason_id)?.label ?? 'Unknown';
      const cur = byReason.get(e.reason_id) ?? { label, value: 0 };
      cur.value += e.value_cents / 100;
      byReason.set(e.reason_id, cur);
    }
    return [...byReason.values()]
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
      .map((r) => ({ label: r.label, value: r.value, tone: 'warning' as const }));
  }, [entries, reasons]);

  const filteredEntries = reasonFilter
    ? entries.filter((e) => e.reason_id === reasonFilter)
    : entries;

  return (
    <>
      <PageHeader
        title="Waste Log"
        description="Track what gets tossed — and why. Accurate waste entries keep variance reporting honest."
        actions={
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setModalOpen(true)}>
            Log waste
          </Button>
        }
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

      <KPIStrip cards={kpis} className="mb-4" />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">
        <Card className="lg:col-span-2">
          <CardHeader title="Loss by reason" description="Top reasons in the trailing 7-day window." />
          {lossByReason.length === 0
            ? <EmptyState title="No waste logged yet." />
            : <HorizontalBarChart data={lossByReason} format={(n) => `$${n.toFixed(0)}`} />}
        </Card>

        <Card padded={false} className="lg:col-span-3">
          <CardHeader
            className="px-5 pt-5"
            title="Recent entries"
            actions={
              <Select
                value={reasonFilter}
                onChange={(e) => setReasonFilter(e.target.value)}
                className="text-sm"
              >
                <option value="">All reasons</option>
                {reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
            }
          />
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Bucket</Th>
                <Th>Station</Th>
                <Th className="text-right">Qty</Th>
                <Th className="text-right">Value</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {filteredEntries.map((e) => {
                const meta = BUCKET_META[e.attribution_bucket];
                const station = stations.find((s) => s.code === e.station_code);
                return (
                  <TRow key={e.id}>
                    <Td className="text-slate-600 tabular-nums">{e.at.slice(0, 16).replace('T', ' ')}</Td>
                    <Td><Badge tone={meta.tone}>{meta.label}</Badge></Td>
                    <Td className="text-slate-600">{station?.label ?? e.station_code ?? '—'}</Td>
                    <Td className="text-right tabular-nums">{e.qty} {e.uom}</Td>
                    <Td className="text-right tabular-nums font-semibold text-slate-800">{usd(e.value_cents)}</Td>
                  </TRow>
                );
              })}
            </tbody>
          </Table>
          {filteredEntries.length === 0 && (
            <div className="p-6">
              <EmptyState
                icon={<Trash2 className="h-6 w-6" />}
                title={reasonFilter ? 'No entries match the filter.' : 'Nothing logged yet'}
                hint={reasonFilter ? 'Clear the filter to see all entries.' : 'Tap "Log waste" to record discarded product.'}
              />
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); resetForm(); }}
        title="Log waste"
        description="Required fields capture accounting attribution (bucket) alongside the operational reason."
        size="lg"
        footer={
          <>
            <Button variant="secondary" type="button" onClick={() => { setModalOpen(false); resetForm(); }}>Cancel</Button>
            <Button type="submit" form="waste-form" leftIcon={<Plus className="h-4 w-4" />}>Log entry</Button>
          </>
        }
      >
        <form id="waste-form" onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Type" required>
            <Select value={refType} onChange={(e) => setRefType(e.target.value as 'ingredient' | 'prep')}>
              <option value="ingredient">Ingredient</option>
              <option value="prep">Prep (recipe)</option>
            </Select>
          </Field>
          <Field label={refType === 'ingredient' ? 'Ingredient' : 'Recipe'} required>
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
          <Field label="Reason" required className="sm:col-span-2">
            <WasteReasonPicker value={reasonId} onChange={setReasonId} />
          </Field>
          <Field label="Attribution bucket" required>
            <Select value={bucket} onChange={(e) => setBucket(e.target.value as Bucket)}>
              {(Object.keys(BUCKET_META) as Bucket[]).map((b) => (
                <option key={b} value={b}>{BUCKET_META[b].label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Station">
            <Select value={stationCode} onChange={(e) => setStationCode(e.target.value)}>
              <option value="">—</option>
              {stations.map((s) => <option key={s.id} value={s.code}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Note" className="sm:col-span-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional detail (e.g. walk-in temperature)" />
          </Field>
        </form>
      </Modal>
    </>
  );
}

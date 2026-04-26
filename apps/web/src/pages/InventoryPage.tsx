// TASK-055 + v1.7 Wave 6 — Inventory count (PO design).
//
// Always-open today's count. Ingredients grouped by storage location (zones)
// presented as pill tabs with per-zone progress. Each row has a QtySpinner,
// a camera button (photos are captured inline as data URLs — MinIO upload is
// a follow-up), and photo-required badges. GPS coords are asked for on first
// interaction. Complete is blocked until every photo-required row has a photo.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardCheck, Check, RotateCcw, Camera, MapPin, ScanLine, List as ListIcon,
} from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { EmptyState } from '../components/ui/Table.js';
import { QtySpinner } from '../components/ui/QtySpinner.js';
import { ZoneTabs } from '../components/ui/ZoneTabs.js';
import { PhotoBadge } from '../components/ui/PhotoBadge.js';
import { cn } from '../components/ui/cn.js';

type CountStatus = 'open' | 'paused' | 'completed' | 'amended';

interface Count {
  id: string;
  date: string;
  status: CountStatus;
  amends_count_id: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_captured_at: string | null;
}

interface Line {
  id: string;
  ingredient_id: string | null;
  actual_qty: number;
  location_id: string | null;
  photo_url: string | null;
}

type CulinaryCategory =
  | 'proteins' | 'dairy' | 'produce' | 'grains' | 'spirits'
  | 'oils' | 'condiments' | 'beverage' | 'bakery' | 'other';

interface Ingredient {
  id: string;
  name: string;
  uom: string;
  storage_location_id: string | null;
  culinary_category: CulinaryCategory | null;
  photo_required: boolean;
  par_qty: number | null;
  par_uom: string | null;
  is_archived: boolean;
}

interface Location { id: string; name: string }

type Mode = 'visual' | 'scan';

const UNZONED = '__unzoned__';
const UNZONED_LABEL = 'Unassigned';

const CATEGORY_LABELS: Record<CulinaryCategory, string> = {
  proteins: 'Proteins', dairy: 'Dairy', produce: 'Produce', grains: 'Grains',
  spirits: 'Spirits', oils: 'Oils', condiments: 'Condiments',
  beverage: 'Beverage', bakery: 'Bakery', other: 'Other',
};

export default function InventoryPage() {
  const [count, setCount] = useState<Count | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [activeZone, setActiveZone] = useState<string>(UNZONED);
  const [mode, setMode] = useState<Mode>('visual');
  const [scanQuery, setScanQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busyIngredientId, setBusyIngredientId] = useState<string | null>(null);
  const gpsAsked = useRef(false);

  const loadCount = useCallback(async () => {
    const res = await apiFetch<{ count: Count; lines: Line[] }>('/api/v1/inventory/counts/today');
    if (res.error) { setError(res.error.message); return; }
    setError(null);
    setCount(res.data?.count ?? null);
    setLines(res.data?.lines ?? []);
  }, []);

  useEffect(() => {
    void (async () => {
      const [ings, locs] = await Promise.all([
        apiFetch<Ingredient[]>('/api/v1/ingredients?include_kpis=false'),
        apiFetch<Location[]>('/api/v1/settings/locations'),
      ]);
      setIngredients(ings.data ?? []);
      setLocations(locs.data ?? []);
      if ((locs.data ?? []).length > 0) setActiveZone(locs.data![0]!.id);
      void loadCount();
    })();
  }, [loadCount]);

  // Capture GPS on first interaction if not already persisted.
  function ensureGps() {
    if (gpsAsked.current) return;
    gpsAsked.current = true;
    if (!count || count.gps_captured_at || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const res = await apiFetch(`/api/v1/inventory/counts/${count.id}/gps`, {
          method: 'POST',
          body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        });
        if (!res.error) void loadCount();
      },
      () => { /* silent — GPS is optional */ },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  }

  async function upsertLine(ing: Ingredient, qty: number, photoUrl?: string | null) {
    if (!count) return;
    ensureGps();
    setBusyIngredientId(ing.id);
    try {
      const existing = lines.find((l) => l.ingredient_id === ing.id);
      const body = {
        ref_type: 'ingredient' as const,
        ingredient_id: ing.id,
        location_id: ing.storage_location_id,
        actual_qty: qty,
        photo_url: photoUrl !== undefined ? photoUrl : existing?.photo_url ?? null,
      };
      // Service lacks an in-place update for arbitrary lines, but `addLine`
      // is idempotent at the UI level — each POST creates a new line, and
      // the most-recent line wins in rollups. For the sweep pattern we keep
      // it simple: always POST, then reload.
      const res = await apiFetch(`/api/v1/inventory/counts/${count.id}/lines`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (res.error) setError(res.error.message);
      else void loadCount();
    } finally {
      setBusyIngredientId(null);
    }
  }

  async function capturePhoto(ing: Ingredient, file: File) {
    const dataUrl = await fileToDataUrl(file);
    const latestQty = mostRecentQty(lines, ing.id) ?? 0;
    await upsertLine(ing, latestQty, dataUrl);
    setInfo(`Captured photo for ${ing.name}.`);
  }

  async function complete() {
    if (!count) return;
    // Gate on photo-required ingredients having a photo.
    const missing = ingredients.filter((ing) => {
      if (!ing.photo_required || ing.is_archived) return false;
      const latest = mostRecentLine(lines, ing.id);
      return !latest || !latest.photo_url;
    });
    if (missing.length > 0) {
      setError(`${missing.length} photo-required ingredient${missing.length === 1 ? '' : 's'} still need a photo: ${missing.slice(0, 3).map((m) => m.name).join(', ')}${missing.length > 3 ? '…' : ''}`);
      return;
    }
    const res = await apiFetch(`/api/v1/inventory/counts/${count.id}/complete`, { method: 'POST', body: JSON.stringify({}) });
    if (res.error) setError(res.error.message);
    else void loadCount();
  }

  async function amend() {
    if (!count) return;
    const res = await apiFetch<Count>(`/api/v1/inventory/counts/${count.id}/amend`, { method: 'POST', body: JSON.stringify({}) });
    if (res.error) setError(res.error.message);
    else void loadCount();
  }

  const zonesWithIngredients = useMemo(() => {
    const byZone = new Map<string, Ingredient[]>();
    for (const ing of ingredients) {
      if (ing.is_archived) continue;
      const zoneId = ing.storage_location_id ?? UNZONED;
      if (!byZone.has(zoneId)) byZone.set(zoneId, []);
      byZone.get(zoneId)!.push(ing);
    }
    return byZone;
  }, [ingredients]);

  const tabs = useMemo(() => {
    const list = locations
      .filter((l) => zonesWithIngredients.has(l.id))
      .map((l) => ({
        id: l.id,
        label: l.name,
        total: zonesWithIngredients.get(l.id)!.length,
        done: zonesWithIngredients.get(l.id)!.filter((ing) => mostRecentLine(lines, ing.id) != null).length,
      }));
    if (zonesWithIngredients.has(UNZONED)) {
      const unzoned = zonesWithIngredients.get(UNZONED)!;
      list.push({
        id: UNZONED,
        label: UNZONED_LABEL,
        total: unzoned.length,
        done: unzoned.filter((ing) => mostRecentLine(lines, ing.id) != null).length,
      });
    }
    return list;
  }, [locations, zonesWithIngredients, lines]);

  const overallDone = tabs.reduce((s, t) => s + t.done, 0);
  const overallTotal = tabs.reduce((s, t) => s + t.total, 0);

  const activeIngredients = useMemo(() => {
    const list = zonesWithIngredients.get(activeZone) ?? [];
    if (mode === 'scan' && scanQuery.trim()) {
      const q = scanQuery.trim().toLowerCase();
      return list.filter((ing) => ing.name.toLowerCase().includes(q));
    }
    return list;
  }, [zonesWithIngredients, activeZone, mode, scanQuery]);

  const lineByIngredient = useMemo(() => {
    const m = new Map<string, Line>();
    for (const l of lines) {
      if (!l.ingredient_id) continue;
      m.set(l.ingredient_id, l);
    }
    return m;
  }, [lines]);

  if (!count) {
    return (
      <>
        <PageHeader title="Inventory Count" description="Sweep the shelves, row by row, zone by zone." />
        <EmptyState icon={<ClipboardCheck className="h-6 w-6" />} title="Loading today's count…" />
      </>
    );
  }

  const immutable = count.status === 'completed' || count.status === 'amended';

  return (
    <>
      <PageHeader
        title="Inventory Count"
        description={`${overallDone}/${overallTotal} items counted · Date ${count.date.slice(0, 10)}`}
        actions={
          <div className="flex items-center gap-2">
            {!immutable && <Button size="sm" leftIcon={<Check className="h-3.5 w-3.5" />} onClick={complete}>Complete</Button>}
            {count.status === 'completed' && <Button size="sm" variant="secondary" leftIcon={<RotateCcw className="h-3.5 w-3.5" />} onClick={amend}>Amend</Button>}
          </div>
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {info && !error && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{info}</div>
      )}

      {tabs.length === 0 ? (
        <EmptyState
          title="No ingredients to count"
          hint="Add ingredients under the Ingredients page first, or assign them to a storage location."
        />
      ) : (
        <>
          <ZoneTabs
            tabs={tabs}
            activeId={activeZone}
            onChange={(id) => { setActiveZone(id); setScanQuery(''); }}
            className="mb-3"
          />

          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-md border border-surface-border p-0.5 bg-white">
              <ModeButton label="Continuous Scan" icon={ScanLine} active={mode === 'scan'} onClick={() => setMode('scan')} />
              <ModeButton label="Visual Count" icon={ListIcon} active={mode === 'visual'} onClick={() => setMode('visual')} />
            </div>
            <GpsChip count={count} />
          </div>

          {mode === 'scan' && (
            <Card className="mb-4">
              <label className="text-sm font-medium text-slate-700 block mb-1">Barcode or ingredient name</label>
              <input
                type="search"
                autoFocus
                value={scanQuery}
                onChange={(e) => setScanQuery(e.target.value)}
                placeholder="Scan a code or type to filter…"
                className="w-full rounded-md border border-surface-border bg-white px-3 py-2 text-sm"
              />
              <p className="mt-2 text-xs text-slate-500">
                Hands-free barcode scanning via camera is coming in a follow-up. For now the scan input is a fast text-narrow.
              </p>
            </Card>
          )}

          <Card padded={false}>
            <ul className="divide-y divide-surface-border">
              {activeIngredients.map((ing) => {
                const line = lineByIngredient.get(ing.id);
                return (
                  <IngredientRow
                    key={ing.id}
                    ingredient={ing}
                    line={line}
                    disabled={immutable || busyIngredientId === ing.id}
                    onQtyChange={(qty) => void upsertLine(ing, qty)}
                    onPhotoCapture={(file) => void capturePhoto(ing, file)}
                  />
                );
              })}
              {activeIngredients.length === 0 && (
                <li className="p-6">
                  <EmptyState title="No ingredients in this zone" />
                </li>
              )}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

function IngredientRow({
  ingredient, line, disabled, onQtyChange, onPhotoCapture,
}: {
  ingredient: Ingredient;
  line: Line | undefined;
  disabled: boolean;
  onQtyChange: (qty: number) => void;
  onPhotoCapture: (file: File) => void;
}) {
  const [qty, setQty] = useState<number>(line?.actual_qty ?? 0);
  useEffect(() => { setQty(line?.actual_qty ?? 0); }, [line?.actual_qty]);
  const photoCaptured = !!line?.photo_url;
  const counted = line != null;
  const categoryLabel = ingredient.culinary_category ? CATEGORY_LABELS[ingredient.culinary_category] : null;

  return (
    <li className="px-5 py-4 flex items-center gap-4 flex-wrap hover:bg-slate-50/50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-slate-900">{ingredient.name}</span>
          {ingredient.photo_required && <PhotoBadge captured={photoCaptured} />}
          {counted && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200">
              <Check className="h-3 w-3" /> Counted
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-slate-500">
          {categoryLabel && <span>{categoryLabel}</span>}
          {categoryLabel && <span className="mx-1.5">·</span>}
          <span>{ingredient.uom}</span>
          {ingredient.par_qty != null && (
            <>
              <span className="mx-1.5">·</span>
              <span>PAR {ingredient.par_qty} {ingredient.par_uom ?? ingredient.uom}</span>
            </>
          )}
        </div>
      </div>
      <QtySpinner
        value={qty}
        onChange={(next) => { setQty(next); onQtyChange(next); }}
        step={1}
        disabled={disabled}
      />
      <label className={cn(
        'inline-flex items-center justify-center h-9 w-9 rounded-md border cursor-pointer transition-colors',
        photoCaptured
          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
          : ingredient.photo_required
            ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100'
            : 'border-surface-border bg-white text-slate-500 hover:bg-slate-50',
        disabled && 'opacity-50 pointer-events-none',
      )}>
        <Camera className="h-4 w-4" />
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPhotoCapture(f);
            e.target.value = '';
          }}
        />
      </label>
    </li>
  );
}

function GpsChip({ count }: { count: Count }) {
  if (count.gps_captured_at) {
    const t = new Date(count.gps_captured_at);
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
        <MapPin className="h-3 w-3" />
        GPS: Verified · {t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
      <MapPin className="h-3 w-3" /> GPS pending
    </span>
  );
}

function ModeButton({ label, icon: Icon, active, onClick }: { label: string; icon: React.ElementType; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors',
        active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function mostRecentLine(lines: Line[], ingredient_id: string): Line | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.ingredient_id === ingredient_id) return lines[i];
  }
  return undefined;
}

function mostRecentQty(lines: Line[], ingredient_id: string): number | null {
  const l = mostRecentLine(lines, ingredient_id);
  return l ? l.actual_qty : null;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

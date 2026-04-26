// v1.7 Wave 10 — Deliveries: list of cards w/ OCR status, scan-invoice modal, reconciliation view.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { PackageCheck, Plus, CheckCircle2, AlertTriangle, FileText, Camera, ArrowLeft } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge, type BadgeTone } from '../components/ui/Badge.js';
import { Input, Field } from '../components/ui/Input.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';
import { IngredientPicker, SupplierPicker } from '../components/ui/EntityPicker.js';
import { Modal } from '../components/ui/Modal.js';

type DeliveryStatus = 'pending' | 'verified' | 'disputed';
type OcrStatus = 'none' | 'processing' | 'parsed' | 'failed';

interface Delivery {
  id: string;
  supplier_id: string;
  received_on: string;
  status: DeliveryStatus;
  invoice_scan_url: string | null;
  ocr_status: OcrStatus;
  discrepancy_count: number;
}

interface Line {
  id: string;
  ingredient_id: string;
  ordered_qty: number | null;
  received_qty: number;
  unit_cost_cents: number;
  note: string | null;
}

interface VerifyResult {
  status: DeliveryStatus;
  disputes: Array<{ line_id: string; ingredient_id: string; ordered: number | null; received: number; delta: number }>;
  cost_updates: Array<{ ingredient_id: string; previous_cents: number | null; new_cents: number }>;
}

interface Supplier { id: string; name: string }
interface IngredientLite { id: string; name: string; uom: string }

const STATUS_TONES: Record<DeliveryStatus, BadgeTone> = {
  pending:  'warn',
  verified: 'success',
  disputed: 'danger',
};

const OCR_TONES: Record<OcrStatus, BadgeTone> = {
  none:       'neutral',
  processing: 'info',
  parsed:     'success',
  failed:     'danger',
};

function usd(cents: number): string { return `$${(cents / 100).toFixed(2)}`; }

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function DeliveriesPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [suppliers, setSuppliers] = useState<Map<string, Supplier>>(new Map());
  const [ingredients, setIngredients] = useState<Map<string, IngredientLite>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanFor, setScanFor] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ delivery: Delivery; lines: Line[] } | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  // Create form state.
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [ingredientId, setIngredientId] = useState<string | null>(null);
  const [orderedQty, setOrderedQty] = useState('');
  const [receivedQty, setReceivedQty] = useState('');
  const [unitCost, setUnitCost] = useState('');

  const load = useCallback(async () => {
    const [d, s, i] = await Promise.all([
      apiFetch<Delivery[]>('/api/v1/deliveries'),
      apiFetch<Supplier[]>('/api/v1/suppliers'),
      apiFetch<IngredientLite[]>('/api/v1/ingredients'),
    ]);
    if (d.error) { setError(d.error.message); return; }
    setError(null);
    setDeliveries(d.data ?? []);
    setSuppliers(new Map((s.data ?? []).map((x) => [x.id, x])));
    setIngredients(new Map((i.data ?? []).map((x) => [x.id, x])));
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function openDetail(id: string) {
    const res = await apiFetch<{ delivery: Delivery; lines: Line[] }>(`/api/v1/deliveries/${id}`);
    if (res.error) { setError(res.error.message); return; }
    setDetail(res.data ?? null);
    setVerifyResult(null);
  }

  async function createDelivery(e: FormEvent) {
    e.preventDefault();
    if (!supplierId || !ingredientId) { setError('Pick a supplier and ingredient.'); return; }
    const body = {
      supplier_id: supplierId,
      received_on: new Date().toISOString(),
      lines: [{
        ingredient_id: ingredientId,
        ordered_qty: Number(orderedQty || 0),
        received_qty: Number(receivedQty || 0),
        unit_cost_cents: Math.round(Number(unitCost || 0) * 100),
        note: null,
      }],
    };
    const res = await apiFetch<Delivery>('/api/v1/deliveries', { method: 'POST', body: JSON.stringify(body) });
    if (res.error) { setError(res.error.message); return; }
    setCreateOpen(false);
    setSupplierId(null); setIngredientId(null); setOrderedQty(''); setReceivedQty(''); setUnitCost('');
    void load();
  }

  async function handleScanFile(file: File) {
    if (!scanFor) return;
    const dataUrl = await fileToDataUrl(file);
    const res = await apiFetch<Delivery>(`/api/v1/deliveries/${scanFor}/scan`, {
      method: 'POST',
      body: JSON.stringify({ invoice_scan_url: dataUrl }),
    });
    if (res.error) { setError(res.error.message); return; }
    setScanOpen(false);
    setScanFor(null);
    void load();
  }

  async function verify(id: string) {
    const res = await apiFetch<VerifyResult>(`/api/v1/deliveries/${id}/verify`, {
      method: 'POST',
      body: JSON.stringify({ tolerance: 0 }),
    });
    if (res.error) { setError(res.error.message); return; }
    setVerifyResult(res.data ?? null);
    void load();
    if (detail) void openDetail(detail.delivery.id);
  }

  const sortedDeliveries = useMemo(
    () => [...deliveries].sort((a, b) => b.received_on.localeCompare(a.received_on)),
    [deliveries],
  );

  // Detail view.
  if (detail) {
    const d = detail.delivery;
    const supplier = suppliers.get(d.supplier_id);
    return (
      <>
        <PageHeader
          title={`Delivery ${d.id.slice(0, 8)}`}
          description={supplier?.name ?? d.supplier_id.slice(0, 8)}
          actions={
            <Button variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => setDetail(null)}>Back</Button>
          }
        />

        <Card padded={false} className="mb-4">
          <div className="px-5 pt-5 flex items-start justify-between gap-3">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Badge tone={STATUS_TONES[d.status]}>{d.status}</Badge>
                <Badge tone={OCR_TONES[d.ocr_status]}>OCR: {d.ocr_status}</Badge>
                {d.discrepancy_count > 0 && <Badge tone="danger">{d.discrepancy_count} discrepanc{d.discrepancy_count === 1 ? 'y' : 'ies'}</Badge>}
              </div>
              <div className="text-xs text-slate-500">Received {d.received_on.slice(0, 10)}</div>
              {d.invoice_scan_url && (
                <a href={d.invoice_scan_url} target="_blank" rel="noreferrer" className="text-xs text-brand-700 hover:underline inline-flex items-center gap-1">
                  <FileText className="h-3 w-3" /> View scanned invoice
                </a>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!d.invoice_scan_url && (
                <Button
                  variant="secondary"
                  leftIcon={<Camera className="h-4 w-4" />}
                  onClick={() => { setScanFor(d.id); setScanOpen(true); }}
                >
                  Scan invoice
                </Button>
              )}
              {d.status === 'pending' && (
                <Button leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => void verify(d.id)}>
                  Verify
                </Button>
              )}
            </div>
          </div>
          <Table className="mt-4">
            <thead>
              <tr>
                <Th>Ingredient</Th>
                <Th className="text-right">Ordered</Th>
                <Th className="text-right">Received</Th>
                <Th className="text-right">Δ</Th>
                <Th className="text-right">Unit cost</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {detail.lines.map((l) => {
                const ing = ingredients.get(l.ingredient_id);
                const delta = l.ordered_qty != null ? l.received_qty - l.ordered_qty : null;
                return (
                  <TRow key={l.id}>
                    <Td className="font-medium">{ing?.name ?? l.ingredient_id.slice(0, 8)}</Td>
                    <Td className="text-right tabular-nums">{l.ordered_qty ?? <span className="text-slate-400">—</span>}</Td>
                    <Td className="text-right tabular-nums font-medium">{l.received_qty}</Td>
                    <Td className="text-right">
                      {delta == null ? <span className="text-slate-400">—</span>
                        : delta === 0 ? <span className="text-emerald-600">0</span>
                        : <Badge tone={delta > 0 ? 'info' : 'danger'}>{delta > 0 ? '+' : ''}{delta}</Badge>}
                    </Td>
                    <Td className="text-right tabular-nums">{usd(l.unit_cost_cents)}</Td>
                  </TRow>
                );
              })}
            </tbody>
          </Table>
        </Card>

        {verifyResult && (
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  Verify result <Badge tone={STATUS_TONES[verifyResult.status]}>{verifyResult.status}</Badge>
                </span>
              }
              description={
                verifyResult.status === 'verified'
                  ? 'All lines within tolerance — cost ledger updated.'
                  : 'Review disputes and reconcile with the supplier.'
              }
            />
            {verifyResult.disputes.length > 0 && (
              <ul className="space-y-1 text-sm">
                {verifyResult.disputes.map((dsp) => {
                  const ing = ingredients.get(dsp.ingredient_id);
                  return (
                    <li key={dsp.line_id} className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <span className="font-medium">{ing?.name ?? dsp.ingredient_id.slice(0, 8)}</span>
                      <span>ordered <span className="font-semibold">{dsp.ordered ?? '—'}</span> · received <span className="font-semibold">{dsp.received}</span></span>
                      <Badge tone="danger">Δ {dsp.delta}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
            {verifyResult.cost_updates.length > 0 && (
              <div className="mt-3">
                <h4 className="text-sm font-semibold text-slate-900 mb-1">Cost updates</h4>
                <ul className="space-y-1 text-sm text-slate-700">
                  {verifyResult.cost_updates.map((u) => {
                    const ing = ingredients.get(u.ingredient_id);
                    return (
                      <li key={u.ingredient_id}>
                        <span className="font-medium">{ing?.name ?? u.ingredient_id.slice(0, 8)}</span>:
                        {' '}{u.previous_cents == null ? 'new' : usd(u.previous_cents)} → <span className="font-semibold">{usd(u.new_cents)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Card>
        )}

        <ScanModal
          open={scanOpen}
          onClose={() => { setScanOpen(false); setScanFor(null); }}
          onFile={handleScanFile}
        />
      </>
    );
  }

  // List view.
  return (
    <>
      <PageHeader
        title="Deliveries"
        description="Receive invoices, flag disputes, and roll fresh cost into the ingredient ledger."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" leftIcon={<Camera className="h-4 w-4" />} onClick={() => { setScanFor(null); setScanOpen(true); }}>
              Scan invoice
            </Button>
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>New delivery</Button>
          </div>
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {sortedDeliveries.length === 0 ? (
        <EmptyState
          icon={<PackageCheck className="h-6 w-6" />}
          title="No deliveries yet"
          hint="Tap New delivery to record receipts, or Scan invoice to OCR an existing receipt."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {sortedDeliveries.map((d) => {
            const supplier = suppliers.get(d.supplier_id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => void openDetail(d.id)}
                className="text-left rounded-lg border border-surface-border bg-white p-4 hover:border-brand-300 hover:shadow-card transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">{supplier?.name ?? d.supplier_id.slice(0, 8)}</div>
                    <div className="text-xs text-slate-500 mt-0.5">Received {d.received_on.slice(0, 10)}</div>
                  </div>
                  <Badge tone={STATUS_TONES[d.status]}>{d.status}</Badge>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  {d.invoice_scan_url
                    ? <Badge tone={OCR_TONES[d.ocr_status]}>Invoice · {d.ocr_status}</Badge>
                    : <span className="text-slate-400 inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />No invoice scanned</span>}
                  {d.discrepancy_count > 0 && <Badge tone="danger">{d.discrepancy_count} Δ</Badge>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New delivery"
        description="Record the first line now — you can add more after the record is created."
        size="lg"
        footer={
          <>
            <Button variant="secondary" type="button" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="submit" form="delivery-form" leftIcon={<Plus className="h-4 w-4" />}>Create delivery</Button>
          </>
        }
      >
        <form id="delivery-form" onSubmit={createDelivery} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Supplier" required className="sm:col-span-3">
            <SupplierPicker value={supplierId} onChange={(v) => setSupplierId(v)} />
          </Field>
          <Field label="Ingredient" required className="sm:col-span-3">
            <IngredientPicker value={ingredientId} onChange={(v) => setIngredientId(v)} />
          </Field>
          <Field label="Ordered qty" required>
            <Input type="number" step="0.01" required value={orderedQty} onChange={(e) => setOrderedQty(e.target.value)} />
          </Field>
          <Field label="Received qty" required>
            <Input type="number" step="0.01" required value={receivedQty} onChange={(e) => setReceivedQty(e.target.value)} />
          </Field>
          <Field label="Unit cost ($)" required>
            <Input type="number" step="0.01" required value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </Field>
        </form>
      </Modal>

      <ScanModal
        open={scanOpen}
        onClose={() => { setScanOpen(false); setScanFor(null); }}
        onFile={handleScanFile}
        deliveries={scanFor ? undefined : sortedDeliveries.filter((d) => !d.invoice_scan_url)}
        onPick={(id) => setScanFor(id)}
        pickedId={scanFor}
        suppliers={suppliers}
      />
    </>
  );
}

interface ScanModalProps {
  open: boolean;
  onClose: () => void;
  onFile: (file: File) => Promise<void>;
  deliveries?: Delivery[];
  onPick?: (id: string) => void;
  pickedId?: string | null;
  suppliers?: Map<string, Supplier>;
}

function ScanModal({ open, onClose, onFile, deliveries, onPick, pickedId, suppliers }: ScanModalProps) {
  const needsPick = deliveries != null && !pickedId;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Scan invoice"
      description={needsPick
        ? 'Pick the delivery to attach this scan to.'
        : 'Upload a photo or PDF. OCR runs in the background and parsed lines appear once ready.'}
      size="md"
      footer={<Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>}
    >
      {needsPick ? (
        <ul className="space-y-1">
          {deliveries!.length === 0 && <li className="text-sm text-slate-500">No deliveries without an invoice scan.</li>}
          {deliveries!.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => onPick?.(d.id)}
                className="w-full flex items-center justify-between gap-2 rounded-md border border-surface-border px-3 py-2 text-sm hover:border-brand-300 hover:bg-brand-50"
              >
                <span className="font-medium">{suppliers?.get(d.supplier_id)?.name ?? d.supplier_id.slice(0, 8)}</span>
                <span className="text-xs text-slate-500">{d.received_on.slice(0, 10)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div>
          <label className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-slate-300 px-4 py-8 text-center cursor-pointer hover:border-brand-300 hover:bg-brand-50">
            <Camera className="h-6 w-6 text-slate-400" />
            <span className="text-sm text-slate-600">Tap to take a photo or upload a PDF</span>
            <input
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </label>
          <div className="mt-3 text-xs text-slate-500">
            OCR extracts line items automatically — manual corrections are available from the delivery detail view.
          </div>
        </div>
      )}
    </Modal>
  );
}

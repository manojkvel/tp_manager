// v1.7 Wave 9 — Suppliers list with KPIs, category/star, delivery schedule, edit modal.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Truck, DollarSign, Clock, AlertTriangle, Pencil, Download } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Button } from '../components/ui/Button.js';
import { Card } from '../components/ui/Card.js';
import { Badge, type BadgeTone } from '../components/ui/Badge.js';
import { Input, Select, Field } from '../components/ui/Input.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';
import { Modal } from '../components/ui/Modal.js';
import { KPIStrip } from '../components/charts/KPIStrip.js';
import { StarRating } from '../components/ui/StarRating.js';

type SupplierCategory = 'broadline' | 'produce' | 'beverage' | 'bakery' | 'dairy' | 'specialty' | 'other';
type SupplierStatus = 'active' | 'review' | 'inactive';

interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  lead_time_days: number;
  is_active: boolean;
  category: SupplierCategory | null;
  star_rating: number | null;
  delivery_days: number[];
  cutoff_time: string | null;
  status: SupplierStatus;
}

interface KpiRow {
  supplier_id: string;
  on_time_pct: number | null;
  fill_rate_pct: number | null;
  ytd_spend_cents: number;
  missed_items_count: number;
  delivery_count: number;
}

interface KpiAgg {
  active_suppliers: number;
  total_ytd_spend_cents: number;
  avg_on_time_pct: number | null;
  missed_items_total: number;
}

const CATEGORY_META: Record<SupplierCategory, { label: string; tone: BadgeTone }> = {
  broadline: { label: 'Broadline', tone: 'neutral' },
  produce:   { label: 'Produce',   tone: 'produce' },
  beverage:  { label: 'Beverage',  tone: 'beverage' },
  bakery:    { label: 'Bakery',    tone: 'bakery' },
  dairy:     { label: 'Dairy',     tone: 'dairy' },
  specialty: { label: 'Specialty', tone: 'spirits' },
  other:     { label: 'Other',     tone: 'neutral' },
};

const STATUS_META: Record<SupplierStatus, { label: string; tone: BadgeTone }> = {
  active:   { label: 'Active',        tone: 'success' },
  review:   { label: 'Under review',  tone: 'warn' },
  inactive: { label: 'Inactive',      tone: 'neutral' },
};

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function usd(cents: number): string { return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`; }

export default function SuppliersPage() {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [kpis, setKpis] = useState<{ rows: KpiRow[]; aggregate: KpiAgg } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      apiFetch<Supplier[]>('/api/v1/suppliers'),
      apiFetch<{ rows: KpiRow[]; aggregate: KpiAgg }>('/api/v1/suppliers/kpis'),
    ]);
    if (a.error) setError(a.error.message);
    else { setError(null); setRows(a.data ?? []); }
    if (b.data) setKpis(b.data);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const kpiByKpiId = useMemo(
    () => new Map((kpis?.rows ?? []).map((r) => [r.supplier_id, r])),
    [kpis],
  );

  const strip = [
    { label: 'Active suppliers', value: kpis?.aggregate.active_suppliers ?? 0, icon: Truck, tone: 'brand' as const },
    { label: 'YTD spend', value: kpis ? usd(kpis.aggregate.total_ytd_spend_cents) : '—', icon: DollarSign, tone: 'neutral' as const },
    { label: 'Avg on-time', value: kpis?.aggregate.avg_on_time_pct != null ? `${kpis.aggregate.avg_on_time_pct}%` : '—', icon: Clock, tone: 'success' as const },
    { label: 'Missed items', value: kpis?.aggregate.missed_items_total ?? 0, icon: AlertTriangle, tone: (kpis && kpis.aggregate.missed_items_total > 0 ? 'danger' : 'success') as 'danger' | 'success' },
  ];

  function renderDeliveryDays(days: number[]): string {
    if (days.length === 0) return '—';
    return days.slice().sort((a, b) => a - b).map((d) => DOW_SHORT[d] ?? d).join(', ');
  }

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const days: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      if (form.get(`dow-${i}`) === 'on') days.push(i);
    }
    const body = {
      name: String(form.get('name') ?? ''),
      contact_name: String(form.get('contact_name') ?? '') || null,
      email: String(form.get('email') ?? '') || null,
      phone: String(form.get('phone') ?? '') || null,
      lead_time_days: Number(form.get('lead_time_days') ?? 1),
      category: (String(form.get('category') ?? '') || null) as SupplierCategory | null,
      star_rating: form.get('star_rating') ? Number(form.get('star_rating')) : null,
      delivery_days: days,
      cutoff_time: String(form.get('cutoff_time') ?? '') || null,
      status: (String(form.get('status') ?? 'active')) as SupplierStatus,
    };
    const res = editing
      ? await apiFetch<Supplier>(`/api/v1/suppliers/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
      : await apiFetch<Supplier>('/api/v1/suppliers', { method: 'POST', body: JSON.stringify(body) });
    if (res.error) { setError(res.error.message); return; }
    setEditing(null);
    setCreateOpen(false);
    void load();
  }

  const modalOpen = createOpen || editing != null;

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Vendors and purveyors that fulfill your ingredient orders."
        actions={
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => { setEditing(null); setCreateOpen(true); }}>
            New supplier
          </Button>
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <KPIStrip cards={strip} className="mb-4" />

      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Supplier</Th>
              <Th>Category</Th>
              <Th>Delivery days</Th>
              <Th>Cutoff</Th>
              <Th className="text-right">On-time %</Th>
              <Th className="text-right">Fill rate %</Th>
              <Th className="text-right">YTD spend</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {rows.map((r) => {
              const kpi = kpiByKpiId.get(r.id);
              const cat = r.category ? CATEGORY_META[r.category] : null;
              const status = STATUS_META[r.status];
              return (
                <TRow key={r.id}>
                  <Td>
                    <div className="flex flex-col">
                      <Link to={`/suppliers/${r.id}`} className="font-medium text-brand-700 hover:underline">
                        {r.name}
                      </Link>
                      {r.star_rating != null && <StarRating value={r.star_rating} />}
                    </div>
                  </Td>
                  <Td>
                    {cat ? <Badge tone={cat.tone}>{cat.label}</Badge> : <span className="text-slate-400">—</span>}
                  </Td>
                  <Td className="text-slate-600 text-xs">{renderDeliveryDays(r.delivery_days)}</Td>
                  <Td className="text-slate-600 tabular-nums">{r.cutoff_time ?? <span className="text-slate-400">—</span>}</Td>
                  <Td className="text-right tabular-nums">{kpi?.on_time_pct != null ? `${kpi.on_time_pct}%` : '—'}</Td>
                  <Td className="text-right tabular-nums">{kpi?.fill_rate_pct != null ? `${kpi.fill_rate_pct}%` : '—'}</Td>
                  <Td className="text-right tabular-nums">{kpi ? usd(kpi.ytd_spend_cents) : '—'}</Td>
                  <Td><Badge tone={status.tone}>{status.label}</Badge></Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(r)}
                        className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-brand-600"
                        aria-label={`Edit ${r.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <a
                        href={`/api/v1/suppliers/${r.id}/price-list.csv`}
                        download
                        className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-brand-600"
                        aria-label="Download CSV"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    </div>
                  </Td>
                </TRow>
              );
            })}
          </tbody>
        </Table>
        {rows.length === 0 && (
          <div className="p-6">
            <EmptyState
              icon={<Truck className="h-6 w-6" />}
              title="No suppliers yet"
              hint="Add the vendors that fulfill your orders to start tracking deliveries."
            />
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => { setCreateOpen(false); setEditing(null); }}
        title={editing ? `Edit ${editing.name}` : 'New supplier'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" type="button" onClick={() => { setCreateOpen(false); setEditing(null); }}>Cancel</Button>
            <Button type="submit" form="supplier-form">{editing ? 'Save' : 'Create supplier'}</Button>
          </>
        }
      >
        <form id="supplier-form" onSubmit={handleSave} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name" required className="sm:col-span-2">
            <Input name="name" required defaultValue={editing?.name ?? ''} placeholder="e.g. US Foods" />
          </Field>
          <Field label="Category">
            <Select name="category" defaultValue={editing?.category ?? ''}>
              <option value="">—</option>
              {(Object.keys(CATEGORY_META) as SupplierCategory[]).map((c) => (
                <option key={c} value={c}>{CATEGORY_META[c].label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select name="status" defaultValue={editing?.status ?? 'active'}>
              {(Object.keys(STATUS_META) as SupplierStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_META[s].label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Contact name">
            <Input name="contact_name" defaultValue={editing?.contact_name ?? ''} placeholder="Account rep" />
          </Field>
          <Field label="Email">
            <Input name="email" type="email" defaultValue={editing?.email ?? ''} placeholder="rep@vendor.com" />
          </Field>
          <Field label="Phone">
            <Input name="phone" defaultValue={editing?.phone ?? ''} placeholder="(555) 555-0100" />
          </Field>
          <Field label="Lead time (days)" hint="Order-to-delivery SLA">
            <Input name="lead_time_days" type="number" min={0} defaultValue={editing?.lead_time_days ?? 1} />
          </Field>
          <Field label="Star rating" hint="0 — 5">
            <Input name="star_rating" type="number" min={0} max={5} step={0.5} defaultValue={editing?.star_rating ?? ''} />
          </Field>
          <Field label="Cutoff time" hint="HH:mm local">
            <Input name="cutoff_time" type="time" defaultValue={editing?.cutoff_time ?? ''} />
          </Field>
          <Field label="Delivery days" className="sm:col-span-2">
            <div className="flex flex-wrap gap-2">
              {DOW_SHORT.map((label, i) => (
                <label key={i} className="flex items-center gap-1 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    name={`dow-${i}`}
                    defaultChecked={editing?.delivery_days.includes(i) ?? false}
                    className="rounded border-slate-300"
                  />
                  {label}
                </label>
              ))}
            </div>
          </Field>
        </form>
      </Modal>
    </>
  );
}

// TASK-037 — /suppliers list + add.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Truck, Mail, Phone, Clock } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Button } from '../components/ui/Button.js';
import { Card } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Input, Field } from '../components/ui/Input.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';

interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  lead_time_days: number;
  is_active: boolean;
}

export default function SuppliersPage() {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<Supplier[]>('/api/v1/suppliers');
    if (res.error) setError(res.error.message);
    else { setError(null); setRows(res.data ?? []); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      name: String(form.get('name') ?? ''),
      contact_name: String(form.get('contact_name') ?? '') || null,
      email: String(form.get('email') ?? '') || null,
      phone: String(form.get('phone') ?? '') || null,
      lead_time_days: Number(form.get('lead_time_days') ?? 1),
    };
    const res = await apiFetch<Supplier>('/api/v1/suppliers', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (res.error) { setError(res.error.message); return; }
    setCreating(false);
    void load();
  }

  async function deactivate(id: string) {
    const res = await apiFetch(`/api/v1/suppliers/${id}/deactivate`, { method: 'POST' });
    if (res.error) setError(res.error.message);
    else void load();
  }

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Vendors and purveyors that fulfill your ingredient orders."
        actions={
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : 'New supplier'}
          </Button>
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {creating && (
        <Card className="mb-4">
          <form onSubmit={onCreate}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="Name" required className="lg:col-span-2">
                <Input name="name" required placeholder="e.g. US Foods" />
              </Field>
              <Field label="Lead time (days)" hint="Order-to-delivery SLA">
                <Input name="lead_time_days" type="number" defaultValue={1} min={0} />
              </Field>
              <Field label="Contact name">
                <Input name="contact_name" placeholder="Account rep" />
              </Field>
              <Field label="Email">
                <Input name="email" type="email" placeholder="rep@vendor.com" />
              </Field>
              <Field label="Phone">
                <Input name="phone" placeholder="(555) 555-0100" />
              </Field>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Button type="submit">Create supplier</Button>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Contact</Th>
              <Th>Email</Th>
              <Th>Phone</Th>
              <Th className="text-right">Lead time</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {rows.map((r) => (
              <TRow key={r.id}>
                <Td className="font-medium text-slate-900">
                  <Link to={`/suppliers/${r.id}`} className="text-brand-700 hover:underline">{r.name}</Link>
                </Td>
                <Td className="text-slate-600">{r.contact_name ?? <span className="text-slate-400">—</span>}</Td>
                <Td className="text-slate-600">
                  {r.email
                    ? <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 hover:text-brand-600"><Mail className="h-3.5 w-3.5" />{r.email}</a>
                    : <span className="text-slate-400">—</span>}
                </Td>
                <Td className="text-slate-600">
                  {r.phone
                    ? <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5 text-slate-400" />{r.phone}</span>
                    : <span className="text-slate-400">—</span>}
                </Td>
                <Td className="text-right tabular-nums text-slate-600">
                  <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-slate-400" />{r.lead_time_days}d</span>
                </Td>
                <Td>
                  <Badge tone={r.is_active ? 'success' : 'neutral'}>
                    {r.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </Td>
                <Td className="text-right">
                  {r.is_active && (
                    <Button variant="ghost" size="sm" onClick={() => void deactivate(r.id)}>
                      Deactivate
                    </Button>
                  )}
                </Td>
              </TRow>
            ))}
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
    </>
  );
}

// TASK-042 — /recipes list + create.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Archive as ArchiveIcon, UtensilsCrossed } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Button } from '../components/ui/Button.js';
import { Card } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Input, Select, Field } from '../components/ui/Input.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';
import { cn } from '../components/ui/cn.js';

interface Recipe {
  id: string;
  type: 'prep' | 'menu';
  name: string;
  is_archived: boolean;
  created_at: string;
}

type Filter = 'all' | 'prep' | 'menu';
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all',  label: 'All' },
  { key: 'menu', label: 'Menu items' },
  { key: 'prep', label: 'Prep' },
];

export default function RecipesPage() {
  const [rows, setRows] = useState<Recipe[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (filter !== 'all') qs.set('type', filter);
    if (search) qs.set('search', search);
    const res = await apiFetch<Recipe[]>(`/api/v1/recipes${qs.toString() ? '?' + qs : ''}`);
    if (res.error) setError(res.error.message); else { setError(null); setRows(res.data ?? []); }
  }, [filter, search]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    all:  rows.length,
    menu: rows.filter((r) => r.type === 'menu').length,
    prep: rows.filter((r) => r.type === 'prep').length,
  }), [rows]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      type: String(form.get('type') ?? 'prep') as 'prep' | 'menu',
      name: String(form.get('name') ?? ''),
      initial_version: {
        yield_qty: Number(form.get('yield_qty') ?? 1),
        yield_uom: String(form.get('yield_uom') ?? 'each'),
        lines: [],
      },
    };
    const res = await apiFetch('/api/v1/recipes', { method: 'POST', body: JSON.stringify(body) });
    if (res.error) { setError(res.error.message); return; }
    setCreating(false);
    void load();
  }

  async function archive(id: string) {
    const res = await apiFetch(`/api/v1/recipes/${id}/archive`, { method: 'POST' });
    if (res.error) setError(res.error.message); else void load();
  }

  return (
    <>
      <PageHeader
        title="Recipes"
        description="Menu items and prep recipes with versioned procedures and plated cost."
        actions={
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : 'New recipe'}
          </Button>
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card padded={false} className="mb-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-4 border-b border-surface-border">
          <div className="flex items-center gap-1">
            {FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    active
                      ? 'bg-brand-50 text-brand-700 border border-brand-200'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent',
                  )}
                >
                  {f.label}
                  <Badge tone={active ? 'brand' : 'neutral'}>{counts[f.key]}</Badge>
                </button>
              );
            })}
          </div>
          <div className="flex-1 relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="search"
              placeholder="Search recipes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-surface-border bg-white pl-8 pr-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
        </div>

        {creating && (
          <form onSubmit={onCreate} className="p-5 border-b border-surface-border bg-slate-50">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="Name" required className="lg:col-span-2">
                <Input name="name" required placeholder="e.g. House marinara" />
              </Field>
              <Field label="Type">
                <Select name="type" defaultValue="prep">
                  <option value="prep">Prep</option>
                  <option value="menu">Menu item</option>
                </Select>
              </Field>
              <Field label="Yield">
                <div className="flex gap-2">
                  <Input name="yield_qty" type="number" step="0.01" defaultValue={1} className="w-24" />
                  <Input name="yield_uom" defaultValue="each" />
                </div>
              </Field>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Button type="submit">Create recipe</Button>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            </div>
          </form>
        )}

        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Created</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {rows.map((r) => (
              <TRow key={r.id}>
                <Td className="font-medium text-slate-900">
                  <Link to={`/recipes/${r.id}`} className="hover:text-brand-600 hover:underline">{r.name}</Link>
                </Td>
                <Td>
                  <Badge tone={r.type === 'menu' ? 'brand' : 'info'}>{r.type}</Badge>
                </Td>
                <Td className="text-slate-500">{r.created_at.slice(0, 10)}</Td>
                <Td className="text-right">
                  <Button
                    variant="ghost" size="sm"
                    leftIcon={<ArchiveIcon className="h-3.5 w-3.5" />}
                    onClick={() => void archive(r.id)}
                  >
                    Archive
                  </Button>
                </Td>
              </TRow>
            ))}
          </tbody>
        </Table>
        {rows.length === 0 && (
          <div className="p-6">
            <EmptyState
              icon={<UtensilsCrossed className="h-6 w-6" />}
              title="No recipes yet"
              hint="Create your first recipe to start costing menu items."
            />
          </div>
        )}
      </Card>
    </>
  );
}

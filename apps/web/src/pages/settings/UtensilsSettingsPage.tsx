// TASK-037 — /settings/utensils (PARTIAL).

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../auth/api.js';

interface Utensil {
  id: string; name: string; kind: string;
  default_uom: string; default_qty: number;
  label_colour: string | null; is_archived: boolean;
}
const KINDS = ['scoop', 'ladle', 'bag', 'spoon', 'cap'] as const;

export default function UtensilsSettingsPage() {
  const [rows, setRows] = useState<Utensil[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<Utensil[]>('/api/v1/settings/utensils');
    if (res.error) setError(res.error.message); else setRows(res.data ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      name: String(form.get('name') ?? ''),
      kind: String(form.get('kind') ?? 'scoop'),
      default_uom: String(form.get('default_uom') ?? 'oz'),
      default_qty: Number(form.get('default_qty') ?? 1),
      label_colour: String(form.get('label_colour') ?? '') || null,
    };
    const res = await apiFetch('/api/v1/settings/utensils', { method: 'POST', body: JSON.stringify(body) });
    if (res.error) setError(res.error.message);
    else { (e.target as HTMLFormElement).reset(); void load(); }
  }

  async function archive(id: string) {
    const res = await apiFetch(`/api/v1/settings/utensils/${id}/archive`, { method: 'POST' });
    if (res.error) setError(res.error.message); else void load();
  }

  return (
    <>
      <h1>Portion utensils</h1>
      <form onSubmit={onCreate} style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto', marginBottom: '1rem' }}>
        <input name="name" placeholder="Name (e.g. Blue Scoop)" required />
        <select name="kind" defaultValue="scoop">
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input name="default_uom" defaultValue="oz" />
        <input name="default_qty" type="number" step="0.01" defaultValue={2} />
        <input name="label_colour" placeholder="Colour" />
        <button type="submit">Add</button>
      </form>
      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
          <th>Name</th><th>Kind</th><th>Default</th><th>Colour</th><th />
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
              <td>{r.name}</td>
              <td>{r.kind}</td>
              <td>{r.default_qty} {r.default_uom}</td>
              <td>{r.label_colour ?? '—'}</td>
              <td style={{ textAlign: 'right' }}>
                <button type="button" onClick={() => void archive(r.id)}>Archive</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

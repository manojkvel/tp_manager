// TASK-037 — /settings/locations (PARTIAL).

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../auth/api.js';

interface Location { id: string; name: string; kind: string; is_archived: boolean }
const KINDS = ['dry', 'cold', 'freezer', 'bar', 'prep'] as const;

export default function LocationsSettingsPage() {
  const [rows, setRows] = useState<Location[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<Location[]>('/api/v1/settings/locations');
    if (res.error) setError(res.error.message); else setRows(res.data ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = { name: String(form.get('name') ?? ''), kind: String(form.get('kind') ?? 'dry') };
    const res = await apiFetch('/api/v1/settings/locations', { method: 'POST', body: JSON.stringify(body) });
    if (res.error) setError(res.error.message);
    else { (e.target as HTMLFormElement).reset(); void load(); }
  }

  async function archive(id: string) {
    const res = await apiFetch(`/api/v1/settings/locations/${id}/archive`, { method: 'POST' });
    if (res.error) setError(res.error.message); else void load();
  }

  return (
    <>
      <h1>Locations</h1>
      <form onSubmit={onCreate} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input name="name" placeholder="Name" required />
        <select name="kind" defaultValue="dry">
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button type="submit">Add</button>
      </form>
      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {rows.map((r) => (
          <li key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #eee' }}>
            <span>{r.name} <small style={{ color: '#888' }}>({r.kind})</small></span>
            <button type="button" onClick={() => void archive(r.id)}>Archive</button>
          </li>
        ))}
      </ul>
    </>
  );
}

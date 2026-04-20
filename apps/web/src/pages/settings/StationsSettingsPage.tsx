// §6.11 — /settings/stations: editable kitchen stations catalogue.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../auth/api.js';

interface Station {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  is_archived: boolean;
}

export default function StationsSettingsPage() {
  const [rows, setRows] = useState<Station[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await apiFetch<Station[]>('/api/v1/settings/stations');
    if (res.error) setError(res.error.message); else setRows(res.data ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const sortRaw = String(form.get('sort_order') ?? '').trim();
    const body = {
      code: String(form.get('code') ?? ''),
      label: String(form.get('label') ?? ''),
      sort_order: sortRaw ? Number(sortRaw) : 0,
    };
    const res = await apiFetch<Station>('/api/v1/settings/stations', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (res.error) setError(res.error.message);
    else { (e.target as HTMLFormElement).reset(); void load(); }
  }

  async function saveEdit(id: string, label: string, sort_order: number) {
    setError(null);
    const res = await apiFetch<Station>(`/api/v1/settings/stations/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ label, sort_order }),
    });
    if (res.error) setError(res.error.message);
    else { setEditingId(null); void load(); }
  }

  async function archive(id: string) {
    setError(null);
    const res = await apiFetch(`/api/v1/settings/stations/${id}/archive`, { method: 'POST' });
    if (res.error) setError(res.error.message); else void load();
  }

  return (
    <>
      <h1>Kitchen stations</h1>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        The station code (e.g. <code>egg</code>) is what recipe lines reference. Renaming a station's
        label is safe — recipe history continues to point at the same code.
      </p>
      <form onSubmit={onCreate} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input name="code" placeholder="code (e.g. grill)" required style={{ width: 160 }} />
        <input name="label" placeholder="Label" required style={{ flex: 1 }} />
        <input name="sort_order" placeholder="Sort" type="number" defaultValue={0} style={{ width: 70 }} />
        <button type="submit">Add</button>
      </form>
      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {rows.map((r) => (
          <li
            key={r.id}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '0.5rem 0', borderBottom: '1px solid #eee',
            }}
          >
            {editingId === r.id ? (
              <EditRow
                row={r}
                onCancel={() => setEditingId(null)}
                onSave={(label, sort) => void saveEdit(r.id, label, sort)}
              />
            ) : (
              <>
                <span>
                  <code>{r.code}</code> — {r.label}
                  <span style={{ color: '#888', marginLeft: '0.5rem', fontSize: '0.8rem' }}>(sort {r.sort_order})</span>
                </span>
                <span style={{ display: 'flex', gap: '0.4rem' }}>
                  <button type="button" onClick={() => setEditingId(r.id)}>Edit</button>
                  <button type="button" onClick={() => void archive(r.id)}>Archive</button>
                </span>
              </>
            )}
          </li>
        ))}
        {rows.length === 0 && <li style={{ color: '#888' }}>No stations yet.</li>}
      </ul>
    </>
  );
}

function EditRow({
  row, onSave, onCancel,
}: {
  row: Station;
  onSave: (label: string, sort_order: number) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(row.label);
  const [sortOrder, setSortOrder] = useState(row.sort_order);
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave(label, sortOrder); }}
      style={{ display: 'flex', gap: '0.4rem', flex: 1 }}
    >
      <code style={{ alignSelf: 'center' }}>{row.code}</code>
      <input value={label} onChange={(e) => setLabel(e.target.value)} required style={{ flex: 1 }} />
      <input
        type="number"
        value={sortOrder}
        onChange={(e) => setSortOrder(Number(e.target.value))}
        style={{ width: 70 }}
      />
      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>Cancel</button>
    </form>
  );
}

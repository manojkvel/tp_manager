// TASK-037 — /settings/waste-reasons (PARTIAL).

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../auth/api.js';

interface WasteReason { id: string; code: string; label: string; is_archived: boolean }

export default function WasteReasonsSettingsPage() {
  const [rows, setRows] = useState<WasteReason[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<WasteReason[]>('/api/v1/settings/waste-reasons');
    if (res.error) setError(res.error.message); else setRows(res.data ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = { code: String(form.get('code') ?? ''), label: String(form.get('label') ?? '') };
    const res = await apiFetch('/api/v1/settings/waste-reasons', { method: 'POST', body: JSON.stringify(body) });
    if (res.error) setError(res.error.message);
    else { (e.target as HTMLFormElement).reset(); void load(); }
  }

  async function archive(id: string) {
    const res = await apiFetch(`/api/v1/settings/waste-reasons/${id}/archive`, { method: 'POST' });
    if (res.error) setError(res.error.message); else void load();
  }

  return (
    <>
      <h1>Waste reasons</h1>
      <form onSubmit={onCreate} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input name="code" placeholder="CODE" required style={{ width: 120 }} />
        <input name="label" placeholder="Label" required style={{ flex: 1 }} />
        <button type="submit">Add</button>
      </form>
      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {rows.map((r) => (
          <li key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #eee' }}>
            <span><code>{r.code}</code> — {r.label}</span>
            <button type="button" onClick={() => void archive(r.id)}>Archive</button>
          </li>
        ))}
      </ul>
    </>
  );
}

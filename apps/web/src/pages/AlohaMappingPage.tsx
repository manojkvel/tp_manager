// TASK-067 — Aloha mapping UI: menu map, modifier map, reconciliation queue (§6.12a AC-5/7).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../auth/api.js';

interface ReconItem {
  id: string; aloha_item_name: string; row_kind: string;
  first_seen_on: string; occurrences: number; resolved: boolean;
}

interface RecipeOpt { id: string; name: string }

export default function AlohaMappingPage() {
  const [queue, setQueue] = useState<ReconItem[]>([]);
  const [recipes, setRecipes] = useState<RecipeOpt[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const [q, r] = await Promise.all([
      apiFetch<ReconItem[]>('/api/v1/aloha/reconciliation'),
      apiFetch<RecipeOpt[]>('/api/v1/recipes'),
    ]);
    if (q.error) setErr(q.error.message);
    else setQueue(q.data ?? []);
    if (r.data) setRecipes(r.data);
  };

  useEffect(() => { void load(); }, []);

  async function mapItem(item: ReconItem, menu_recipe_id: string) {
    if (!menu_recipe_id) return;
    setBusy(item.id);
    const res = await apiFetch('/api/v1/aloha/map/menu', {
      method: 'POST',
      body: JSON.stringify({
        aloha_item_name: item.aloha_item_name,
        menu_recipe_id,
        effective_from: new Date().toISOString().slice(0, 10),
      }),
    });
    setBusy(null);
    if (res.error) { setErr(res.error.message); return; }
    await load();
  }

  return (
    <>
      <h1>Aloha Mapping</h1>
      <p style={{ color: '#666' }}>Items from the POS feed that don't yet resolve to a recipe or modifier.</p>
      {err && <p role="alert" style={{ color: 'crimson' }}>{err}</p>}

      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={th}>Aloha name</th><th style={th}>Kind</th>
            <th style={th}>First seen</th><th style={th}># seen</th><th style={th}>Map to</th>
          </tr>
        </thead>
        <tbody>
          {queue.map((it) => (
            <tr key={it.id}>
              <td style={td}><strong>{it.aloha_item_name}</strong></td>
              <td style={td}>{it.row_kind}</td>
              <td style={td}>{it.first_seen_on.slice(0, 10)}</td>
              <td style={td}>{it.occurrences}</td>
              <td style={td}>
                {it.row_kind === 'item' ? (
                  <select
                    disabled={busy === it.id}
                    onChange={(e) => void mapItem(it, e.target.value)}
                    defaultValue=""
                  >
                    <option value="" disabled>Select recipe…</option>
                    {recipes.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                ) : (
                  <em style={{ color: '#888' }}>Use modifier form ↓</em>
                )}
              </td>
            </tr>
          ))}
          {queue.length === 0 && <tr><td colSpan={5} style={td}>Nothing pending.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

const th: React.CSSProperties = { textAlign: 'left', borderBottom: '2px solid #ddd', padding: '0.4rem 0.6rem' };
const td: React.CSSProperties = { padding: '0.3rem 0.6rem', borderBottom: '1px solid #eee' };

// TASK-042 — /recipes/station/:station (§6.3b).
//
// Printable station view. On-demand "Print" opens the browser print dialog
// which produces a PDF via Save as PDF — @react-pdf/renderer is deferred until
// wave 6 when the detail layout is settled (PARTIAL).

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../auth/api.js';

interface StationRow {
  recipe_id: string;
  recipe_name: string;
  step_order: number | null;
  line: {
    id: string;
    ingredient_id: string | null;
    ref_recipe_id: string | null;
    qty: number;
    qty_text: string | null;
    uom: string | null;
    note: string | null;
  };
}

export default function StationViewPage() {
  const { station } = useParams<{ station: string }>();
  const [rows, setRows] = useState<StationRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!station) return;
    const res = await apiFetch<StationRow[]>(`/api/v1/recipes/station/${encodeURIComponent(station)}`);
    if (res.error) setError(res.error.message); else setRows(res.data ?? []);
  }, [station]);

  useEffect(() => { void load(); }, [load]);

  const grouped = rows.reduce<Record<string, StationRow[]>>((acc, r) => {
    (acc[r.recipe_name] ??= []).push(r);
    return acc;
  }, {});

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '1.5rem', maxWidth: 900 }}>
      <p className="no-print"><Link to="/recipes">← Recipes</Link></p>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
        <h1>Station: {station}</h1>
        <span className="no-print" style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" onClick={() => window.print()}>Print this view</button>
          <a href={`/api/v1/recipes/station/${encodeURIComponent(station ?? '')}/pdf`} target="_blank" rel="noreferrer">
            4-up cheat sheet ↗
          </a>
        </span>
      </header>
      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}
      {Object.keys(grouped).length === 0 && <p style={{ color: '#888' }}>No lines for this station.</p>}
      {Object.entries(grouped).map(([name, items]) => (
        <section key={name} style={{ marginBottom: '1.5rem', border: '1px solid #ccc', padding: '1rem' }}>
          <h2>{name}</h2>
          <ol>
            {items.map((r) => (
              <li key={r.line.id}>
                <strong>{r.line.qty_text ?? r.line.qty} {r.line.uom ?? ''}</strong>{' '}
                {r.line.note ? <em>— {r.line.note}</em> : null}
              </li>
            ))}
          </ol>
        </section>
      ))}
      <style>{`@media print { .no-print { display: none; } }`}</style>
    </main>
  );
}

// GAP-05 — Forecast overrides UI (§6.12b AC-5).
//
// Owner / kitchen lead captures advisory-forecast overrides — expected qty (model
// output) + override qty (human number) + reason. Once the day passes, the actual
// qty is recorded so Phase 2 can use these tuples as a learning signal for when
// humans systematically disagree with the model.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../auth/api.js';

type EntityType = 'recipe' | 'ingredient';

interface OverrideRow {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  target_date: string;
  expected_qty: number;
  override_qty: number;
  actual_qty: number | null;
  reason: string | null;
  user_id: string | null;
  at: string;
}

interface CaptureForm {
  entity_type: EntityType;
  entity_id: string;
  target_date: string;
  expected_qty: string;
  override_qty: string;
  reason: string;
}

const EMPTY_FORM: CaptureForm = {
  entity_type: 'recipe',
  entity_id: '',
  target_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10),
  expected_qty: '',
  override_qty: '',
  reason: '',
};

export default function ForecastOverridesPage() {
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [form, setForm] = useState<CaptureForm>(EMPTY_FORM);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<OverrideRow[]>('/api/v1/forecasts/overrides');
    if (res.error) setErr(res.error.message);
    else setRows(res.data ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const expected = Number(form.expected_qty);
    const override = Number(form.override_qty);
    if (!form.entity_id || !Number.isFinite(expected) || !Number.isFinite(override)) {
      setErr('entity_id, expected_qty, and override_qty are required');
      return;
    }
    const res = await apiFetch<OverrideRow>('/api/v1/forecasts/override', {
      method: 'POST',
      body: JSON.stringify({
        entity_type: form.entity_type,
        entity_id: form.entity_id.trim(),
        target_date: form.target_date,
        expected_qty: expected,
        override_qty: override,
        reason: form.reason.trim() || undefined,
      }),
    });
    if (res.error) { setErr(res.error.message); return; }
    setForm(EMPTY_FORM);
    void load();
  }

  async function recordActual(row: OverrideRow) {
    const raw = window.prompt(`Actual qty for ${row.entity_id} on ${row.target_date}?`);
    if (raw == null) return;
    const actual = Number(raw);
    if (!Number.isFinite(actual) || actual < 0) {
      setErr('actual_qty must be a non-negative number');
      return;
    }
    const res = await apiFetch<OverrideRow>(`/api/v1/forecasts/overrides/${row.id}/actual`, {
      method: 'PATCH',
      body: JSON.stringify({ actual_qty: actual }),
    });
    if (res.error) setErr(res.error.message);
    else void load();
  }

  return (
    <>
      <h1>Forecast Overrides</h1>
      <p style={{ color: '#555', maxWidth: 720 }}>
        Capture when you choose a different prep quantity than the advisory forecast.
        These tuples drive the Phase-2 learning signal — record the actual quantity
        used after service so the model can learn when humans systematically diverge.
      </p>
      {err && <p role="alert" style={{ color: 'crimson' }}>{err}</p>}

      <section style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #ddd', borderRadius: 6 }}>
        <h2 style={{ marginTop: 0 }}>New override</h2>
        <form onSubmit={(e) => void submit(e)} style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          <label>
            Entity type
            <select
              value={form.entity_type}
              onChange={(e) => setForm({ ...form, entity_type: e.target.value as EntityType })}
              style={input}
            >
              <option value="recipe">recipe</option>
              <option value="ingredient">ingredient</option>
            </select>
          </label>
          <label>
            Entity id
            <input
              value={form.entity_id}
              onChange={(e) => setForm({ ...form, entity_id: e.target.value })}
              placeholder="uuid"
              required
              style={input}
            />
          </label>
          <label>
            Target date
            <input
              type="date"
              value={form.target_date}
              onChange={(e) => setForm({ ...form, target_date: e.target.value })}
              required
              style={input}
            />
          </label>
          <label>
            Expected (model)
            <input
              type="number"
              step="0.1"
              min="0"
              value={form.expected_qty}
              onChange={(e) => setForm({ ...form, expected_qty: e.target.value })}
              required
              style={input}
            />
          </label>
          <label>
            Override (human)
            <input
              type="number"
              step="0.1"
              min="0"
              value={form.override_qty}
              onChange={(e) => setForm({ ...form, override_qty: e.target.value })}
              required
              style={input}
            />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Reason (optional)
            <input
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="e.g. catering buyout, weather"
              style={input}
            />
          </label>
          <div style={{ gridColumn: '1 / -1' }}>
            <button type="submit" style={{ padding: '0.5rem 1rem' }}>Save override</button>
          </div>
        </form>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Recent overrides</h2>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={th}>Date</th><th style={th}>Type</th><th style={th}>Entity</th>
              <th style={th}>Expected</th><th style={th}>Override</th><th style={th}>Δ</th>
              <th style={th}>Actual</th><th style={th}>Reason</th><th style={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const delta = r.override_qty - r.expected_qty;
              return (
                <tr key={r.id}>
                  <td style={td}>{r.target_date}</td>
                  <td style={td}>{r.entity_type}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: '0.85em' }}>{r.entity_id.slice(0, 8)}</td>
                  <td style={td}>{r.expected_qty.toFixed(1)}</td>
                  <td style={td}>{r.override_qty.toFixed(1)}</td>
                  <td style={{ ...td, color: delta > 0 ? '#1a5d1a' : delta < 0 ? '#a00' : 'inherit' }}>
                    {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                  </td>
                  <td style={td}>{r.actual_qty != null ? r.actual_qty.toFixed(1) : '—'}</td>
                  <td style={td}>{r.reason ?? ''}</td>
                  <td style={td}>
                    {r.actual_qty == null && (
                      <button type="button" onClick={() => void recordActual(r)}>Record actual</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={9} style={td}>No overrides captured yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}

const th: React.CSSProperties = { textAlign: 'left', borderBottom: '2px solid #ddd', padding: '0.4rem 0.6rem' };
const td: React.CSSProperties = { padding: '0.3rem 0.6rem', borderBottom: '1px solid #eee' };
const input: React.CSSProperties = { display: 'block', width: '100%', padding: '0.35rem 0.5rem', marginTop: '0.25rem', boxSizing: 'border-box' };

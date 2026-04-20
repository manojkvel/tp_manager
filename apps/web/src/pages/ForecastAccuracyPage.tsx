// TASK-078 — /reports/forecast-accuracy: model holdout MAPE per SKU over time.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../auth/api.js';

interface AccuracyRow {
  entity_type: string;
  entity_id: string;
  entity_name: string;
  algorithm: string;
  holdout_mape: number | null;
  trained_at: string;
}

export default function ForecastAccuracyPage() {
  const [rows, setRows] = useState<AccuracyRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await apiFetch<AccuracyRow[]>('/api/v1/forecasts/accuracy');
      if (res.error) setErr(res.error.message);
      else setRows(res.data ?? []);
    })();
  }, []);

  const avgMape = rows.filter((r) => r.holdout_mape != null)
    .reduce((s, r, _, arr) => s + (r.holdout_mape ?? 0) / arr.length, 0);

  return (
    <>
      <h1>Forecast Accuracy</h1>
      {err && <p role="alert" style={{ color: 'crimson' }}>{err}</p>}
      <p>Average holdout MAPE: <strong>{avgMape.toFixed(1)}%</strong></p>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={th}>Kind</th><th style={th}>Item</th>
            <th style={th}>Algorithm</th><th style={th}>MAPE</th><th style={th}>Trained</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.entity_type}:${r.entity_id}`}>
              <td style={td}>{r.entity_type}</td>
              <td style={td}>{r.entity_name}</td>
              <td style={td}>{r.algorithm}</td>
              <td style={td}>{r.holdout_mape != null ? `${r.holdout_mape.toFixed(1)}%` : '—'}</td>
              <td style={td}>{r.trained_at.slice(0, 10)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} style={td}>No trained models yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

const th: React.CSSProperties = { textAlign: 'left', borderBottom: '2px solid #ddd', padding: '0.4rem 0.6rem' };
const td: React.CSSProperties = { padding: '0.3rem 0.6rem', borderBottom: '1px solid #eee' };

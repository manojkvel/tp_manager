// TASK-061 — /settings/migration (§6.14 AC-4..7).

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../auth/api.js';

interface StagedBatch {
  id: string;
  source_file: string;
  parser_version: string;
  staged_at: string;
  status: 'staged' | 'approved' | 'rolled_back';
  approved_at: string | null;
}

interface FieldAgreement { field: string; probe: string; candidate: string; score: number }
interface MatchCandidate { id: string; score: number; agreements: FieldAgreement[] }

interface StagedItem {
  id: string;
  kind: string;
  probe: { name: string; uom?: string | null };
  bucket: 'new' | 'matched' | 'ambiguous' | 'unmapped';
  matches: MatchCandidate[];
  decision: 'pending' | 'accept_new' | 'merge' | 'reject';
  decision_target_id: string | null;
}

export default function MigrationReviewPage() {
  const [batches, setBatches] = useState<StagedBatch[]>([]);
  const [active, setActive] = useState<{ batch: StagedBatch; items: StagedItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const res = await apiFetch<StagedBatch[]>('/api/v1/migration/batches');
    if (res.error) { setError(res.error.message); return; }
    setBatches(res.data ?? []);
  }, []);

  const open = useCallback(async (id: string) => {
    const res = await apiFetch<{ batch: StagedBatch; items: StagedItem[] }>(`/api/v1/migration/batches/${id}`);
    if (res.error) { setError(res.error.message); return; }
    setActive(res.data ?? null);
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  async function decide(item_id: string, decision: 'accept_new' | 'merge' | 'reject', target_id?: string) {
    if (!active) return;
    const res = await apiFetch(`/api/v1/migration/batches/${active.batch.id}/items/${item_id}/decision`, {
      method: 'POST', body: JSON.stringify({ decision, target_id: target_id ?? null }),
    });
    if (res.error) { setError(res.error.message); return; }
    void open(active.batch.id);
  }

  async function approve() {
    if (!active) return;
    const res = await apiFetch(`/api/v1/migration/batches/${active.batch.id}/approve`, { method: 'POST', body: JSON.stringify({}) });
    if (res.error) { setError(res.error.message); return; }
    await loadList();
    void open(active.batch.id);
  }

  async function rollback() {
    if (!active) return;
    if (!window.confirm('Roll back this approved batch?')) return;
    const res = await apiFetch(`/api/v1/migration/batches/${active.batch.id}/rollback`, { method: 'POST', body: JSON.stringify({}) });
    if (res.error) { setError(res.error.message); return; }
    await loadList();
    void open(active.batch.id);
  }

  const buckets = active?.items.reduce<Record<string, StagedItem[]>>((acc, item) => {
    (acc[item.bucket] ??= []).push(item);
    return acc;
  }, {}) ?? {};

  return (
    <>
      <h1>Migration Review</h1>
      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}

      <section style={{ display: 'flex', gap: '2rem' }}>
        <aside style={{ flex: '0 0 260px' }}>
          <h2>Batches</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {batches.map((b) => (
              <li key={b.id} style={{ marginBottom: '0.5rem' }}>
                <button type="button" onClick={() => void open(b.id)} style={{ textAlign: 'left', width: '100%' }}>
                  <code>{b.id.slice(0, 8)}</code> — {b.source_file}<br />
                  <small>{b.status} • {b.staged_at.slice(0, 10)}</small>
                </button>
              </li>
            ))}
            {batches.length === 0 && <li style={{ color: '#888' }}>No batches.</li>}
          </ul>
        </aside>

        <section style={{ flex: 1 }}>
          {!active && <p style={{ color: '#888' }}>Select a batch to review.</p>}
          {active && (
            <>
              <h2>{active.batch.source_file} <small>({active.batch.status})</small></h2>
              {active.batch.status === 'staged' && (
                <button type="button" onClick={() => void approve()}>Approve all</button>
              )}
              {active.batch.status === 'approved' && (
                <button type="button" onClick={() => void rollback()}>Rollback</button>
              )}
              {(['new', 'matched', 'ambiguous', 'unmapped'] as const).map((bucket) => (
                <div key={bucket} style={{ marginTop: '1rem' }}>
                  <h3>{bucket} ({(buckets[bucket] ?? []).length})</h3>
                  {(buckets[bucket] ?? []).map((item) => (
                    <article key={item.id} style={{ border: '1px solid #ddd', padding: '0.75rem', marginBottom: '0.5rem' }}>
                      <strong>{item.probe.name}</strong> {item.probe.uom ? `(${item.probe.uom})` : ''} — decision: <em>{item.decision}</em>
                      {item.matches.length > 0 && (
                        <details style={{ marginTop: '0.25rem' }}>
                          <summary>Why this match?</summary>
                          <ul>
                            {item.matches.slice(0, 3).map((m) => (
                              <li key={m.id}>
                                <code>{m.id.slice(0, 8)}</code> score {(m.score * 100).toFixed(0)}%
                                <ul>
                                  {m.agreements.map((a, i) => (
                                    <li key={i}>{a.field}: {a.probe} ↔ {a.candidate} ({(a.score * 100).toFixed(0)}%)</li>
                                  ))}
                                </ul>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {active.batch.status === 'staged' && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <button type="button" onClick={() => void decide(item.id, 'accept_new')}>Accept new</button>{' '}
                          {item.matches.length > 0 && (
                            <button type="button" onClick={() => void decide(item.id, 'merge', item.matches[0]!.id)}>
                              Merge → {item.matches[0]!.id.slice(0, 8)}
                            </button>
                          )}{' '}
                          <button type="button" onClick={() => void decide(item.id, 'reject')}>Reject</button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              ))}
            </>
          )}
        </section>
      </section>
    </>
  );
}

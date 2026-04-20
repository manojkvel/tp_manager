// TASK-077 — Forecast proxy behaviour: graceful degradation on failures.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createForecastClient } from '../client.js';

describe('forecast-proxy client', () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('returns null when baseUrl is empty (graceful)', async () => {
    const client = createForecastClient({ baseUrl: '' });
    const out = await client.forecast('r', 'recipe', 'e', ['2026-05-01']);
    expect(out).toBeNull();
  });

  it('returns the ForecastResult on success', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({
        model_version: 'seasonal_naive@2026',
        algorithm: 'seasonal_naive',
        predictions: [{ target_date: '2026-05-01', point: 10, p10: 8, p90: 12, algorithm: 'seasonal_naive' }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch;

    const client = createForecastClient({ baseUrl: 'http://ml' });
    const out = await client.forecast('r', 'recipe', 'e', ['2026-05-01']);
    expect(out?.algorithm).toBe('seasonal_naive');
    expect(out?.predictions).toHaveLength(1);
  });

  it('returns null on 5xx (no throw)', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 503 })) as typeof fetch;
    const client = createForecastClient({ baseUrl: 'http://ml' });
    const out = await client.forecast('r', 'recipe', 'e', ['2026-05-01']);
    expect(out).toBeNull();
  });

  it('returns null on timeout / network error', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('econnrefused'); }) as typeof fetch;
    const client = createForecastClient({ baseUrl: 'http://ml' });
    const out = await client.forecast('r', 'recipe', 'e', ['2026-05-01']);
    expect(out).toBeNull();
  });
});

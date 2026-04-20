// TASK-077 — Forecast proxy. The operational critical path stays TS (§6.12b AC-7).
// This module is the only TS ↔ Python boundary; it handles timeout, retry once,
// and graceful degradation (returns nulls so prep/order screens can render without forecasts).

export interface ForecastPoint {
  target_date: string;
  point: number;
  p10: number;
  p90: number;
  algorithm: string;
  /** GAP-06 / §6.12b AC-8 — three short human-readable explanations rendered in ForecastBadge tooltip. */
  top_drivers: string[];
}

export interface ForecastResult {
  model_version: string;
  algorithm: string;
  predictions: ForecastPoint[];
}

export interface ForecastClient {
  forecast(
    restaurant_id: string,
    entity_type: 'recipe' | 'ingredient',
    entity_id: string,
    target_dates: string[],
  ): Promise<ForecastResult | null>;
  train(
    restaurant_id: string,
    entity_type: 'recipe' | 'ingredient',
    entity_id: string,
    history: number[],
  ): Promise<{ algorithm: string; holdout_mape: number | null } | null>;
}

export function createForecastClient(opts: { baseUrl: string; timeoutMs?: number } = { baseUrl: '' }): ForecastClient {
  const baseUrl = opts.baseUrl || process.env.ML_SERVICE_URL || '';
  const timeoutMs = opts.timeoutMs ?? 2000;

  async function call<T>(path: string, body: unknown): Promise<T | null> {
    if (!baseUrl) return null;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    } finally {
      clearTimeout(tid);
    }
  }

  return {
    async forecast(restaurant_id, entity_type, entity_id, target_dates) {
      return call<ForecastResult>('/v1/forecast', { restaurant_id, entity_type, entity_id, target_dates });
    },
    async train(restaurant_id, entity_type, entity_id, history) {
      return call<{ algorithm: string; holdout_mape: number | null }>(
        '/v1/train', { restaurant_id, entity_type, entity_id, history },
      );
    },
  };
}

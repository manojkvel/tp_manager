// v1.7 Wave 10 — OCR consumer.
//
// Polls the API for deliveries stuck in `ocr_status = 'processing'`, forwards
// the scanned invoice payload to the ML service's /v1/ocr/invoice endpoint,
// then patches the delivery back to `parsed` (with the extracted lines) or
// `failed` (with an error note).
//
// This module is imported by main.ts and only activates when both
// `API_URL` and `ML_URL` environment variables are present.

export interface OcrWorkerState { ticks: number; parsed: number; failed: number; last_tick_at: string }

export interface OcrDeliveryRef {
  id: string;
  restaurant_id: string;
  invoice_scan_url: string;
}

export interface ExtractedLine {
  raw_text: string;
  description: string | null;
  qty: number | null;
  unit_cost_cents: number | null;
}

interface MlOcrResponse { status: string; lines: ExtractedLine[]; raw_text: string | null }

export interface OcrDeps {
  apiUrl: string;
  mlUrl: string;
  serviceToken: string;
  fetchImpl?: typeof fetch;
}

async function listProcessing(deps: OcrDeps): Promise<OcrDeliveryRef[]> {
  const f = deps.fetchImpl ?? fetch;
  const res = await f(`${deps.apiUrl}/api/v1/internal/deliveries/ocr-queue`, {
    headers: { authorization: `Bearer ${deps.serviceToken}` },
  });
  if (!res.ok) return [];
  const body = await res.json() as { data?: OcrDeliveryRef[] };
  return body.data ?? [];
}

async function postOcrResult(
  deps: OcrDeps,
  ref: OcrDeliveryRef,
  status: 'parsed' | 'failed',
  lines: ExtractedLine[],
): Promise<void> {
  const f = deps.fetchImpl ?? fetch;
  await f(`${deps.apiUrl}/api/v1/internal/deliveries/${ref.id}/ocr-result`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${deps.serviceToken}`,
      'content-type': 'application/json',
      'x-restaurant-id': ref.restaurant_id,
    },
    body: JSON.stringify({ status, lines }),
  });
}

async function callMlOcr(deps: OcrDeps, ref: OcrDeliveryRef): Promise<MlOcrResponse> {
  const f = deps.fetchImpl ?? fetch;
  // The scan URL may be a data: URL (dev) or a signed MinIO URL (prod). In both
  // cases we fetch the bytes and forward them as base64 to the ML endpoint.
  const imageRes = await f(ref.invoice_scan_url);
  const buf = await imageRes.arrayBuffer();
  const b64 = Buffer.from(buf).toString('base64');
  const res = await f(`${deps.mlUrl}/v1/ocr/invoice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      restaurant_id: ref.restaurant_id,
      delivery_id: ref.id,
      image_base64: b64,
    }),
  });
  if (!res.ok) throw new Error(`ml responded ${res.status}`);
  return res.json() as Promise<MlOcrResponse>;
}

export async function ocrTick(deps: OcrDeps, state: OcrWorkerState): Promise<void> {
  state.ticks += 1;
  state.last_tick_at = new Date().toISOString();
  const queue = await listProcessing(deps);
  for (const ref of queue) {
    try {
      const result = await callMlOcr(deps, ref);
      const status = result.status === 'parsed' ? 'parsed' : 'failed';
      await postOcrResult(deps, ref, status, result.lines);
      if (status === 'parsed') state.parsed += 1; else state.failed += 1;
    } catch {
      state.failed += 1;
      await postOcrResult(deps, ref, 'failed', []).catch(() => undefined);
    }
  }
}

export function makeOcrState(): OcrWorkerState {
  return { ticks: 0, parsed: 0, failed: 0, last_tick_at: new Date(0).toISOString() };
}

export function resolveOcrDepsFromEnv(): OcrDeps | null {
  const apiUrl = process.env.API_URL;
  const mlUrl = process.env.ML_URL;
  const serviceToken = process.env.WORKER_API_TOKEN;
  if (!apiUrl || !mlUrl || !serviceToken) return null;
  return { apiUrl, mlUrl, serviceToken };
}

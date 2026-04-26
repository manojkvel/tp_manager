// v1.7 Wave 10 — internal OCR queue + result endpoints.
//
// The worker hits these with a shared SERVICE_TOKEN (no JWT), so we verify
// the bearer check and the write-back path without a live DB.

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  registerInternalDeliveryRoutes,
  type OcrQueueSource,
  type OcrQueueRef,
} from '../internal-routes.js';
import {
  DeliveriesService,
  type DeliveryRepo,
  type IngredientCostRepo,
  type Delivery,
  type DeliveryLine,
  type OcrStatus,
} from '../service.js';

const TOKEN = 'svc-test-token';
const RID = '11111111-1111-4111-8111-111111111111';

function inMemoryDeliveryRepo(initial: Delivery[]): { repo: DeliveryRepo; ocrUpdates: Array<{ id: string; status: OcrStatus; extracted: unknown }> } {
  const deliveries = new Map<string, Delivery>(initial.map((d) => [d.id, d]));
  const ocrUpdates: Array<{ id: string; status: OcrStatus; extracted: unknown }> = [];
  const repo: DeliveryRepo = {
    async findById(id) { return deliveries.get(id) ?? null; },
    async insert(row) { deliveries.set(row.id, row); },
    async updateStatus() { /* noop */ },
    async updateDiscrepancyCount() { /* noop */ },
    async attachInvoiceScan() { /* noop */ },
    async updateOcrStatus(id, status, extracted) {
      ocrUpdates.push({ id, status, extracted });
      const d = deliveries.get(id);
      if (d) deliveries.set(id, { ...d, ocr_status: status });
    },
    async listByRestaurant(rid) {
      return [...deliveries.values()].filter((d) => d.restaurant_id === rid);
    },
    async linesFor() { return []; },
    async insertLine() { /* noop */ },
  };
  return { repo, ocrUpdates };
}

const costRepo: IngredientCostRepo = {
  async latestCents() { return null; },
  async insert() { /* noop */ },
};

function makeDelivery(id: string, overrides: Partial<Delivery> = {}): Delivery {
  return {
    id,
    restaurant_id: RID,
    supplier_id: 'sup-1',
    po_id: null,
    received_on: new Date('2026-04-20T10:00:00Z'),
    status: 'pending',
    received_by: null,
    invoice_scan_url: 'https://example.test/scan.png',
    ocr_status: 'processing',
    discrepancy_count: 0,
    created_at: new Date('2026-04-20T10:00:00Z'),
    ...overrides,
  };
}

describe('Internal OCR routes', () => {
  let app: FastifyInstance;
  let ocrUpdates: Array<{ id: string; status: OcrStatus; extracted: unknown }>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    const { repo, ocrUpdates: updates } = inMemoryDeliveryRepo([
      makeDelivery('d-1'),
      makeDelivery('d-2', { ocr_status: 'parsed', invoice_scan_url: 'https://example.test/other.png' }),
    ]);
    ocrUpdates = updates;
    const svc = new DeliveriesService({ deliveries: repo, costs: costRepo });
    const queue: OcrQueueSource = {
      async listProcessing() {
        const refs: OcrQueueRef[] = [
          { id: 'd-1', restaurant_id: RID, invoice_scan_url: 'https://example.test/scan.png' },
        ];
        return refs;
      },
    };
    await registerInternalDeliveryRoutes(app, svc, queue, TOKEN);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects requests without the service token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/internal/deliveries/ocr-queue' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with a wrong token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/internal/deliveries/ocr-queue',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns the processing queue when authed', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/internal/deliveries/ocr-queue',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: OcrQueueRef[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.id).toBe('d-1');
  });

  it('writes OCR result back when status=parsed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/internal/deliveries/d-1/ocr-result',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        'x-restaurant-id': RID,
      },
      payload: JSON.stringify({
        status: 'parsed',
        lines: [{ raw_text: '2 x apple $3.50', description: 'apple', qty: 2, unit_cost_cents: 350 }],
        raw_text: '2 x apple $3.50',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(ocrUpdates).toHaveLength(1);
    expect(ocrUpdates[0]!.status).toBe('parsed');
    expect(ocrUpdates[0]!.id).toBe('d-1');
    const extracted = ocrUpdates[0]!.extracted as { lines: unknown[]; raw_text: string | null };
    expect(extracted.lines).toHaveLength(1);
    expect(extracted.raw_text).toBe('2 x apple $3.50');
  });

  it('rejects when x-restaurant-id is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/internal/deliveries/d-1/ocr-result',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ status: 'failed', lines: [] }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unknown status values', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/internal/deliveries/d-1/ocr-result',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        'x-restaurant-id': RID,
      },
      payload: JSON.stringify({ status: 'processing', lines: [] }),
    });
    expect(res.statusCode).toBe(400);
  });
});

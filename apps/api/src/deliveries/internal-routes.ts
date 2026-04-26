// v1.7 Wave 10 — Internal (worker → API) delivery routes.
//
// The aloha-worker's OCR consumer polls the API for deliveries with
// `ocr_status='processing'`, calls the ML service, and posts extracted lines
// back. These routes cross tenant boundaries and therefore require a shared
// service token (env `SERVICE_TOKEN`) rather than a JWT.
//
// Mount path: /api/v1/internal/deliveries/*

import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { DeliveriesService, OcrStatus } from './service.js';

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

function serviceTokenGuard(expectedToken: string | undefined): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!expectedToken) {
      reply.code(503).send(envelope(null, { code: 'NOT_CONFIGURED', message: 'SERVICE_TOKEN is not set' }));
      return;
    }
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      reply.code(401).send(envelope(null, { code: 'UNAUTHORIZED', message: 'service token required' }));
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    if (token !== expectedToken) {
      reply.code(401).send(envelope(null, { code: 'UNAUTHORIZED', message: 'invalid service token' }));
      return;
    }
  };
}

export interface OcrQueueRef {
  id: string;
  restaurant_id: string;
  invoice_scan_url: string;
}

export interface OcrQueueSource {
  listProcessing(): Promise<OcrQueueRef[]>;
}

export function prismaOcrQueueSource(prisma: PrismaClient): OcrQueueSource {
  return {
    async listProcessing() {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- service-token worker, cross-tenant by design
      const rows = await prisma.delivery.findMany({
        where: { ocr_status: 'processing', invoice_scan_url: { not: null } },
        select: { id: true, restaurant_id: true, invoice_scan_url: true },
        orderBy: { created_at: 'asc' },
        take: 50,
      });
      return rows
        .filter((r): r is { id: string; restaurant_id: string; invoice_scan_url: string } =>
          r.invoice_scan_url !== null)
        .map((r) => ({
          id: r.id,
          restaurant_id: r.restaurant_id,
          invoice_scan_url: r.invoice_scan_url,
        }));
    },
  };
}

export async function registerInternalDeliveryRoutes(
  app: FastifyInstance,
  svc: DeliveriesService,
  queue: OcrQueueSource,
  serviceToken: string | undefined,
): Promise<void> {
  const guard = serviceTokenGuard(serviceToken);

  app.get(
    '/api/v1/internal/deliveries/ocr-queue',
    { preHandler: [guard] },
    async () => envelope(await queue.listProcessing(), null),
  );

  app.post<{
    Params: { id: string };
    Body: { status: OcrStatus; lines?: unknown[]; raw_text?: string | null };
    Headers: { 'x-restaurant-id'?: string };
  }>(
    '/api/v1/internal/deliveries/:id/ocr-result',
    { preHandler: [guard] },
    async (req, reply) => {
      const restaurantId = req.headers['x-restaurant-id'];
      if (!restaurantId || typeof restaurantId !== 'string') {
        return reply.code(400).send(envelope(null, {
          code: 'MISSING_RESTAURANT',
          message: 'x-restaurant-id header required',
        }));
      }
      const status = req.body.status;
      if (status !== 'parsed' && status !== 'failed') {
        return reply.code(400).send(envelope(null, {
          code: 'INVALID_STATUS',
          message: 'status must be parsed or failed',
        }));
      }
      const extracted = {
        lines: req.body.lines ?? [],
        raw_text: req.body.raw_text ?? null,
        completed_at: new Date().toISOString(),
      };
      await svc.recordOcrResult(restaurantId, req.params.id, status, extracted);
      return envelope({ ok: true }, null);
    },
  );
}

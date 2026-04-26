// TASK-054 — Deliveries HTTP routes (§6.6).

import type { FastifyInstance } from 'fastify';
import { anyAuthed, ownerOrManager } from '../rbac/guard.js';
import {
  DeliveriesService, DeliveryNotFoundError, DeliveryAlreadyProcessedError,
  type CreateDeliveryInput, type VerifyOpts,
} from './service.js';

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

export async function registerDeliveryRoutes(app: FastifyInstance, svc: DeliveriesService): Promise<void> {
  app.get(
    '/api/v1/deliveries',
    { preHandler: [anyAuthed()] },
    async (req) => envelope(await svc.list(req.auth!.restaurant_id), null),
  );

  app.post<{ Body: Omit<CreateDeliveryInput, 'received_on'> & { received_on: string } }>(
    '/api/v1/deliveries',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      const d = await svc.create(req.auth!.restaurant_id, {
        ...req.body,
        received_on: new Date(req.body.received_on),
      });
      return reply.code(201).send(envelope(d, null));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/deliveries/:id',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      try {
        const d = await svc.get(req.auth!.restaurant_id, req.params.id);
        const lines = await svc.linesFor(d.id);
        return envelope({ delivery: d, lines }, null);
      } catch (err) {
        if (err instanceof DeliveryNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { invoice_scan_url: string } }>(
    '/api/v1/deliveries/:id/scan',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      try {
        const d = await svc.attachInvoiceScan(req.auth!.restaurant_id, req.params.id, req.body.invoice_scan_url);
        return envelope(d, null);
      } catch (err) {
        if (err instanceof DeliveryNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string }; Body: VerifyOpts }>(
    '/api/v1/deliveries/:id/verify',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      try {
        const res = await svc.verify(req.auth!.restaurant_id, req.params.id, req.body ?? {});
        return envelope(res, null);
      } catch (err) {
        if (err instanceof DeliveryNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        if (err instanceof DeliveryAlreadyProcessedError) {
          return reply.code(409).send(envelope(null, { code: 'ALREADY_PROCESSED', message: err.message }));
        }
        throw err;
      }
    },
  );
}

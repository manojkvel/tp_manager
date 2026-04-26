// TASK-059 — Orders HTTP routes (§6.7).

import type { FastifyInstance } from 'fastify';
import { anyAuthed, ownerOrManager } from '../rbac/guard.js';
import {
  OrdersService, OrderNotFoundError, InvalidOrderTransitionError,
  type CreateDraftInput,
} from './service.js';
import {
  renderOrderEmail,
  SupplierEmailMissingError,
  type EmailTransport,
  type SupplierForEmail,
  type LineForEmail,
  type RestaurantForEmail,
} from './email.js';

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

export interface EmailLookup {
  getSupplier(restaurant_id: string, supplier_id: string): Promise<SupplierForEmail | null>;
  getRestaurant(restaurant_id: string): Promise<RestaurantForEmail | null>;
  decorateLines(lines: Awaited<ReturnType<OrdersService['linesFor']>>): Promise<LineForEmail[]>;
}

export interface OrderRoutesDeps {
  transport?: EmailTransport;
  lookup?: EmailLookup;
  fromAddress?: string;
}

export async function registerOrderRoutes(
  app: FastifyInstance,
  svc: OrdersService,
  deps: OrderRoutesDeps = {},
): Promise<void> {
  app.get('/api/v1/orders/suggestions', { preHandler: [anyAuthed()] }, async (req) => {
    const list = await svc.suggest(req.auth!.restaurant_id);
    return envelope(list, null);
  });

  // v1.7 §6.7 AC-7 — auto-generate draft orders (one per supplier) from PAR shortfall.
  app.post('/api/v1/orders/auto-generate', { preHandler: [ownerOrManager()] }, async (req, reply) => {
    const orders = await svc.autoGenerate(req.auth!.restaurant_id);
    return reply.code(201).send(envelope({ orders, count: orders.length }, null));
  });

  app.get<{ Querystring: { status?: 'draft' | 'sent' | 'received' } }>(
    '/api/v1/orders',
    { preHandler: [anyAuthed()] },
    async (req) => envelope(await svc.list(req.auth!.restaurant_id, req.query.status), null),
  );

  app.post<{ Body: CreateDraftInput }>(
    '/api/v1/orders',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      const o = await svc.createDraft(req.auth!.restaurant_id, req.body);
      return reply.code(201).send(envelope(o, null));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/orders/:id',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      try {
        const o = await svc.get(req.auth!.restaurant_id, req.params.id);
        const lines = await svc.linesFor(o.id);
        return envelope({ order: o, lines }, null);
      } catch (err) {
        if (err instanceof OrderNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/orders/:id/export.csv',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      try {
        const o = await svc.get(req.auth!.restaurant_id, req.params.id);
        const lines = await svc.linesFor(o.id);
        reply.header('content-type', 'text/csv');
        return OrdersService.toCsv(o, lines);
      } catch (err) {
        if (err instanceof OrderNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        throw err;
      }
    },
  );

  // v1.7 §6.7 — render + dispatch order email. Flips status to 'sent' on success.
  app.post<{ Params: { id: string } }>(
    '/api/v1/orders/:id/email',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      if (!deps.transport || !deps.lookup) {
        return reply.code(503).send(envelope(null, {
          code: 'EMAIL_NOT_CONFIGURED',
          message: 'email transport is not configured',
        }));
      }
      try {
        const rid = req.auth!.restaurant_id;
        const order = await svc.get(rid, req.params.id);
        const [supplier, restaurant, rawLines] = await Promise.all([
          deps.lookup.getSupplier(rid, order.supplier_id),
          deps.lookup.getRestaurant(rid),
          svc.linesFor(order.id),
        ]);
        if (!supplier) {
          return reply.code(404).send(envelope(null, { code: 'SUPPLIER_NOT_FOUND', message: 'supplier missing' }));
        }
        if (!restaurant) {
          return reply.code(404).send(envelope(null, { code: 'RESTAURANT_NOT_FOUND', message: 'restaurant missing' }));
        }
        const lines = await deps.lookup.decorateLines(rawLines);
        const msg = renderOrderEmail({
          order,
          supplier,
          restaurant,
          lines,
          fromAddress: deps.fromAddress ?? 'orders@tp-manager.local',
        });
        await deps.transport.send(msg);
        const sent = order.status === 'draft' ? await svc.send(rid, order.id) : order;
        return envelope({ order: sent, transport: deps.transport.name, to: msg.to, cc: msg.cc }, null);
      } catch (err) {
        if (err instanceof OrderNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        if (err instanceof SupplierEmailMissingError) {
          return reply.code(422).send(envelope(null, { code: 'SUPPLIER_NO_EMAIL', message: err.message }));
        }
        if (err instanceof InvalidOrderTransitionError) {
          return reply.code(409).send(envelope(null, { code: 'INVALID_TRANSITION', message: err.message }));
        }
        throw err;
      }
    },
  );

  for (const action of ['send', 'receive'] as const) {
    app.post<{ Params: { id: string } }>(
      `/api/v1/orders/:id/${action}`,
      { preHandler: [ownerOrManager()] },
      async (req, reply) => {
        try {
          const o = action === 'send'
            ? await svc.send(req.auth!.restaurant_id, req.params.id)
            : await svc.markReceived(req.auth!.restaurant_id, req.params.id);
          return envelope(o, null);
        } catch (err) {
          if (err instanceof OrderNotFoundError) {
            return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
          }
          if (err instanceof InvalidOrderTransitionError) {
            return reply.code(409).send(envelope(null, { code: 'INVALID_TRANSITION', message: err.message }));
          }
          throw err;
        }
      },
    );
  }
}

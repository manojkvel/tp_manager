// TASK-035 — Suppliers HTTP routes (§6.2).

import type { FastifyInstance } from 'fastify';
import { ownerOrManager, anyAuthed } from '../rbac/guard.js';
import {
  SuppliersService,
  DuplicateSupplierError,
  priceCreep,
  type CreateSupplierInput,
  type UpdateSupplierInput,
  type UpsertOfferInput,
} from './service.js';

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

export interface SupplierRoutesDeps {
  service: SuppliersService;
  historyForIngredient: (ingredient_id: string) => Promise<ReturnType<SuppliersService['rankedOffersForIngredient']> extends Promise<infer R> ? R : never>;
  // windowDays + threshold can be feature-flagged; defaults here for MVP.
  creep?: { windowDays: number; thresholdPct: number };
}

export async function registerSupplierRoutes(app: FastifyInstance, deps: SupplierRoutesDeps): Promise<void> {
  const svc = deps.service;
  const creepWindow = deps.creep ?? { windowDays: 30, thresholdPct: 10 };

  app.get<{ Querystring: { includeInactive?: string } }>(
    '/api/v1/suppliers',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const rows = await svc.list(req.auth!.restaurant_id, {
        includeInactive: req.query.includeInactive === 'true',
      });
      return envelope(rows, null);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/suppliers/:id',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      const row = await svc.get(req.auth!.restaurant_id, req.params.id);
      if (!row) return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: 'supplier not found' }));
      const offers = await svc.offersForSupplier(req.params.id);
      return envelope({ ...row, offers }, null);
    },
  );

  app.post<{ Body: CreateSupplierInput }>(
    '/api/v1/suppliers',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      try {
        const row = await svc.create(req.auth!.restaurant_id, req.body);
        return reply.code(201).send(envelope(row, null));
      } catch (err) {
        if (err instanceof DuplicateSupplierError) {
          return reply.code(409).send(envelope(null, { code: 'DUPLICATE', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.put<{ Params: { id: string }; Body: UpdateSupplierInput }>(
    '/api/v1/suppliers/:id',
    { preHandler: [ownerOrManager()] },
    async (req) => {
      const row = await svc.update(req.auth!.restaurant_id, req.params.id, req.body);
      return envelope(row, null);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/suppliers/:id/deactivate',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      await svc.deactivate(req.auth!.restaurant_id, req.params.id);
      return reply.code(204).send();
    },
  );

  // Offers — AC-3.
  app.get<{ Params: { id: string } }>(
    '/api/v1/ingredients/:id/offers',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const rows = await svc.rankedOffersForIngredient(req.params.id);
      return envelope(rows, null);
    },
  );

  app.post<{ Params: { id: string }; Body: Omit<UpsertOfferInput, 'ingredient_id'> }>(
    '/api/v1/ingredients/:id/offers',
    { preHandler: [ownerOrManager()] },
    async (req) => {
      const row = await svc.upsertOffer(req.auth!.restaurant_id, { ...req.body, ingredient_id: req.params.id });
      return envelope(row, null);
    },
  );

  app.post<{ Params: { id: string }; Body: { supplier_order: string[] } }>(
    '/api/v1/ingredients/:id/offers/reorder',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      await svc.reorderOffers(req.auth!.restaurant_id, req.params.id, req.body.supplier_order);
      return reply.code(204).send();
    },
  );

  // §6.2 AC-5 — price creep report. Caller provides the ingredient scope.
  app.get<{ Params: { id: string }; Querystring: { windowDays?: string; thresholdPct?: string } }>(
    '/api/v1/ingredients/:id/price-creep',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const offers = await deps.historyForIngredient(req.params.id);
      const windowDays = Number(req.query.windowDays ?? creepWindow.windowDays);
      const thresholdPct = Number(req.query.thresholdPct ?? creepWindow.thresholdPct);
      const report = priceCreep(offers, { windowDays, thresholdPct });
      return envelope(report, null);
    },
  );
}

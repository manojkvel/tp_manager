// TASK-052 — Prep HTTP routes (§6.4).
//
// RBAC: list/generate → any authed; start/complete/skip → any authed (staff may
// execute prep per spec §6.13 role matrix).

import type { FastifyInstance } from 'fastify';
import { anyAuthed } from '../rbac/guard.js';
import {
  PrepService, PrepSheetNotFoundError, SkipReasonRequiredError,
} from './service.js';

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

export async function registerPrepRoutes(app: FastifyInstance, svc: PrepService): Promise<void> {
  // §6.10 dashboard KPI — today's prep progress.
  app.get(
    '/api/v1/prep/sheet/today/kpi',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const sheet = await svc.generate(req.auth!.restaurant_id, new Date());
      let pending = 0;
      let completed = 0;
      for (const row of sheet.rows) {
        if (row.status === 'complete' || row.status === 'skipped') completed += 1;
        else pending += 1;
      }
      return envelope({ pending, completed }, null);
    },
  );

  app.post<{ Body: { date?: string } }>(
    '/api/v1/prep/sheet',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const date = req.body?.date ? new Date(req.body.date) : new Date();
      const sheet = await svc.generate(req.auth!.restaurant_id, date);
      return envelope(sheet, null);
    },
  );

  app.get<{ Querystring: { date?: string } }>(
    '/api/v1/prep/sheet',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const date = req.query.date ? new Date(req.query.date) : new Date();
      const sheet = await svc.generate(req.auth!.restaurant_id, date);
      return envelope(sheet, null);
    },
  );

  // v1.7 §6.4 AC-8 — sheet KPI strip.
  app.get<{ Querystring: { date?: string } }>(
    '/api/v1/prep/sheet/summary',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const date = req.query.date ? new Date(req.query.date) : new Date();
      const sheet = await svc.generate(req.auth!.restaurant_id, date);
      return envelope(svc.summarise(sheet), null);
    },
  );

  // v1.7 — partial edit row (assignee, temp, qty).
  app.patch<{ Params: { row_id: string }; Body: { assigned_to_user_id?: string | null; temp_f?: number | null; needed_qty?: number } }>(
    '/api/v1/prep/rows/:row_id',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      try {
        await svc.patchRow(req.auth!.restaurant_id, req.params.row_id, req.body ?? {});
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof PrepSheetNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        throw err;
      }
    },
  );

  // v1.7 §6.4 AC-7 — QC sign-off.
  app.post<{ Params: { row_id: string }; Body: { temp_f?: number | null } }>(
    '/api/v1/prep/rows/:row_id/qc-sign',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      try {
        await svc.signQc(req.auth!.restaurant_id, req.params.row_id, req.auth!.sub, req.body?.temp_f ?? null);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof PrepSheetNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { row_id: string } }>(
    '/api/v1/prep/rows/:row_id/start',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      try {
        await svc.start(req.auth!.restaurant_id, req.params.row_id, req.auth!.sub);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof PrepSheetNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { row_id: string }; Body: { shelf_life_days?: number | null } }>(
    '/api/v1/prep/rows/:row_id/complete',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      try {
        const run = await svc.markComplete(
          req.auth!.restaurant_id,
          req.params.row_id,
          req.auth!.sub,
          req.body?.shelf_life_days ?? null,
        );
        return envelope(run, null);
      } catch (err) {
        if (err instanceof PrepSheetNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { row_id: string }; Body: { reason: string } }>(
    '/api/v1/prep/rows/:row_id/skip',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      try {
        await svc.markSkipped(req.auth!.restaurant_id, req.params.row_id, req.body?.reason ?? '');
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof SkipReasonRequiredError) {
          return reply.code(400).send(envelope(null, { code: 'VALIDATION', message: err.message }));
        }
        if (err instanceof PrepSheetNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        throw err;
      }
    },
  );
}

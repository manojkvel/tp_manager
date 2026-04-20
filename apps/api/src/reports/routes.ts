// TASK-069 — Reports HTTP routes (§6.9). Gated to owner + manager.
// GAP-10 — /dashboard/chips powers the dashboard's gap-prompt chips
// (ingredients without a default supplier, deliveries currently in dispute).

import type { FastifyInstance } from 'fastify';
import { ownerOrManager, anyAuthed } from '../rbac/guard.js';
import type { ReportsService } from './service.js';

export interface DashboardChipsSource {
  countIngredientsNeedingSupplier(restaurant_id: string): Promise<number>;
  countDisputedDeliveries(restaurant_id: string): Promise<number>;
}

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

function parseDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}

export async function registerReportsRoutes(
  app: FastifyInstance,
  svc: ReportsService,
  chips?: DashboardChipsSource,
): Promise<void> {
  app.get<{ Querystring: { since?: string; until?: string } }>(
    '/api/v1/reports/avt',
    { preHandler: [ownerOrManager()] },
    async (req) => {
      const rows = await svc.avt(req.auth!.restaurant_id, {
        since: parseDate(req.query.since),
        until: parseDate(req.query.until),
      });
      return envelope(rows, null);
    },
  );

  app.get<{ Querystring: { sinceDays?: string; threshold_pct?: string } }>(
    '/api/v1/reports/price-creep',
    { preHandler: [ownerOrManager()] },
    async (req) => {
      const rows = await svc.priceCreep(req.auth!.restaurant_id, {
        sinceDays: req.query.sinceDays ? Number(req.query.sinceDays) : undefined,
        threshold_pct: req.query.threshold_pct ? Number(req.query.threshold_pct) : undefined,
      });
      return envelope(rows, null);
    },
  );

  app.get<{ Querystring: { since?: string; until?: string } }>(
    '/api/v1/reports/waste',
    { preHandler: [ownerOrManager()] },
    async (req) => {
      const rows = await svc.wasteByReason(req.auth!.restaurant_id, {
        since: parseDate(req.query.since),
        until: parseDate(req.query.until),
      });
      return envelope(rows, null);
    },
  );

  if (chips) {
    app.get(
      '/api/v1/dashboard/chips',
      { preHandler: [anyAuthed()] },
      async (req) => {
        const rid = req.auth!.restaurant_id;
        const [needs_supplier, disputed_deliveries] = await Promise.all([
          chips.countIngredientsNeedingSupplier(rid),
          chips.countDisputedDeliveries(rid),
        ]);
        return envelope({ needs_supplier, disputed_deliveries }, null);
      },
    );
  }
}

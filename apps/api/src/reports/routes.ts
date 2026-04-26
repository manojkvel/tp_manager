// TASK-069 — Reports HTTP routes (§6.9). Gated to owner + manager.
// GAP-10 — /dashboard/chips powers the dashboard's gap-prompt chips
// (ingredients without a default supplier, deliveries currently in dispute).

import type { FastifyInstance } from 'fastify';
import { ownerOrManager, anyAuthed } from '../rbac/guard.js';
import type { ReportsService } from './service.js';

export interface DashboardActivityItem {
  id: string;
  at: Date;
  kind: 'delivery' | 'waste' | 'count' | 'order' | 'prep';
  label: string;
  hint?: string;
}

export interface DashboardDeliveryExpected {
  delivery_id: string;
  supplier_id: string;
  supplier_name: string;
  status: 'pending' | 'verified' | 'disputed';
  received_on: string;
  discrepancy_count: number;
}

export interface DashboardCutoff {
  supplier_id: string;
  supplier_name: string;
  cutoff_time: string;
  next_delivery_day: string;
  minutes_until_cutoff: number | null;
}

export interface DashboardDeliverySchedule {
  deliveries_today: DashboardDeliveryExpected[];
  cutoffs_today: DashboardCutoff[];
}

export interface DashboardChipsSource {
  countIngredientsNeedingSupplier(restaurant_id: string): Promise<number>;
  countDisputedDeliveries(restaurant_id: string): Promise<number>;
  recentActivity?(restaurant_id: string, limit: number): Promise<DashboardActivityItem[]>;
  deliverySchedule?(restaurant_id: string, now: Date): Promise<DashboardDeliverySchedule>;
}

export interface StockIntelligenceDeps {
  listIngredientsByIds(rid: string, ids: string[]): Promise<Array<{
    id: string; name: string; par_qty: number | null;
    latest_unit_cost_cents: number | null;
  }>>;
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
  stockDeps?: StockIntelligenceDeps,
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

  // v1.7 §6.9 — AvT summary with tier classification + totals.
  app.get<{ Querystring: { since?: string; until?: string } }>(
    '/api/v1/reports/avt/summary',
    { preHandler: [ownerOrManager()] },
    async (req) => envelope(await svc.avtSummary(req.auth!.restaurant_id, {
      since: parseDate(req.query.since),
      until: parseDate(req.query.until),
    }), null),
  );

  // v1.7 §6.9 — price creep enriched with last-3-delivery trend.
  app.get<{ Querystring: { sinceDays?: string; threshold_pct?: string } }>(
    '/api/v1/reports/price-creep/trend',
    { preHandler: [ownerOrManager()] },
    async (req) => envelope(await svc.priceCreepWithTrend(req.auth!.restaurant_id, {
      sinceDays: req.query.sinceDays ? Number(req.query.sinceDays) : undefined,
      threshold_pct: req.query.threshold_pct ? Number(req.query.threshold_pct) : undefined,
    }), null),
  );

  // v1.7 §6.9 — waste & loss (bucket + reason + totals).
  app.get<{ Querystring: { since?: string; until?: string } }>(
    '/api/v1/reports/waste-loss',
    { preHandler: [ownerOrManager()] },
    async (req) => envelope(await svc.wasteLoss(req.auth!.restaurant_id, {
      since: parseDate(req.query.since),
      until: parseDate(req.query.until),
    }), null),
  );

  // v1.7 §6.10 — food-cost percent for dashboard KPI strip.
  app.get<{ Querystring: { since?: string; until?: string } }>(
    '/api/v1/reports/food-cost-pct',
    { preHandler: [anyAuthed()] },
    async (req) => envelope(await svc.foodCostPct(req.auth!.restaurant_id, {
      since: parseDate(req.query.since),
      until: parseDate(req.query.until),
    }), null),
  );

  // v1.7 §6.10 — weekly inventory value trend for dashboard line chart.
  app.get<{ Querystring: { sinceDays?: string } }>(
    '/api/v1/reports/inventory-cost-weekly',
    { preHandler: [anyAuthed()] },
    async (req) => envelope(await svc.inventoryCostWeekly(req.auth!.restaurant_id, {
      sinceDays: req.query.sinceDays ? Number(req.query.sinceDays) : undefined,
    }), null),
  );

  // v1.7 §6.10 — daily AvT aggregate for dashboard weekday bars.
  app.get<{ Querystring: { since?: string; until?: string } }>(
    '/api/v1/reports/avt-daily',
    { preHandler: [anyAuthed()] },
    async (req) => envelope(await svc.avtDaily(req.auth!.restaurant_id, {
      since: parseDate(req.query.since),
      until: parseDate(req.query.until),
    }), null),
  );

  // v1.8 — menu-item contribution ranking (revenue, margin, share-of-profit).
  app.get<{ Querystring: { since?: string; until?: string } }>(
    '/api/v1/reports/menu-contribution',
    { preHandler: [ownerOrManager()] },
    async (req) => envelope(await svc.menuContribution(req.auth!.restaurant_id, {
      since: parseDate(req.query.since),
      until: parseDate(req.query.until),
    }), null),
  );

  if (stockDeps) {
    // v1.8 — per-ingredient days-of-stock and shortage flags.
    app.get(
      '/api/v1/reports/stock-intelligence',
      { preHandler: [anyAuthed()] },
      async (req) => {
        const rid = req.auth!.restaurant_id;
        const rows = await svc.stockIntelligence(rid, async (ids) => {
          const ings = await stockDeps.listIngredientsByIds(rid, ids);
          return ings.map((i) => ({ id: i.id, name: i.name, par_qty: i.par_qty }));
        });
        return envelope(rows, null);
      },
    );

    // v1.8 — ingredients with on-hand > 0 but zero usage/waste in 30 days.
    app.get(
      '/api/v1/reports/dead-stock',
      { preHandler: [anyAuthed()] },
      async (req) => {
        const rid = req.auth!.restaurant_id;
        const rows = await svc.deadStock(rid, async (ids) => {
          const ings = await stockDeps.listIngredientsByIds(rid, ids);
          return ings.map((i) => ({
            id: i.id, name: i.name, latest_unit_cost_cents: i.latest_unit_cost_cents,
          }));
        });
        return envelope(rows, null);
      },
    );
  }

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

    if (chips.recentActivity) {
      const recent = chips.recentActivity;
      app.get<{ Querystring: { limit?: string } }>(
        '/api/v1/dashboard/activity',
        { preHandler: [anyAuthed()] },
        async (req) => {
          const limit = req.query.limit ? Math.min(50, Number(req.query.limit)) : 10;
          const items = await recent(req.auth!.restaurant_id, limit);
          return envelope(items, null);
        },
      );
    }

    if (chips.deliverySchedule) {
      const schedule = chips.deliverySchedule;
      app.get(
        '/api/v1/dashboard/delivery-schedule',
        { preHandler: [anyAuthed()] },
        async (req) => envelope(await schedule(req.auth!.restaurant_id, new Date()), null),
      );
    }
  }
}

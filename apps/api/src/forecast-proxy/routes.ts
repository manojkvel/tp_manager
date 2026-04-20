// TASK-079 — forecast-proxy HTTP routes: advisory forecast lookup consumed by
// prep sheet and orders UI. Accuracy endpoint feeds /reports/forecast-accuracy.
// GAP-05 — POST /forecasts/override + GET /forecasts/overrides (§6.12b AC-5).

import type { FastifyInstance } from 'fastify';
import { anyAuthed, ownerOrManager } from '../rbac/guard.js';
import type { ForecastClient } from './client.js';
import {
  OverrideService, OverrideValidationError, OverrideNotFoundError,
  type ForecastEntityType,
} from './override.js';

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

interface ForecastLookupBody {
  entity_type: 'recipe' | 'ingredient';
  entity_ids: string[];
  target_dates: string[];
}

interface OverrideCaptureBody {
  entity_type: ForecastEntityType;
  entity_id: string;
  target_date: string;
  expected_qty: number;
  override_qty: number;
  reason?: string;
}

interface OverrideActualBody {
  actual_qty: number;
}

export async function registerForecastRoutes(
  app: FastifyInstance,
  client: ForecastClient,
  accuracyRepo: {
    listRecentModels(rid: string): Promise<Array<{
      entity_type: string; entity_id: string; entity_name: string;
      algorithm: string; holdout_mape: number | null; trained_at: Date;
    }>>;
  },
  overrideService?: OverrideService,
): Promise<void> {
  app.post<{ Body: ForecastLookupBody }>(
    '/api/v1/forecasts/lookup',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const { entity_type, entity_ids, target_dates } = req.body;
      const rid = req.auth!.restaurant_id;
      const results = await Promise.all(
        entity_ids.map(async (id) => ({
          entity_id: id,
          forecast: await client.forecast(rid, entity_type, id, target_dates),
        })),
      );
      return envelope(results, null);
    },
  );

  app.get('/api/v1/forecasts/accuracy', { preHandler: [ownerOrManager()] }, async (req) => {
    const rows = await accuracyRepo.listRecentModels(req.auth!.restaurant_id);
    return envelope(rows, null);
  });

  if (overrideService) {
    app.post<{ Body: OverrideCaptureBody }>(
      '/api/v1/forecasts/override',
      { preHandler: [ownerOrManager()] },
      async (req, reply) => {
        try {
          const row = await overrideService.capture(req.auth!.restaurant_id, {
            ...req.body,
            user_id: req.auth!.sub,
          });
          return reply.code(201).send(envelope(row, null));
        } catch (err) {
          if (err instanceof OverrideValidationError) {
            return reply.code(422).send(envelope(null, { code: 'INVALID', message: err.message }));
          }
          throw err;
        }
      },
    );

    app.get<{ Querystring: { entity_type?: ForecastEntityType; entity_id?: string; from_date?: string; to_date?: string } }>(
      '/api/v1/forecasts/overrides',
      { preHandler: [anyAuthed()] },
      async (req) => {
        const rows = await overrideService.list(req.auth!.restaurant_id, req.query);
        return envelope(rows, null);
      },
    );

    app.patch<{ Params: { id: string }; Body: OverrideActualBody }>(
      '/api/v1/forecasts/overrides/:id/actual',
      { preHandler: [ownerOrManager()] },
      async (req, reply) => {
        try {
          const row = await overrideService.recordActual(
            req.auth!.restaurant_id,
            req.params.id,
            req.body.actual_qty,
          );
          return envelope(row, null);
        } catch (err) {
          if (err instanceof OverrideNotFoundError) {
            return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
          }
          if (err instanceof OverrideValidationError) {
            return reply.code(422).send(envelope(null, { code: 'INVALID', message: err.message }));
          }
          throw err;
        }
      },
    );
  }
}

export function prismaAccuracyRepo(prisma: {
  forecastModel: { findMany(args: unknown): Promise<Array<Record<string, unknown>>> };
}): {
  listRecentModels(rid: string): Promise<Array<{
    entity_type: string; entity_id: string; entity_name: string;
    algorithm: string; holdout_mape: number | null; trained_at: Date;
  }>>;
} {
  return {
    async listRecentModels(rid: string) {
      const rows = await prisma.forecastModel.findMany({
        where: { restaurant_id: rid },
        orderBy: { trained_at: 'desc' },
        take: 100,
      });
      return rows.map((r) => ({
        entity_type: String(r.entity_type),
        entity_id: String(r.entity_id),
        entity_name: String(r.entity_id).slice(0, 8),
        algorithm: String(r.algorithm),
        holdout_mape: r.holdout_mape == null ? null : Number(r.holdout_mape),
        trained_at: new Date(String(r.trained_at)),
      }));
    },
  };
}

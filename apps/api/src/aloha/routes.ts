// TASK-066, TASK-067 — Aloha HTTP routes (§6.12a).
//   POST /api/v1/aloha/import       — manual PMIX upload
//   GET  /api/v1/aloha/runs         — recent import history
//   GET  /api/v1/aloha/reconciliation — queue of unmapped items
//   POST /api/v1/aloha/map/menu     — map aloha item → menu recipe
//   POST /api/v1/aloha/map/modifier — map aloha modifier → ingredient / sub-recipe

import type { FastifyInstance } from 'fastify';
import { ownerOrManager } from '../rbac/guard.js';
import type { AlohaService } from './service.js';

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

interface ImportBody {
  source?: 'manual_upload' | 'sftp' | 'api' | 'middleware';
  rows: readonly (readonly string[])[];
}

interface MenuMapBody {
  aloha_item_name: string;
  menu_recipe_id: string;
  effective_from: string;
}

interface ModifierMapBody {
  aloha_modifier_name: string;
  ingredient_id?: string | null;
  recipe_id?: string | null;
  qty: number;
  uom: string;
  effective_from: string;
}

export async function registerAlohaRoutes(
  app: FastifyInstance,
  svc: AlohaService,
  mappingRepo: {
    upsertMenuMap(rid: string, body: MenuMapBody): Promise<void>;
    upsertModifierMap(rid: string, body: ModifierMapBody): Promise<void>;
    listReconciliation(rid: string): Promise<unknown[]>;
  },
): Promise<void> {
  app.post<{ Body: ImportBody }>(
    '/api/v1/aloha/import',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      const source = req.body.source ?? 'manual_upload';
      const run = await svc.importPmix(req.auth!.restaurant_id, source, req.body.rows);
      return reply.code(201).send(envelope(run, null));
    },
  );

  app.get('/api/v1/aloha/runs', { preHandler: [ownerOrManager()] }, async (req) =>
    envelope(await svc.recentRuns(req.auth!.restaurant_id), null),
  );

  app.get('/api/v1/aloha/reconciliation', { preHandler: [ownerOrManager()] }, async (req) =>
    envelope(await mappingRepo.listReconciliation(req.auth!.restaurant_id), null),
  );

  app.post<{ Body: MenuMapBody }>(
    '/api/v1/aloha/map/menu',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      await mappingRepo.upsertMenuMap(req.auth!.restaurant_id, req.body);
      return reply.code(201).send(envelope({ ok: true }, null));
    },
  );

  app.post<{ Body: ModifierMapBody }>(
    '/api/v1/aloha/map/modifier',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      await mappingRepo.upsertModifierMap(req.auth!.restaurant_id, req.body);
      return reply.code(201).send(envelope({ ok: true }, null));
    },
  );
}

import type { PrismaClient } from '@prisma/client';

export function prismaAlohaMappingRepo(prisma: PrismaClient): {
  upsertMenuMap(rid: string, body: MenuMapBody): Promise<void>;
  upsertModifierMap(rid: string, body: ModifierMapBody): Promise<void>;
  listReconciliation(rid: string): Promise<unknown[]>;
} {
  return {
    async upsertMenuMap(rid, body) {
      const eff = new Date(body.effective_from);
      await prisma.alohaMenuMap.create({
        data: {
          restaurant_id: rid,
          aloha_item_name: body.aloha_item_name,
          menu_recipe_id: body.menu_recipe_id,
          effective_from: eff,
          confidence: 'manual',
        },
      });
    },
    async upsertModifierMap(rid, body) {
      await prisma.alohaModifierMap.create({
        data: {
          restaurant_id: rid,
          aloha_modifier_name: body.aloha_modifier_name,
          ingredient_id: body.ingredient_id ?? null,
          recipe_id: body.recipe_id ?? null,
          qty: body.qty,
          uom: body.uom,
          effective_from: new Date(body.effective_from),
        },
      });
    },
    async listReconciliation(rid) {
      const rows = await prisma.alohaReconciliationQueue.findMany({
        where: { restaurant_id: rid, resolved: false },
        orderBy: { first_seen_on: 'desc' },
      });
      return rows;
    },
  };
}

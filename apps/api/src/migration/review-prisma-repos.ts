// TASK-061 — Prisma-backed repos for migration review.

import type { PrismaClient } from '@prisma/client';
import type { CanonicalCandidate, StagingProbe, MatchCandidate } from './dedupe.js';
import type {
  ReviewBatchRepo, CanonicalSource, PromotionWriter,
  StagedBatch, StagedItem, ReviewBatchStatus,
} from './review.js';

export function prismaReviewBatchRepo(prisma: PrismaClient): ReviewBatchRepo {
  return {
    async insertBatch(b) {
      await prisma.stagedMigrationBatch.create({
        data: {
          id: b.id,
          restaurant_id: b.restaurant_id,
          source_file: b.source_file,
          parser_version: b.parser_version,
          staged_at: b.staged_at,
          status: b.status,
          approved_at: b.approved_at,
          approved_by: b.approved_by,
          rolled_back_at: b.rolled_back_at,
        },
      });
    },
    async findBatch(id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- service enforces tenant check
      const row = await prisma.stagedMigrationBatch.findUnique({ where: { id } });
      return row ? mapBatch(row) : null;
    },
    async listBatches(restaurant_id) {
      const rows = await prisma.stagedMigrationBatch.findMany({
        where: { restaurant_id }, orderBy: { staged_at: 'desc' },
      });
      return rows.map(mapBatch);
    },
    async updateBatch(id, patch) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- PK update after tenant check
      await prisma.stagedMigrationBatch.update({
        where: { id },
        data: {
          ...(patch.status ? { status: patch.status } : {}),
          ...(patch.approved_at !== undefined ? { approved_at: patch.approved_at } : {}),
          ...(patch.approved_by !== undefined ? { approved_by: patch.approved_by } : {}),
          ...(patch.rolled_back_at !== undefined ? { rolled_back_at: patch.rolled_back_at } : {}),
        },
      });
    },
    async insertItem(item) {
      await prisma.stagedMigrationItem.create({
        data: {
          id: item.id,
          batch_id: item.batch_id,
          kind: item.kind,
          probe: item.probe as unknown as object,
          payload: item.payload as unknown as object,
          bucket: item.bucket,
          matches: item.matches as unknown as object,
          decision: item.decision,
          decision_target_id: item.decision_target_id,
        },
      });
    },
    async itemsFor(batch_id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped via batch_id FK
      const rows = await prisma.stagedMigrationItem.findMany({ where: { batch_id } });
      return rows.map(mapItem);
    },
    async updateItem(id, patch) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- PK update after tenant check
      await prisma.stagedMigrationItem.update({
        where: { id },
        data: {
          ...(patch.decision ? { decision: patch.decision } : {}),
          ...(patch.decision_target_id !== undefined ? { decision_target_id: patch.decision_target_id } : {}),
        },
      });
    },
  };
}

export function prismaCanonicalSource(prisma: PrismaClient): CanonicalSource {
  return {
    async ingredients(restaurant_id) {
      const rows = await prisma.ingredient.findMany({
        where: { restaurant_id, is_archived: false },
        select: { id: true, name: true, uom: true, default_supplier_id: true },
      });
      return rows.map<CanonicalCandidate>((r) => ({
        id: r.id,
        name: r.name,
        uom: r.uom,
        supplier_id: r.default_supplier_id ?? null,
      }));
    },
  };
}

/**
 * Promotion writer — for the v1.6 MVP only ingredients are promoted; recipe and
 * pos_sale promotion are deferred to migration parsers' own writers (TASK-047
 * staging_writer + atomic_batch). This writer handles the owner-approved
 * ingredient layer, which is the surface §6.14 AC-4..7 govern.
 */
export function prismaPromotionWriter(prisma: PrismaClient): PromotionWriter {
  return {
    async promote(batch, items) {
      let inserted = 0;
      let merged = 0;
      await prisma.$transaction(async (tx) => {
        for (const item of items) {
          if (item.decision === 'reject') continue;
          if (item.kind !== 'ingredient') continue;
          const probe = item.probe as { name: string; uom?: string | null };
          const payload = item.payload as Record<string, unknown>;
          if (item.decision === 'merge' && item.decision_target_id) {
            // eslint-disable-next-line @tp/tp/require-restaurant-id -- merging into existing ingredient identified by id
            await tx.ingredient.update({
              where: { id: item.decision_target_id },
              data: {
                ...(payload.density_g_per_ml ? { density_g_per_ml: Number(payload.density_g_per_ml) } : {}),
                ...(payload.shelf_life_days ? { shelf_life_days: Number(payload.shelf_life_days) } : {}),
              },
            });
            merged += 1;
          } else if (item.decision === 'accept_new') {
            await tx.ingredient.create({
              data: {
                restaurant_id: batch.restaurant_id,
                name: probe.name,
                uom: probe.uom ?? 'each',
                uom_category: (payload.uom_category as 'weight' | 'volume' | 'count') ?? 'count',
                pack_size: payload.pack_size ? Number(payload.pack_size) : null,
                shelf_life_days: payload.shelf_life_days ? Number(payload.shelf_life_days) : null,
                density_g_per_ml: payload.density_g_per_ml ? Number(payload.density_g_per_ml) : null,
              },
            });
            inserted += 1;
          }
        }
      });
      return { inserted, merged };
    },
    async rollback(batch) {
      // For ingredient merges we cannot reliably reverse field updates without
      // a snapshot; rollback removes only ingredients inserted by `accept_new`
      // (identified by created_at >= batch.approved_at).
      const removed = await prisma.ingredient.deleteMany({
        where: {
          restaurant_id: batch.restaurant_id,
          created_at: { gte: batch.approved_at ?? batch.staged_at },
          // Heuristic: only newly-inserted, never-referenced rows.
          recipe_lines: { none: {} },
          delivery_lines: { none: {} },
          order_lines: { none: {} },
          costs: { none: {} },
        },
      });
      return { removed: removed.count };
    },
  };
}

function mapBatch(r: {
  id: string; restaurant_id: string; source_file: string; parser_version: string;
  staged_at: Date; status: string; approved_at: Date | null;
  approved_by: string | null; rolled_back_at: Date | null;
}): StagedBatch {
  return {
    id: r.id,
    restaurant_id: r.restaurant_id,
    source_file: r.source_file,
    parser_version: r.parser_version,
    staged_at: r.staged_at,
    status: r.status as ReviewBatchStatus,
    approved_at: r.approved_at,
    approved_by: r.approved_by,
    rolled_back_at: r.rolled_back_at,
  };
}

function mapItem(r: {
  id: string; batch_id: string; kind: string; probe: unknown; payload: unknown;
  bucket: string; matches: unknown; decision: string; decision_target_id: string | null;
}): StagedItem {
  return {
    id: r.id,
    batch_id: r.batch_id,
    kind: r.kind as 'ingredient' | 'recipe' | 'pos_sale',
    probe: r.probe as StagingProbe,
    payload: r.payload as Record<string, unknown>,
    bucket: r.bucket as StagedItem['bucket'],
    matches: (r.matches as MatchCandidate[]) ?? [],
    decision: r.decision as StagedItem['decision'],
    decision_target_id: r.decision_target_id,
  };
}

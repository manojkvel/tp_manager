// TASK-066 — Prisma-backed Aloha repos. replaceDay() wraps delete+insert in a tx
// so re-import is idempotent (§6.12a AC-6) and atomic (AD-7).

import type { PrismaClient } from '@prisma/client';
import type {
  AlohaRepo, AlohaImportRun, PosSaleRow, CoverCount, StockoutEvent, ReconciliationItem,
} from './service.js';

export function prismaAlohaRepo(prisma: PrismaClient): AlohaRepo {
  return {
    async insertRun(r) {
      await prisma.alohaImportRun.create({
        data: {
          id: r.id,
          restaurant_id: r.restaurant_id,
          business_date: r.business_date,
          source: r.source,
          started_at: r.started_at,
          completed_at: r.completed_at,
          status: r.status,
          rows_ingested: r.rows_ingested,
          error_detail: r.error_detail,
        },
      });
    },

    async updateRun(id, patch) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- PK update
      await prisma.alohaImportRun.update({
        where: { id },
        data: {
          completed_at: patch.completed_at,
          status: patch.status,
          rows_ingested: patch.rows_ingested,
          error_detail: patch.error_detail,
        },
      });
    },

    async replaceDay(restaurant_id, business_date, op) {
      const out = await op();
      await prisma.$transaction(async (tx) => {
        await tx.posSale.deleteMany({ where: { restaurant_id, business_date } });
        await tx.coverCount.deleteMany({ where: { restaurant_id, business_date } });
        await tx.stockoutEvent.deleteMany({ where: { restaurant_id, business_date } });

        if (out.pos_sales.length > 0) {
          await tx.posSale.createMany({
            data: out.pos_sales.map((p: PosSaleRow) => ({
              id: p.id,
              import_run_id: p.import_run_id,
              restaurant_id: p.restaurant_id,
              business_date: p.business_date,
              category: p.category,
              aloha_item_name: p.aloha_item_name,
              row_kind: p.row_kind,
              qty: p.qty,
              unit_price_cents: p.unit_price_cents,
              item_sales_cents: p.item_sales_cents,
              aloha_cost_cents: p.aloha_cost_cents,
            })),
          });
        }
        if (out.covers) {
          await tx.coverCount.create({
            data: {
              id: out.covers.id,
              restaurant_id: out.covers.restaurant_id,
              import_run_id: out.covers.import_run_id,
              business_date: out.covers.business_date,
              covers: out.covers.covers,
            },
          });
        }
        if (out.stockouts.length > 0) {
          await tx.stockoutEvent.createMany({
            data: out.stockouts.map((s: StockoutEvent) => ({
              id: s.id,
              restaurant_id: s.restaurant_id,
              import_run_id: s.import_run_id,
              business_date: s.business_date,
              ingredient_id: s.ingredient_id,
              recipe_id: s.recipe_id,
              aloha_marker_name: s.aloha_marker_name,
              count: s.count,
              mapped: s.mapped,
            })),
          });
        }
      });
    },

    async recentRuns(restaurant_id, limit) {
      const rows = await prisma.alohaImportRun.findMany({
        where: { restaurant_id },
        orderBy: { started_at: 'desc' },
        take: limit,
      });
      return rows.map((r): AlohaImportRun => ({
        id: r.id,
        restaurant_id: r.restaurant_id,
        business_date: r.business_date,
        source: r.source as AlohaImportRun['source'],
        started_at: r.started_at,
        completed_at: r.completed_at,
        status: r.status as AlohaImportRun['status'],
        rows_ingested: r.rows_ingested,
        error_detail: r.error_detail,
      }));
    },

    async enqueueReconciliation(items) {
      for (const it of items) {
        await prisma.alohaReconciliationQueue.upsert({
          where: {
            restaurant_id_aloha_item_name_row_kind: {
              restaurant_id: it.restaurant_id,
              aloha_item_name: it.aloha_item_name,
              row_kind: it.row_kind,
            },
          },
          create: {
            id: it.id,
            restaurant_id: it.restaurant_id,
            aloha_item_name: it.aloha_item_name,
            row_kind: it.row_kind,
            first_seen_on: it.first_seen_on,
            occurrences: it.occurrences,
            resolved: false,
          },
          update: {
            occurrences: { increment: it.occurrences },
          },
        });
      }
    },
  };
}

// Re-export for type inference used by consumers
export type { AlohaRepo, PosSaleRow, CoverCount, StockoutEvent, ReconciliationItem };

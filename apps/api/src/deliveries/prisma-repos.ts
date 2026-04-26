// TASK-054 — Prisma-backed repos for deliveries + ingredient cost history.

import type { PrismaClient } from '@prisma/client';
import type {
  DeliveryRepo, IngredientCostRepo, Delivery, DeliveryLine, DeliveryStatus, OcrStatus,
} from './service.js';

export function prismaDeliveryRepo(prisma: PrismaClient): DeliveryRepo {
  return {
    async findById(id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- service enforces tenant check
      const row = await prisma.delivery.findUnique({ where: { id } });
      return row ? map(row) : null;
    },
    async insert(row) {
      await prisma.delivery.create({
        data: {
          id: row.id,
          restaurant_id: row.restaurant_id,
          supplier_id: row.supplier_id,
          po_id: row.po_id,
          received_on: row.received_on,
          status: row.status,
          received_by: row.received_by,
          invoice_scan_url: row.invoice_scan_url,
          ocr_status: row.ocr_status,
          discrepancy_count: row.discrepancy_count,
          created_at: row.created_at,
        },
      });
    },
    async updateStatus(id, status) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- PK update after tenant check
      await prisma.delivery.update({ where: { id }, data: { status } });
    },
    async updateDiscrepancyCount(id, count) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- PK update after tenant check
      await prisma.delivery.update({ where: { id }, data: { discrepancy_count: count } });
    },
    async attachInvoiceScan(id, url, ocr_status) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- PK update after tenant check
      await prisma.delivery.update({ where: { id }, data: { invoice_scan_url: url, ocr_status } });
    },
    async updateOcrStatus(id, status, extracted) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- PK update after tenant check
      await prisma.delivery.update({
        where: { id },
        data: {
          ocr_status: status,
          ocr_extracted_lines_json: extracted === undefined ? undefined : (extracted as object),
        },
      });
    },
    async listByRestaurant(restaurant_id) {
      const rows = await prisma.delivery.findMany({
        where: { restaurant_id },
        orderBy: { received_on: 'desc' },
      });
      return rows.map(map);
    },
    async linesFor(delivery_id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped via delivery_id FK
      const rows = await prisma.deliveryLine.findMany({ where: { delivery_id } });
      return rows.map(mapLine);
    },
    async insertLine(line) {
      await prisma.deliveryLine.create({
        data: {
          id: line.id,
          delivery_id: line.delivery_id,
          ingredient_id: line.ingredient_id,
          ordered_qty: line.ordered_qty,
          received_qty: line.received_qty,
          unit_cost_cents: line.unit_cost_cents,
          note: line.note,
        },
      });
    },
  };
}

export function prismaDeliveryCostRepo(prisma: PrismaClient): IngredientCostRepo {
  return {
    async latestCents(ingredient_id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped via ingredient_id FK
      const row = await prisma.ingredientCost.findFirst({
        where: { ingredient_id },
        orderBy: { effective_from: 'desc' },
        select: { unit_cost_cents: true },
      });
      return row?.unit_cost_cents ?? null;
    },
    async insert(row) {
      await prisma.ingredientCost.create({
        data: {
          ingredient_id: row.ingredient_id,
          unit_cost_cents: row.unit_cost_cents,
          effective_from: row.effective_from,
          source: row.source,
          note: row.note,
        },
      });
    },
  };
}

function map(r: {
  id: string; restaurant_id: string; supplier_id: string; po_id: string | null;
  received_on: Date; status: string; received_by: string | null;
  invoice_scan_url?: string | null; ocr_status?: string | null;
  discrepancy_count?: number;
  created_at: Date;
}): Delivery {
  return {
    id: r.id,
    restaurant_id: r.restaurant_id,
    supplier_id: r.supplier_id,
    po_id: r.po_id,
    received_on: r.received_on,
    status: r.status as DeliveryStatus,
    received_by: r.received_by,
    invoice_scan_url: r.invoice_scan_url ?? null,
    ocr_status: (r.ocr_status ?? 'none') as OcrStatus,
    discrepancy_count: r.discrepancy_count ?? 0,
    created_at: r.created_at,
  };
}

function mapLine(l: {
  id: string; delivery_id: string; ingredient_id: string;
  ordered_qty: unknown; received_qty: unknown; unit_cost_cents: number; note: string | null;
}): DeliveryLine {
  return {
    id: l.id,
    delivery_id: l.delivery_id,
    ingredient_id: l.ingredient_id,
    ordered_qty: l.ordered_qty == null ? null : Number(l.ordered_qty),
    received_qty: Number(l.received_qty),
    unit_cost_cents: l.unit_cost_cents,
    note: l.note,
  };
}

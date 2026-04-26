// TASK-052 — Prisma-backed repos for prep sheets, runs, and par lookups.

import type { PrismaClient } from '@prisma/client';
import type {
  PrepSheetRepo, PrepRunRepo, ParRepo, PrepSheet, PrepSheetRow, PrepRun, ParForDay,
} from './service.js';

export function prismaPrepSheetRepo(prisma: PrismaClient): PrepSheetRepo {
  return {
    async findByDate(restaurant_id, date) {
      const s = await prisma.prepSheet.findFirst({
        where: { restaurant_id, date },
        include: { rows: { include: { recipe_version: { include: { recipe: true } } } } },
      });
      return s ? mapSheet(s) : null;
    },
    async insert(sheet) {
      await prisma.$transaction(async (tx) => {
        await tx.prepSheet.create({
          data: {
            id: sheet.id,
            restaurant_id: sheet.restaurant_id,
            date: sheet.date,
            generated_at: sheet.generated_at,
          },
        });
        if (sheet.rows.length > 0) {
          await tx.prepSheetRow.createMany({
            data: sheet.rows.map((r) => ({
              id: r.id,
              prep_sheet_id: r.prep_sheet_id,
              recipe_version_id: r.recipe_version_id,
              needed_qty: r.needed_qty,
              status: r.status,
              started_at: r.started_at,
              completed_at: r.completed_at,
              user_id: r.user_id,
              skip_reason: r.skip_reason,
            })),
          });
        }
      });
    },
    async getRow(id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- tenant check in service via sheet join
      const row = await prisma.prepSheetRow.findUnique({
        where: { id },
        include: { prep_sheet: true, recipe_version: { include: { recipe: true } } },
      });
      if (!row) return null;
      return {
        row: {
          id: row.id,
          prep_sheet_id: row.prep_sheet_id,
          recipe_version_id: row.recipe_version_id,
          recipe_id: row.recipe_version.recipe_id,
          recipe_name: row.recipe_version.recipe.name,
          needed_qty: Number(row.needed_qty),
          status: row.status,
          started_at: row.started_at,
          completed_at: row.completed_at,
          user_id: row.user_id,
          skip_reason: row.skip_reason,
          assigned_to_user_id: row.assigned_to_user_id ?? null,
          qc_signed_by_user_id: row.qc_signed_by_user_id ?? null,
          qc_signed_at: row.qc_signed_at ?? null,
          temp_f: row.temp_f == null ? null : Number(row.temp_f),
        },
        restaurant_id: row.prep_sheet.restaurant_id,
      };
    },
    async updateRow(id, patch) {
      const data: Record<string, unknown> = {};
      if (patch.status !== undefined) data['status'] = patch.status;
      if (patch.started_at !== undefined) data['started_at'] = patch.started_at;
      if (patch.completed_at !== undefined) data['completed_at'] = patch.completed_at;
      if (patch.user_id !== undefined) data['user_id'] = patch.user_id;
      if (patch.skip_reason !== undefined) data['skip_reason'] = patch.skip_reason;
      if (patch.assigned_to_user_id !== undefined) data['assigned_to_user_id'] = patch.assigned_to_user_id;
      if (patch.qc_signed_by_user_id !== undefined) data['qc_signed_by_user_id'] = patch.qc_signed_by_user_id;
      if (patch.qc_signed_at !== undefined) data['qc_signed_at'] = patch.qc_signed_at;
      if (patch.temp_f !== undefined) data['temp_f'] = patch.temp_f;
      if (patch.needed_qty !== undefined) data['needed_qty'] = patch.needed_qty;
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- PK update after tenant check
      await prisma.prepSheetRow.update({ where: { id }, data });
    },
  };
}

export function prismaPrepRunRepo(prisma: PrismaClient): PrepRunRepo {
  return {
    async insert(run) {
      await prisma.prepRun.create({
        data: {
          id: run.id,
          recipe_version_id: run.recipe_version_id,
          prepared_on: run.prepared_on,
          prepared_by_user_id: run.prepared_by_user_id,
          qty_yielded: run.qty_yielded,
          expires_on: run.expires_on,
          created_at: run.created_at,
        },
      });
    },
    async onHandWithinShelfLife(recipe_version_id, shelf_life_days, asOf) {
      const cutoff = shelf_life_days == null
        ? new Date(0)
        : new Date(asOf.getTime() - shelf_life_days * 86_400_000);
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped via recipe_version_id FK
      const runs = await prisma.prepRun.findMany({
        where: {
          recipe_version_id,
          prepared_on: { gte: cutoff },
        },
        select: { qty_yielded: true },
      });
      return runs.reduce((sum, r) => sum + Number(r.qty_yielded), 0);
    },
  };
}

export function prismaParRepo(prisma: PrismaClient): ParRepo {
  return {
    async forDayOfWeek(restaurant_id, day_of_week) {
      const rows = await prisma.parLevel.findMany({
        where: { restaurant_id, day_of_week },
        include: {
          recipe: {
            include: {
              versions: { where: { is_current: true }, take: 1 },
            },
          },
        },
      });
      return rows
        .filter((r) => r.recipe.versions.length > 0 && !r.recipe.is_archived)
        .map<ParForDay>((r) => ({
          recipe_id: r.recipe_id,
          recipe_version_id: r.recipe.versions[0]!.id,
          recipe_name: r.recipe.name,
          qty: Number(r.qty),
          shelf_life_days: r.recipe.versions[0]!.shelf_life_days,
        }));
    },
  };
}

function mapSheet(s: {
  id: string; restaurant_id: string; date: Date; generated_at: Date;
  rows: Array<{
    id: string; prep_sheet_id: string; recipe_version_id: string;
    needed_qty: unknown; status: string;
    started_at: Date | null; completed_at: Date | null;
    user_id: string | null; skip_reason: string | null;
    assigned_to_user_id?: string | null; qc_signed_by_user_id?: string | null;
    qc_signed_at?: Date | null; temp_f?: unknown;
    recipe_version: { recipe_id: string; recipe: { name: string } };
  }>;
}): PrepSheet {
  return {
    id: s.id,
    restaurant_id: s.restaurant_id,
    date: s.date,
    generated_at: s.generated_at,
    rows: s.rows.map<PrepSheetRow>((r) => ({
      id: r.id,
      prep_sheet_id: r.prep_sheet_id,
      recipe_version_id: r.recipe_version_id,
      recipe_id: r.recipe_version.recipe_id,
      recipe_name: r.recipe_version.recipe.name,
      needed_qty: Number(r.needed_qty),
      status: r.status as PrepSheetRow['status'],
      started_at: r.started_at,
      completed_at: r.completed_at,
      user_id: r.user_id,
      skip_reason: r.skip_reason,
      assigned_to_user_id: r.assigned_to_user_id ?? null,
      qc_signed_by_user_id: r.qc_signed_by_user_id ?? null,
      qc_signed_at: r.qc_signed_at ?? null,
      temp_f: r.temp_f == null ? null : Number(r.temp_f),
    })),
  };
}

export type _PrepRun = PrepRun;

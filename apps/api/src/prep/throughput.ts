// Prep throughput leaderboard — ranks staff by rows completed, average
// turnaround, and QC sign rate over a trailing window. Useful for spotting
// bottlenecks and recognising high performers.

import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { anyAuthed } from '../rbac/guard.js';

export interface PrepThroughputRow {
  user_id: string;
  user_name: string;
  user_role: string;
  rows_completed: number;
  rows_qc_signed: number;
  qc_rate_pct: number;
  avg_minutes_per_row: number | null;
  on_time_rate_pct: number | null;
}

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

export async function registerPrepThroughputRoute(
  app: FastifyInstance,
  prisma: PrismaClient,
): Promise<void> {
  app.get<{ Querystring: { sinceDays?: string } }>(
    '/api/v1/reports/prep-throughput',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const rid = req.auth!.restaurant_id;
      const sinceDays = req.query.sinceDays ? Number(req.query.sinceDays) : 7;
      const since = new Date(Date.now() - sinceDays * 86_400_000);

      const rows = await prisma.prepSheetRow.findMany({
        where: {
          prep_sheet: { restaurant_id: rid },
          completed_at: { gte: since },
          user_id: { not: null },
        },
        select: {
          user_id: true,
          started_at: true,
          completed_at: true,
          qc_signed_by_user_id: true,
          prep_sheet: { select: { date: true } },
        },
      });

      const byUser = new Map<string, {
        completed: number; qcSigned: number;
        totalMinutes: number; minuteCount: number;
        onTime: number; onTimeTotal: number;
      }>();

      for (const r of rows) {
        if (!r.user_id || !r.completed_at) continue;
        const bucket = byUser.get(r.user_id) ?? {
          completed: 0, qcSigned: 0,
          totalMinutes: 0, minuteCount: 0,
          onTime: 0, onTimeTotal: 0,
        };
        bucket.completed += 1;
        if (r.qc_signed_by_user_id) bucket.qcSigned += 1;
        if (r.started_at) {
          const mins = (r.completed_at.getTime() - r.started_at.getTime()) / 60_000;
          if (mins >= 0 && mins < 24 * 60) {
            bucket.totalMinutes += mins;
            bucket.minuteCount += 1;
          }
        }
        if (r.prep_sheet?.date) {
          bucket.onTimeTotal += 1;
          const sheetEnd = new Date(r.prep_sheet.date);
          sheetEnd.setUTCHours(23, 59, 59, 999);
          if (r.completed_at.getTime() <= sheetEnd.getTime()) bucket.onTime += 1;
        }
        byUser.set(r.user_id, bucket);
      }

      if (byUser.size === 0) return envelope([], null);

      const users = await prisma.user.findMany({
        where: { id: { in: Array.from(byUser.keys()) } },
        select: { id: true, email: true, name: true, role: true },
      });
      const userMap = new Map(users.map((u) => [u.id, u]));

      const result: PrepThroughputRow[] = Array.from(byUser.entries()).map(([userId, b]) => {
        const u = userMap.get(userId);
        return {
          user_id: userId,
          user_name: u?.name ?? u?.email ?? 'Unknown',
          user_role: u?.role ?? 'staff',
          rows_completed: b.completed,
          rows_qc_signed: b.qcSigned,
          qc_rate_pct: b.completed > 0 ? Math.round((b.qcSigned / b.completed) * 1000) / 10 : 0,
          avg_minutes_per_row: b.minuteCount > 0 ? Math.round((b.totalMinutes / b.minuteCount) * 10) / 10 : null,
          on_time_rate_pct: b.onTimeTotal > 0 ? Math.round((b.onTime / b.onTimeTotal) * 1000) / 10 : null,
        };
      });

      result.sort((a, b) => b.rows_completed - a.rows_completed);
      return envelope(result, null);
    },
  );
}

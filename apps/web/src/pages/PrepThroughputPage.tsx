// Prep throughput leaderboard — rows completed, avg turnaround, QC rate, on-time rate per staff.
// Spot bottlenecks (slow turnaround), training wins (high QC rate), reliability (on-time %).

import { useEffect, useMemo, useState } from 'react';
import { Users, Timer, ShieldCheck, Trophy } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';
import { KPIStrip } from '../components/charts/KPIStrip.js';
import { Field, Select } from '../components/ui/Input.js';

interface Row {
  user_id: string;
  user_name: string;
  user_role: string;
  rows_completed: number;
  rows_qc_signed: number;
  qc_rate_pct: number;
  avg_minutes_per_row: number | null;
  on_time_rate_pct: number | null;
}

function pace(minutes: number | null): { label: string; tone: 'success' | 'warn' | 'danger' | 'neutral' } {
  if (minutes == null) return { label: '—', tone: 'neutral' };
  if (minutes < 15) return { label: `${minutes.toFixed(0)}m`, tone: 'success' };
  if (minutes < 30) return { label: `${minutes.toFixed(0)}m`, tone: 'warn' };
  return { label: `${minutes.toFixed(0)}m`, tone: 'danger' };
}

export default function PrepThroughputPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [window, setWindow] = useState<7 | 14 | 30>(7);

  useEffect(() => {
    void (async () => {
      setLoaded(false);
      const r = await apiFetch<Row[]>(`/api/v1/reports/prep-throughput?sinceDays=${window}`);
      setRows(r.data ?? []);
      setLoaded(true);
    })();
  }, [window]);

  const { totalRows, topByVolume, avgQc, avgPace } = useMemo(() => {
    const total = rows.reduce((s, r) => s + r.rows_completed, 0);
    const top = [...rows].sort((a, b) => b.rows_completed - a.rows_completed)[0];
    const withQc = rows.filter((r) => r.rows_completed > 0);
    const qc = withQc.length > 0 ? withQc.reduce((s, r) => s + r.qc_rate_pct, 0) / withQc.length : 0;
    const withPace = rows.filter((r) => r.avg_minutes_per_row != null);
    const pc = withPace.length > 0
      ? withPace.reduce((s, r) => s + (r.avg_minutes_per_row ?? 0), 0) / withPace.length
      : null;
    return { totalRows: total, topByVolume: top, avgQc: qc, avgPace: pc };
  }, [rows]);

  const kpiCards = [
    {
      label: 'Active cooks',
      value: rows.length,
      hint: `Trailing ${window} days`,
      icon: Users,
      tone: rows.length > 0 ? ('brand' as const) : ('neutral' as const),
    },
    {
      label: 'Prep rows done',
      value: totalRows,
      hint: rows.length > 0 ? `${(totalRows / Math.max(rows.length, 1)).toFixed(1)} avg per cook` : 'No activity',
      icon: Trophy,
      tone: 'neutral' as const,
    },
    {
      label: 'Avg turnaround',
      value: avgPace != null ? `${avgPace.toFixed(0)}m` : '—',
      hint: 'Start → complete',
      icon: Timer,
      tone: avgPace == null ? ('neutral' as const) : avgPace < 20 ? ('success' as const) : avgPace < 35 ? ('warn' as const) : ('danger' as const),
    },
    {
      label: 'QC sign rate',
      value: `${avgQc.toFixed(0)}%`,
      hint: 'Rows with QC initials',
      icon: ShieldCheck,
      tone: avgQc >= 90 ? ('success' as const) : avgQc >= 60 ? ('warn' as const) : ('danger' as const),
    },
  ];

  return (
    <>
      <PageHeader
        title="Prep Throughput"
        description="Who's producing, how fast, and how reliably — leaderboard across the trailing window."
        actions={
          <Field label="Window" className="w-40 mb-0">
            <Select value={String(window)} onChange={(e) => setWindow(Number(e.target.value) as 7 | 14 | 30)}>
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
            </Select>
          </Field>
        }
      />

      <KPIStrip cards={kpiCards} className="mb-4" />

      {topByVolume && totalRows > 0 && (
        <div
          role="note"
          className="mb-4 flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          <Trophy className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden />
          <div>
            <div className="font-semibold">
              {topByVolume.user_name} leads with {topByVolume.rows_completed} rows
              {topByVolume.avg_minutes_per_row != null && ` at ${topByVolume.avg_minutes_per_row.toFixed(0)}m avg`}
            </div>
            <div className="text-xs mt-0.5">
              QC-signed {topByVolume.qc_rate_pct.toFixed(0)}% · on-time {topByVolume.on_time_rate_pct?.toFixed(0) ?? '—'}%.
            </div>
          </div>
        </div>
      )}

      <Card padded={false}>
        <CardHeader className="px-5 pt-5" title="Leaderboard" description="Sorted by rows completed." />
        <Table>
          <thead>
            <tr>
              <Th>Cook</Th>
              <Th>Role</Th>
              <Th className="text-right">Rows done</Th>
              <Th className="text-right">Avg pace</Th>
              <Th className="text-right">QC sign rate</Th>
              <Th className="text-right">On-time</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {rows.map((r, i) => {
              const paceInfo = pace(r.avg_minutes_per_row);
              return (
                <TRow key={r.user_id}>
                  <Td className="font-medium text-slate-900">
                    <span className="inline-flex items-center gap-2">
                      {i === 0 && <Trophy className="h-4 w-4 text-amber-500" aria-hidden />}
                      {r.user_name}
                    </span>
                  </Td>
                  <Td className="text-slate-500 text-xs uppercase tracking-wide">{r.user_role}</Td>
                  <Td className="text-right tabular-nums font-semibold">{r.rows_completed}</Td>
                  <Td className="text-right tabular-nums">
                    <Badge tone={paceInfo.tone}>{paceInfo.label}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums">
                    <span className={r.qc_rate_pct >= 90 ? 'text-emerald-700' : r.qc_rate_pct >= 60 ? 'text-amber-700' : 'text-red-700'}>
                      {r.qc_rate_pct.toFixed(0)}%
                    </span>
                    <span className="text-slate-400 text-xs ml-1">({r.rows_qc_signed})</span>
                  </Td>
                  <Td className="text-right tabular-nums text-slate-500">
                    {r.on_time_rate_pct != null ? `${r.on_time_rate_pct.toFixed(0)}%` : '—'}
                  </Td>
                </TRow>
              );
            })}
          </tbody>
        </Table>
        {loaded && rows.length === 0 && (
          <div className="px-5 py-6">
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title="No prep rows completed in this window."
              hint="Try a longer window, or encourage staff to mark prep rows complete as they go."
            />
          </div>
        )}
      </Card>
    </>
  );
}

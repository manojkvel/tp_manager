// v1.7 Wave 7 — Price Creep: alert banner + multi-series trend line + table.
// v1.8 — projected monthly $ impact per flagged ingredient (delta × 30-day usage).

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, TrendingUp, DollarSign } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';
import { KPIStrip } from '../components/charts/KPIStrip.js';
import { LineChart, type LineSeries } from '../components/charts/LineChart.js';

interface TrendPoint { observed_at: string; unit_cost_cents: number }
interface CreepRow {
  ingredient_id: string; ingredient_name: string;
  previous_cents: number; latest_cents: number;
  delta_pct: number; observed_at: string;
  deliveries: TrendPoint[];
  usage_last_30_days: number | null;
  monthly_impact_cents: number | null;
}

function usd(cents: number): string { return `$${(cents / 100).toFixed(2)}`; }
function usdLarge(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${dollars.toFixed(0)}`;
}

export default function PriceCreepPage() {
  const [rows, setRows] = useState<CreepRow[]>([]);
  useEffect(() => {
    void (async () => {
      const r = await apiFetch<CreepRow[]>('/api/v1/reports/price-creep/trend');
      setRows(r.data ?? []);
    })();
  }, []);

  const top = useMemo(() => [...rows].sort((a, b) => b.delta_pct - a.delta_pct).slice(0, 5), [rows]);

  // Build wide-format chart data: each delivery index → { label, [ingredient_name]: cost$ }.
  const { chartData, series } = useMemo(() => {
    const series: LineSeries[] = top.map((r) => ({ key: r.ingredient_id, label: r.ingredient_name }));
    const maxDeliveries = top.reduce((m, r) => Math.max(m, r.deliveries.length), 0);
    const chartData: Array<Record<string, unknown>> = [];
    for (let i = 0; i < maxDeliveries; i += 1) {
      const row: Record<string, unknown> = { label: `D-${maxDeliveries - i}` };
      for (const r of top) {
        const d = r.deliveries.slice().reverse()[i]; // oldest → newest
        if (d) row[r.ingredient_id] = d.unit_cost_cents / 100;
      }
      chartData.push(row);
    }
    return { chartData, series };
  }, [top]);

  const critical = rows.filter((r) => r.delta_pct > 15).length;
  const monthlyImpact = rows.reduce((s, r) => s + (r.monthly_impact_cents ?? 0), 0);
  const annualImpact = monthlyImpact * 12;
  const topImpact = [...rows]
    .filter((r) => r.monthly_impact_cents != null)
    .sort((a, b) => (b.monthly_impact_cents ?? 0) - (a.monthly_impact_cents ?? 0))[0];

  const kpiCards = [
    {
      label: 'Flagged ingredients',
      value: rows.length,
      hint: critical > 0 ? `${critical} critical (>15%)` : 'All within watch range',
      icon: AlertTriangle,
      tone: critical > 0 ? ('danger' as const) : rows.length > 0 ? ('warn' as const) : ('success' as const),
    },
    {
      label: 'Projected monthly cost',
      value: monthlyImpact > 0 ? usdLarge(monthlyImpact) : '—',
      hint: 'At current usage volume',
      icon: DollarSign,
      tone: monthlyImpact > 0 ? ('warn' as const) : ('neutral' as const),
    },
    {
      label: 'Annualized',
      value: annualImpact > 0 ? usdLarge(annualImpact) : '—',
      hint: 'If prices hold through next year',
      icon: TrendingUp,
      tone: annualImpact > 0 ? ('warn' as const) : ('neutral' as const),
    },
    {
      label: 'Top offender',
      value: topImpact ? usdLarge(topImpact.monthly_impact_cents ?? 0) : '—',
      hint: topImpact ? topImpact.ingredient_name : 'Needs usage data',
      icon: DollarSign,
      tone: topImpact ? ('danger' as const) : ('neutral' as const),
    },
  ];

  return (
    <>
      <PageHeader
        title="Price Creep"
        description="Ingredients whose unit cost drifted ≥ 5% over the trailing 30 days."
      />

      <KPIStrip cards={kpiCards} className="mb-4" />

      {rows.length > 0 && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden />
          <div>
            <div className="font-semibold">
              {rows.length} flagged ingredient{rows.length === 1 ? '' : 's'}
              {critical > 0 && <span className="ml-1 text-red-700">· {critical} critical (&gt;15%)</span>}
            </div>
            <div className="text-xs mt-0.5">
              Review supplier pricing or renegotiate — rising costs erode menu margin quickly.
            </div>
          </div>
        </div>
      )}

      <Card className="mb-4">
        <CardHeader
          title={<span className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-slate-500" />Price trend — top 5 flagged</span>}
          description="Last 3 delivery prices (oldest → newest)."
        />
        {chartData.length === 0
          ? <EmptyState title="No trend data yet." hint="Prices appear once at least two deliveries exist for the flagged ingredients." />
          : <LineChart data={chartData} xKey="label" series={series} yFormat={(n) => `$${n.toFixed(2)}`} />}
      </Card>

      <Card padded={false}>
        <CardHeader className="px-5 pt-5" title="Flagged ingredients" />
        <Table>
          <thead>
            <tr>
              <Th>Ingredient</Th>
              <Th className="text-right">Previous</Th>
              <Th className="text-right">Latest</Th>
              <Th className="text-right">Delta</Th>
              <Th className="text-right">30-day usage</Th>
              <Th className="text-right">Monthly impact</Th>
              <Th>Severity</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {[...rows]
              .sort((a, b) => (b.monthly_impact_cents ?? 0) - (a.monthly_impact_cents ?? 0))
              .map((r) => (
              <TRow key={r.ingredient_id}>
                <Td className="font-medium">{r.ingredient_name}</Td>
                <Td className="text-right tabular-nums">{usd(r.previous_cents)}</Td>
                <Td className="text-right tabular-nums">{usd(r.latest_cents)}</Td>
                <Td className="text-right tabular-nums">+{r.delta_pct.toFixed(1)}%</Td>
                <Td className="text-right tabular-nums text-slate-500">
                  {r.usage_last_30_days != null
                    ? r.usage_last_30_days.toFixed(1)
                    : <span className="text-slate-300">—</span>}
                </Td>
                <Td className="text-right tabular-nums font-semibold">
                  {r.monthly_impact_cents != null && r.monthly_impact_cents !== 0
                    ? <span className={r.monthly_impact_cents > 0 ? 'text-red-700' : 'text-emerald-700'}>
                        {r.monthly_impact_cents > 0 ? '+' : ''}{usd(r.monthly_impact_cents)}
                      </span>
                    : <span className="text-slate-300">—</span>}
                </Td>
                <Td>
                  <Badge tone={r.delta_pct > 15 ? 'danger' : 'warn'}>
                    {r.delta_pct > 15 ? 'Major' : 'Watch'}
                  </Badge>
                </Td>
              </TRow>
            ))}
          </tbody>
        </Table>
        {rows.length === 0 && <div className="px-5 py-6"><EmptyState title="No price-creep rows in the window." /></div>}
      </Card>
    </>
  );
}

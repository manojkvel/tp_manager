// v1.7 Wave 7 — Actual vs Theoretical variance: KPI strip + horizontal bar + table.

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, DollarSign, Target } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';
import { KPIStrip } from '../components/charts/KPIStrip.js';
import { HorizontalBarChart, type HBarPoint } from '../components/charts/HorizontalBarChart.js';

type Tier = 'critical' | 'warning' | 'ok';

interface AvtRow {
  menu_recipe_id: string; menu_recipe_name: string; qty_sold: number;
  theoretical_cost_cents: number; actual_cost_cents: number;
  variance_cents: number; variance_pct: number; tier?: Tier;
}

interface AvtSummary {
  total_theoretical_cents: number;
  total_actual_cents: number;
  total_variance_cents: number;
  items_over_threshold: number;
  rows: AvtRow[];
}

function usd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${Math.abs(cents / 100).toFixed(2)}`;
}

function tierLabel(t: Tier | undefined): { tone: 'danger' | 'warn' | 'success'; label: string } {
  if (t === 'critical') return { tone: 'danger', label: 'Critical' };
  if (t === 'warning') return { tone: 'warn', label: 'Warning' };
  return { tone: 'success', label: 'OK' };
}

export default function AvTVariancePage() {
  const [summary, setSummary] = useState<AvtSummary | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<AvtSummary>('/api/v1/reports/avt/summary');
      setSummary(r.data ?? null);
    })();
  }, []);

  const rows = summary?.rows ?? [];

  const chartData: HBarPoint[] = useMemo(() => {
    return [...rows]
      .sort((a, b) => Math.abs(b.variance_cents) - Math.abs(a.variance_cents))
      .slice(0, 12)
      .map((r) => ({
        label: r.menu_recipe_name,
        value: r.variance_cents / 100,
        tone: r.tier === 'critical' ? 'critical' : r.tier === 'warning' ? 'warning' : 'ok',
      }));
  }, [rows]);

  const kpis = [
    { label: 'Total Variance', value: summary ? usd(summary.total_variance_cents) : '—', hint: 'Actual − Theoretical', icon: DollarSign, tone: (summary && summary.total_variance_cents > 0 ? 'danger' : 'success') as 'danger' | 'success' },
    { label: 'Items Over Threshold', value: summary?.items_over_threshold ?? 0, hint: '≥ 5% variance', icon: AlertTriangle, tone: 'warn' as const },
    { label: 'Theoretical Cost', value: summary ? usd(summary.total_theoretical_cents) : '—', hint: 'Trailing 7 days', icon: Target, tone: 'neutral' as const },
    { label: 'Actual Cost', value: summary ? usd(summary.total_actual_cents) : '—', hint: 'Trailing 7 days', icon: DollarSign, tone: 'brand' as const },
  ];

  return (
    <>
      <PageHeader
        title="Actual vs Theoretical Variance"
        description="Compare what your menu recipes should cost against what your inventory reports they actually cost."
      />

      <KPIStrip cards={kpis} className="mb-4" />

      <Card className="mb-4">
        <CardHeader title="Formula" description="Start + Received − Counted − POS Usage" />
        <div className="text-xs text-slate-600 leading-relaxed">
          Variance tiers: <span className="font-medium text-red-700">Critical &gt;10%</span>,
          {' '}<span className="font-medium text-amber-700">Warning 5-10%</span>,
          {' '}<span className="font-medium text-emerald-700">OK &lt;5%</span>.
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader title="Variance by menu item" description="Top 12 by absolute variance ($)." />
        {chartData.length === 0
          ? <EmptyState title="No variance data yet." hint="Variance appears once you have POS sales joined to menu recipes." />
          : <HorizontalBarChart data={chartData} format={(n) => `$${n.toFixed(0)}`} />}
      </Card>

      <Card padded={false}>
        <CardHeader className="px-5 pt-5" title="Full variance breakdown" />
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th className="text-right">Qty Sold</Th>
              <Th className="text-right">Theoretical</Th>
              <Th className="text-right">Actual</Th>
              <Th className="text-right">Variance</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {rows.map((r) => {
              const t = tierLabel(r.tier);
              return (
                <TRow key={r.menu_recipe_id}>
                  <Td className="font-medium">{r.menu_recipe_name}</Td>
                  <Td className="text-right tabular-nums">{r.qty_sold.toFixed(0)}</Td>
                  <Td className="text-right tabular-nums">{usd(r.theoretical_cost_cents)}</Td>
                  <Td className="text-right tabular-nums">{usd(r.actual_cost_cents)}</Td>
                  <Td className="text-right tabular-nums">{usd(r.variance_cents)} ({r.variance_pct.toFixed(1)}%)</Td>
                  <Td><Badge tone={t.tone}>{t.label}</Badge></Td>
                </TRow>
              );
            })}
          </tbody>
        </Table>
        {rows.length === 0 && <div className="px-5 py-6"><EmptyState title="No variance rows." /></div>}
      </Card>
    </>
  );
}

// Menu-item contribution — which dishes actually pay the rent.
// Ranks by absolute margin $ (qty × per-item margin) over trailing 30 days.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, DollarSign, Flame, Snowflake } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';
import { KPIStrip } from '../components/charts/KPIStrip.js';
import { HorizontalBarChart, type HBarPoint } from '../components/charts/HorizontalBarChart.js';

interface Row {
  menu_recipe_id: string;
  menu_recipe_name: string;
  qty_sold: number;
  revenue_cents: number;
  theoretical_cost_cents: number;
  margin_cents: number;
  margin_pct: number;
  cost_pct: number;
  share_of_profit_pct: number;
}

function usd(cents: number): string { return `$${(cents / 100).toFixed(2)}`; }
function usdLarge(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${dollars.toFixed(0)}`;
}

type Classification = 'star' | 'workhorse' | 'puzzle' | 'dog';

function classify(r: Row, medianQty: number, medianMargin: number): Classification {
  const highQty = r.qty_sold >= medianQty;
  const highMargin = r.margin_pct >= medianMargin;
  if (highQty && highMargin) return 'star';
  if (highQty && !highMargin) return 'workhorse';
  if (!highQty && highMargin) return 'puzzle';
  return 'dog';
}

const CLASS_LABEL: Record<Classification, string> = {
  star: 'Star',
  workhorse: 'Workhorse',
  puzzle: 'Puzzle',
  dog: 'Dog',
};

function classBadgeTone(c: Classification): 'success' | 'warn' | 'neutral' | 'danger' {
  if (c === 'star') return 'success';
  if (c === 'workhorse') return 'warn';
  if (c === 'puzzle') return 'neutral';
  return 'danger';
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export default function MenuContributionPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<Row[]>('/api/v1/reports/menu-contribution');
      setRows(r.data ?? []);
      setLoaded(true);
    })();
  }, []);

  const { totalRevenue, totalMargin, avgMarginPct, topItem, medianQty, medianMargin } = useMemo(() => {
    const totalRev = rows.reduce((s, r) => s + r.revenue_cents, 0);
    const totalMar = rows.reduce((s, r) => s + r.margin_cents, 0);
    const avgPct = totalRev > 0 ? (totalMar / totalRev) * 100 : 0;
    const top = [...rows].sort((a, b) => b.margin_cents - a.margin_cents)[0];
    const mq = median(rows.map((r) => r.qty_sold));
    const mm = median(rows.map((r) => r.margin_pct));
    return { totalRevenue: totalRev, totalMargin: totalMar, avgMarginPct: avgPct, topItem: top, medianQty: mq, medianMargin: mm };
  }, [rows]);

  const classified = useMemo(() => rows.map((r) => ({
    ...r,
    classification: classify(r, medianQty, medianMargin),
  })), [rows, medianQty, medianMargin]);

  const chartData = useMemo<HBarPoint[]>(() => {
    return [...classified]
      .sort((a, b) => b.margin_cents - a.margin_cents)
      .slice(0, 10)
      .map((r) => ({
        label: r.menu_recipe_name.length > 22 ? r.menu_recipe_name.slice(0, 21) + '…' : r.menu_recipe_name,
        value: Math.round(r.margin_cents / 100),
        tone: r.classification === 'star' ? 'ok' : r.classification === 'dog' ? 'critical' : 'warning',
      }));
  }, [classified]);

  const dogCount = classified.filter((r) => r.classification === 'dog').length;
  const starCount = classified.filter((r) => r.classification === 'star').length;

  const kpiCards = [
    {
      label: 'Total revenue',
      value: totalRevenue > 0 ? usdLarge(totalRevenue) : '—',
      hint: 'Trailing 30 days',
      icon: DollarSign,
      tone: 'neutral' as const,
    },
    {
      label: 'Gross margin',
      value: totalMargin > 0 ? usdLarge(totalMargin) : '—',
      hint: `${avgMarginPct.toFixed(1)}% of revenue`,
      icon: TrendingUp,
      tone: avgMarginPct >= 65 ? ('success' as const) : avgMarginPct >= 55 ? ('warn' as const) : ('danger' as const),
    },
    {
      label: 'Stars',
      value: starCount,
      hint: 'High volume + high margin',
      icon: Flame,
      tone: starCount > 0 ? ('success' as const) : ('neutral' as const),
    },
    {
      label: 'Dogs',
      value: dogCount,
      hint: 'Low volume + low margin',
      icon: Snowflake,
      tone: dogCount > 0 ? ('danger' as const) : ('success' as const),
    },
  ];

  return (
    <>
      <PageHeader
        title="Menu Contribution"
        description="Which menu items pay the rent — ranked by absolute gross margin over the last 30 days."
      />

      <KPIStrip cards={kpiCards} className="mb-4" />

      {topItem && (
        <div
          role="note"
          className="mb-4 flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          <Flame className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden />
          <div>
            <div className="font-semibold">
              {topItem.menu_recipe_name} contributes {usdLarge(topItem.margin_cents)} ({topItem.share_of_profit_pct.toFixed(0)}% of profit)
            </div>
            <div className="text-xs mt-0.5">
              Protect availability on stars; rework dogs or 86 them to free up menu real estate.
            </div>
          </div>
        </div>
      )}

      <Card className="mb-4">
        <CardHeader
          title={<span className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-slate-500" />Top 10 by margin ($)</span>}
          description="Green = star · amber = workhorse/puzzle · red = dog."
        />
        {chartData.length === 0
          ? <EmptyState title="No sales yet." hint="Contribution shows up once POS sales sync and recipes are mapped." />
          : <HorizontalBarChart data={chartData} format={(n) => `$${n.toLocaleString()}`} />}
      </Card>

      <Card padded={false}>
        <CardHeader className="px-5 pt-5" title="All menu items" description="Sorted by absolute margin." />
        <Table>
          <thead>
            <tr>
              <Th>Menu item</Th>
              <Th>Class</Th>
              <Th className="text-right">Qty sold</Th>
              <Th className="text-right">Revenue</Th>
              <Th className="text-right">Cost %</Th>
              <Th className="text-right">Margin %</Th>
              <Th className="text-right">Margin $</Th>
              <Th className="text-right">Share</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {classified.map((r) => (
              <TRow key={r.menu_recipe_id}>
                <Td className="font-medium">
                  <Link to={`/recipes/${r.menu_recipe_id}`} className="text-brand-700 hover:underline">
                    {r.menu_recipe_name}
                  </Link>
                </Td>
                <Td>
                  <Badge tone={classBadgeTone(r.classification)}>{CLASS_LABEL[r.classification]}</Badge>
                </Td>
                <Td className="text-right tabular-nums text-slate-700">{r.qty_sold.toFixed(0)}</Td>
                <Td className="text-right tabular-nums text-slate-700">{usd(r.revenue_cents)}</Td>
                <Td className="text-right tabular-nums text-slate-500">{r.cost_pct.toFixed(1)}%</Td>
                <Td className={`text-right tabular-nums ${r.margin_pct >= 65 ? 'text-emerald-700' : r.margin_pct >= 55 ? 'text-amber-700' : 'text-red-700'}`}>
                  {r.margin_pct.toFixed(1)}%
                </Td>
                <Td className="text-right tabular-nums font-semibold">{usd(r.margin_cents)}</Td>
                <Td className="text-right tabular-nums text-slate-500">{r.share_of_profit_pct.toFixed(1)}%</Td>
              </TRow>
            ))}
          </tbody>
        </Table>
        {loaded && classified.length === 0 && (
          <div className="px-5 py-6">
            <EmptyState
              title="No menu-item data yet."
              hint="Sync POS sales and map aloha items to recipes to see contribution."
            />
          </div>
        )}
      </Card>
    </>
  );
}

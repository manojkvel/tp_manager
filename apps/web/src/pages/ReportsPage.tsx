// TASK-069 — Reports screens: AvT, Price Creep, Waste (§6.9).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, TrendingUp, Trash2, ArrowRight, Target, Edit3 } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';

interface AvtRow {
  menu_recipe_id: string; menu_recipe_name: string; qty_sold: number;
  theoretical_cost_cents: number; actual_cost_cents: number;
  variance_cents: number; variance_pct: number;
}

interface PriceCreepRow {
  ingredient_id: string; ingredient_name: string;
  previous_cents: number; latest_cents: number;
  delta_pct: number; observed_at: string;
}

interface WasteRow {
  reason_id: string; reason_label: string; total_value_cents: number; entries: number;
}

export default function ReportsPage() {
  const [avt, setAvt] = useState<AvtRow[]>([]);
  const [creep, setCreep] = useState<PriceCreepRow[]>([]);
  const [waste, setWaste] = useState<WasteRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [a, c, w] = await Promise.all([
        apiFetch<AvtRow[]>('/api/v1/reports/avt'),
        apiFetch<PriceCreepRow[]>('/api/v1/reports/price-creep'),
        apiFetch<WasteRow[]>('/api/v1/reports/waste'),
      ]);
      if (a.error) setErr(a.error.message);
      else setAvt(a.data ?? []);
      if (c.data) setCreep(c.data);
      if (w.data) setWaste(w.data);
    })();
  }, []);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Track cost variance, price drift, and waste across the last rolling windows."
      />

      {err && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      {/* Sub-report links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <Link
          to="/reports/forecast-accuracy"
          className="group rounded-lg border border-surface-border bg-white p-4 flex items-center gap-3 hover:border-brand-300 hover:shadow-card transition-all"
        >
          <div className="h-9 w-9 rounded-md bg-sky-50 text-sky-600 flex items-center justify-center">
            <Target className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-slate-900">Forecast accuracy</div>
            <div className="text-xs text-slate-500">MAPE, p10/p90 coverage</div>
          </div>
          <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-brand-600" />
        </Link>
        <Link
          to="/reports/forecast-overrides"
          className="group rounded-lg border border-surface-border bg-white p-4 flex items-center gap-3 hover:border-brand-300 hover:shadow-card transition-all"
        >
          <div className="h-9 w-9 rounded-md bg-brand-50 text-brand-600 flex items-center justify-center">
            <Edit3 className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-slate-900">Forecast overrides</div>
            <div className="text-xs text-slate-500">Audit operator adjustments</div>
          </div>
          <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-brand-600" />
        </Link>
      </div>

      <Card padded={false} className="mb-6">
        <CardHeader
          className="px-5 pt-5"
          title={
            <span className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-slate-500" />
              Actual vs Theoretical
            </span>
          }
          description="Last 7 days — where actual cost drifted from recipe cost."
        />
        <Table>
          <thead>
            <tr>
              <Th>Menu item</Th>
              <Th className="text-right">Qty</Th>
              <Th className="text-right">Theoretical</Th>
              <Th className="text-right">Actual</Th>
              <Th className="text-right">Variance</Th>
              <Th className="text-right">%</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {avt.map((r) => {
              const positive = r.variance_cents > 0;
              return (
                <TRow key={r.menu_recipe_id}>
                  <Td className="font-medium">{r.menu_recipe_name}</Td>
                  <Td className="text-right tabular-nums">{r.qty_sold}</Td>
                  <Td className="text-right tabular-nums text-slate-600">${(r.theoretical_cost_cents / 100).toFixed(2)}</Td>
                  <Td className="text-right tabular-nums text-slate-600">${(r.actual_cost_cents / 100).toFixed(2)}</Td>
                  <Td className={`text-right tabular-nums font-semibold ${positive ? 'text-red-600' : 'text-emerald-600'}`}>
                    {positive ? '+' : ''}${(r.variance_cents / 100).toFixed(2)}
                  </Td>
                  <Td className="text-right">
                    <Badge tone={Math.abs(r.variance_pct) >= 10 ? (positive ? 'danger' : 'success') : 'neutral'}>
                      {positive ? '+' : ''}{r.variance_pct.toFixed(1)}%
                    </Badge>
                  </Td>
                </TRow>
              );
            })}
          </tbody>
        </Table>
        {avt.length === 0 && (
          <div className="px-5 py-6"><EmptyState title="No variance data" hint="Log POS sales and prep to populate this report." /></div>
        )}
      </Card>

      <Card padded={false} className="mb-6">
        <CardHeader
          className="px-5 pt-5"
          title={
            <span className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-slate-500" />
              Price creep
              <Badge tone="warn">≥ 5%</Badge>
            </span>
          }
          description="Ingredient cost increases over the last 30 days."
        />
        <Table>
          <thead>
            <tr>
              <Th>Ingredient</Th>
              <Th className="text-right">Previous</Th>
              <Th className="text-right">Latest</Th>
              <Th className="text-right">Δ%</Th>
              <Th>Observed</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {creep.map((r) => (
              <TRow key={r.ingredient_id}>
                <Td className="font-medium">{r.ingredient_name}</Td>
                <Td className="text-right tabular-nums text-slate-600">${(r.previous_cents / 100).toFixed(2)}</Td>
                <Td className="text-right tabular-nums text-slate-600">${(r.latest_cents / 100).toFixed(2)}</Td>
                <Td className="text-right">
                  <Badge tone="danger">+{r.delta_pct.toFixed(1)}%</Badge>
                </Td>
                <Td className="text-slate-500">{r.observed_at.slice(0, 10)}</Td>
              </TRow>
            ))}
          </tbody>
        </Table>
        {creep.length === 0 && (
          <div className="px-5 py-6"><EmptyState title="No price creep detected" hint="Prices are stable across tracked ingredients." /></div>
        )}
      </Card>

      <Card padded={false}>
        <CardHeader
          className="px-5 pt-5"
          title={
            <span className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-slate-500" />
              Waste by reason
            </span>
          }
          description="Last 7 days — aggregated cost of discarded product."
        />
        <Table>
          <thead>
            <tr>
              <Th>Reason</Th>
              <Th className="text-right">Entries</Th>
              <Th className="text-right">Total value</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {waste.map((r) => (
              <TRow key={r.reason_id}>
                <Td className="font-medium">{r.reason_label}</Td>
                <Td className="text-right tabular-nums">{r.entries}</Td>
                <Td className="text-right tabular-nums font-semibold text-slate-800">
                  ${(r.total_value_cents / 100).toFixed(2)}
                </Td>
              </TRow>
            ))}
          </tbody>
        </Table>
        {waste.length === 0 && (
          <div className="px-5 py-6"><EmptyState title="No waste logged" hint="Log kitchen waste from /prep/waste to populate this report." /></div>
        )}
      </Card>
    </>
  );
}

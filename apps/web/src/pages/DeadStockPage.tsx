// Dead stock — ingredients with on-hand > 0 but zero 30-day usage and no waste.
// Surfaces idle inventory value so the owner can liquidate or 86 the item.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PackageX, DollarSign, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Table, Th, Td, TRow, EmptyState } from '../components/ui/Table.js';
import { KPIStrip } from '../components/charts/KPIStrip.js';

interface DeadStockRow {
  ingredient_id: string;
  ingredient_name: string;
  on_hand_qty: number;
  counted_at: string;
  unit_cost_cents: number | null;
  idle_value_cents: number | null;
  last_waste_at: string | null;
}

function usd(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function usdLarge(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${dollars.toFixed(0)}`;
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

export default function DeadStockPage() {
  const [rows, setRows] = useState<DeadStockRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await apiFetch<DeadStockRow[]>('/api/v1/reports/dead-stock');
      setRows(r.data ?? []);
      setLoaded(true);
    })();
  }, []);

  const { totalValue, itemsWithValue, maxIdle, topOffender } = useMemo(() => {
    const withValue = rows.filter((r) => r.idle_value_cents != null);
    const total = withValue.reduce((s, r) => s + (r.idle_value_cents ?? 0), 0);
    const top = [...withValue].sort((a, b) => (b.idle_value_cents ?? 0) - (a.idle_value_cents ?? 0))[0];
    const maxDays = rows.reduce((m, r) => Math.max(m, daysSince(r.counted_at)), 0);
    return { totalValue: total, itemsWithValue: withValue.length, maxIdle: maxDays, topOffender: top };
  }, [rows]);

  const kpiCards = [
    {
      label: 'Dead stock items',
      value: rows.length,
      hint: rows.length > 0 ? 'No sales or waste in 30 days' : 'All inventory is moving',
      icon: PackageX,
      tone: rows.length > 0 ? ('warn' as const) : ('success' as const),
    },
    {
      label: 'Idle cash',
      value: totalValue > 0 ? usdLarge(totalValue) : '—',
      hint: itemsWithValue > 0 ? `${itemsWithValue} items with cost data` : 'Needs unit costs',
      icon: DollarSign,
      tone: totalValue > 0 ? ('danger' as const) : ('neutral' as const),
    },
    {
      label: 'Oldest idle',
      value: maxIdle > 0 ? `${maxIdle}d` : '—',
      hint: 'Since last inventory count',
      icon: AlertTriangle,
      tone: maxIdle > 30 ? ('danger' as const) : ('neutral' as const),
    },
    {
      label: 'Top offender',
      value: topOffender ? usdLarge(topOffender.idle_value_cents ?? 0) : '—',
      hint: topOffender ? topOffender.ingredient_name : 'Needs unit costs',
      icon: DollarSign,
      tone: topOffender ? ('warn' as const) : ('neutral' as const),
    },
  ];

  return (
    <>
      <PageHeader
        title="Dead Stock"
        description="Ingredients on hand with no sales or waste over the last 30 days — cash tied up in inventory that isn't moving."
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
              {rows.length} idle item{rows.length === 1 ? '' : 's'} tying up {totalValue > 0 ? usdLarge(totalValue) : 'cash'}
            </div>
            <div className="text-xs mt-0.5">
              Consider a special, staff meal, or supplier return. Ingredients without POS recipes also land here — check menu mapping.
            </div>
          </div>
        </div>
      )}

      <Card padded={false}>
        <CardHeader className="px-5 pt-5" title="Idle ingredients" description="Sorted by idle value." />
        <Table>
          <thead>
            <tr>
              <Th>Ingredient</Th>
              <Th className="text-right">On hand</Th>
              <Th className="text-right">Unit cost</Th>
              <Th className="text-right">Idle value</Th>
              <Th className="text-right">Last counted</Th>
              <Th className="text-right">Last waste</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {[...rows]
              .sort((a, b) => (b.idle_value_cents ?? 0) - (a.idle_value_cents ?? 0))
              .map((r) => {
                const ageDays = daysSince(r.counted_at);
                return (
                  <TRow key={r.ingredient_id}>
                    <Td className="font-medium">
                      <Link to={`/ingredients/${r.ingredient_id}`} className="text-brand-700 hover:underline">
                        {r.ingredient_name}
                      </Link>
                    </Td>
                    <Td className="text-right tabular-nums text-slate-700">{r.on_hand_qty.toFixed(1)}</Td>
                    <Td className="text-right tabular-nums text-slate-500">{usd(r.unit_cost_cents)}</Td>
                    <Td className="text-right tabular-nums font-semibold">
                      {r.idle_value_cents != null
                        ? <span className="text-red-700">{usd(r.idle_value_cents)}</span>
                        : <span className="text-slate-300">—</span>}
                    </Td>
                    <Td className="text-right tabular-nums text-slate-500">
                      {ageDays}d ago
                    </Td>
                    <Td className="text-right tabular-nums text-slate-500">
                      {r.last_waste_at ? `${daysSince(r.last_waste_at)}d ago` : <span className="text-slate-300">never</span>}
                    </Td>
                  </TRow>
                );
              })}
          </tbody>
        </Table>
        {loaded && rows.length === 0 && (
          <div className="px-5 py-6">
            <EmptyState
              icon={<PackageX className="h-6 w-6" />}
              title="No dead stock detected."
              hint="Every ingredient with on-hand quantity has moved in the last 30 days."
            />
          </div>
        )}
      </Card>
    </>
  );
}

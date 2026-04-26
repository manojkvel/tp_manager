// v1.7 Wave 13 — Dashboard overhaul per PO design.
// 4-card KPI strip (Inventory value, Items tracked, Variance alerts, Food cost %),
// two-column chart row (AvT daily bars, weekly inventory cost line), bottom row
// with recent activity feed + quick action tiles.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet, Package, TrendingUp, Percent, ArrowRight, ClipboardList,
  ClipboardCheck, PackageCheck, ShoppingCart, Trash2, BarChart3,
  AlertTriangle, Truck, Clock, type LucideIcon,
} from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { useAuth } from '../auth/useAuth.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';
import { KPIStrip } from '../components/charts/KPIStrip.js';
import { VerticalBarChart } from '../components/charts/VerticalBarChart.js';
import { LineChart } from '../components/charts/LineChart.js';

interface InventoryKpi { value_cents: number; items_tracked: number }
interface DashboardChips { needs_supplier: number; disputed_deliveries: number }
interface AvtRow {
  menu_recipe_id: string; menu_recipe_name: string; variance_cents: number; variance_pct: number;
}
interface FoodCostPct {
  actual_cost_cents: number; sales_cents: number; food_cost_pct: number | null;
}
interface AvtDailyPoint {
  business_date: string; theoretical_cost_cents: number; actual_cost_cents: number;
}
interface InventoryCostWeeklyPoint { week_start: string; total_value_cents: number }

interface ActivityItem {
  id: string;
  at: string;
  kind: 'delivery' | 'waste' | 'count' | 'order' | 'prep';
  label: string;
  hint?: string;
}

interface DeliveryExpected {
  delivery_id: string; supplier_id: string; supplier_name: string;
  status: 'pending' | 'verified' | 'disputed';
  received_on: string; discrepancy_count: number;
}
interface Cutoff {
  supplier_id: string; supplier_name: string; cutoff_time: string;
  next_delivery_day: string; minutes_until_cutoff: number | null;
}
interface DeliverySchedule {
  deliveries_today: DeliveryExpected[];
  cutoffs_today: Cutoff[];
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function DashboardPage() {
  const session = useAuth();
  const [inv, setInv] = useState<InventoryKpi | null>(null);
  const [avt, setAvt] = useState<AvtRow[]>([]);
  const [food, setFood] = useState<FoodCostPct | null>(null);
  const [daily, setDaily] = useState<AvtDailyPoint[]>([]);
  const [weekly, setWeekly] = useState<InventoryCostWeeklyPoint[]>([]);
  const [chips, setChips] = useState<DashboardChips | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [schedule, setSchedule] = useState<DeliverySchedule | null>(null);

  useEffect(() => {
    void (async () => {
      const [i, a, f, d, w, c, act, sch] = await Promise.all([
        apiFetch<InventoryKpi>('/api/v1/inventory/kpi'),
        apiFetch<AvtRow[]>('/api/v1/reports/avt'),
        apiFetch<FoodCostPct>('/api/v1/reports/food-cost-pct'),
        apiFetch<AvtDailyPoint[]>('/api/v1/reports/avt-daily'),
        apiFetch<InventoryCostWeeklyPoint[]>('/api/v1/reports/inventory-cost-weekly'),
        apiFetch<DashboardChips>('/api/v1/dashboard/chips'),
        apiFetch<ActivityItem[]>('/api/v1/dashboard/activity'),
        apiFetch<DeliverySchedule>('/api/v1/dashboard/delivery-schedule'),
      ]);
      if (i.data) setInv(i.data);
      if (a.data) setAvt(a.data);
      if (f.data) setFood(f.data);
      if (d.data) setDaily(d.data);
      if (w.data) setWeekly(w.data);
      if (c.data) setChips(c.data);
      if (act.data) setActivity(act.data);
      if (sch.data) setSchedule(sch.data);
    })();
  }, []);

  const varianceAlerts = avt.filter((r) => Math.abs(r.variance_pct) >= 10).length;

  const kpiCards = useMemo(() => [
    {
      label: 'Total inventory value',
      value: inv ? formatUsd(inv.value_cents) : '—',
      hint: 'Stock on hand, current count',
      icon: Wallet,
      tone: 'brand' as const,
    },
    {
      label: 'Items tracked',
      value: inv?.items_tracked ?? '—',
      hint: 'Active ingredients',
      icon: Package,
      tone: 'neutral' as const,
    },
    {
      label: 'Variance alerts',
      value: varianceAlerts,
      hint: 'AvT ≥ 10% this week',
      icon: TrendingUp,
      tone: varianceAlerts > 0 ? ('warn' as const) : ('success' as const),
    },
    {
      label: 'Food cost %',
      value: food && food.food_cost_pct != null ? `${food.food_cost_pct.toFixed(1)}%` : '—',
      hint: 'Trailing 30 days',
      icon: Percent,
      tone: food && food.food_cost_pct != null && food.food_cost_pct > 35 ? ('warn' as const) : ('success' as const),
    },
  ], [inv, varianceAlerts, food]);

  const dailyChartData = useMemo(() => {
    return daily.map((d) => {
      const date = new Date(d.business_date);
      return {
        day: WEEKDAY_LABELS[date.getUTCDay()],
        theoretical: d.theoretical_cost_cents / 100,
        actual: d.actual_cost_cents / 100,
      };
    });
  }, [daily]);

  const weeklyChartData = useMemo(() => weekly.map((w) => ({
    week: new Date(w.week_start).toISOString().slice(5, 10),
    value: w.total_value_cents / 100,
  })), [weekly]);

  const greeting = timeOfDayGreeting();
  const name = session?.user.email?.split('@')[0] ?? 'there';

  return (
    <>
      <div data-testid="healthz" className="sr-only">ok</div>

      <PageHeader
        title={<span>{greeting}, <span className="capitalize">{name}</span></span>}
        description="Here's a snapshot of today's kitchen operations."
        actions={
          <Link to="/prep/sheet">
            <Button variant="primary" leftIcon={<ClipboardList className="h-4 w-4" />}>
              Today&rsquo;s prep
            </Button>
          </Link>
        }
      />

      <KPIStrip cards={kpiCards} className="mb-6" />

      {chips && (chips.needs_supplier > 0 || chips.disputed_deliveries > 0) && (
        <section className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {chips.needs_supplier > 0 && (
            <AttentionLink
              to="/ingredients?filter=needs_supplier"
              tone="warn"
              title={`${chips.needs_supplier} ingredient${chips.needs_supplier === 1 ? '' : 's'} without a supplier`}
              hint="Assign a supplier to enable ordering"
            />
          )}
          {chips.disputed_deliveries > 0 && (
            <AttentionLink
              to="/deliveries?filter=disputed"
              tone="danger"
              title={`${chips.disputed_deliveries} disputed deliver${chips.disputed_deliveries === 1 ? 'y' : 'ies'}`}
              hint="Review discrepancy and resolve"
            />
          )}
        </section>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader
            title="Actual vs Theoretical — by day"
            description="This week's cost of goods sold, theoretical plate cost vs POS sales."
            actions={
              <Link to="/reports/avt" className="text-sm font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1">
                Full AvT <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          {dailyChartData.length === 0 ? (
            <div className="text-sm text-slate-500 py-12 text-center">No sales recorded this period.</div>
          ) : (
            <VerticalBarChart
              data={dailyChartData}
              xKey="day"
              series={[
                { key: 'theoretical', label: 'Theoretical', color: '#0ea5e9' },
                { key: 'actual', label: 'Actual', color: '#ea580c' },
              ]}
              yFormat={(n) => `$${n.toFixed(0)}`}
            />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Weekly inventory cost"
            description="Total stock value at close of each completed count."
            actions={
              <Link to="/inventory" className="text-sm font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1">
                Counts <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          {weeklyChartData.length === 0 ? (
            <div className="text-sm text-slate-500 py-12 text-center">No completed counts yet.</div>
          ) : (
            <LineChart
              data={weeklyChartData}
              xKey="week"
              series={[{ key: 'value', label: 'Inventory value', color: '#10b981' }]}
              yFormat={(n) => `$${n.toFixed(0)}`}
            />
          )}
        </Card>
      </section>

      {schedule && (schedule.deliveries_today.length > 0 || schedule.cutoffs_today.length > 0) && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <Card>
            <CardHeader
              title={<span className="flex items-center gap-2"><Truck className="h-4 w-4 text-slate-500" />Deliveries today</span>}
              description={schedule.deliveries_today.length === 0 ? 'Nothing expected.' : `${schedule.deliveries_today.length} expected`}
              actions={
                <Link to="/deliveries" className="text-sm font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1">
                  All deliveries <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            {schedule.deliveries_today.length === 0 ? (
              <div className="text-sm text-slate-500 py-6 text-center">No deliveries scheduled for today.</div>
            ) : (
              <ul className="divide-y divide-surface-border">
                {schedule.deliveries_today.map((d) => (
                  <li key={d.delivery_id} className="py-2.5 flex items-center gap-3">
                    <Truck className="h-4 w-4 text-slate-400 shrink-0" />
                    <Link
                      to={`/deliveries?id=${d.delivery_id}`}
                      className="flex-1 min-w-0 text-sm font-medium text-slate-900 hover:text-brand-700 truncate"
                    >
                      {d.supplier_name}
                    </Link>
                    {d.discrepancy_count > 0 && (
                      <Badge tone="danger">{d.discrepancy_count} disc.</Badge>
                    )}
                    <Badge tone={d.status === 'verified' ? 'success' : d.status === 'disputed' ? 'danger' : 'warn'}>
                      {d.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title={<span className="flex items-center gap-2"><Clock className="h-4 w-4 text-slate-500" />Order cutoffs today</span>}
              description={schedule.cutoffs_today.length === 0 ? 'No cutoffs for tomorrow.' : 'Place orders before these deadlines.'}
              actions={
                <Link to="/orders" className="text-sm font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1">
                  New order <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            {schedule.cutoffs_today.length === 0 ? (
              <div className="text-sm text-slate-500 py-6 text-center">No supplier cutoffs today.</div>
            ) : (
              <ul className="divide-y divide-surface-border">
                {schedule.cutoffs_today.map((c) => (
                  <li key={c.supplier_id} className="py-2.5 flex items-center gap-3">
                    <Clock className={`h-4 w-4 shrink-0 ${cutoffColor(c.minutes_until_cutoff)}`} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-slate-900 truncate">{c.supplier_name}</span>
                      <span className="block text-xs text-slate-500">
                        Cutoff {c.cutoff_time} → delivery {c.next_delivery_day}
                      </span>
                    </span>
                    <span className={`text-xs font-semibold tabular-nums ${cutoffColor(c.minutes_until_cutoff)}`}>
                      {formatCountdown(c.minutes_until_cutoff)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent activity"
            description="Newest deliveries, waste entries, counts, orders, and prep."
          />
          {activity.length === 0 ? (
            <div className="text-sm text-slate-500 py-8 text-center">Nothing recent to show.</div>
          ) : (
            <ul className="divide-y divide-surface-border">
              {activity.slice(0, 8).map((a) => (
                <li key={a.id} className="py-2.5 flex items-center gap-3">
                  <ActivityDot kind={a.kind} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-slate-900 truncate">{a.label}</span>
                    {a.hint && <span className="block text-xs text-slate-500">{a.hint}</span>}
                  </span>
                  <span className="text-xs text-slate-400 shrink-0 tabular-nums">
                    {formatRelativeTime(a.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Quick actions" />
          <div className="grid grid-cols-2 gap-3">
            <QuickAction to="/inventory"   label="New count"    icon={ClipboardCheck} tone="brand"   />
            <QuickAction to="/prep/waste"  label="Log waste"    icon={Trash2}         tone="neutral" />
            <QuickAction to="/deliveries"  label="Scan invoice" icon={PackageCheck}   tone="neutral" />
            <QuickAction to="/orders"      label="New order"    icon={ShoppingCart}   tone="neutral" />
            <QuickAction to="/prep/sheet"  label="Prep sheet"   icon={ClipboardList}  tone="neutral" />
            <QuickAction to="/reports"     label="Reports"      icon={BarChart3}      tone="neutral" />
          </div>
        </Card>
      </section>
    </>
  );
}

function ActivityDot({ kind }: { kind: ActivityItem['kind'] }) {
  const cls: Record<ActivityItem['kind'], string> = {
    delivery: 'bg-sky-500',
    waste:    'bg-red-500',
    count:    'bg-brand-500',
    order:    'bg-violet-500',
    prep:     'bg-emerald-500',
  };
  return <span className={`h-2 w-2 rounded-full shrink-0 ${cls[kind]}`} />;
}

function QuickAction({
  to, label, icon: Icon, tone,
}: { to: string; label: string; icon: LucideIcon; tone: 'brand' | 'neutral' }) {
  const brand = tone === 'brand';
  return (
    <Link
      to={to}
      className={
        brand
          ? 'group rounded-lg p-3 bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-card hover:shadow-card-hover transition-shadow'
          : 'group rounded-lg p-3 bg-white border border-surface-border shadow-card hover:shadow-card-hover hover:border-brand-300 transition-all'
      }
    >
      <div className={brand ? 'h-8 w-8 rounded-md bg-white/15 flex items-center justify-center' : 'h-8 w-8 rounded-md bg-brand-50 text-brand-600 flex items-center justify-center'}>
        <Icon className="h-4 w-4" />
      </div>
      <div className={brand ? 'mt-2 text-xs font-semibold' : 'mt-2 text-xs font-medium text-slate-900'}>
        {label}
      </div>
    </Link>
  );
}

function AttentionLink({
  to, tone, title, hint,
}: { to: string; tone: 'warn' | 'danger'; title: string; hint: string }) {
  const styles = tone === 'danger'
    ? { wrap: 'bg-red-50 border-red-200 hover:bg-red-100',     dot: 'bg-red-500',   fg: 'text-red-900' }
    : { wrap: 'bg-amber-50 border-amber-200 hover:bg-amber-100', dot: 'bg-amber-500', fg: 'text-amber-900' };
  return (
    <Link
      to={to}
      className={`group flex items-start gap-3 rounded-md border px-3 py-2.5 transition-colors ${styles.wrap}`}
    >
      <AlertTriangle className={`h-4 w-4 mt-0.5 ${tone === 'danger' ? 'text-red-600' : 'text-amber-600'}`} />
      <span className="flex-1 min-w-0">
        <span className={`block text-sm font-medium ${styles.fg}`}>{title}</span>
        <span className="block text-xs text-slate-600">{hint}</span>
      </span>
      <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 mt-1" />
      <span aria-hidden className={`hidden ${styles.dot}`} />
    </Link>
  );
}

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5)  return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatUsd(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${dollars.toFixed(0)}`;
}

function cutoffColor(minutes: number | null): string {
  if (minutes == null) return 'text-slate-500';
  if (minutes < 0) return 'text-slate-400';
  if (minutes < 60) return 'text-red-600';
  if (minutes < 180) return 'text-amber-600';
  return 'text-emerald-600';
}

function formatCountdown(minutes: number | null): string {
  if (minutes == null) return '—';
  if (minutes < 0) return 'passed';
  if (minutes < 60) return `${minutes}m left`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h left` : `${h}h ${m}m`;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d`;
  return new Date(iso).toISOString().slice(5, 10);
}

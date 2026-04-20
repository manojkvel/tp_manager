// TASK-070 — Dashboard (§6.10): inventory value, items tracked, variance alerts,
// today's prep, weekly waste, quick actions.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet, Package, ClipboardList, Trash2, AlertTriangle, TrendingUp, ArrowRight,
  ClipboardCheck, PackageCheck, ShoppingCart, BarChart3, type LucideIcon,
} from 'lucide-react';
import { apiFetch } from '../auth/api.js';
import { useAuth } from '../auth/useAuth.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { Stat } from '../components/ui/Stat.js';
import { Card, CardHeader } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';

interface AvtRow {
  menu_recipe_id: string; menu_recipe_name: string; variance_cents: number; variance_pct: number;
}
interface WasteRow { reason_label: string; total_value_cents: number; entries: number }
interface InventoryKpi { value_cents: number; items_tracked: number }
interface PrepToday { pending: number; completed: number }
interface DashboardChips { needs_supplier: number; disputed_deliveries: number }

export default function DashboardPage() {
  const session = useAuth();
  const [avt, setAvt] = useState<AvtRow[]>([]);
  const [waste, setWaste] = useState<WasteRow[]>([]);
  const [inv, setInv] = useState<InventoryKpi | null>(null);
  const [prep, setPrep] = useState<PrepToday | null>(null);
  const [chips, setChips] = useState<DashboardChips | null>(null);

  useEffect(() => {
    void (async () => {
      const [a, w, i, p, c] = await Promise.all([
        apiFetch<AvtRow[]>('/api/v1/reports/avt'),
        apiFetch<WasteRow[]>('/api/v1/reports/waste'),
        apiFetch<InventoryKpi>('/api/v1/inventory/kpi'),
        apiFetch<PrepToday>('/api/v1/prep/sheet/today/kpi'),
        apiFetch<DashboardChips>('/api/v1/dashboard/chips'),
      ]);
      if (a.data) setAvt(a.data);
      if (w.data) setWaste(w.data);
      if (i.data) setInv(i.data);
      if (p.data) setPrep(p.data);
      if (c.data) setChips(c.data);
    })();
  }, []);

  const variances = avt.filter((r) => Math.abs(r.variance_pct) >= 10);
  const weeklyWaste = waste.reduce((s, r) => s + r.total_value_cents, 0);
  const prepTotal = prep ? prep.pending + prep.completed : 0;
  const prepPct = prepTotal === 0 ? 0 : Math.round(((prep?.completed ?? 0) / prepTotal) * 100);

  const greeting = timeOfDayGreeting();
  const name = session?.user.email?.split('@')[0] ?? 'there';

  return (
    <>
      <div data-testid="healthz" className="sr-only">ok</div>

      <PageHeader
        title={
          <span>
            {greeting}, <span className="capitalize">{name}</span>
          </span>
        }
        description="Here's a snapshot of today's kitchen operations."
        actions={
          <Link to="/prep/sheet">
            <Button variant="primary" leftIcon={<ClipboardList className="h-4 w-4" />}>
              Today&rsquo;s prep
            </Button>
          </Link>
        }
      />

      {/* KPI grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat
          label="Inventory value"
          value={inv ? formatUsd(inv.value_cents) : '—'}
          icon={Wallet}
          tone="brand"
          hint="Total stock on hand"
        />
        <Stat
          label="Items tracked"
          value={inv?.items_tracked ?? '—'}
          icon={Package}
          tone="neutral"
          hint="Active ingredients"
        />
        <Stat
          label="Today's prep"
          value={prep ? `${prep.completed}/${prepTotal}` : '—'}
          icon={ClipboardList}
          tone={prepTotal === 0 || prepPct === 100 ? 'success' : 'warn'}
          hint={prepTotal > 0 ? `${prepPct}% complete` : 'No tasks yet'}
        />
        <Stat
          label="Weekly waste"
          value={formatUsd(weeklyWaste)}
          icon={Trash2}
          tone={weeklyWaste > 0 ? 'warn' : 'neutral'}
          hint="Rolling 7-day cost"
        />
      </section>

      {/* Attention row */}
      {(variances.length > 0 || (chips && (chips.needs_supplier > 0 || chips.disputed_deliveries > 0))) && (
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {variances.length > 0 && (
            <Card className="lg:col-span-2">
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-amber-600" />
                    Variance alerts
                    <Badge tone="warn">≥ 10%</Badge>
                  </span>
                }
                description="Recipes where actual usage drifted meaningfully from theoretical."
                actions={
                  <Link to="/reports" className="text-sm font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1">
                    All reports <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                }
              />
              <ul className="divide-y divide-surface-border">
                {variances.slice(0, 5).map((r) => {
                  const positive = r.variance_pct > 0;
                  return (
                    <li key={r.menu_recipe_id} className="py-2.5 flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-900 truncate">{r.menu_recipe_name}</span>
                      <span className="flex items-center gap-2 shrink-0 pl-4">
                        <span className={positive ? 'text-red-600 text-sm font-semibold' : 'text-emerald-600 text-sm font-semibold'}>
                          {positive ? '+' : ''}{r.variance_pct.toFixed(1)}%
                        </span>
                        <span className="text-xs text-slate-500 tabular-nums">
                          {formatUsd(r.variance_cents)}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {chips && (chips.needs_supplier > 0 || chips.disputed_deliveries > 0) && (
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    Needs attention
                  </span>
                }
              />
              <div className="space-y-2">
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
              </div>
            </Card>
          )}
        </section>
      )}

      {/* Quick actions */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Quick actions</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <QuickAction to="/prep/sheet"  label="Prep sheet"     icon={ClipboardList}  tone="brand"   />
          <QuickAction to="/inventory"   label="Count stock"    icon={ClipboardCheck} tone="neutral" />
          <QuickAction to="/deliveries"  label="Receive"        icon={PackageCheck}   tone="neutral" />
          <QuickAction to="/orders"      label="Place order"    icon={ShoppingCart}   tone="neutral" />
          <QuickAction to="/prep/waste"  label="Log waste"      icon={Trash2}         tone="neutral" />
          <QuickAction to="/reports"     label="Reports"        icon={BarChart3}      tone="neutral" />
        </div>
      </section>
    </>
  );
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
          ? 'group rounded-lg p-4 bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-card hover:shadow-card-hover transition-shadow'
          : 'group rounded-lg p-4 bg-white border border-surface-border shadow-card hover:shadow-card-hover hover:border-brand-300 transition-all'
      }
    >
      <div className={brand ? 'h-9 w-9 rounded-md bg-white/15 flex items-center justify-center' : 'h-9 w-9 rounded-md bg-brand-50 text-brand-600 flex items-center justify-center'}>
        <Icon className="h-5 w-5" />
      </div>
      <div className={brand ? 'mt-3 text-sm font-semibold' : 'mt-3 text-sm font-medium text-slate-900'}>
        {label}
      </div>
      <div className={brand ? 'text-xs opacity-80 mt-0.5' : 'text-xs text-slate-500 mt-0.5'}>
        Open <ArrowRight className="inline h-3 w-3 -mt-px ml-0.5 opacity-70" />
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
      <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${styles.dot}`} />
      <span className="flex-1 min-w-0">
        <span className={`block text-sm font-medium ${styles.fg}`}>{title}</span>
        <span className="block text-xs text-slate-600">{hint}</span>
      </span>
      <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 mt-1" />
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
  if (Math.abs(dollars) >= 1000) {
    return `$${(dollars / 1000).toFixed(1)}k`;
  }
  return `$${dollars.toFixed(0)}`;
}

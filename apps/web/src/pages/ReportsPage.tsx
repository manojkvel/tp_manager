// v1.7 Wave 7 — Reports hub. Sub-pages live at /reports/avt, /reports/price-creep, /reports/waste-loss.

import { Link } from 'react-router-dom';
import { BarChart3, TrendingUp, Trash2, ArrowRight, Target, Edit3, PackageX, Flame, Trophy } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.js';

interface Tile {
  to: string;
  title: string;
  description: string;
  icon: typeof BarChart3;
  iconBg: string;
  iconFg: string;
}

const TILES: Tile[] = [
  {
    to: '/reports/avt',
    title: 'Actual vs Theoretical',
    description: 'Variance by menu item — where actual cost drifts from recipe cost.',
    icon: BarChart3,
    iconBg: 'bg-red-50',
    iconFg: 'text-red-600',
  },
  {
    to: '/reports/price-creep',
    title: 'Price Creep',
    description: 'Ingredients whose cost is rising faster than menu pricing.',
    icon: TrendingUp,
    iconBg: 'bg-amber-50',
    iconFg: 'text-amber-600',
  },
  {
    to: '/reports/waste-loss',
    title: 'Waste & Loss',
    description: 'Bucketed loss attribution: spoilage, prep waste, comps, and theft.',
    icon: Trash2,
    iconBg: 'bg-orange-50',
    iconFg: 'text-orange-600',
  },
  {
    to: '/reports/menu-contribution',
    title: 'Menu Contribution',
    description: 'Ranked by gross margin — which dishes pay the rent vs slow movers.',
    icon: Flame,
    iconBg: 'bg-emerald-50',
    iconFg: 'text-emerald-600',
  },
  {
    to: '/reports/prep-throughput',
    title: 'Prep Throughput',
    description: 'Cook leaderboard — rows completed, pace, QC sign rate, on-time %.',
    icon: Trophy,
    iconBg: 'bg-amber-50',
    iconFg: 'text-amber-600',
  },
  {
    to: '/reports/dead-stock',
    title: 'Dead Stock',
    description: 'Idle inventory that has not moved in 30 days — cash tied up on the shelf.',
    icon: PackageX,
    iconBg: 'bg-slate-100',
    iconFg: 'text-slate-600',
  },
  {
    to: '/reports/forecast-accuracy',
    title: 'Forecast Accuracy',
    description: 'MAPE and p10/p90 coverage for the demand forecast.',
    icon: Target,
    iconBg: 'bg-sky-50',
    iconFg: 'text-sky-600',
  },
  {
    to: '/reports/forecast-overrides',
    title: 'Forecast Overrides',
    description: 'Audit of operator adjustments applied to the forecast.',
    icon: Edit3,
    iconBg: 'bg-brand-50',
    iconFg: 'text-brand-600',
  },
];

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        description="Track cost variance, price drift, waste attribution, and forecast quality."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {TILES.map(({ to, title, description, icon: Icon, iconBg, iconFg }) => (
          <Link
            key={to}
            to={to}
            className="group rounded-lg border border-surface-border bg-white p-4 flex items-start gap-3 hover:border-brand-300 hover:shadow-card transition-all"
          >
            <div className={`h-10 w-10 rounded-md flex items-center justify-center shrink-0 ${iconBg} ${iconFg}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-900">{title}</div>
              <div className="text-xs text-slate-500 mt-1 leading-relaxed">{description}</div>
            </div>
            <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-brand-600 mt-0.5" />
          </Link>
        ))}
      </div>
    </>
  );
}

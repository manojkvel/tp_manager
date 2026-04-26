import type { ReactNode } from 'react';
import { cn } from './cn.js';

export type BadgeTone =
  | 'neutral' | 'brand' | 'success' | 'warn' | 'danger' | 'info'
  // v1.7 — culinary categories + waste attribution buckets.
  | 'proteins' | 'dairy' | 'produce' | 'grains' | 'spirits' | 'oils'
  | 'condiments' | 'beverage' | 'bakery'
  | 'spoilage' | 'prep_waste' | 'comped_meals' | 'theft_suspected';

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

const toneStyles: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  brand:   'bg-brand-50 text-brand-700 ring-brand-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warn:    'bg-amber-50 text-amber-800 ring-amber-200',
  danger:  'bg-red-50 text-red-700 ring-red-200',
  info:    'bg-sky-50 text-sky-700 ring-sky-200',
  // v1.7 culinary categories.
  proteins:   'bg-red-50 text-red-700 ring-red-200',
  dairy:      'bg-sky-50 text-sky-700 ring-sky-200',
  produce:    'bg-emerald-50 text-emerald-700 ring-emerald-200',
  grains:     'bg-amber-50 text-amber-800 ring-amber-200',
  spirits:    'bg-violet-50 text-violet-700 ring-violet-200',
  oils:       'bg-yellow-50 text-yellow-800 ring-yellow-200',
  condiments: 'bg-pink-50 text-pink-700 ring-pink-200',
  beverage:   'bg-cyan-50 text-cyan-700 ring-cyan-200',
  bakery:     'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
  // v1.7 waste attribution buckets.
  spoilage:         'bg-amber-50 text-amber-800 ring-amber-200',
  prep_waste:       'bg-orange-50 text-orange-700 ring-orange-200',
  comped_meals:     'bg-sky-50 text-sky-700 ring-sky-200',
  theft_suspected:  'bg-red-50 text-red-700 ring-red-200',
};

export function Badge({ tone = 'neutral' as BadgeTone, className, children }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
      toneStyles[tone],
      className,
    )}>
      {children}
    </span>
  );
}

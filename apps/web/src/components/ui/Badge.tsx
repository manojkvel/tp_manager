import type { ReactNode } from 'react';
import { cn } from './cn.js';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warn' | 'danger' | 'info';

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

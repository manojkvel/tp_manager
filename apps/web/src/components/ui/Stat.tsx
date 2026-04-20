import type { LucideIcon } from 'lucide-react';
import { cn } from './cn.js';

type Tone = 'neutral' | 'brand' | 'success' | 'warn' | 'danger';

interface StatProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: Tone;
  trend?: { delta: string; direction: 'up' | 'down' | 'flat' };
}

const toneStyles: Record<Tone, { iconBg: string; iconFg: string }> = {
  neutral: { iconBg: 'bg-slate-100',     iconFg: 'text-slate-600'   },
  brand:   { iconBg: 'bg-brand-50',      iconFg: 'text-brand-600'   },
  success: { iconBg: 'bg-emerald-50',    iconFg: 'text-emerald-600' },
  warn:    { iconBg: 'bg-amber-50',      iconFg: 'text-amber-600'   },
  danger:  { iconBg: 'bg-red-50',        iconFg: 'text-red-600'     },
};

export function Stat({ label, value, hint, icon: Icon, tone = 'neutral', trend }: StatProps) {
  const s = toneStyles[tone];
  return (
    <div className="rounded-lg bg-white border border-surface-border shadow-card p-5 flex items-start gap-4">
      {Icon && (
        <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center shrink-0', s.iconBg)}>
          <Icon className={cn('h-5 w-5', s.iconFg)} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</span>
          {trend && (
            <span className={cn(
              'text-xs font-medium',
              trend.direction === 'up'   && 'text-emerald-600',
              trend.direction === 'down' && 'text-red-600',
              trend.direction === 'flat' && 'text-slate-500',
            )}>
              {trend.direction === 'up' ? '▲' : trend.direction === 'down' ? '▼' : '■'} {trend.delta}
            </span>
          )}
        </div>
        {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
      </div>
    </div>
  );
}

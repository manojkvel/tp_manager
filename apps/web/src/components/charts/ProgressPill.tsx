// v1.7 Wave 3 — "0/6 counted" pill with filled bar.
import { cn } from '../ui/cn.js';

interface Props {
  done: number;
  total: number;
  label?: string;
  tone?: 'brand' | 'success';
  className?: string;
}

export function ProgressPill({ done, total, label = 'counted', tone = 'brand', className }: Props) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const fillColor = tone === 'success' ? 'bg-emerald-500' : 'bg-brand-500';
  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <div className="h-1.5 w-16 rounded-full bg-slate-200 overflow-hidden">
        <div
          className={cn('h-full transition-[width]', fillColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-slate-600">
        {done}/{total} {label}
      </span>
    </div>
  );
}

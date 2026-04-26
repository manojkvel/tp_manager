// v1.7 Wave 3 — 0-5 star read-only display for supplier ratings.
import { Star } from 'lucide-react';
import { cn } from './cn.js';

interface Props {
  value: number;
  max?: number;
  size?: 'sm' | 'md';
  className?: string;
  showValue?: boolean;
}

export function StarRating({ value, max = 5, size = 'sm', className, showValue = true }: Props) {
  const clamped = Math.max(0, Math.min(max, value));
  const dim = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-label={`${clamped} of ${max} stars`}>
      {Array.from({ length: max }).map((_, i) => {
        const filled = i < Math.round(clamped);
        return (
          <Star
            key={i}
            className={cn(dim, filled ? 'fill-amber-400 text-amber-400' : 'text-slate-300')}
          />
        );
      })}
      {showValue && (
        <span className="ml-1 text-xs tabular-nums text-slate-600">{clamped.toFixed(1)}</span>
      )}
    </span>
  );
}

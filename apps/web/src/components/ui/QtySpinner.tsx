// v1.7 Wave 3 — [−][ n ][+] qty spinner (inventory count rows).
import { Minus, Plus } from 'lucide-react';
import { cn } from './cn.js';

interface Props {
  value: number;
  onChange: (next: number) => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md';
}

export function QtySpinner({
  value, onChange, step = 1, min = 0, max, disabled = false, className, size = 'md',
}: Props) {
  const btn = 'flex items-center justify-center rounded-md border border-surface-border bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed';
  const btnSize = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9';
  const inputSize = size === 'sm' ? 'h-8 w-14 text-sm' : 'h-9 w-16 text-base';
  const dec = () => onChange(Math.max(min, value - step));
  const inc = () => onChange(max != null ? Math.min(max, value + step) : value + step);
  return (
    <div className={cn('inline-flex items-center gap-1', className)}>
      <button type="button" onClick={dec} disabled={disabled || value <= min} className={cn(btn, btnSize)} aria-label="Decrement">
        <Minus className="h-4 w-4 text-slate-600" />
      </button>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        disabled={disabled}
        className={cn(
          'rounded-md border border-surface-border text-center font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent',
          inputSize,
        )}
        step={step}
      />
      <button type="button" onClick={inc} disabled={disabled || (max != null && value >= max)} className={cn(btn, btnSize)} aria-label="Increment">
        <Plus className="h-4 w-4 text-slate-600" />
      </button>
    </div>
  );
}

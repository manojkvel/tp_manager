// v1.7 Wave 3 — pill-tab row with per-tab progress fraction.
// v1.7 Wave 14 — zone-tab icons inferred from the zone's label (walk-in,
// cooler, dry, bar, freezer, prep, etc.), matching the PO design.
import type { LucideIcon } from 'lucide-react';
import {
  Snowflake, Package, Wine, Refrigerator, ChefHat, MapPin,
} from 'lucide-react';
import { cn } from './cn.js';

export interface ZoneTab {
  id: string;
  label: string;
  done: number;
  total: number;
}

interface Props {
  tabs: ZoneTab[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}

function iconForLabel(label: string): LucideIcon {
  const l = label.toLowerCase();
  if (l.includes('freezer')) return Snowflake;
  if (l.includes('walk-in') || l.includes('walk in') || l.includes('cooler') || l.includes('fridge') || l.includes('refrig')) return Refrigerator;
  if (l.includes('bar')) return Wine;
  if (l.includes('dry') || l.includes('storage') || l.includes('pantry')) return Package;
  if (l.includes('prep') || l.includes('kitchen') || l.includes('station')) return ChefHat;
  return MapPin;
}

export function ZoneTabs({ tabs, activeId, onChange, className }: Props) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)} role="tablist">
      {tabs.map((t) => {
        const active = t.id === activeId;
        const complete = t.total > 0 && t.done >= t.total;
        const Icon = iconForLabel(t.label);
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors border',
              active
                ? 'bg-emerald-700 text-white border-emerald-700 shadow-sm'
                : 'bg-white text-slate-700 border-surface-border hover:bg-slate-50',
            )}
          >
            <Icon className={cn('h-4 w-4', active ? 'text-white' : 'text-slate-500')} />
            <span>{t.label}</span>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs tabular-nums',
                active
                  ? 'bg-white/20 text-white'
                  : complete
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-600',
              )}
            >
              {t.done}/{t.total}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// v1.7 Wave 3 — horizontal KPI strip. Thin wrapper around Stat.
import type { LucideIcon } from 'lucide-react';
import { Stat } from '../ui/Stat.js';
import { cn } from '../ui/cn.js';

export interface KPICard {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: 'neutral' | 'brand' | 'success' | 'warn' | 'danger';
  trend?: { delta: string; direction: 'up' | 'down' | 'flat' };
}

interface KPIStripProps {
  cards: KPICard[];
  className?: string;
}

export function KPIStrip({ cards, className }: KPIStripProps) {
  const cols = Math.min(Math.max(cards.length, 1), 5);
  const gridCols: Record<number, string> = {
    1: 'grid-cols-1',
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
    5: 'sm:grid-cols-2 lg:grid-cols-5',
  };
  return (
    <div className={cn('grid grid-cols-1 gap-4', gridCols[cols], className)}>
      {cards.map((c, i) => (
        <Stat key={i} {...c} />
      ))}
    </div>
  );
}

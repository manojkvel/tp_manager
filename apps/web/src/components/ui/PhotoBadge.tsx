// v1.7 Wave 3 — "Photo Required" pill for inventory count rows.
import { Camera } from 'lucide-react';
import { cn } from './cn.js';

interface Props {
  captured?: boolean;
  className?: string;
}

export function PhotoBadge({ captured = false, className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        captured
          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
          : 'bg-orange-50 text-orange-700 ring-orange-200',
        className,
      )}
    >
      <Camera className="h-3 w-3" />
      {captured ? 'Photo Captured' : 'Photo Required'}
    </span>
  );
}

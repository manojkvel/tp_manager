import type { HTMLAttributes, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';
import { cn } from './cn.js';

export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-hidden rounded-lg border border-surface-border bg-white shadow-card">
      <div className="overflow-x-auto">
        <table className={cn('min-w-full divide-y divide-surface-border text-sm', className)} {...rest}>
          {children}
        </table>
      </div>
    </div>
  );
}

export function Th({ className, children, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-slate-500 bg-surface-muted',
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({ className, children, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-4 py-3 text-slate-800 align-top', className)} {...rest}>
      {children}
    </td>
  );
}

export function TRow({ className, children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('hover:bg-surface-subtle', className)} {...rest}>
      {children}
    </tr>
  );
}

export function EmptyState({
  icon, title, hint, action,
}: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-surface-border bg-white py-12 text-center">
      {icon && (
        <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

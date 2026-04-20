import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn.js';

const fieldBase =
  'w-full rounded-md border border-surface-border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus-ring disabled:bg-slate-50 disabled:text-slate-500';

interface FieldWrapProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, error, required, children, className }: FieldWrapProps) {
  return (
    <label className={cn('block', className)}>
      {label && (
        <span className="mb-1.5 inline-flex items-center gap-1 text-sm font-medium text-slate-700">
          {label}
          {required && <span className="text-red-600">*</span>}
        </span>
      )}
      {children}
      {error
        ? <span className="mt-1 block text-xs text-red-600">{error}</span>
        : hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(fieldBase, className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(fieldBase, 'min-h-[88px]', className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cn(fieldBase, 'pr-8', className)} {...rest}>
        {children}
      </select>
    );
  },
);

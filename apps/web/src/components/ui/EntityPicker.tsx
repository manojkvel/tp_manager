// Reusable typeahead combobox for picking a server entity by name.
//
// The form layer should never make non-technical users type or paste UUIDs.
// This component fetches a small result set from a `/list?search=` endpoint,
// shows the human-readable label, and emits the entity id on selection.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../auth/api.js';
import { Input } from './Input.js';
import { cn } from './cn.js';

export interface EntityPickerProps<T> {
  endpoint: string;
  value: string | null;
  onChange: (id: string | null, row: T | null) => void;
  getId: (row: T) => string;
  getLabel: (row: T) => string;
  getMeta?: (row: T) => string | null;
  searchParam?: string;
  extraQuery?: Record<string, string | undefined>;
  placeholder?: string;
  disabled?: boolean;
  minChars?: number;
  pageSize?: number;
  invalid?: boolean;
}

export function EntityPicker<T>({
  endpoint,
  value,
  onChange,
  getId,
  getLabel,
  getMeta,
  searchParam = 'search',
  extraQuery,
  placeholder = 'Type to search…',
  disabled,
  minChars = 0,
  pageSize = 8,
  invalid,
}: EntityPickerProps<T>) {
  const inputId = useId();
  const listId = `${inputId}-list`;
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<T[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [selectedRow, setSelectedRow] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);

  const buildUrl = useCallback(
    (q: string, byIdValue?: string) => {
      const params = new URLSearchParams();
      if (byIdValue) {
        // Some endpoints support id filter directly; fall back to a search by id substring otherwise.
        params.set('id', byIdValue);
      } else if (q.length >= minChars) {
        params.set(searchParam, q);
      }
      if (extraQuery) {
        for (const [k, v] of Object.entries(extraQuery)) {
          if (v != null && v !== '') params.set(k, v);
        }
      }
      const qs = params.toString();
      return qs ? `${endpoint}?${qs}` : endpoint;
    },
    [endpoint, extraQuery, minChars, searchParam],
  );

  // Resolve an externally-supplied value once on mount or when value changes
  // and we don't yet have the matching row label cached.
  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setSelectedRow(null);
      setQuery('');
      return;
    }
    if (selectedRow && getId(selectedRow) === value) return;
    (async () => {
      const res = await apiFetch<T[]>(buildUrl(''));
      if (cancelled) return;
      const list = res.data ?? [];
      const match = list.find((r) => getId(r) === value) ?? null;
      if (match) {
        setSelectedRow(match);
        setQuery(getLabel(match));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value, selectedRow, getId, getLabel, buildUrl]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(async () => {
      setLoading(true);
      const res = await apiFetch<T[]>(buildUrl(query));
      setLoading(false);
      const list = (res.data ?? []).slice(0, pageSize);
      setRows(list);
      setHighlight(0);
    }, 150);
    return () => window.clearTimeout(handle);
  }, [open, query, buildUrl, pageSize]);

  // Click outside closes.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function pick(row: T) {
    setSelectedRow(row);
    setQuery(getLabel(row));
    setOpen(false);
    onChange(getId(row), row);
    inputRef.current?.blur();
  }

  function clear() {
    setSelectedRow(null);
    setQuery('');
    onChange(null, null);
    inputRef.current?.focus();
    setOpen(true);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && rows[highlight]) {
        e.preventDefault();
        pick(rows[highlight]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const showClear = useMemo(() => Boolean(selectedRow || query), [selectedRow, query]);

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(invalid && 'border-red-500')}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (selectedRow) {
            setSelectedRow(null);
            onChange(null, null);
          }
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showClear && !disabled && (
        <button
          type="button"
          aria-label="Clear selection"
          onClick={clear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-700"
        >
          ×
        </button>
      )}
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-surface-border bg-white shadow-lg"
        >
          {loading && <li className="px-3 py-2 text-xs text-slate-500">Loading…</li>}
          {!loading && rows.length === 0 && (
            <li className="px-3 py-2 text-xs text-slate-500">No matches</li>
          )}
          {!loading &&
            rows.map((row, i) => {
              const id = getId(row);
              const meta = getMeta?.(row);
              const active = i === highlight;
              return (
                <li
                  key={id}
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(row);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    'cursor-pointer px-3 py-2 text-sm',
                    active ? 'bg-brand-50 text-brand-900' : 'text-slate-800',
                  )}
                >
                  <div className="font-medium">{getLabel(row)}</div>
                  {meta && <div className="text-xs text-slate-500">{meta}</div>}
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}

// Pre-typed pickers for the four entities our forms reference most often.

export interface IngredientLite {
  id: string;
  name: string;
  uom: string;
  default_supplier_id?: string | null;
  pack_size?: number | null;
}

export function IngredientPicker(
  props: Omit<EntityPickerProps<IngredientLite>, 'endpoint' | 'getId' | 'getLabel' | 'getMeta'>,
) {
  return (
    <EntityPicker<IngredientLite>
      endpoint="/api/v1/ingredients"
      getId={(r) => r.id}
      getLabel={(r) => r.name}
      getMeta={(r) => `${r.uom}${r.pack_size ? ` · pack ${r.pack_size}` : ''}`}
      placeholder="Search ingredient…"
      {...props}
    />
  );
}

export interface SupplierLite {
  id: string;
  name: string;
  contact_name?: string | null;
}

export function SupplierPicker(
  props: Omit<EntityPickerProps<SupplierLite>, 'endpoint' | 'getId' | 'getLabel' | 'getMeta'>,
) {
  return (
    <EntityPicker<SupplierLite>
      endpoint="/api/v1/suppliers"
      getId={(r) => r.id}
      getLabel={(r) => r.name}
      getMeta={(r) => r.contact_name ?? null}
      placeholder="Search supplier…"
      {...props}
    />
  );
}

export interface RecipeLite {
  id: string;
  name: string;
  type: string;
}

export function RecipePicker(
  props: Omit<EntityPickerProps<RecipeLite>, 'endpoint' | 'getId' | 'getLabel' | 'getMeta'>,
) {
  return (
    <EntityPicker<RecipeLite>
      endpoint="/api/v1/recipes"
      getId={(r) => r.id}
      getLabel={(r) => r.name}
      getMeta={(r) => r.type}
      placeholder="Search recipe…"
      {...props}
    />
  );
}

export interface LocationLite {
  id: string;
  name: string;
  type?: string | null;
}

export function LocationPicker(
  props: Omit<EntityPickerProps<LocationLite>, 'endpoint' | 'getId' | 'getLabel' | 'getMeta'>,
) {
  return (
    <EntityPicker<LocationLite>
      endpoint="/api/v1/settings/locations"
      getId={(r) => r.id}
      getLabel={(r) => r.name}
      getMeta={(r) => r.type ?? null}
      placeholder="Storage location…"
      {...props}
    />
  );
}

export interface WasteReasonLite {
  id: string;
  name: string;
  code?: string | null;
}

export function WasteReasonPicker(
  props: Omit<EntityPickerProps<WasteReasonLite>, 'endpoint' | 'getId' | 'getLabel' | 'getMeta'>,
) {
  return (
    <EntityPicker<WasteReasonLite>
      endpoint="/api/v1/settings/waste-reasons"
      getId={(r) => r.id}
      getLabel={(r) => r.name}
      getMeta={(r) => r.code ?? null}
      placeholder="Reason…"
      {...props}
    />
  );
}

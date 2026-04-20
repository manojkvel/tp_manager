// TASK-078 — ForecastBadge: advisory forecast display next to an SKU quantity.
// GAP-08 / §6.12b AC-8 — surfaces the three top_drivers from the ML service so
// the kitchen lead can sanity-check the number before deciding to override it.

import React, { useState } from 'react';

export interface ForecastBadgeProps {
  point: number | null;
  p10?: number | null;
  p90?: number | null;
  algorithm?: string;
  uom?: string;
  top_drivers?: string[];
}

export function ForecastBadge({ point, p10, p90, algorithm, uom, top_drivers }: ForecastBadgeProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (point == null) return null;

  const band = p10 != null && p90 != null
    ? ` (${p10.toFixed(1)}–${p90.toFixed(1)})`
    : '';

  const color = algorithm === 'cold_start' ? '#666' : '#1a5d1a';
  // `title` is the native fallback tooltip (works on touch + keyboard); the
  // popover below is the rich version with one driver per line.
  const titleSummary = algorithm === 'cold_start'
    ? 'Cold start: 4-week mean'
    : `Forecast via ${algorithm ?? 'auto'}`;
  const drivers = top_drivers ?? [];
  const titleFull = drivers.length
    ? `${titleSummary}\n• ${drivers.join('\n• ')}`
    : titleSummary;

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <span
        title={titleFull}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        tabIndex={0}
        role="button"
        aria-label={titleFull}
        aria-expanded={drivers.length > 0 ? open : undefined}
        style={{
          display: 'inline-block',
          padding: '0.1rem 0.4rem',
          marginLeft: '0.5rem',
          fontSize: '0.8rem',
          color,
          border: `1px solid ${color}`,
          borderRadius: 10,
          cursor: drivers.length ? 'help' : 'default',
        }}
      >
        ~{point.toFixed(1)}{uom ? ` ${uom}` : ''}{band}
      </span>
      {open && drivers.length > 0 && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            padding: '0.5rem 0.7rem',
            background: '#1f2937',
            color: '#f9fafb',
            borderRadius: 6,
            fontSize: '0.75rem',
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
            zIndex: 50,
            boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{titleSummary}</div>
          <ul style={{ margin: 0, paddingLeft: '1rem' }}>
            {drivers.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </span>
      )}
    </span>
  );
}

export default ForecastBadge;

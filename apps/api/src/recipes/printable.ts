// GAP-02 — Print-ready HTML for flash cards (§6.3 AC-6) and station cheat
// sheets (§6.3b AC-3). The deliverable is printable HTML; browsers save as
// PDF via Ctrl+P. No server-side PDF engine required.

import type { RecipeLineRow } from './cost.js';

export interface PrintableRecipe {
  id: string;
  name: string;
  type: 'prep' | 'menu';
  version: {
    id: string;
    yield_qty: number;
    yield_uom: string;
    shelf_life_days: number | null;
    equipment: string[];
    procedure: string;
    photo_url: string | null;
  };
  lines: readonly RecipeLineRow[];
  /** Optional human-readable names keyed by ingredient_id / ref_recipe_id. */
  ingredient_labels?: Record<string, string>;
}

export interface PrintableStationRow {
  recipe_id: string;
  recipe_name: string;
  step_order: number | null;
  line: RecipeLineRow;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function titleCase(s: string): string {
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}

function lineLabel(line: RecipeLineRow, labels: Record<string, string> | undefined): string {
  const ref = line.ref_type === 'ingredient' ? line.ingredient_id : line.ref_recipe_id;
  // Per-line `note` wins over catalog label — the chef's wording is canonical
  // for that step (e.g., "use slightly under-ripe avocado").
  const name = line.note ?? (ref && labels?.[ref]) ?? ref ?? '—';
  const qty = line.qty_text ?? (line.qty > 0 ? `${line.qty}${line.uom ? ' ' + line.uom : ''}` : '');
  return `${qty ? qty + ' ' : ''}${escapeHtml(String(name))}`;
}

const PRINT_CSS = `
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; margin: 0; }
  .card { padding: 1.25rem; border: 1px solid #ccc; border-radius: 6px; margin: 1rem; }
  h1 { margin: 0 0 0.5rem; font-size: 1.6rem; }
  h2 { margin: 1rem 0 0.25rem; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.04em; color: #555; }
  ul { margin: 0.25rem 0 0.5rem 1.25rem; padding: 0; }
  li { margin: 0.15rem 0; }
  .meta { color: #666; font-size: 0.85rem; margin-bottom: 0.5rem; }
  @media print {
    @page { size: letter; margin: 0.5in; }
    .card { page-break-inside: avoid; border: none; padding: 0.25in; margin: 0; }
    .no-print { display: none; }
  }
`;

const STATION_CSS = `
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; margin: 0; padding: 0.5rem; }
  header { padding: 0.5rem 1rem; border-bottom: 2px solid #111; margin-bottom: 1rem; }
  h1 { margin: 0; font-size: 1.4rem; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; }
  .card { border: 1px solid #ccc; border-radius: 4px; padding: 0.75rem; }
  .card h2 { margin: 0 0 0.4rem; font-size: 1.05rem; }
  .card ol { margin: 0; padding-left: 1.25rem; }
  .empty { padding: 2rem; text-align: center; color: #666; }
  @media print {
    @page { size: letter; margin: 0.4in; }
    header { border-bottom: 1px solid #111; }
    .grid { gap: 0.3rem; }
    .card { page-break-inside: avoid; border: 1px solid #999; }
    .no-print { display: none; }
  }
`;

export function renderRecipeCard(r: PrintableRecipe): string {
  const equipment = r.version.equipment.length
    ? `<h2>Equipment</h2><ul>${r.version.equipment.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`
    : '';
  const lines = r.lines.length
    ? `<h2>Ingredients</h2><ul>${r.lines.map((l) => `<li>${lineLabel(l, r.ingredient_labels)}</li>`).join('')}</ul>`
    : '';
  const proc = r.version.procedure
    ? `<h2>Procedure</h2><p>${escapeHtml(r.version.procedure).replace(/\n/g, '<br/>')}</p>`
    : '';
  const shelf = r.version.shelf_life_days != null
    ? `Shelf life: ${r.version.shelf_life_days} days · `
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(r.name)} · recipe card</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<article class="card">
  <h1>${escapeHtml(r.name)}</h1>
  <div class="meta">${titleCase(r.type)} · Yields ${r.version.yield_qty} ${escapeHtml(r.version.yield_uom)} · ${shelf}Rev ${escapeHtml(r.version.id.slice(0, 8))}</div>
  ${equipment}
  ${lines}
  ${proc}
  <div class="no-print" style="margin-top:1rem;color:#888;font-size:0.8rem;">Press Ctrl+P (⌘P) and "Save as PDF" to export.</div>
</article>
</body>
</html>`;
}

export function renderStationSheet(station: string, rows: readonly PrintableStationRow[]): string {
  const stationTitle = titleCase(station) + ' Station';

  // Group rows by recipe_id, preserving order.
  const groups = new Map<string, { name: string; rows: PrintableStationRow[] }>();
  for (const r of rows) {
    const g = groups.get(r.recipe_id) ?? { name: r.recipe_name, rows: [] };
    g.rows.push(r);
    groups.set(r.recipe_id, g);
  }

  const cards = Array.from(groups.values()).map((g) => {
    const steps = g.rows
      .slice()
      .sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0))
      .map((r) => `<li>${lineLabel(r.line, undefined)}</li>`)
      .join('');
    return `<section class="card"><h2>${escapeHtml(g.name)}</h2><ol>${steps}</ol></section>`;
  }).join('');

  const body = groups.size === 0
    ? `<p class="empty">No recipes at ${escapeHtml(stationTitle)}.</p>`
    : `<div class="grid">${cards}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(stationTitle)} · cheat sheet</title>
<style>${STATION_CSS}</style>
</head>
<body>
<header><h1>${escapeHtml(stationTitle)}</h1></header>
${body}
<div class="no-print" style="margin:1rem;color:#888;font-size:0.8rem;">Press Ctrl+P (⌘P) and "Save as PDF" for a 4-up printable sheet.</div>
</body>
</html>`;
}

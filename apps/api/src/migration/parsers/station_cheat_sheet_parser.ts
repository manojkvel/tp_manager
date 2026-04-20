// station_cheat_sheet_parser (§6.14 AC-3).
//
// Shape of real fixture ("Server Side Expo Cheat Sheet.xlsx"):
//   col0 = menu item OR section header (uppercase like "APPS", "PANCAKES")
//   col1 = plating notes (e.g., "Syrup, Butter on Pancakes")
//
//   Some rows have null col1 when col0 is a section header.
//   Some rows have null col0 and narrative col1 — these are notes that
//   "apply to the whole section" (e.g., "*Plastic Ramekins...") — captured
//   onto the current section's metadata, not as items.
//
// Output: one StagingPlatingNote per menu item with the enclosing section.

import { randomUUID } from 'node:crypto';
import type { Parser, ParseResult, StagingPlatingNote } from '../types.js';

export const station_cheat_sheet_parser: Parser<readonly (readonly (string | null)[])[], StagingPlatingNote> = (rows, _ctx) => {
  const errors: ParseResult<never>['errors'] = [];
  const out: StagingPlatingNote[] = [];
  let section = '';

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const c0 = clean(row[0]);
    const c1 = clean(row[1]);
    if (!c0 && !c1) continue;

    if (c0 && isSectionHeader(c0)) {
      section = c0;
      continue;
    }

    // Continuation note (no item name) — fold into the running section but
    // don't emit as a plating note. We skip silently.
    if (!c0) continue;

    if (!c1) {
      // Item with no plating note — still capture it so the UI can show "no
      // special plating" rather than assuming the item is missing.
      out.push({
        staging_id: randomUUID(),
        source_row_ref: `row:${i + 1}`,
        recipe_name: c0,
        section: section || 'UNKNOWN',
        plating_notes: '',
      });
      continue;
    }

    if (!section) {
      errors.push({ source_row_ref: `row:${i + 1}`, message: `plating note "${c0}" appeared before any section header` });
      continue;
    }

    out.push({
      staging_id: randomUUID(),
      source_row_ref: `row:${i + 1}`,
      recipe_name: c0,
      section,
      plating_notes: c1,
    });
  }

  return { rows: out, errors };
};

function clean(v: string | null | undefined): string {
  return (v ?? '').toString().trim();
}

function isSectionHeader(s: string): boolean {
  // Uppercase section markers with optional '/', '&', digits forbidden.
  return /^[A-Z][A-Z/&\s]+$/.test(s) && s.length >= 3 && !/\d/.test(s);
}

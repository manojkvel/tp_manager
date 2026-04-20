// barista_prep_parser (§6.14 AC-3).
//
// Shape of real fixture ("Barista Prep.xlsx"):
//   col0 = item/section text, col1 = par qty (often blank in template export)
//   Layout: [sheet title] / [Items | Par header] / items... / blank /
//           [section title "Specials"] / items... / blank /
//           [section title "Barista Fridge Stocking List"] / [Items | Par] / items...
//
// Rules:
//   - Skip the sheet-title row ("Barista Prep") and the header row ("Items"/"Par").
//   - A single-cell row with col0 text and col1 null → new section name.
//   - A two-cell row is an item: col0=recipe_name, col1=qty (nullable → undefined).
//   - Blank rows are section separators (ignored).
//   - Qty that fails to parse becomes an error; the row is dropped.

import { randomUUID } from 'node:crypto';
import type { Parser, ParseResult, StagingParTemplate } from '../types.js';

const TITLE_HINTS = new Set(['barista prep', 'items']);

export const barista_prep_parser: Parser<readonly (readonly (string | null)[])[], StagingParTemplate> = (rows, _ctx) => {
  const errors: ParseResult<never>['errors'] = [];
  const out: StagingParTemplate[] = [];
  let section = '';
  let prevBlank = true; // treat start-of-sheet as "preceded by blank"

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const c0 = clean(row[0]);
    const c1 = clean(row[1]);
    if (!c0 && !c1) { prevBlank = true; continue; } // blank separator

    const lower = c0.toLowerCase();
    if (TITLE_HINTS.has(lower)) { prevBlank = false; continue; } // sheet title / column header

    // Section-header heuristic: a single-cell row is a section title when
    //   (a) the previous row was blank (the real fixture's dominant pattern), OR
    //   (b) the next row is an "Items | Par" column-header (a template hint
    //       the author used to re-introduce a column header per section).
    if (c0 && !c1) {
      const next = rows[i + 1];
      const nextIsColHeader = !!next && clean(next[0]).toLowerCase() === 'items' && clean(next[1]).toLowerCase() === 'par';
      if (prevBlank || nextIsColHeader) {
        section = c0;
        prevBlank = false;
        continue;
      }
    }
    prevBlank = false;

    // Item row.
    let qty: number | undefined;
    if (c1) {
      const parsed = Number(c1.replace(/,/g, ''));
      if (!Number.isFinite(parsed)) {
        errors.push({ source_row_ref: `row:${i + 1}`, message: `unparseable par "${c1}" for "${c0}"` });
        continue;
      }
      qty = parsed;
    }
    out.push({
      staging_id: randomUUID(),
      source_row_ref: `row:${i + 1}`,
      recipe_name: c0,
      section: section || undefined,
      qty,
    });
  }

  return { rows: out, errors };
};

function clean(v: string | null | undefined): string {
  return (v ?? '').toString().trim();
}

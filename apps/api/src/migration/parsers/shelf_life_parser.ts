// shelf_life_parser (§6.14 AC-3).
//
// Shape of real fixture ("Prep and Ingredients Shelf Life.xlsx"):
//   [col0, col1, col2=blank, col3, col4]
//   where (col0,col1) and (col3,col4) are each an (item_name, "N days") pair.
//   A row with col1=null and col0=UPPERCASE_TEXT is a category header
//   (MEATS, CHEESE, VEGETABLES, DRESSINGS/SAUCES/MIXES, BATTERS, MISCELLANEOUS).
//   Blank cells / trailing empty rows are skipped.
//
// Output: one StagingIngredient per row with `shelf_life_days` populated.
// The UOM is unknown at this stage — we tag `uom_category` based on the
// category header when we can (e.g. "CHEESE" → weight, "BATTERS" → volume),
// and fall back to 'each' when ambiguous.

import { randomUUID } from 'node:crypto';
import type { Parser, ParseResult, StagingIngredient } from '../types.js';

const WEIGHT_CATEGORIES = new Set(['MEATS', 'CHEESE', 'VEGETABLES']);
const VOLUME_CATEGORIES = new Set(['DRESSINGS/SAUCES/MIXES', 'BATTERS']);

export const shelf_life_parser: Parser<readonly (readonly (string | null)[])[], StagingIngredient> = (rows, _ctx) => {
  const errors: ParseResult<never>['errors'] = [];
  const out: StagingIngredient[] = [];

  let leftCategory = '';
  let rightCategory = '';

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const c0 = clean(row[0]);
    const c1 = clean(row[1]);
    const c3 = clean(row[3]);
    const c4 = clean(row[4]);

    // Category header on the left column: col0=UPPERCASE, col1=null.
    if (c0 && !c1 && isCategoryHeader(c0)) {
      leftCategory = c0;
    } else if (c0 && c1) {
      const days = parseDays(c1);
      if (days == null) {
        errors.push({ source_row_ref: `row:${i + 1}`, message: `unparseable shelf_life "${c1}" for "${c0}"` });
      } else {
        out.push(buildRow(c0, days, leftCategory, `row:${i + 1}:L`));
      }
    }

    // Category header on the right column.
    if (c3 && !c4 && isCategoryHeader(c3)) {
      rightCategory = c3;
    } else if (c3 && c4) {
      const days = parseDays(c4);
      if (days == null) {
        errors.push({ source_row_ref: `row:${i + 1}`, message: `unparseable shelf_life "${c4}" for "${c3}"` });
      } else {
        out.push(buildRow(c3, days, rightCategory, `row:${i + 1}:R`));
      }
    }
  }

  return { rows: out, errors };
};

function clean(v: string | null | undefined): string {
  return (v ?? '').toString().trim();
}

function isCategoryHeader(s: string): boolean {
  // A category header is all-uppercase (allowing `/`, spaces, `&`) with no digits.
  return /^[A-Z/&\s]+$/.test(s) && s.length >= 3;
}

function parseDays(s: string): number | null {
  // Accepts "7 days", "1 day", "30 days" (leading/trailing whitespace already trimmed).
  const m = s.match(/^(\d+)\s*day[s]?$/i);
  return m ? Number(m[1]) : null;
}

function buildRow(name: string, shelf_life_days: number, category: string, source_row_ref: string): StagingIngredient {
  const cat = categorise(category);
  return {
    staging_id: randomUUID(),
    source_row_ref,
    name,
    uom: defaultUom(cat),
    uom_category: cat,
    shelf_life_days,
  };
}

function categorise(category: string): 'weight' | 'volume' | 'count' | undefined {
  if (WEIGHT_CATEGORIES.has(category)) return 'weight';
  if (VOLUME_CATEGORIES.has(category)) return 'volume';
  if (category === 'MISCELLANEOUS') return undefined;
  return undefined;
}

function defaultUom(cat: 'weight' | 'volume' | 'count' | undefined): string {
  if (cat === 'weight') return 'g';
  if (cat === 'volume') return 'mL';
  return 'each';
}

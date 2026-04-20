// End-to-end smoke against the real CSV fixtures the owner exported from the
// .pptx / .docx originals. These tests load the actual files in
// `__tests__/fixtures/`, run them through the parser, and assert the output
// has plausible scale (no empty results, low error rate) — they catch
// structural drift between the fixture and the parser without re-asserting
// every row. Per-row behaviour is covered in the dedicated unit-test files.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { portion_utensils_parser } from '../parsers/portion_utensils_parser.js';
import { beverage_recipes_parser } from '../parsers/beverage_recipes_parser.js';
import { flash_card_parser } from '../parsers/flash_card_parser.js';
import type { BatchContext } from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));
const ctx: BatchContext = {
  batch_id: 'batch-1', source_file: 'fixture', parser_version: '1.0.0',
  restaurant_id: 'rid', started_at: new Date('2026-04-19T00:00:00Z'),
};

// Minimal RFC-4180-ish reader: handles double-quote escaping + commas inside
// quoted fields. Sufficient for the owner-supplied exports; not a general CSV
// library (the parser contract takes pre-loaded matrices, so this lives only
// in the test).
function loadCsv(path: string): string[][] {
  const text = readFileSync(path, 'utf8');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; }
        else { inQuotes = false; }
      } else { cell += ch; }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      // Keep blank rows so parsers that use them as separators still work.
      rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

describe('CSV fixture smoke (§6.14 AC-3)', () => {
  it('portion_utensils.csv: every utensil parsed, no errors', () => {
    const rows = loadCsv(join(here, 'fixtures', 'portion_utensils.csv'));
    const out = portion_utensils_parser(rows, ctx);
    expect(out.errors).toEqual([]);
    const defaults = out.rows.filter((r) => !r.ingredient_name);
    // Source has 12 utensil rows (incl. header).
    expect(defaults.length).toBeGreaterThanOrEqual(10);
    // At least one of every kind we know is present.
    const kinds = new Set(defaults.map((d) => d.kind));
    expect(kinds.has('scoop')).toBe(true);
    expect(kinds.has('ladle')).toBe(true);
  });

  it('beverage_recipes.csv: produces ≥25 menu recipes with non-empty procedures', () => {
    const rows = loadCsv(join(here, 'fixtures', 'beverage_recipes.csv'));
    const out = beverage_recipes_parser(rows, ctx);
    expect(out.errors).toEqual([]);
    // Source yields 29 unique (section, recipe_name, vessel) groups — floor at
    // 25 leaves margin for minor fixture edits without masking real regressions.
    expect(out.rows.length).toBeGreaterThanOrEqual(25);
    const withProcedure = out.rows.filter((r) => r.procedure && r.procedure.length > 10);
    expect(withProcedure.length).toBe(out.rows.length);
    // All beverages classify as menu items.
    expect(out.rows.every((r) => r.type === 'menu')).toBe(true);
  });

  it('flash_cards.csv: produces ≥80 plating notes across both decks', () => {
    const rows = loadCsv(join(here, 'fixtures', 'flash_cards.csv'));
    const out = flash_card_parser(rows, ctx);
    expect(out.errors).toEqual([]);
    expect(out.rows.length).toBeGreaterThanOrEqual(80);
    const decks = new Set(out.rows.map((r) => r.section));
    expect(decks.has('Beverage Flash Cards')).toBe(true);
    expect(decks.has('Menu Flash Cards')).toBe(true);
    // Every emitted slide has at least one bullet.
    expect(out.rows.every((r) => r.plating_notes.startsWith('• '))).toBe(true);
  });
});

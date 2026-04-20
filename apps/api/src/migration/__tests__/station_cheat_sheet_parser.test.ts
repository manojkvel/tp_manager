// station_cheat_sheet_parser tests (§6.14 AC-3).
// Matrices mirror "Server Side Expo Cheat Sheet.xlsx" — section headers in col0
// with plating notes in col1.

import { describe, it, expect } from 'vitest';
import { station_cheat_sheet_parser } from '../parsers/station_cheat_sheet_parser.js';
import type { BatchContext } from '../types.js';

const ctx: BatchContext = {
  batch_id: 'batch-1',
  source_file: 'Server Side Expo Cheat Sheet.xlsx',
  parser_version: '1.0.0',
  restaurant_id: 'rid',
  started_at: new Date('2026-04-19T00:00:00Z'),
};

describe('station_cheat_sheet_parser', () => {
  it('tags each plating note with the enclosing section', () => {
    const rows: (string | null)[][] = [
      ['APPS', null],
      ['Avocado Toast', 'Olive Oil, Side Plates Per Person, 2 eggs their way'],
      ['Seasonal Toast', 'Side Plates Per Person'],
      ['PANCAKES', null],
      ['Berry Chocolaty', 'Syrup, Ramekin of Strawberry Sauce'],
      ['Plain Pancakes', 'Syrup,  Butter on Pancakes'],
    ];
    const out = station_cheat_sheet_parser(rows, ctx);
    expect(out.errors).toEqual([]);
    expect(out.rows).toHaveLength(4);
    expect(out.rows.find((r) => r.recipe_name === 'Avocado Toast')!.section).toBe('APPS');
    expect(out.rows.find((r) => r.recipe_name === 'Plain Pancakes')!.section).toBe('PANCAKES');
  });

  it('captures items with no plating note as empty-note rows', () => {
    const rows: (string | null)[][] = [
      ['SKILLETS', null],
      ['Basic and Wilbur Skillets', 'NA'],
      ['COMBOS', null],
      ['Sandwiches', 'NA'],
    ];
    const out = station_cheat_sheet_parser(rows, ctx);
    expect(out.rows.every((r) => r.section)).toBe(true);
    // "NA" is preserved verbatim — the ingestion UI can decide to normalise it.
    expect(out.rows.find((r) => r.recipe_name === 'Sandwiches')!.plating_notes).toBe('NA');
  });

  it('skips continuation notes (null col0 with narrative col1)', () => {
    // Mirrors row 2 of the real fixture: ["*All bowls/soup cups ... doilie underneath"]
    // attached to the BREAKFAST header from row 1 — not an item in its own right.
    const rows: (string | null)[][] = [
      ['BREAKFAST', '*Plastic Ramekins are only used for To-go items (Never on In-House plates)'],
      [null, '*All bowls/soup cups going on plates need a doilie underneath'],
      ['APPS', null],
      ['Avocado Toast', 'Olive Oil, Side Plates Per Person, 2 eggs their way'],
    ];
    const out = station_cheat_sheet_parser(rows, ctx);
    // BREAKFAST's row has col1 text but col0 is a section marker — skipped.
    // The continuation row (null, '*...') is skipped.
    // Only "Avocado Toast" is emitted.
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.recipe_name).toBe('Avocado Toast');
    expect(out.rows[0]!.section).toBe('APPS');
  });

  it('reports an error when a plating note appears before any section header', () => {
    const rows: (string | null)[][] = [
      ['Rogue Item', 'should be rejected'],
    ];
    const out = station_cheat_sheet_parser(rows, ctx);
    expect(out.rows).toHaveLength(0);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]!.message).toMatch(/before any section header/);
  });
});

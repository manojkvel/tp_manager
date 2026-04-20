// portion_utensils_parser tests (§6.14 AC-3).
// Input rows mirror the CSV export of `Portion Control Utensils.docx`.

import { describe, it, expect } from 'vitest';
import { portion_utensils_parser } from '../parsers/portion_utensils_parser.js';
import type { BatchContext } from '../types.js';

const ctx: BatchContext = {
  batch_id: 'batch-1',
  source_file: 'portion_utensils.csv',
  parser_version: '1.0.0',
  restaurant_id: 'rid',
  started_at: new Date('2026-04-19T00:00:00Z'),
};

describe('portion_utensils_parser', () => {
  it('emits a default row + one assignment per ingredient with parsed kind/qty/uom', () => {
    const rows: string[][] = [
      ['utensil', 'uses', 'notes'],
      ['Purple .75oz Scoop', 'Daisy Cakes, Whipped Butter, Sour Cream', ''],
    ];
    const out = portion_utensils_parser(rows, ctx);
    expect(out.errors).toEqual([]);
    // 1 default + 3 assignments = 4 rows.
    expect(out.rows).toHaveLength(4);
    const def = out.rows[0]!;
    expect(def.utensil_name).toBe('Purple .75oz Scoop');
    expect(def.kind).toBe('scoop');
    expect(def.default_qty).toBe(0.75);
    expect(def.default_uom).toBe('oz');
    expect(def.ingredient_name).toBeUndefined();

    const assignments = out.rows.slice(1);
    expect(assignments.map((r) => r.ingredient_name)).toEqual([
      'Daisy Cakes', 'Whipped Butter', 'Sour Cream',
    ]);
    for (const a of assignments) {
      expect(a.default_qty).toBe(0.75);
      expect(a.kind).toBe('scoop');
    }
  });

  it('parses sized variants — Blue 2oz Scoop, Grey 4oz Scoop, 6oz Ladle', () => {
    const rows: string[][] = [
      ['utensil', 'uses', 'notes'],
      ['Blue 2oz Scoop', 'Avocado Chunk', ''],
      ['Grey 4oz Scoop', 'Cheesy Grits', ''],
      ['6oz Ladle', 'Soups, Whipped Egg', ''],
    ];
    const out = portion_utensils_parser(rows, ctx);
    const defaults = out.rows.filter((r) => !r.ingredient_name);
    expect(defaults.map((d) => [d.utensil_name, d.kind, d.default_qty, d.default_uom])).toEqual([
      ['Blue 2oz Scoop', 'scoop', 2, 'oz'],
      ['Grey 4oz Scoop', 'scoop', 4, 'oz'],
      ['6oz Ladle', 'ladle', 6, 'oz'],
    ]);
  });

  it('classifies Baseball Cap before generic Scoop', () => {
    const rows: string[][] = [
      ['utensil', 'uses', 'notes'],
      ['Small Baseball Cap 2 oz Scoop', 'Maple Walnuts', ''],
    ];
    const out = portion_utensils_parser(rows, ctx);
    expect(out.rows[0]!.kind).toBe('baseball_cap');
    expect(out.rows[0]!.default_qty).toBe(2);
    expect(out.rows[0]!.default_uom).toBe('oz');
  });

  it('handles utensils without numeric capacity (dredges, squeeze tops) → qty=1, uom=count', () => {
    const rows: string[][] = [
      ['utensil', 'uses', 'notes'],
      ['Metal Dredge', 'Cinnamon, Paprika', ''],
      ['Pointed Tip Squeeze Bottle Top', 'All Dressings', 'Do not cut tip lower than first line'],
    ];
    const out = portion_utensils_parser(rows, ctx);
    const defaults = out.rows.filter((r) => !r.ingredient_name);
    expect(defaults.map((d) => [d.kind, d.default_qty, d.default_uom])).toEqual([
      ['dredge_metal', 1, 'count'],
      ['squeeze_bottle_top_pointed', 1, 'count'],
    ]);
    expect(defaults[1]!.notes).toBe('Do not cut tip lower than first line');
  });

  it('flags duplicate utensil rows', () => {
    const rows: string[][] = [
      ['utensil', 'uses', 'notes'],
      ['Blue 2oz Scoop', 'Avocado Chunk', ''],
      ['Blue 2oz Scoop', 'Diced Tomato', ''],
    ];
    const out = portion_utensils_parser(rows, ctx);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]!.message).toMatch(/duplicate utensil/);
  });

  it('preserves parenthesised qualifiers in ingredient names when splitting', () => {
    const rows: string[][] = [
      ['utensil', 'uses', 'notes'],
      ['White 5.3oz Scoop', 'Full size pancakes (large), Buttermilk', ''],
    ];
    const out = portion_utensils_parser(rows, ctx);
    const ings = out.rows.filter((r) => r.ingredient_name).map((r) => r.ingredient_name);
    expect(ings).toEqual(['Full size pancakes (large)', 'Buttermilk']);
  });
});

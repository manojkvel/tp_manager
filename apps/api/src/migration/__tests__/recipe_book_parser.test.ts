// TASK-043 — recipe_book_parser tests (§6.14 AC-3).

import { describe, it, expect } from 'vitest';
import { recipe_book_parser } from '../parsers/recipe_book_parser.js';
import type { BatchContext } from '../types.js';

const ctx: BatchContext = {
  batch_id: 'batch-1',
  source_file: 'TP Recipe Book.xlsx',
  parser_version: '1.0.0',
  restaurant_id: 'rid',
  started_at: new Date('2026-04-19T00:00:00Z'),
};

const HEADER = [
  'recipe_name', 'type', 'yield_qty', 'yield_uom', 'line_position',
  'ingredient_name', 'qty', 'uom', 'station', 'step_order', 'ref_recipe_name', 'qty_text',
];

describe('recipe_book_parser', () => {
  it('groups rows into one recipe per (type, name)', () => {
    const rows = [
      HEADER,
      ['Omelette', 'menu', '1', 'each', '0', 'Egg',    '3', 'each', 'egg', '1', '', ''],
      ['Omelette', 'menu', '1', 'each', '1', 'Butter', '10', 'g',   'egg', '2', '', ''],
      ['Salsa',    'prep', '1000', 'g', '0', 'Tomato', '900', 'g',  '',    '',  '', ''],
    ];
    const out = recipe_book_parser(rows, ctx);
    expect(out.errors).toEqual([]);
    const bundle = out.rows[0]!;
    expect(bundle.recipes).toHaveLength(2);
    expect(bundle.lines).toHaveLength(3);
    const omelette = bundle.recipes.find((r) => r.name === 'Omelette')!;
    expect(omelette.type).toBe('menu');
    expect(bundle.lines.filter((l) => l.recipe_staging_id === omelette.staging_id)).toHaveLength(2);
  });

  it('ignores Spanish columns (v1.6 scope — EN body only)', () => {
    const headerWithEs = [...HEADER, 'ingredient_name_es', 'note_es'];
    const rows = [
      headerWithEs,
      ['Omelette', 'menu', '1', 'each', '0', 'Egg', '3', 'each', 'egg', '1', '', '', 'Huevo', 'nota'],
    ];
    const out = recipe_book_parser(rows, ctx);
    expect(out.errors).toEqual([]);
    const line = out.rows[0]!.lines[0]!;
    expect(line.ingredient_name).toBe('Egg');
  });

  it('records malformed rows without aborting the batch', () => {
    const rows = [
      HEADER,
      ['',         'menu', '1', 'each', '0', 'Egg', '3', 'each', '', '', '', ''], // empty name
      ['Omelette', 'menu', '1', 'each', '0', 'Egg', '3', 'each', '', '', '', ''],
    ];
    const out = recipe_book_parser(rows, ctx);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]!.source_row_ref).toBe('row:2');
    expect(out.rows[0]!.recipes).toHaveLength(1);
  });

  it('fails fast if required headers are missing', () => {
    const rows = [['wrong', 'columns'], ['x', 'y']];
    const out = recipe_book_parser(rows, ctx);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]!.message).toMatch(/missing required columns/);
  });

  it('preserves qty_text alongside qty', () => {
    const rows = [
      HEADER,
      ['Salsa', 'prep', '1000', 'g', '0', 'Salt', '0', 'g', '', '', '', 'to taste'],
    ];
    const out = recipe_book_parser(rows, ctx);
    expect(out.errors).toEqual([]);
    expect(out.rows[0]!.lines[0]!.qty_text).toBe('to taste');
  });
});

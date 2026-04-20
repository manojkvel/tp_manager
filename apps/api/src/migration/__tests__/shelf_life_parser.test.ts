// shelf_life_parser tests (§6.14 AC-3).
// Input matrices mirror the layout of "Prep and Ingredients Shelf Life.xlsx"
// — a paired two-column-per-category sheet with interleaved section headers.

import { describe, it, expect } from 'vitest';
import { shelf_life_parser } from '../parsers/shelf_life_parser.js';
import type { BatchContext } from '../types.js';

const ctx: BatchContext = {
  batch_id: 'batch-1',
  source_file: 'Prep and Ingredients Shelf Life.xlsx',
  parser_version: '1.0.0',
  restaurant_id: 'rid',
  started_at: new Date('2026-04-19T00:00:00Z'),
};

describe('shelf_life_parser', () => {
  it('parses paired two-column categories into StagingIngredient rows', () => {
    const rows: (string | null)[][] = [
      ['MEATS', null, null, 'CHEESE', null],
      ['Bacon Slices (Bacon-1)', '7 days', null, 'American Cheese', '7 days'],
      ['Chicken Chunks', '5 days', null, 'Cheddar Cheese', '7 days'],
    ];
    const out = shelf_life_parser(rows, ctx);
    expect(out.errors).toEqual([]);
    expect(out.rows.map((r) => r.name)).toEqual([
      'Bacon Slices (Bacon-1)', 'American Cheese', 'Chicken Chunks', 'Cheddar Cheese',
    ]);
    const bacon = out.rows.find((r) => r.name === 'Bacon Slices (Bacon-1)')!;
    expect(bacon.shelf_life_days).toBe(7);
    expect(bacon.uom_category).toBe('weight');
  });

  it('accepts singular "1 day" as well as "N days"', () => {
    const rows: (string | null)[][] = [
      ['VEGETABLES', null, null, null, null],
      ['Avocado Chunk', '1 day', null, null, null],
      ['Onions (Caramelized)', '3 days', null, null, null],
    ];
    const out = shelf_life_parser(rows, ctx);
    expect(out.errors).toEqual([]);
    expect(out.rows.find((r) => r.name === 'Avocado Chunk')!.shelf_life_days).toBe(1);
    expect(out.rows.find((r) => r.name === 'Onions (Caramelized)')!.shelf_life_days).toBe(3);
  });

  it('maps uom_category by section header', () => {
    const rows: (string | null)[][] = [
      ['MEATS', null, null, 'DRESSINGS/SAUCES/MIXES', null],
      ['Bacon', '7 days', null, 'Balsamic Vinaigrette', '30 days'],
      ['MISCELLANEOUS', null, null, null, null],
      ['Cranberries', '30 days', null, null, null],
    ];
    const out = shelf_life_parser(rows, ctx);
    expect(out.rows.find((r) => r.name === 'Bacon')!.uom_category).toBe('weight');
    expect(out.rows.find((r) => r.name === 'Balsamic Vinaigrette')!.uom_category).toBe('volume');
    expect(out.rows.find((r) => r.name === 'Cranberries')!.uom_category).toBeUndefined();
  });

  it('handles a mid-sheet category switch on the right column', () => {
    // Mirrors the real fixture where the right column shifts category mid-sheet
    // (row 10: right-cell becomes "DRESSINGS/SAUCES/MIXES").
    const rows: (string | null)[][] = [
      ['MEATS', null, null, 'CHEESE', null],
      ['Bacon', '7 days', null, 'American', '7 days'],
      ['Chicken Tenders', '3 days', null, 'DRESSINGS/SAUCES/MIXES', null],
      ['Shrimp', '3 days', null, 'Balsamic Vinaigrette', '30 days'],
    ];
    const out = shelf_life_parser(rows, ctx);
    expect(out.errors).toEqual([]);
    // The right-side "DRESSINGS/SAUCES/MIXES" row is a category header,
    // not an item — it should not appear as a StagingIngredient row.
    expect(out.rows.find((r) => r.name === 'DRESSINGS/SAUCES/MIXES')).toBeUndefined();
    const vin = out.rows.find((r) => r.name === 'Balsamic Vinaigrette')!;
    expect(vin.uom_category).toBe('volume');
    expect(vin.shelf_life_days).toBe(30);
  });

  it('records an error for unparseable shelf_life text', () => {
    const rows: (string | null)[][] = [
      ['MEATS', null, null, null, null],
      ['Mystery Meat', 'as needed', null, null, null],
    ];
    const out = shelf_life_parser(rows, ctx);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]!.message).toMatch(/unparseable shelf_life/);
    expect(out.rows).toHaveLength(0);
  });

  it('skips blank / trailing empty rows without errors', () => {
    const rows: (string | null)[][] = [
      ['MEATS', null, null, null, null],
      ['Bacon', '7 days', null, null, null],
      [null, null, null, null, null],
      ['', '', null, null, null],
      ['Turkey', '5 days', null, null, null],
    ];
    const out = shelf_life_parser(rows, ctx);
    expect(out.errors).toEqual([]);
    expect(out.rows).toHaveLength(2);
  });
});

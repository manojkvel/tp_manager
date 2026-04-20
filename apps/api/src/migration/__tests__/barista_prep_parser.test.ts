// barista_prep_parser tests (§6.14 AC-3).
// Input matrices mirror "Barista Prep.xlsx" — a template export with section
// headers and (optional) par quantities.

import { describe, it, expect } from 'vitest';
import { barista_prep_parser } from '../parsers/barista_prep_parser.js';
import type { BatchContext } from '../types.js';

const ctx: BatchContext = {
  batch_id: 'batch-1',
  source_file: 'Barista Prep.xlsx',
  parser_version: '1.0.0',
  restaurant_id: 'rid',
  started_at: new Date('2026-04-19T00:00:00Z'),
};

describe('barista_prep_parser', () => {
  it('extracts items with section tags from a template export (pars empty)', () => {
    const rows: (string | null)[][] = [
      ['Barista Prep  ', null, null],
      ['Items', 'Par', null],
      ['Iced Chai', null, null],
      ['Mocha Cold Brew', null, null],
      [null, null, null],
      ['Specials', null, null],
      ['Pumpkin Cold Brew', null, null],
    ];
    const out = barista_prep_parser(rows, ctx);
    expect(out.errors).toEqual([]);
    expect(out.rows.map((r) => r.recipe_name)).toEqual([
      'Iced Chai', 'Mocha Cold Brew', 'Pumpkin Cold Brew',
    ]);
    expect(out.rows.find((r) => r.recipe_name === 'Pumpkin Cold Brew')!.section).toBe('Specials');
    expect(out.rows.find((r) => r.recipe_name === 'Iced Chai')!.qty).toBeUndefined();
  });

  it('parses numeric par values when provided', () => {
    const rows: (string | null)[][] = [
      ['Items', 'Par', null],
      ['Iced Chai', '2', null],
      ['Mocha Cold Brew', '1.5', null],
    ];
    const out = barista_prep_parser(rows, ctx);
    expect(out.rows.find((r) => r.recipe_name === 'Iced Chai')!.qty).toBe(2);
    expect(out.rows.find((r) => r.recipe_name === 'Mocha Cold Brew')!.qty).toBe(1.5);
  });

  it('records an error on unparseable par value', () => {
    const rows: (string | null)[][] = [
      ['Items', 'Par', null],
      ['Iced Chai', 'as needed', null],
    ];
    const out = barista_prep_parser(rows, ctx);
    expect(out.rows).toHaveLength(0);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]!.message).toMatch(/unparseable par/);
  });

  it('switches section when a single-cell header row appears', () => {
    // Real-fixture layout: blank-row separator precedes each section header,
    // and an "Items | Par" column-header row may re-introduce the columns.
    const rows: (string | null)[][] = [
      ['Items', 'Par', null],
      ['Cold Brew', null, null],
      [null, null, null],
      ['Specials', null, null],
      ['Pumpkin Cold Brew', null, null],
      [null, null, null],
      ['Barista Fridge Stocking List', null, null],
      ['Items', 'Par', null],
      ['Oat Milk', null, null],
    ];
    const out = barista_prep_parser(rows, ctx);
    const sections = out.rows.map((r) => r.section);
    expect(sections).toEqual([undefined, 'Specials', 'Barista Fridge Stocking List']);
  });
});

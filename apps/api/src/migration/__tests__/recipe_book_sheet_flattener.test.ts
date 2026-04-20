// recipe_book_sheet_flattener tests (§6.14 AC-3 helper).
// Verifies that the flattener turns the real multi-sheet TP Recipe Book
// layout into a matrix the canonical recipe_book_parser can accept.

import { describe, it, expect } from 'vitest';
import { flattenRecipeBook } from '../parsers/recipe_book_sheet_flattener.js';
import { recipe_book_parser } from '../parsers/recipe_book_parser.js';
import type { BatchContext } from '../types.js';

const ctx: BatchContext = {
  batch_id: 'batch-1',
  source_file: 'TP Recipe Book.xlsx',
  parser_version: '1.0.0',
  restaurant_id: 'rid',
  started_at: new Date('2026-04-19T00:00:00Z'),
};

describe('recipe_book_sheet_flattener', () => {
  it('flattens a Cilantro-Honey-Dijon-shaped sheet into canonical rows', () => {
    const sheets = [
      {
        sheet_name: 'Cilantro Honey Dijon',
        rows: [
          [new Date('2024-04-01'), 'CILANTRO HONEY DIJON', null, '1X  Recipe      '],
          ['Ingredients', 'Ingredientes', 'Quantity', 'Cantidad'],
          ['Mayonnaise', 'Mayonesa', '1 bottle (1 gallon)', '1 bote (1 galón)'],
          ["Gulden's Spicy Brown Mustard", 'Mostaza', '2 quarts', '2 cuartos'],
          ['Honey', 'Miel', '2 cups', '2 copas'],
          ['Shelf Life: 30 days', null, null, null],
          ['Equipment:', null, 'Equipo:', null],
        ],
      },
    ];
    const matrix = flattenRecipeBook(sheets);
    expect(matrix[0]).toContain('recipe_name');

    const out = recipe_book_parser(matrix, ctx);
    expect(out.errors).toEqual([]);
    const bundle = out.rows[0]!;
    expect(bundle.recipes).toHaveLength(1);
    expect(bundle.recipes[0]!.name).toBe('CILANTRO HONEY DIJON');
    // Shelf-life + Equipment labels are dropped; three ingredients kept.
    expect(bundle.lines).toHaveLength(3);
    expect(bundle.lines[0]!.ingredient_name).toBe('Mayonnaise');
    expect(bundle.lines[0]!.qty_text).toMatch(/bottle/);
  });

  it('parses fractional qty (1/3 cup) and preserves uom hint', () => {
    const sheets = [
      {
        sheet_name: 'Cinnamon Sugar Swirl',
        rows: [
          [new Date('2024-04-01'), 'CINNAMON SUGAR SWIRL', null, '1X Recipe'],
          ['Ingredients', 'Ingredientes', 'Quantity', 'Cantidad'],
          ['Cinnamon', 'Canela', '1/3 cup', '1/3 copa'],
        ],
      },
    ];
    const matrix = flattenRecipeBook(sheets);
    const out = recipe_book_parser(matrix, ctx);
    expect(out.errors).toEqual([]);
    const line = out.rows[0]!.lines[0]!;
    expect(line.ingredient_name).toBe('Cinnamon');
    // 1/3 → 0.3333… — accept any non-integer approximation.
    expect(line.qty).toBeGreaterThan(0.33);
    expect(line.qty).toBeLessThan(0.34);
    expect(line.uom).toBe('cup');
  });

  it('joins multiple sheets into one canonical matrix', () => {
    const sheets = [
      {
        sheet_name: 'Salsa',
        rows: [
          [new Date('2024-04-01'), 'SALSA', null, '1x Recipe'],
          ['Ingredients', 'Ingredientes', 'Quantity', 'Cantidad'],
          ['Canned Diced Tomatoes', 'Tomates', '3 cans', '3 latas'],
          ['Cilantro', 'Cilantro', '8 oz', '8 oz'],
        ],
      },
      {
        sheet_name: 'Mixed Cheese',
        rows: [
          [new Date('2024-04-01'), 'MIXED CHEESE', null, '1x Recipe'],
          ['Ingredients', null, 'Quantity', null],
          ['Jack Cheese', 'Queso Jack', '2 bags', '2 bolsas'],
        ],
      },
    ];
    const matrix = flattenRecipeBook(sheets);
    const out = recipe_book_parser(matrix, ctx);
    expect(out.errors).toEqual([]);
    const names = out.rows[0]!.recipes.map((r) => r.name).sort();
    expect(names).toEqual(['MIXED CHEESE', 'SALSA']);
  });

  it('uses the sheet name as a fallback when row 1 has no title', () => {
    const sheets = [
      {
        sheet_name: 'Frybread',
        rows: [
          ['Ingredients', 'Ingredientes', 'Quantity', 'Cantidad'],
          ['Flour', 'Harina', '2 cups', '2 copas'],
        ],
      },
    ];
    const matrix = flattenRecipeBook(sheets);
    const out = recipe_book_parser(matrix, ctx);
    expect(out.errors).toEqual([]);
    expect(out.rows[0]!.recipes[0]!.name).toBe('Frybread');
  });
});

// flash_card_parser tests (§6.14 AC-3).

import { describe, it, expect } from 'vitest';
import { flash_card_parser } from '../parsers/flash_card_parser.js';
import type { BatchContext } from '../types.js';

const ctx: BatchContext = {
  batch_id: 'batch-1',
  source_file: 'flash_cards.csv',
  parser_version: '1.0.0',
  restaurant_id: 'rid',
  started_at: new Date('2026-04-19T00:00:00Z'),
};

describe('flash_card_parser', () => {
  it('groups by (deck, slide_number, item_name) and joins body lines as bullets', () => {
    const rows: string[][] = [
      ['deck', 'slide_number', 'item_name', 'line_index', 'line_text'],
      ['Beverage Flash Cards', '5', 'Marshmallow World Cold Brew', '0', 'Marshmallow World Cold Brew'],
      ['Beverage Flash Cards', '5', 'Marshmallow World Cold Brew', '1', 'Coffee ice cube with mocha cold brew'],
      ['Beverage Flash Cards', '5', 'Marshmallow World Cold Brew', '2', 'Topped with marshmallow cold foam'],
      ['Beverage Flash Cards', '5', 'Marshmallow World Cold Brew', '3', 'Served in a stemless wineglass'],
    ];
    const out = flash_card_parser(rows, ctx);
    expect(out.errors).toEqual([]);
    expect(out.rows).toHaveLength(1);
    const note = out.rows[0]!;
    expect(note.recipe_name).toBe('Marshmallow World Cold Brew');
    expect(note.section).toBe('Beverage Flash Cards');
    expect(note.plating_notes).toBe(
      '• Coffee ice cube with mocha cold brew\n• Topped with marshmallow cold foam\n• Served in a stemless wineglass',
    );
  });

  it('skips title-only / cover slides with no body', () => {
    const rows: string[][] = [
      ['deck', 'slide_number', 'item_name', 'line_index', 'line_text'],
      ['Beverage Flash Cards', '1', 'Beverage Item Descriptions & Pictures', '0', 'Beverage Item Descriptions & Pictures'],
      ['Beverage Flash Cards', '7', 'Annie\u2019s Lemonade', '1', 'Ice, Strawberry reduction, and pink lemonade blended'],
    ];
    const out = flash_card_parser(rows, ctx);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.recipe_name).toBe('Annie\u2019s Lemonade');
  });

  it('separates two slides for the same item_name in different decks', () => {
    const rows: string[][] = [
      ['deck', 'slide_number', 'item_name', 'line_index', 'line_text'],
      ['Beverage Flash Cards', '5', 'Marshmallow World Cold Brew', '1', 'beverage description'],
      ['Menu Flash Cards', '88', 'Side of Sunny Side Up Eggs', '1', 'Two sunny side up eggs on a side plate'],
    ];
    const out = flash_card_parser(rows, ctx);
    expect(out.rows.map((r) => [r.section, r.recipe_name])).toEqual([
      ['Beverage Flash Cards', 'Marshmallow World Cold Brew'],
      ['Menu Flash Cards', 'Side of Sunny Side Up Eggs'],
    ]);
  });

  it('orders body lines by line_index even when the source CSV is shuffled', () => {
    const rows: string[][] = [
      ['deck', 'slide_number', 'item_name', 'line_index', 'line_text'],
      ['Menu Flash Cards', '98', 'Fruit Cup', '3', 'Served when subbing'],
      ['Menu Flash Cards', '98', 'Fruit Cup', '1', 'Pineapple, Grapes, Strawberries'],
      ['Menu Flash Cards', '98', 'Fruit Cup', '2', 'In a soup cup on a side plate'],
    ];
    const out = flash_card_parser(rows, ctx);
    expect(out.rows[0]!.plating_notes.split('\n')).toEqual([
      '• Pineapple, Grapes, Strawberries',
      '• In a soup cup on a side plate',
      '• Served when subbing',
    ]);
  });

  it('records errors for unparseable slide_number / line_index', () => {
    const rows: string[][] = [
      ['deck', 'slide_number', 'item_name', 'line_index', 'line_text'],
      ['Beverage Flash Cards', 'one', 'Cappuccino', '1', 'do thing'],
      ['Beverage Flash Cards', '5', 'Mocha', 'abc', 'do another thing'],
    ];
    const out = flash_card_parser(rows, ctx);
    expect(out.errors).toHaveLength(2);
    expect(out.errors[0]!.message).toMatch(/unparseable slide_number/);
    expect(out.errors[1]!.message).toMatch(/unparseable line_index/);
  });
});

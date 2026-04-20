// TASK-044 — aloha_pmix_parser tests (§6.12a AC-3, §6.14 AC-3).

import { describe, it, expect } from 'vitest';
import { aloha_pmix_parser } from '../parsers/aloha_pmix_parser.js';
import type { BatchContext } from '../types.js';

const ctx: BatchContext = {
  batch_id: 'batch-1',
  source_file: 'myReport (10).xlsx',
  parser_version: '1.0.0',
  restaurant_id: 'rid',
  started_at: new Date('2026-04-19T00:00:00Z'),
};

const HEADER = ['business_date', 'name', 'qty_sold', 'net_sales'];

describe('aloha_pmix_parser classification', () => {
  it('classifies ordinary items (qty > 0) as "item"', () => {
    const rows = [HEADER, ['2026-04-18', 'Omelette', '12', '150.00']];
    const out = aloha_pmix_parser(rows, ctx);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.kind).toBe('item');
    expect(out.rows[0]!.net_sales_cents).toBe(15000);
  });

  it('classifies "MOD:" rows as modifiers of the preceding item', () => {
    const rows = [
      HEADER,
      ['2026-04-18', 'Omelette',  '12', '150.00'],
      ['2026-04-18', 'MOD: Bacon', '8',  '32.00'],
    ];
    const out = aloha_pmix_parser(rows, ctx);
    const mod = out.rows.find((r) => r.kind === 'modifier')!;
    expect(mod).toBeDefined();
    expect(mod.modifier_of).toBe('Omelette');
    expect(mod.menu_item_name).toBe('Bacon');
  });

  it('classifies "86 <name>" rows with qty_sold=0 as stockouts', () => {
    const rows = [
      HEADER,
      ['2026-04-18', '86 Salmon', '0', '0'],
    ];
    const out = aloha_pmix_parser(rows, ctx);
    expect(out.rows[0]!.kind).toBe('stockout');
    expect(out.rows[0]!.menu_item_name).toBe('Salmon');
  });

  it('classifies COVER/GUEST COUNT rows as covers', () => {
    const rows = [
      HEADER,
      ['2026-04-18', 'COVERS', '85', '0'],
      ['2026-04-18', 'Guest Count', '85', '0'],
    ];
    const out = aloha_pmix_parser(rows, ctx);
    expect(out.rows.every((r) => r.kind === 'cover')).toBe(true);
  });

  it('surfaces malformed rows without aborting', () => {
    const rows = [
      HEADER,
      ['', 'x', '1', '0'],            // missing date
      ['2026-04-18', 'y', 'NaN', '0'], // invalid qty
      ['2026-04-18', 'z', '1', '0'],
    ];
    const out = aloha_pmix_parser(rows, ctx);
    expect(out.rows).toHaveLength(1);
    expect(out.errors).toHaveLength(2);
  });
});

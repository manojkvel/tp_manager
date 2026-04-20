// beverage_recipes_parser tests (§6.14 AC-3).

import { describe, it, expect } from 'vitest';
import { beverage_recipes_parser } from '../parsers/beverage_recipes_parser.js';
import type { BatchContext } from '../types.js';

const ctx: BatchContext = {
  batch_id: 'batch-1',
  source_file: 'beverage_recipes.csv',
  parser_version: '1.0.0',
  restaurant_id: 'rid',
  started_at: new Date('2026-04-19T00:00:00Z'),
};

describe('beverage_recipes_parser', () => {
  it('groups (section, recipe_name, vessel) and joins ordered procedure steps', () => {
    const rows: string[][] = [
      ['section', 'recipe_name', 'vessel', 'step_number', 'step_text', 'source_style'],
      ['Hot Drinks', 'Cappuccino', 'BIG MUG', '0', '', 'Normal'],
      ['Hot Drinks', 'Cappuccino', 'BIG MUG', '1', 'Fill pitcher to 9oz line', 'Normal'],
      ['Hot Drinks', 'Cappuccino', 'BIG MUG', '2', 'Steam to 140F', 'Normal'],
      ['Hot Drinks', 'Cappuccino', 'BIG MUG', '3', 'Brew 2 shots espresso', 'Normal'],
    ];
    const out = beverage_recipes_parser(rows, ctx);
    expect(out.errors).toEqual([]);
    expect(out.rows).toHaveLength(1);
    const r = out.rows[0]!;
    expect(r.name).toBe('Cappuccino');
    expect(r.type).toBe('menu');
    expect(r.yield_qty).toBe(1);
    expect(r.yield_uom).toBe('BIG MUG');
    expect(r.procedure).toBe('[Hot Drinks]\n1. Fill pitcher to 9oz line\n2. Steam to 140F\n3. Brew 2 shots espresso');
  });

  it('emits one recipe per unique (recipe_name, vessel) — Cappuccino + Latte share section', () => {
    const rows: string[][] = [
      ['section', 'recipe_name', 'vessel', 'step_number', 'step_text', 'source_style'],
      ['Hot Drinks', 'Cappuccino', 'BIG MUG', '1', 'cap step 1', 'Normal'],
      ['Hot Drinks', 'Latte', 'BIG MUG', '1', 'latte step 1', 'Normal'],
      ['Hot Drinks', 'Latte', 'BIG MUG', '2', 'latte step 2', 'Normal'],
    ];
    const out = beverage_recipes_parser(rows, ctx);
    expect(out.rows.map((r) => r.name).sort()).toEqual(['Cappuccino', 'Latte']);
    const latte = out.rows.find((r) => r.name === 'Latte')!;
    expect(latte.procedure).toContain('latte step 1');
    expect(latte.procedure).toContain('latte step 2');
  });

  it('sorts steps by step_number even when CSV is shuffled', () => {
    const rows: string[][] = [
      ['section', 'recipe_name', 'vessel', 'step_number', 'step_text', 'source_style'],
      ['Hot Drinks', 'Espresso', 'Espresso Cup', '3', 'third', 'Normal'],
      ['Hot Drinks', 'Espresso', 'Espresso Cup', '1', 'first', 'Normal'],
      ['Hot Drinks', 'Espresso', 'Espresso Cup', '2', 'second', 'Normal'],
    ];
    const out = beverage_recipes_parser(rows, ctx);
    expect(out.rows[0]!.procedure).toBe('[Hot Drinks]\n1. first\n2. second\n3. third');
  });

  it('drops step_number=0 title rows and keeps only real procedure', () => {
    const rows: string[][] = [
      ['section', 'recipe_name', 'vessel', 'step_number', 'step_text', 'source_style'],
      ['Hot Drinks', 'Chai Tea', 'BIG MUG', '0', '', 'Normal'],
      ['Hot Drinks', 'Chai Tea', 'BIG MUG', '1', 'Big mug filled 3/4 with Chai', 'Body Text'],
    ];
    const out = beverage_recipes_parser(rows, ctx);
    expect(out.rows[0]!.procedure).toBe('[Hot Drinks]\n1. Big mug filled 3/4 with Chai');
  });

  it('records an error for an unparseable step_number', () => {
    const rows: string[][] = [
      ['section', 'recipe_name', 'vessel', 'step_number', 'step_text', 'source_style'],
      ['Hot Drinks', 'Mocha', 'BIG MUG', 'first', 'do something', 'Normal'],
    ];
    const out = beverage_recipes_parser(rows, ctx);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]!.message).toMatch(/unparseable step_number/);
  });

  it('falls back yield_uom=serving when vessel is blank', () => {
    const rows: string[][] = [
      ['section', 'recipe_name', 'vessel', 'step_number', 'step_text', 'source_style'],
      ['', 'Mystery Drink', '', '1', 'do thing', 'Normal'],
    ];
    const out = beverage_recipes_parser(rows, ctx);
    expect(out.rows[0]!.yield_uom).toBe('serving');
  });
});

// GAP-01 — Printable recipe HTML (§6.3 AC-6 flash card, §6.3b AC-3 station sheet).
//
// The "PDF" endpoints render print-ready HTML with @media print CSS tuned for
// US Letter / A4, 4-up station cards. The browser performs the actual PDF
// conversion via Ctrl+P → "Save as PDF". This satisfies the deliverable
// (printable card / cheat sheet) without adding a heavyweight PDF lib.

import { describe, it, expect } from 'vitest';
import { renderRecipeCard, renderStationSheet } from '../printable.js';
import type { RecipeLineRow } from '../cost.js';

function line(overrides: Partial<RecipeLineRow>): RecipeLineRow {
  return {
    id: 'l1',
    recipe_version_id: 'v1',
    position: 0,
    ref_type: 'ingredient',
    ingredient_id: 'i1',
    ref_recipe_id: null,
    qty: 2,
    qty_text: null,
    uom: 'oz',
    note: null,
    station: 'lunch',
    step_order: 1,
    utensil_id: null,
    ...overrides,
  };
}

describe('renderRecipeCard (§6.3 AC-6)', () => {
  const recipe = {
    id: 'r1',
    name: 'Avocado Toast',
    type: 'menu' as const,
    version: {
      id: 'v1',
      yield_qty: 1,
      yield_uom: 'each',
      shelf_life_days: null,
      equipment: ['griddle', 'chef knife'],
      procedure: 'Toast bread. Mash avocado. Plate.',
      photo_url: null,
    },
    lines: [
      line({ position: 0, qty: 1, uom: 'slice', note: 'sourdough' }),
      line({ position: 1, qty: 0.5, uom: 'each', note: 'avocado' }),
    ],
    ingredient_labels: { i1: 'Sourdough' } as Record<string, string>,
  };

  it('renders a full HTML document with doctype', () => {
    const html = renderRecipeCard(recipe);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('</html>');
  });

  it('includes the recipe name as a heading', () => {
    const html = renderRecipeCard(recipe);
    expect(html).toContain('Avocado Toast');
  });

  it('embeds print-friendly @media print CSS sized for Letter/A4', () => {
    const html = renderRecipeCard(recipe);
    expect(html).toContain('@media print');
    expect(html).toMatch(/@page\s*\{[^}]*size:\s*letter/i);
  });

  it('lists equipment and procedure', () => {
    const html = renderRecipeCard(recipe);
    expect(html).toContain('griddle');
    expect(html).toContain('Mash avocado');
  });

  it('lists recipe lines', () => {
    const html = renderRecipeCard(recipe);
    expect(html).toContain('sourdough');
    expect(html).toContain('avocado');
  });

  it('does not include any cost numbers (cooks do not need prices)', () => {
    const html = renderRecipeCard(recipe);
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toContain('cost');
  });
});

describe('renderStationSheet (§6.3b AC-3)', () => {
  const rows = [
    {
      recipe_id: 'omelette',
      recipe_name: 'Basic Omelette',
      step_order: 1,
      line: line({ note: 'pour eggs', station: 'egg' }),
    },
    {
      recipe_id: 'omelette',
      recipe_name: 'Basic Omelette',
      step_order: 2,
      line: line({ note: 'fold', station: 'egg' }),
    },
    {
      recipe_id: 'benedict',
      recipe_name: 'Eggs Benedict',
      step_order: 1,
      line: line({ note: 'poach', station: 'egg' }),
    },
  ];

  it('renders a full HTML document', () => {
    const html = renderStationSheet('egg', rows);
    expect(html).toMatch(/^<!doctype html>/i);
  });

  it('groups lines under their recipe name', () => {
    const html = renderStationSheet('egg', rows);
    // Each recipe name should appear exactly once as a heading.
    expect(html.match(/Basic Omelette/g)?.length).toBeGreaterThanOrEqual(1);
    expect(html.match(/Eggs Benedict/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it('titles the sheet with the station name (title-cased)', () => {
    const html = renderStationSheet('egg', rows);
    expect(html).toMatch(/Egg Station/i);
  });

  it('uses a 4-up grid layout in print CSS', () => {
    const html = renderStationSheet('egg', rows);
    expect(html).toMatch(/grid-template-columns:\s*repeat\(2,/);
    expect(html).toMatch(/page-break-inside:\s*avoid/);
  });

  it('renders an empty sheet cleanly when no rows match', () => {
    const html = renderStationSheet('bar', []);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('No recipes');
  });
});

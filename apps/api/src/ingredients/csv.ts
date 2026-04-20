// TASK-033 — Ingredient CSV import/export (§6.1 AC-5).
//
// Hand-rolled CSV (no deps) — handles the columns the owner's prototype expects:
// name, uom, uom_category, pack_size, shelf_life_days, allergen_flags (|-joined), density_g_per_ml.
// Quoting: RFC 4180 minimal — values containing ',' '"' or newline are double-quoted and internal quotes doubled.

import type { UomCategory } from '@tp/types';
import type { IngredientRow } from './service.js';

const COLUMNS = [
  'name', 'uom', 'uom_category', 'pack_size', 'shelf_life_days', 'allergen_flags', 'density_g_per_ml',
] as const;

type CsvColumn = (typeof COLUMNS)[number];

function quote(v: string): string {
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function ingredientsToCsv(rows: IngredientRow[]): string {
  const header = COLUMNS.join(',');
  const body = rows.map((r) => [
    quote(r.name),
    quote(r.uom),
    r.uom_category,
    r.pack_size == null ? '' : String(r.pack_size),
    r.shelf_life_days == null ? '' : String(r.shelf_life_days),
    quote(r.allergen_flags.join('|')),
    r.density_g_per_ml == null ? '' : String(r.density_g_per_ml),
  ].join(','));
  return [header, ...body].join('\n');
}

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  let quoted = false;
  while (i < line.length) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      cur += c; i += 1; continue;
    }
    if (c === '"') { quoted = true; i += 1; continue; }
    if (c === ',') { out.push(cur); cur = ''; i += 1; continue; }
    cur += c; i += 1;
  }
  out.push(cur);
  return out;
}

export interface CsvIngredientInput {
  name: string;
  uom: string;
  uom_category: UomCategory;
  pack_size: number | null;
  shelf_life_days: number | null;
  allergen_flags: string[];
  density_g_per_ml: number | null;
}

export function csvToIngredients(csv: string): CsvIngredientInput[] {
  const lines = csv.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = parseLine(lines[0]!).map((h) => h.trim());
  for (const required of COLUMNS) {
    if (!headers.includes(required)) {
      throw new Error(`CSV missing required column: ${required}`);
    }
  }
  const idx: Record<CsvColumn, number> = Object.fromEntries(COLUMNS.map((c) => [c, headers.indexOf(c)])) as Record<CsvColumn, number>;
  return lines.slice(1).map((line) => {
    const f = parseLine(line);
    const uomCategory = f[idx.uom_category]?.trim();
    if (uomCategory !== 'weight' && uomCategory !== 'volume' && uomCategory !== 'count') {
      throw new Error(`invalid uom_category "${uomCategory}"`);
    }
    const packSize = f[idx.pack_size]?.trim();
    const shelfLifeDays = f[idx.shelf_life_days]?.trim();
    const allergen = f[idx.allergen_flags]?.trim() ?? '';
    const density = f[idx.density_g_per_ml]?.trim();
    return {
      name: f[idx.name]!.trim(),
      uom: f[idx.uom]!.trim(),
      uom_category: uomCategory,
      pack_size: packSize ? Number(packSize) : null,
      shelf_life_days: shelfLifeDays ? Number(shelfLifeDays) : null,
      allergen_flags: allergen ? allergen.split('|').map((s) => s.trim()).filter(Boolean) : [],
      density_g_per_ml: density ? Number(density) : null,
    };
  });
}

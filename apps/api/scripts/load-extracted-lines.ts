// Load LLM-extracted recipe lines into recipe_line rows.
//
// Reads:  apps/api/data/llm/recipe-lines-extracted.jsonl
// Each line: { id: "<recipe_uuid>", lines: [ {ref:"ingredient"|"recipe", name, qty|null, uom|null, note|null} ] }
//
// Matching rules:
//   - Exact case-insensitive match against existing ingredient.name or recipe.name (scoped to restaurant).
//   - If ref === "ingredient" and no match → create new ingredient (uom + uom_category inferred from row or defaults to oz/weight).
//   - If ref === "recipe" and no match → SKIP that line (do not auto-create sub-recipes) and log.
//   - qty = null → stored as 0 with qty_text populated from note (so "to taste" / "as needed" survives).
//
// Idempotent: skips recipes that already have any recipe_line rows on their current version.
//
// Usage:  set -a && source .env && set +a && pnpm --filter @tp/api exec tsx scripts/load-extracted-lines.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient, Prisma } from '@prisma/client';

const here = dirname(fileURLToPath(import.meta.url));
const IN_FILE = join(here, '..', 'data', 'llm', 'recipe-lines-extracted.jsonl');

type ExtLine = {
  ref: 'ingredient' | 'recipe';
  name: string;
  qty: number | null;
  uom: string | null;
  note: string | null;
};
type ExtRec = { id: string; lines: ExtLine[] };

function normUom(uom: string | null | undefined): { uom: string; category: 'weight' | 'volume' | 'count' } {
  const u = (uom ?? '').toLowerCase().trim();
  if (['oz', 'lb', 'g', 'kg'].includes(u)) return { uom: u, category: 'weight' };
  if (['fl_oz', 'floz', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'pt', 'qt', 'gal'].includes(u.replace(' ', '_'))) {
    return { uom: u.replace(' ', '_'), category: 'volume' };
  }
  if (['each', 'ea', 'unit', 'clove', 'slice', 'piece', 'serving'].includes(u)) return { uom: u || 'each', category: 'count' };
  return { uom: u || 'oz', category: 'weight' };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const restaurant = await prisma.restaurant.findFirst();
    if (!restaurant) throw new Error('no restaurant');
    const rid = restaurant.id;

    const text = readFileSync(IN_FILE, 'utf8');
    const recs: ExtRec[] = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));

    const ingredients = await prisma.ingredient.findMany({ where: { restaurant_id: rid } });
    const ingByName = new Map(ingredients.map((i) => [i.name.toLowerCase(), i]));
    const recipes = await prisma.recipe.findMany({ where: { restaurant_id: rid } });
    const recByName = new Map(recipes.map((r) => [r.name.toLowerCase(), r]));

    let createdIngredients = 0, insertedLines = 0, skippedRecipes = 0, skippedSubrecipes = 0;

    for (const rec of recs) {
      const version = await prisma.recipeVersion.findFirst({
        where: { recipe_id: rec.id, is_current: true },
      });
      if (!version) { console.warn(`no current version for recipe ${rec.id} — skip`); skippedRecipes += 1; continue; }

      const existingLineCount = await prisma.recipeLine.count({ where: { recipe_version_id: version.id } });
      if (existingLineCount > 0) { skippedRecipes += 1; continue; }

      let pos = 0;
      for (const l of rec.lines) {
        const key = l.name.toLowerCase().trim();
        if (!key) continue;

        if (l.ref === 'recipe') {
          const sub = recByName.get(key);
          if (!sub) { console.warn(`  [${rec.id}] sub-recipe not found: ${l.name}`); skippedSubrecipes += 1; continue; }
          const qty = l.qty ?? 0;
          await prisma.recipeLine.create({
            data: {
              recipe_version_id: version.id,
              position: pos, ref_type: 'recipe',
              ref_recipe_id: sub.id,
              qty: new Prisma.Decimal(qty),
              qty_text: l.qty == null ? (l.note ?? 'as needed') : null,
              uom: l.uom, note: l.note, step_order: pos + 1,
            },
          });
          pos += 1;
          insertedLines += 1;
          continue;
        }

        let ing = ingByName.get(key);
        if (!ing) {
          const { uom, category } = normUom(l.uom);
          ing = await prisma.ingredient.create({
            data: {
              restaurant_id: rid,
              name: l.name,
              uom, uom_category: category,
            },
          });
          ingByName.set(ing.name.toLowerCase(), ing);
          createdIngredients += 1;
        }
        const qty = l.qty ?? 0;
        await prisma.recipeLine.create({
          data: {
            recipe_version_id: version.id,
            position: pos, ref_type: 'ingredient',
            ingredient_id: ing.id,
            qty: new Prisma.Decimal(qty),
            qty_text: l.qty == null ? (l.note ?? 'as needed') : null,
            uom: l.uom, note: l.note, step_order: pos + 1,
          },
        });
        pos += 1;
        insertedLines += 1;
      }
    }

    console.log(`recipes processed: ${recs.length} (${skippedRecipes} already had lines)`);
    console.log(`ingredients created: ${createdIngredients}`);
    console.log(`sub-recipe lines skipped (not found): ${skippedSubrecipes}`);
    console.log(`recipe_line rows inserted: ${insertedLines}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

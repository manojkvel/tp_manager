// Load LLM-extracted recipe lines + proposed preps into recipe_version /
// recipe_line rows.
//
// Inputs (apps/api/data/llm/):
//   preps-to-create.jsonl         (optional) — one proposed prep per line:
//     { name, yield_qty, yield_uom, procedure, lines: [{ref, name, qty, uom, note}] }
//   recipe-lines-extracted.jsonl  (required) — one input recipe per line:
//     { id: "<recipe_uuid>", lines: [{ref, name, qty, uom, note}] }
//
// Behaviour:
//   - Phase 1: create every proposed prep (type='prep') that doesn't already
//     exist in the restaurant's catalogue. Each gets a v1 RecipeVersion marked
//     is_current = true with the LLM's yield + procedure. Preps already in
//     the catalogue are skipped (we do not overwrite existing preps).
//   - Phase 2: insert each new prep's own lines (after all preps are known, so
//     prep → prep references resolve).
//   - Phase 3: for every recipe in `recipe-lines-extracted.jsonl`, wipe the
//     current-version lines and re-insert from the extraction. This supports
//     re-running v2 as a full refresh over the v1 pass.
//
// Matching rules:
//   - Case-insensitive exact match against existing ingredient.name /
//     recipe.name (scoped to the single restaurant).
//   - Unknown ingredient → auto-create with UoM category inferred from the row.
//   - Unknown prep (ref:"recipe") in extraction lines → SKIP and log.
//
// Usage:
//   set -a && source .env && set +a && pnpm --filter @tp/api exec tsx scripts/load-extracted-lines.ts

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient, Prisma } from '@prisma/client';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(here, '..', 'data', 'llm');
const PREPS_FILE = join(DATA_DIR, 'preps-to-create.jsonl');
const LINES_FILE = join(DATA_DIR, 'recipe-lines-extracted.jsonl');
// Companion index file written by export-recipes-for-llm.ts. Used to translate
// the Mac-local UUIDs in LINES_FILE into stable recipe names so this script
// works against any freshly-seeded DB (where Prisma generates new UUIDs).
const NAMES_FILE = join(DATA_DIR, 'recipes-to-extract.jsonl');

type ExtRef = 'ingredient' | 'recipe';
type ExtLine = {
  ref: ExtRef;
  name: string;
  qty: number | null;
  uom: string | null;
  note: string | null;
};
type ExtRec = { id: string; lines: ExtLine[] };
type ProposedPrep = {
  name: string;
  yield_qty: number;
  yield_uom: string;
  procedure: string;
  lines: ExtLine[];
};

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
}

function normUom(uom: string | null | undefined): { uom: string; category: 'weight' | 'volume' | 'count' } {
  const u = (uom ?? '').toLowerCase().trim().replace(' ', '_');
  if (['oz', 'lb', 'g', 'kg'].includes(u)) return { uom: u, category: 'weight' };
  if (['fl_oz', 'floz', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'pt', 'qt', 'gal'].includes(u)) {
    return { uom: u === 'floz' ? 'fl_oz' : u, category: 'volume' };
  }
  if (['each', 'ea', 'unit', 'clove', 'slice', 'piece', 'serving', 'pinch'].includes(u)) {
    return { uom: u || 'each', category: 'count' };
  }
  return { uom: u || 'oz', category: 'weight' };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const restaurant = await prisma.restaurant.findFirst();
    if (!restaurant) throw new Error('no restaurant');
    const rid = restaurant.id;

    const proposedPreps = readJsonl<ProposedPrep>(PREPS_FILE);
    const extracted = readJsonl<ExtRec>(LINES_FILE);
    if (!extracted.length) throw new Error(`empty or missing ${LINES_FILE}`);
    // Build an id→name index from the export companion file. Names from
    // recipe-lines-extracted.jsonl's UUIDs may not exist in this DB, but the
    // names will, since seed-demo-data uses the same source CSVs.
    const idIndex = readJsonl<{ id: string; name: string }>(NAMES_FILE);
    const nameByExportId = new Map(idIndex.map((r) => [r.id, r.name.toLowerCase().trim()]));
    console.log(`loaded ${proposedPreps.length} proposed preps + ${extracted.length} recipe extractions (id→name index: ${nameByExportId.size})`);

    const ingredients = await prisma.ingredient.findMany({ where: { restaurant_id: rid } });
    const ingByName = new Map(ingredients.map((i) => [i.name.toLowerCase().trim(), i]));
    const recipes = await prisma.recipe.findMany({ where: { restaurant_id: rid } });
    const recByName = new Map(recipes.map((r) => [r.name.toLowerCase().trim(), r]));

    let createdIngredients = 0;
    let createdPreps = 0;
    let skippedPrepsExisting = 0;
    const newPrepLines: Array<{ prep_recipe_id: string; version_id: string; lines: ExtLine[] }> = [];

    async function ensureIngredient(name: string, uom: string | null): Promise<{ id: string }> {
      const key = name.toLowerCase().trim();
      const existing = ingByName.get(key);
      if (existing) return existing;
      const { uom: normalized, category } = normUom(uom);
      const created = await prisma.ingredient.create({
        data: { restaurant_id: rid, name, uom: normalized, uom_category: category },
      });
      ingByName.set(created.name.toLowerCase().trim(), created);
      createdIngredients += 1;
      return created;
    }

    async function insertLines(version_id: string, lines: ExtLine[], label: string): Promise<number> {
      let pos = 0;
      let skipped = 0;
      for (const l of lines) {
        const key = l.name.toLowerCase().trim();
        if (!key) continue;

        if (l.ref === 'recipe') {
          const sub = recByName.get(key);
          if (!sub) {
            console.warn(`  [${label}] sub-recipe not found: ${l.name}`);
            skipped += 1;
            continue;
          }
          await prisma.recipeLine.create({
            data: {
              recipe_version_id: version_id,
              position: pos,
              ref_type: 'recipe',
              ref_recipe_id: sub.id,
              qty: new Prisma.Decimal(l.qty ?? 0),
              qty_text: l.qty == null ? 'as needed' : null,
              uom: l.uom,
              note: l.note,
              step_order: pos + 1,
            },
          });
        } else {
          const ing = await ensureIngredient(l.name, l.uom);
          await prisma.recipeLine.create({
            data: {
              recipe_version_id: version_id,
              position: pos,
              ref_type: 'ingredient',
              ingredient_id: ing.id,
              qty: new Prisma.Decimal(l.qty ?? 0),
              qty_text: l.qty == null ? 'as needed' : null,
              uom: l.uom,
              note: l.note,
              step_order: pos + 1,
            },
          });
        }
        pos += 1;
      }
      return skipped;
    }

    // Phase 1 — create prep recipes + their v1 versions (no lines yet, so that
    // prep → prep references in their bodies can resolve in phase 2).
    for (const prep of proposedPreps) {
      const key = prep.name.toLowerCase().trim();
      if (recByName.has(key)) {
        skippedPrepsExisting += 1;
        continue;
      }
      const recipe = await prisma.recipe.create({
        data: { restaurant_id: rid, type: 'prep', name: prep.name },
      });
      const version = await prisma.recipeVersion.create({
        data: {
          recipe_id: recipe.id,
          version: 1,
          is_current: true,
          yield_qty: new Prisma.Decimal(prep.yield_qty),
          yield_uom: prep.yield_uom,
          procedure: prep.procedure ?? '',
        },
      });
      recByName.set(key, recipe);
      createdPreps += 1;
      newPrepLines.push({ prep_recipe_id: recipe.id, version_id: version.id, lines: prep.lines });
    }

    // Phase 2 — insert lines for each newly created prep.
    let prepLinesInserted = 0;
    let prepSubSkipped = 0;
    for (const entry of newPrepLines) {
      prepSubSkipped += await insertLines(entry.version_id, entry.lines, `prep:${entry.prep_recipe_id.slice(0, 8)}`);
      prepLinesInserted += entry.lines.length;
    }

    // Phase 3 — process extracted recipe lines. Wipe current-version lines
    // first so v2 is a true refresh over any prior v1 pass.
    let recipesProcessed = 0;
    let recipesMissingVersion = 0;
    let totalLinesInserted = 0;
    let totalSubSkipped = 0;
    let wipedRecipes = 0;

    for (const rec of extracted) {
      // Try by id first (works on the original Mac where IDs match), then
      // fall back to id→name→recipe (works on every other DB).
      let recipeId: string | null = null;
      let version = await prisma.recipeVersion.findFirst({
        where: { recipe_id: rec.id, is_current: true },
      });
      if (version) {
        recipeId = rec.id;
      } else {
        const name = nameByExportId.get(rec.id);
        const localRecipe = name ? recByName.get(name) : undefined;
        if (localRecipe) {
          recipeId = localRecipe.id;
          version = await prisma.recipeVersion.findFirst({
            where: { recipe_id: localRecipe.id, is_current: true },
          });
        }
      }
      if (!version || !recipeId) {
        const hint = nameByExportId.get(rec.id) ?? '(unknown name)';
        console.warn(`no current version for recipe ${rec.id} [${hint}] — skip`);
        recipesMissingVersion += 1;
        continue;
      }

      const existing = await prisma.recipeLine.count({ where: { recipe_version_id: version.id } });
      if (existing > 0) {
        await prisma.recipeLine.deleteMany({ where: { recipe_version_id: version.id } });
        wipedRecipes += 1;
      }

      totalSubSkipped += await insertLines(version.id, rec.lines, rec.id.slice(0, 8));
      totalLinesInserted += rec.lines.length;
      recipesProcessed += 1;
    }

    console.log('---');
    console.log(`preps created:                ${createdPreps}`);
    console.log(`preps skipped (in catalog):   ${skippedPrepsExisting}`);
    console.log(`prep internal lines queued:   ${prepLinesInserted} (${prepSubSkipped} sub-refs skipped)`);
    console.log(`recipes refreshed:            ${recipesProcessed} (${wipedRecipes} had prior lines wiped)`);
    console.log(`recipes missing current ver:  ${recipesMissingVersion}`);
    console.log(`extraction lines attempted:   ${totalLinesInserted} (${totalSubSkipped} sub-refs skipped)`);
    console.log(`ingredients auto-created:     ${createdIngredients}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

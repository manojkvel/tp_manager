// Export recipes with zero recipe_line rows + existing ingredient / recipe
// catalogue so an LLM can extract structured ingredient lines from their
// narrative procedure text.
//
// Outputs (written to apps/api/data/llm/):
//   recipes-to-extract.jsonl   one JSON object per line: { id, name, type, procedure }
//   catalog.json               { ingredients: [{name, uom}], recipes: [{name, type}] }
//
// Usage:  set -a && source .env && set +a && pnpm --filter @tp/api exec tsx scripts/export-recipes-for-llm.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, '..', 'data', 'llm');

async function main() {
  const prisma = new PrismaClient();
  try {
    const restaurant = await prisma.restaurant.findFirst();
    if (!restaurant) throw new Error('no restaurant — run bootstrap-owner first');
    const rid = restaurant.id;

    const empty = await prisma.$queryRaw<Array<{ id: string; name: string; type: string; procedure: string }>>`
      SELECT r.id, r.name, r.type::text AS type, rv.procedure
      FROM recipe r
      JOIN recipe_version rv ON rv.recipe_id = r.id AND rv.is_current = true
      LEFT JOIN recipe_line rl ON rl.recipe_version_id = rv.id
      WHERE r.restaurant_id = ${rid}::uuid
      GROUP BY r.id, r.name, r.type, rv.procedure
      HAVING count(rl.id) = 0
      ORDER BY r.type, r.name
    `;

    const ingredients = await prisma.ingredient.findMany({
      where: { restaurant_id: rid },
      select: { name: true, uom: true },
      orderBy: { name: 'asc' },
    });
    const recipes = await prisma.recipe.findMany({
      where: { restaurant_id: rid },
      select: { name: true, type: true },
      orderBy: { name: 'asc' },
    });

    mkdirSync(OUT_DIR, { recursive: true });

    const jsonl = empty.map((r) => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(join(OUT_DIR, 'recipes-to-extract.jsonl'), jsonl);

    writeFileSync(
      join(OUT_DIR, 'catalog.json'),
      JSON.stringify({ ingredients, recipes }, null, 2),
    );

    console.log(`wrote ${empty.length} recipes → ${OUT_DIR}/recipes-to-extract.jsonl`);
    console.log(`wrote catalog (${ingredients.length} ingredients, ${recipes.length} recipes) → ${OUT_DIR}/catalog.json`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

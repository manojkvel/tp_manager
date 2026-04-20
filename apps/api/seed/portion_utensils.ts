// TASK-023 — Seed the 8 portion utensils from spec §6.3a AC-2.
// Source: Portion Control Utensils.docx (owner-provided; EN-only per v1.6).
//
// Each utensil carries a `default_uom` + `default_qty`, which becomes the
// row in `utensil_equivalence` with `ingredient_id = NULL`. Per-ingredient
// overrides are seeded later during migration (TASK-046/047).
//
// Runner: `pnpm -F @tp/api exec tsx apps/api/seed/portion_utensils.ts`
// (the top-level seed orchestrator will be TASK-046 land).

import { PrismaClient, type EquivalenceSource, type UtensilKind } from '@prisma/client';

interface SeedRow {
  name: string;
  label_colour: string | null;
  kind: UtensilKind;
  default_uom: string;
  default_qty: number;
}

const SEED: readonly SeedRow[] = [
  { name: 'Purple 0.75 oz Scoop', label_colour: 'purple', kind: 'scoop', default_uom: 'oz', default_qty: 0.75 },
  { name: 'Blue 2 oz Scoop',      label_colour: 'blue',   kind: 'scoop', default_uom: 'oz', default_qty: 2 },
  { name: 'Grey 4 oz Scoop',      label_colour: 'grey',   kind: 'scoop', default_uom: 'oz', default_qty: 4 },
  { name: 'White 5.3 oz Scoop',   label_colour: 'white',  kind: 'scoop', default_uom: 'oz', default_qty: 5.3 },
  { name: 'Small Baseball Cap 2 oz', label_colour: null,  kind: 'cap',   default_uom: 'oz', default_qty: 2 },
  { name: 'Large Baseball Cap 4 oz', label_colour: null,  kind: 'cap',   default_uom: 'oz', default_qty: 4 },
  { name: '2 oz Ladle', label_colour: null, kind: 'ladle', default_uom: 'oz', default_qty: 2 },
  { name: '6 oz Ladle', label_colour: null, kind: 'ladle', default_uom: 'oz', default_qty: 6 },
];

export async function seedPortionUtensils(prisma: PrismaClient, restaurantId: string): Promise<void> {
  for (const row of SEED) {
    const utensil = await prisma.portionUtensil.upsert({
      where: { restaurant_id_name: { restaurant_id: restaurantId, name: row.name } },
      create: {
        restaurant_id: restaurantId,
        name: row.name,
        label_colour: row.label_colour,
        kind: row.kind,
        default_uom: row.default_uom,
        default_qty: row.default_qty,
      },
      update: {
        label_colour: row.label_colour,
        kind: row.kind,
        default_uom: row.default_uom,
        default_qty: row.default_qty,
      },
    });

    // Each utensil gets exactly one default equivalence (ingredient_id = null).
    // We emulate UPSERT via a find+create pair because the partial unique index
    // on utensil_equivalence is Postgres-level and Prisma can't target it
    // directly in `upsert`.
    const existingDefault = await prisma.utensilEquivalence.findFirst({
      where: { utensil_id: utensil.id, ingredient_id: null },
    });
    if (!existingDefault) {
      await prisma.utensilEquivalence.create({
        data: {
          utensil_id: utensil.id,
          ingredient_id: null,
          equivalent_qty: row.default_qty,
          equivalent_uom: row.default_uom,
          source: 'default' satisfies EquivalenceSource,
        },
      });
    }
  }
}

// Allow `tsx apps/api/seed/portion_utensils.ts <restaurant_id>` invocations.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , restaurantId] = process.argv;
  if (!restaurantId) {
    console.error('usage: tsx portion_utensils.ts <restaurant_id>');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  seedPortionUtensils(prisma, restaurantId)
    .then(() => {
      console.log(`[seed] portion_utensils: ${SEED.length} rows seeded for restaurant ${restaurantId}`);
      return prisma.$disconnect();
    })
    .catch((err) => {
      console.error('[seed] portion_utensils failed:', err);
      return prisma.$disconnect().finally(() => process.exit(1));
    });
}

export const PORTION_UTENSIL_SEED = SEED;

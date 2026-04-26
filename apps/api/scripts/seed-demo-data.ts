// Seed the local dev DB with the owner's real CSV exports from
// `/Users/kvel/Downloads/Restaurant operations 2/csv_exports`, plus enough
// synthesised operational rows (suppliers, ingredients, inventory, prep,
// deliveries, orders, waste) that the UI is not empty.
//
// Idempotent — safe to re-run. Skips inserts if rows with the same
// (restaurant_id, name) tuple already exist. Designed for local development
// only; do NOT run against a shared environment.
//
// Usage:  pnpm --filter @tp/api exec tsx scripts/seed-demo-data.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient, Prisma } from '@prisma/client';
import { portion_utensils_parser } from '../src/migration/parsers/portion_utensils_parser.js';
import { beverage_recipes_parser } from '../src/migration/parsers/beverage_recipes_parser.js';
import { flash_card_parser } from '../src/migration/parsers/flash_card_parser.js';
import type { BatchContext } from '../src/migration/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(here, '..', 'data');

// Minimal RFC-4180-ish CSV reader — same logic as the smoke-test helper.
function loadCsv(path: string): string[][] {
  const text = readFileSync(path, 'utf8');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; }
        else { inQuotes = false; }
      } else { cell += ch; }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Collapse parser's detailed utensil kinds into the DB enum values.
function utensilKindToEnum(kind: string): 'scoop' | 'ladle' | 'bag' | 'spoon' | 'cap' {
  if (kind.includes('scoop')) return 'scoop';
  if (kind.includes('ladle')) return 'ladle';
  if (kind === 'baseball_cap' || kind.includes('cap')) return 'cap';
  if (kind.includes('spoon') || kind.includes('spoodle')) return 'spoon';
  if (kind.includes('bag')) return 'bag';
  return 'scoop';
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const owner = await prisma.user.findFirst({ where: { role: 'owner' }, orderBy: { created_at: 'asc' } });
    if (!owner) throw new Error('no owner user — run bootstrap-owner first');
    const restaurant_id = owner.restaurant_id;
    const ctx: BatchContext = {
      batch_id: 'seed-demo-data',
      source_file: 'csv_exports',
      parser_version: '1.0.0',
      restaurant_id,
      started_at: new Date(),
    };

    console.log(`→ seeding restaurant ${restaurant_id}`);

    await seedLocations(prisma, restaurant_id);
    await seedWasteReasons(prisma, restaurant_id);
    await seedStations(prisma, restaurant_id);

    // Utensils + ingredients derived from portion_utensils.csv
    const utensilRows = loadCsv(join(DATA_DIR, 'portion_utensils.csv'));
    const utensilOut = portion_utensils_parser(utensilRows, ctx);
    const ingredientNames = Array.from(new Set(
      utensilOut.rows
        .filter((r) => r.ingredient_name)
        .map((r) => r.ingredient_name!.trim())
        .filter((n) => n.length > 0),
    ));
    const utensilDefaults = utensilOut.rows.filter((r) => !r.ingredient_name);
    console.log(`  utensils: ${utensilDefaults.length} defaults, ${utensilOut.rows.length - utensilDefaults.length} assignments`);

    const ingredientsById = await upsertIngredients(prisma, restaurant_id, ingredientNames);
    console.log(`  ingredients: ${ingredientsById.size}`);

    const supplier = await upsertSupplier(prisma, restaurant_id);
    await linkIngredientsToSupplier(prisma, supplier.id, Array.from(ingredientsById.values()));
    console.log(`  supplier:    ${supplier.name}`);

    const utensilsByName = await upsertUtensils(prisma, restaurant_id, utensilDefaults, utensilKindToEnum);
    await upsertUtensilEquivalences(prisma, utensilOut.rows, utensilsByName, ingredientsById);
    console.log(`  utensil equivalences wired`);

    // Beverage recipes
    const bevRows = loadCsv(join(DATA_DIR, 'beverage_recipes.csv'));
    const bevOut = beverage_recipes_parser(bevRows, ctx);
    console.log(`  beverage recipes: ${bevOut.rows.length}`);
    const recipesByName = await upsertBeverageRecipes(prisma, restaurant_id, bevOut.rows);

    // Flash cards → append plating notes to matching recipes (or create placeholders)
    const flashRows = loadCsv(join(DATA_DIR, 'flash_cards.csv'));
    const flashOut = flash_card_parser(flashRows, ctx);
    console.log(`  plating notes:    ${flashOut.rows.length}`);
    await appendPlatingNotes(prisma, restaurant_id, flashOut.rows, recipesByName);

    // Curated pantry + composed recipes with real ingredient/sub-recipe lines.
    // This is what makes the UI feel "live" — every other seed is flat lists.
    const pantry = await seedPantry(prisma, restaurant_id);
    await linkIngredientsToSupplier(prisma, supplier.id, Array.from(pantry.values()));
    console.log(`  pantry:      ${pantry.size} curated ingredients`);
    const prepRecipes = await seedPrepRecipes(prisma, restaurant_id, pantry);
    console.log(`  prep recipes: ${prepRecipes.size} with ingredient lines`);
    const menuRecipes = await seedMenuRecipes(prisma, restaurant_id, pantry, prepRecipes);
    console.log(`  menu recipes: ${menuRecipes.size} with composed lines`);
    await seedParLevels(prisma, restaurant_id, menuRecipes);
    console.log(`  par levels wired`);
    await seedHistoricalSalesAndCovers(prisma, restaurant_id, menuRecipes);
    console.log(`  POS sales + covers: last 14 days`);
    await seedForecastPredictions(prisma, restaurant_id, menuRecipes);
    console.log(`  forecasts: next 7 days`);

    // Operational demo rows — small, meaningful, deterministic
    await seedInventoryCount(prisma, restaurant_id, Array.from(pantry.values()).slice(0, 15));
    await seedPrepSheetFromForecast(prisma, restaurant_id);
    await seedDelivery(prisma, restaurant_id, supplier.id, Array.from(pantry.values()).slice(0, 4));
    await seedOrder(prisma, restaurant_id, supplier.id, Array.from(pantry.values()).slice(4, 7));
    await seedWasteEntries(prisma, restaurant_id, Array.from(pantry.values()).slice(0, 3));

    console.log('\n✓ seed complete');
  } finally {
    await prisma.$disconnect();
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Catalogue helpers
// ──────────────────────────────────────────────────────────────────────────

async function seedLocations(prisma: PrismaClient, restaurant_id: string): Promise<void> {
  const specs: Array<{ name: string; kind: 'dry' | 'cold' | 'freezer' | 'bar' | 'prep' }> = [
    { name: 'Walk-in cooler', kind: 'cold' },
    { name: 'Walk-in freezer', kind: 'freezer' },
    { name: 'Dry storage', kind: 'dry' },
    { name: 'Bar', kind: 'bar' },
    { name: 'Prep line', kind: 'prep' },
  ];
  for (const s of specs) {
    await prisma.location.upsert({
      where: { restaurant_id_name: { restaurant_id, name: s.name } },
      update: {},
      create: { restaurant_id, name: s.name, kind: s.kind },
    });
  }
}

async function seedWasteReasons(prisma: PrismaClient, restaurant_id: string): Promise<void> {
  const specs = [
    { code: 'SPOILAGE',    label: 'Spoilage' },
    { code: 'OVER_PREP',   label: 'Over-prep' },
    { code: 'DROPPED',     label: 'Dropped / contaminated' },
    { code: 'OVERCOOKED',  label: 'Overcooked' },
    { code: 'WRONG_ORDER', label: 'Wrong order' },
  ];
  for (const s of specs) {
    await prisma.wasteReason.upsert({
      where: { restaurant_id_code: { restaurant_id, code: s.code } },
      update: { label: s.label },
      create: { restaurant_id, code: s.code, label: s.label },
    });
  }
}

async function seedStations(prisma: PrismaClient, restaurant_id: string): Promise<void> {
  const specs = [
    { code: 'PREP',    label: 'Prep',    sort_order: 10 },
    { code: 'GRILL',   label: 'Grill',   sort_order: 20 },
    { code: 'EXPO',    label: 'Expo',    sort_order: 30 },
    { code: 'BARISTA', label: 'Barista', sort_order: 40 },
    { code: 'BAR',     label: 'Bar',     sort_order: 50 },
  ];
  for (const s of specs) {
    await prisma.station.upsert({
      where: { restaurant_id_code: { restaurant_id, code: s.code } },
      update: { label: s.label, sort_order: s.sort_order },
      create: { restaurant_id, ...s },
    });
  }
}

async function upsertIngredients(
  prisma: PrismaClient, restaurant_id: string, names: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const cold = await prisma.location.findFirst({ where: { restaurant_id, name: 'Walk-in cooler' } });
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const existing = await prisma.ingredient.findUnique({
      where: { restaurant_id_name: { restaurant_id, name } },
    });
    if (existing) { out.set(name, existing.id); continue; }

    // Naïve UoM/category guess — good enough for demo. "oz/weight" fits most
    // food ingredients in the source data; adjust manually from the UI later.
    const ing = await prisma.ingredient.create({
      data: {
        restaurant_id,
        name,
        uom: 'oz',
        uom_category: 'weight',
        storage_location_id: cold?.id,
      },
    });
    out.set(name, ing.id);

    // Seed one cost so cost math works in reports
    await prisma.ingredientCost.create({
      data: {
        ingredient_id: ing.id,
        unit_cost_cents: 120 + Math.floor(Math.random() * 400),
        effective_from: new Date(),
        source: 'manual',
        note: 'demo seed',
      },
    });
  }
  return out;
}

async function upsertSupplier(prisma: PrismaClient, restaurant_id: string): Promise<{ id: string; name: string }> {
  const name = 'US Foods (demo)';
  const found = await prisma.supplier.findUnique({
    where: { restaurant_id_name: { restaurant_id, name } },
  });
  if (found) return { id: found.id, name: found.name };
  const s = await prisma.supplier.create({
    data: {
      restaurant_id,
      name,
      contact_name: 'Sales Rep',
      email: 'orders@usfoods.example',
      phone: '(555) 010-0100',
      lead_time_days: 2,
      min_order_cents: 10000,
      order_cadence: 'M,W,F',
    },
  });
  return { id: s.id, name: s.name };
}

async function linkIngredientsToSupplier(
  prisma: PrismaClient, supplier_id: string, ingredient_ids: string[],
): Promise<void> {
  for (const ingredient_id of ingredient_ids.slice(0, 20)) {
    await prisma.ingredient.update({
      where: { id: ingredient_id },
      data: { default_supplier_id: supplier_id },
    });
    await prisma.supplierIngredient.upsert({
      where: {
        supplier_id_ingredient_id_effective_from: {
          supplier_id, ingredient_id,
          effective_from: new Date('2026-01-01'),
        },
      },
      update: {},
      create: {
        supplier_id, ingredient_id,
        unit_cost_cents: 150 + Math.floor(Math.random() * 200),
        rank: 1,
        effective_from: new Date('2026-01-01'),
      },
    });
  }
}

async function upsertUtensils(
  prisma: PrismaClient, restaurant_id: string,
  defaults: Array<{ utensil_name: string; kind: string; default_qty: number; default_uom: string }>,
  kindMap: (k: string) => 'scoop' | 'ladle' | 'bag' | 'spoon' | 'cap',
): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const d of defaults) {
    const u = await prisma.portionUtensil.upsert({
      where: { restaurant_id_name: { restaurant_id, name: d.utensil_name } },
      update: { kind: kindMap(d.kind), default_qty: d.default_qty, default_uom: d.default_uom },
      create: {
        restaurant_id,
        name: d.utensil_name,
        kind: kindMap(d.kind),
        default_qty: d.default_qty,
        default_uom: d.default_uom,
      },
    });
    byName.set(d.utensil_name, u.id);
  }
  return byName;
}

async function upsertUtensilEquivalences(
  prisma: PrismaClient,
  rows: Array<{ utensil_name: string; ingredient_name?: string; default_qty: number; default_uom: string }>,
  utensilsByName: Map<string, string>, ingredientsById: Map<string, string>,
): Promise<void> {
  for (const r of rows) {
    const utensil_id = utensilsByName.get(r.utensil_name);
    if (!utensil_id) continue;
    const ingredient_id = r.ingredient_name ? ingredientsById.get(r.ingredient_name.trim()) ?? null : null;
    // Prisma's compound-unique upsert won't accept NULL on a nullable column,
    // so we emulate upsert via findFirst + create/update.
    const existing = await prisma.utensilEquivalence.findFirst({ where: { utensil_id, ingredient_id } });
    if (existing) {
      await prisma.utensilEquivalence.update({
        where: { id: existing.id },
        data: { equivalent_qty: r.default_qty, equivalent_uom: r.default_uom },
      });
    } else {
      await prisma.utensilEquivalence.create({
        data: {
          utensil_id,
          ingredient_id,
          equivalent_qty: r.default_qty,
          equivalent_uom: r.default_uom,
          source: ingredient_id ? 'override' : 'default',
        },
      });
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Recipe helpers
// ──────────────────────────────────────────────────────────────────────────

async function upsertBeverageRecipes(
  prisma: PrismaClient, restaurant_id: string,
  rows: Array<{ name: string; type: 'menu' | 'prep'; yield_qty: number; yield_uom: string; procedure: string }>,
): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const r of rows) {
    const existing = await prisma.recipe.findUnique({
      where: { restaurant_id_type_name: { restaurant_id, type: r.type, name: r.name } },
    });
    let recipe_id: string;
    if (existing) {
      recipe_id = existing.id;
    } else {
      const rec = await prisma.recipe.create({
        data: { restaurant_id, type: r.type, name: r.name },
      });
      recipe_id = rec.id;
      await prisma.recipeVersion.create({
        data: {
          recipe_id,
          version: 1,
          is_current: true,
          yield_qty: new Prisma.Decimal(r.yield_qty),
          yield_uom: r.yield_uom,
          procedure: r.procedure,
        },
      });
    }
    byName.set(r.name.toLowerCase(), recipe_id);
  }
  return byName;
}

async function appendPlatingNotes(
  prisma: PrismaClient, restaurant_id: string,
  notes: Array<{ recipe_name: string; section: string; plating_notes: string }>,
  recipesByName: Map<string, string>,
): Promise<void> {
  for (const n of notes) {
    const existingId = recipesByName.get(n.recipe_name.toLowerCase());
    if (existingId) {
      // Append plating notes to the current version's procedure field
      const current = await prisma.recipeVersion.findFirst({
        where: { recipe_id: existingId, is_current: true },
      });
      if (current && !current.procedure.includes(n.plating_notes.slice(0, 30))) {
        await prisma.recipeVersion.update({
          where: { id: current.id },
          data: {
            procedure: `${current.procedure}\n\n[Plating — ${n.section}]\n${n.plating_notes}`.trim(),
          },
        });
      }
      continue;
    }

    // Create a stub "menu" recipe for items only seen on flash cards
    // (e.g. food plates from Menu Flash Cards) so the library shows them.
    const existing = await prisma.recipe.findUnique({
      where: { restaurant_id_type_name: { restaurant_id, type: 'menu', name: n.recipe_name } },
    });
    if (existing) continue;
    const rec = await prisma.recipe.create({
      data: { restaurant_id, type: 'menu', name: n.recipe_name },
    });
    await prisma.recipeVersion.create({
      data: {
        recipe_id: rec.id,
        version: 1,
        is_current: true,
        yield_qty: new Prisma.Decimal(1),
        yield_uom: 'serving',
        procedure: `[Plating — ${n.section}]\n${n.plating_notes}`,
      },
    });
    recipesByName.set(n.recipe_name.toLowerCase(), rec.id);
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Operational demo helpers (small, deterministic rows for the UI)
// ──────────────────────────────────────────────────────────────────────────

async function seedInventoryCount(
  prisma: PrismaClient, restaurant_id: string, ingredient_ids: string[],
): Promise<void> {
  if (ingredient_ids.length === 0) return;
  const today = startOfDay(new Date());
  const existing = await prisma.inventoryCount.findFirst({
    where: { restaurant_id, date: today },
  });
  if (existing) return;
  const count = await prisma.inventoryCount.create({
    data: { restaurant_id, date: today, status: 'open' },
  });
  for (const ingredient_id of ingredient_ids) {
    await prisma.inventoryCountLine.create({
      data: {
        count_id: count.id,
        ref_type: 'ingredient',
        ingredient_id,
        expected_qty: new Prisma.Decimal(10),
        actual_qty: new Prisma.Decimal(9.5 + Math.random()),
        unit_cost_cents: 200,
      },
    });
  }
}

async function seedPrepSheetFromForecast(prisma: PrismaClient, restaurant_id: string): Promise<void> {
  const today = startOfDay(new Date());
  const existing = await prisma.prepSheet.findUnique({
    where: { restaurant_id_date: { restaurant_id, date: today } },
  });
  if (existing) return;
  // Prefer menu recipes that have real lines — no point filling a prep sheet
  // with recipes that can't be cost-rolled-up.
  const richRecipes = await prisma.recipe.findMany({
    where: {
      restaurant_id, type: 'menu', is_archived: false,
      versions: { some: { is_current: true, lines: { some: {} } } },
    },
    take: 8,
    include: { versions: { where: { is_current: true }, take: 1 } },
  });
  if (richRecipes.length === 0) return;
  const sheet = await prisma.prepSheet.create({ data: { restaurant_id, date: today } });
  // Deterministic "needs" so the sheet looks like something the forecast produced.
  const NEEDS = [24, 18, 16, 12, 10, 8, 6, 6];
  for (let i = 0; i < richRecipes.length; i += 1) {
    const r = richRecipes[i]!;
    const version = r.versions[0];
    if (!version) continue;
    await prisma.prepSheetRow.create({
      data: {
        prep_sheet_id: sheet.id,
        recipe_version_id: version.id,
        needed_qty: new Prisma.Decimal(NEEDS[i] ?? 4),
        status: i === 0 ? 'complete' : (i === 1 ? 'in_progress' : 'pending'),
      },
    });
  }
}

async function seedDelivery(
  prisma: PrismaClient, restaurant_id: string, supplier_id: string, ingredient_ids: string[],
): Promise<void> {
  if (ingredient_ids.length === 0) return;
  const existing = await prisma.delivery.findFirst({
    where: { restaurant_id, supplier_id, received_on: startOfDay(new Date()) },
  });
  if (existing) return;
  const delivery = await prisma.delivery.create({
    data: {
      restaurant_id, supplier_id,
      received_on: startOfDay(new Date()),
      status: 'pending',
    },
  });
  for (const ingredient_id of ingredient_ids) {
    await prisma.deliveryLine.create({
      data: {
        delivery_id: delivery.id,
        ingredient_id,
        ordered_qty: new Prisma.Decimal(10),
        received_qty: new Prisma.Decimal(10),
        unit_cost_cents: 250,
      },
    });
  }
}

async function seedOrder(
  prisma: PrismaClient, restaurant_id: string, supplier_id: string, ingredient_ids: string[],
): Promise<void> {
  if (ingredient_ids.length === 0) return;
  const existing = await prisma.order.findFirst({
    where: { restaurant_id, supplier_id, status: 'draft' },
  });
  if (existing) return;
  const order = await prisma.order.create({
    data: {
      restaurant_id, supplier_id,
      status: 'draft',
      expected_on: startOfDay(new Date(Date.now() + 2 * 86_400_000)),
    },
  });
  for (const ingredient_id of ingredient_ids) {
    await prisma.orderLine.create({
      data: {
        order_id: order.id,
        ingredient_id,
        qty: new Prisma.Decimal(5),
        unit_cost_cents: 200,
      },
    });
  }
}

async function seedWasteEntries(
  prisma: PrismaClient, restaurant_id: string, ingredient_ids: string[],
): Promise<void> {
  if (ingredient_ids.length === 0) return;
  const reason = await prisma.wasteReason.findFirst({ where: { restaurant_id, code: 'SPOILAGE' } });
  if (!reason) return;
  const existing = await prisma.wasteEntry.count({ where: { restaurant_id } });
  if (existing > 0) return;
  for (const ingredient_id of ingredient_ids) {
    await prisma.wasteEntry.create({
      data: {
        restaurant_id,
        ref_type: 'ingredient',
        ingredient_id,
        qty: new Prisma.Decimal(0.5 + Math.random()),
        uom: 'oz',
        reason_id: reason.id,
        attribution_bucket: 'spoilage',
        unit_cost_cents_pinned: 250,
        value_cents: 250,
      },
    });
  }
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
//  Curated pantry + composed recipes
//
//  The utensil-derived ingredients (above) are noisy portion-target phrases
//  like "All Diced/Chopped Meats and Vegetables on Stations" — fine for scoop
//  equivalence tables but useless as raw inputs. Here we layer a small,
//  realistic pantry on top and compose prep + menu recipes that reference
//  them, so the UI can demonstrate the full linking graph:
//
//      Ingredient ──(recipe_line.ref_type=ingredient)──> Prep recipe version
//      Prep recipe ──(recipe_line.ref_type=recipe)────> Menu recipe version
//      Menu recipe ──(par_level)───────────────────────> Prep sheet rows
//      Menu recipe ──(aloha_menu_map)─> pos_sale ─────> AvT + Forecast
//
//  Every downstream report wants the whole chain populated.
// ──────────────────────────────────────────────────────────────────────────

interface PantrySpec {
  key: string; name: string;
  uom: string; uom_category: 'weight' | 'volume' | 'count';
  cost_cents: number; // per uom
  shelf_life_days?: number;
  pack_size?: number;
  allergens?: string[];
}

const PANTRY: PantrySpec[] = [
  { key: 'flour_ap',       name: 'All-purpose flour',    uom: 'oz',    uom_category: 'weight', cost_cents: 6,   shelf_life_days: 365, allergens: ['gluten'] },
  { key: 'sugar_white',    name: 'Granulated sugar',     uom: 'oz',    uom_category: 'weight', cost_cents: 5,   shelf_life_days: 730 },
  { key: 'sugar_brown',    name: 'Brown sugar',          uom: 'oz',    uom_category: 'weight', cost_cents: 7,   shelf_life_days: 365 },
  { key: 'salt_kosher',    name: 'Kosher salt',          uom: 'oz',    uom_category: 'weight', cost_cents: 3,   shelf_life_days: 3650 },
  { key: 'butter_unsalted',name: 'Unsalted butter',      uom: 'oz',    uom_category: 'weight', cost_cents: 28,  shelf_life_days: 90,  allergens: ['dairy'] },
  { key: 'milk_whole',     name: 'Whole milk',           uom: 'fl_oz', uom_category: 'volume', cost_cents: 5,   shelf_life_days: 14,  allergens: ['dairy'] },
  { key: 'heavy_cream',    name: 'Heavy cream',          uom: 'fl_oz', uom_category: 'volume', cost_cents: 12,  shelf_life_days: 14,  allergens: ['dairy'] },
  { key: 'eggs_large',     name: 'Eggs, large',          uom: 'each',  uom_category: 'count',   cost_cents: 35,  shelf_life_days: 30,  pack_size: 12, allergens: ['egg'] },
  { key: 'vanilla_extract',name: 'Vanilla extract',      uom: 'fl_oz', uom_category: 'volume', cost_cents: 85,  shelf_life_days: 730 },
  { key: 'coffee_beans',   name: 'Coffee beans, whole',  uom: 'oz',    uom_category: 'weight', cost_cents: 45,  shelf_life_days: 180 },
  { key: 'espresso_beans', name: 'Espresso beans',       uom: 'oz',    uom_category: 'weight', cost_cents: 50,  shelf_life_days: 180 },
  { key: 'lemon_juice',    name: 'Lemon juice, fresh',   uom: 'fl_oz', uom_category: 'volume', cost_cents: 18,  shelf_life_days: 7 },
  { key: 'bacon',          name: 'Bacon, thick-cut',     uom: 'oz',    uom_category: 'weight', cost_cents: 35,  shelf_life_days: 14 },
  { key: 'ham_smoked',     name: 'Smoked ham',           uom: 'oz',    uom_category: 'weight', cost_cents: 40,  shelf_life_days: 14 },
  { key: 'cheddar',        name: 'Sharp cheddar, shredded', uom: 'oz', uom_category: 'weight', cost_cents: 32,  shelf_life_days: 30,  allergens: ['dairy'] },
  { key: 'mozzarella',     name: 'Fresh mozzarella',     uom: 'oz',    uom_category: 'weight', cost_cents: 42,  shelf_life_days: 14,  allergens: ['dairy'] },
  { key: 'english_muffin', name: 'English muffin',       uom: 'each',  uom_category: 'count',   cost_cents: 40,  shelf_life_days: 10,  allergens: ['gluten'] },
  { key: 'sourdough',      name: 'Sourdough slice',      uom: 'each',  uom_category: 'count',   cost_cents: 35,  shelf_life_days: 7,   allergens: ['gluten'] },
  { key: 'tomato',         name: 'Beefsteak tomato',     uom: 'each',  uom_category: 'count',   cost_cents: 75,  shelf_life_days: 7 },
  { key: 'basil_fresh',    name: 'Basil, fresh',         uom: 'oz',    uom_category: 'weight', cost_cents: 95,  shelf_life_days: 5 },
  { key: 'olive_oil',      name: 'Olive oil, extra virgin', uom: 'fl_oz', uom_category: 'volume', cost_cents: 30, shelf_life_days: 540 },
  { key: 'garlic',         name: 'Garlic cloves',        uom: 'each',  uom_category: 'count',   cost_cents: 8,   shelf_life_days: 60 },
  { key: 'avocado',        name: 'Avocado',              uom: 'each',  uom_category: 'count',   cost_cents: 120, shelf_life_days: 5 },
  { key: 'spinach_baby',   name: 'Baby spinach',         uom: 'oz',    uom_category: 'weight', cost_cents: 25,  shelf_life_days: 5 },
  { key: 'smoked_salmon',  name: 'Smoked salmon',        uom: 'oz',    uom_category: 'weight', cost_cents: 180, shelf_life_days: 10, allergens: ['fish'] },
];

async function seedPantry(prisma: PrismaClient, restaurant_id: string): Promise<Map<string, string>> {
  const cold = await prisma.location.findFirst({ where: { restaurant_id, name: 'Walk-in cooler' } });
  const dry  = await prisma.location.findFirst({ where: { restaurant_id, name: 'Dry storage' } });
  const out = new Map<string, string>();
  for (const spec of PANTRY) {
    const location = spec.uom_category === 'weight' && (spec.shelf_life_days ?? 0) > 180 ? dry : cold;
    const existing = await prisma.ingredient.findUnique({
      where: { restaurant_id_name: { restaurant_id, name: spec.name } },
    });
    let id: string;
    if (existing) {
      id = existing.id;
    } else {
      const ing = await prisma.ingredient.create({
        data: {
          restaurant_id,
          name: spec.name,
          uom: spec.uom,
          uom_category: spec.uom_category,
          pack_size: spec.pack_size ? new Prisma.Decimal(spec.pack_size) : null,
          storage_location_id: location?.id,
          shelf_life_days: spec.shelf_life_days,
          allergen_flags: spec.allergens ?? [],
        },
      });
      id = ing.id;
    }
    out.set(spec.key, id);

    // One current cost + one prior cost so Price-Creep can display a delta.
    const anchor = new Date('2026-02-01');
    const current = new Date('2026-04-01');
    const hasAnchor = await prisma.ingredientCost.count({
      where: { ingredient_id: id, effective_from: anchor },
    });
    if (hasAnchor === 0) {
      await prisma.ingredientCost.create({
        data: { ingredient_id: id, unit_cost_cents: spec.cost_cents, effective_from: anchor, source: 'manual', note: 'seed anchor' },
      });
    }
    const hasCurrent = await prisma.ingredientCost.count({
      where: { ingredient_id: id, effective_from: current },
    });
    if (hasCurrent === 0) {
      // +6% drift for a subset → Price-Creep has signal
      const bumped = spec.key === 'eggs_large' || spec.key === 'heavy_cream' || spec.key === 'avocado'
        ? Math.round(spec.cost_cents * 1.18)
        : spec.cost_cents;
      await prisma.ingredientCost.create({
        data: { ingredient_id: id, unit_cost_cents: bumped, effective_from: current, source: 'manual', note: 'seed current' },
      });
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
//  Prep recipes (sub-recipes referenced by menu recipes)
// ──────────────────────────────────────────────────────────────────────────

type LineSpec =
  | { kind: 'ingredient'; key: string; qty: number; uom: string; note?: string; station?: string }
  | { kind: 'recipe';     key: string; qty: number; uom: string; note?: string; station?: string };

interface RecipeSpec {
  key: string;
  name: string;
  type: 'menu' | 'prep';
  yield_qty: number;
  yield_uom: string;
  procedure: string;
  lines: LineSpec[];
}

const PREP_RECIPES: RecipeSpec[] = [
  {
    key: 'pancake_batter', name: 'Pancake batter (prep)', type: 'prep',
    yield_qty: 32, yield_uom: 'fl_oz',
    procedure: 'Whisk dry ingredients, then fold in wet. Rest 5 min before griddling.',
    lines: [
      { kind: 'ingredient', key: 'flour_ap',        qty: 14, uom: 'oz',    station: 'prep' },
      { kind: 'ingredient', key: 'sugar_white',     qty: 2,  uom: 'oz',    station: 'prep' },
      { kind: 'ingredient', key: 'salt_kosher',     qty: 0.25, uom: 'oz',  station: 'prep' },
      { kind: 'ingredient', key: 'eggs_large',      qty: 2,  uom: 'each',  station: 'prep' },
      { kind: 'ingredient', key: 'milk_whole',      qty: 16, uom: 'fl_oz', station: 'prep' },
      { kind: 'ingredient', key: 'butter_unsalted', qty: 2,  uom: 'oz',    station: 'prep', note: 'melted' },
    ],
  },
  {
    key: 'whipped_cream', name: 'Whipped cream (prep)', type: 'prep',
    yield_qty: 16, yield_uom: 'fl_oz',
    procedure: 'Whip cream cold. Add sugar + vanilla at soft-peak stage. Stop at firm peak.',
    lines: [
      { kind: 'ingredient', key: 'heavy_cream',     qty: 12, uom: 'fl_oz', station: 'prep' },
      { kind: 'ingredient', key: 'sugar_white',    qty: 1,  uom: 'oz',    station: 'prep' },
      { kind: 'ingredient', key: 'vanilla_extract', qty: 0.25, uom: 'fl_oz', station: 'prep' },
    ],
  },
  {
    key: 'hollandaise', name: 'Hollandaise (prep)', type: 'prep',
    yield_qty: 16, yield_uom: 'fl_oz',
    procedure: 'Double-boiler. Whisk yolks + lemon until pale, then drizzle clarified butter. Season at the end.',
    lines: [
      { kind: 'ingredient', key: 'eggs_large',      qty: 4,  uom: 'each', station: 'prep', note: 'yolks only' },
      { kind: 'ingredient', key: 'butter_unsalted', qty: 8,  uom: 'oz',   station: 'prep', note: 'clarified' },
      { kind: 'ingredient', key: 'lemon_juice',     qty: 1,  uom: 'fl_oz', station: 'prep' },
      { kind: 'ingredient', key: 'salt_kosher',     qty: 0.1, uom: 'oz',  station: 'prep' },
    ],
  },
  {
    key: 'simple_syrup', name: 'Simple syrup (prep)', type: 'prep',
    yield_qty: 16, yield_uom: 'fl_oz',
    procedure: 'Equal parts sugar and hot water. Stir until fully dissolved, cool before storing.',
    lines: [
      { kind: 'ingredient', key: 'sugar_white', qty: 8, uom: 'oz', station: 'bar' },
    ],
  },
  {
    key: 'basil_pesto', name: 'Basil pesto (prep)', type: 'prep',
    yield_qty: 8, yield_uom: 'oz',
    procedure: 'Blend basil, oil, garlic smooth. Fold in grated mozzarella, season with salt.',
    lines: [
      { kind: 'ingredient', key: 'basil_fresh', qty: 3,  uom: 'oz',    station: 'prep' },
      { kind: 'ingredient', key: 'olive_oil',   qty: 4,  uom: 'fl_oz', station: 'prep' },
      { kind: 'ingredient', key: 'garlic',      qty: 3,  uom: 'each',  station: 'prep' },
      { kind: 'ingredient', key: 'mozzarella',  qty: 1,  uom: 'oz',    station: 'prep' },
      { kind: 'ingredient', key: 'salt_kosher', qty: 0.1, uom: 'oz',   station: 'prep' },
    ],
  },
];

const MENU_RECIPES: RecipeSpec[] = [
  {
    key: 'classic_pancakes', name: 'Classic Pancakes', type: 'menu',
    yield_qty: 1, yield_uom: 'serving',
    procedure: 'Stack of 3 griddle cakes. Top with whipped cream and a pat of butter. Serve with warm maple syrup on the side.',
    lines: [
      { kind: 'recipe',     key: 'pancake_batter', qty: 8,  uom: 'fl_oz', station: 'grill' },
      { kind: 'recipe',     key: 'whipped_cream',  qty: 2,  uom: 'fl_oz', station: 'expo' },
      { kind: 'ingredient', key: 'butter_unsalted', qty: 0.5, uom: 'oz',  station: 'expo' },
    ],
  },
  {
    key: 'eggs_benedict', name: 'Eggs Benedict', type: 'menu',
    yield_qty: 1, yield_uom: 'serving',
    procedure: 'Toast muffin halves. Lay ham, poached eggs. Blanket with hollandaise. Garnish with wilted spinach.',
    lines: [
      { kind: 'ingredient', key: 'english_muffin', qty: 1, uom: 'each',  station: 'grill' },
      { kind: 'ingredient', key: 'ham_smoked',     qty: 3, uom: 'oz',    station: 'grill' },
      { kind: 'ingredient', key: 'eggs_large',     qty: 2, uom: 'each',  station: 'grill' },
      { kind: 'recipe',     key: 'hollandaise',    qty: 3, uom: 'fl_oz', station: 'expo' },
      { kind: 'ingredient', key: 'spinach_baby',   qty: 1, uom: 'oz',    station: 'grill' },
    ],
  },
  {
    key: 'caprese_toast', name: 'Caprese Toast', type: 'menu',
    yield_qty: 1, yield_uom: 'serving',
    procedure: 'Grill sourdough. Layer mozzarella and tomato. Drizzle pesto and olive oil, finish with fresh basil.',
    lines: [
      { kind: 'ingredient', key: 'sourdough',   qty: 2, uom: 'each', station: 'grill' },
      { kind: 'ingredient', key: 'tomato',      qty: 1, uom: 'each', station: 'prep' },
      { kind: 'ingredient', key: 'mozzarella',  qty: 3, uom: 'oz',   station: 'prep' },
      { kind: 'recipe',     key: 'basil_pesto', qty: 1, uom: 'oz',   station: 'expo' },
      { kind: 'ingredient', key: 'olive_oil',   qty: 0.5, uom: 'fl_oz', station: 'expo' },
      { kind: 'ingredient', key: 'basil_fresh', qty: 0.25, uom: 'oz',  station: 'expo' },
    ],
  },
  {
    key: 'avocado_toast', name: 'Avocado Toast', type: 'menu',
    yield_qty: 1, yield_uom: 'serving',
    procedure: 'Toast sourdough. Mash avocado with lemon + salt, spread thick. Crack of pepper.',
    lines: [
      { kind: 'ingredient', key: 'sourdough',    qty: 2, uom: 'each',  station: 'grill' },
      { kind: 'ingredient', key: 'avocado',      qty: 1, uom: 'each',  station: 'prep' },
      { kind: 'ingredient', key: 'lemon_juice',  qty: 0.25, uom: 'fl_oz', station: 'prep' },
      { kind: 'ingredient', key: 'salt_kosher',  qty: 0.05, uom: 'oz', station: 'prep' },
    ],
  },
  {
    key: 'salmon_bagel', name: 'Smoked Salmon Plate', type: 'menu',
    yield_qty: 1, yield_uom: 'serving',
    procedure: 'Toasted English muffin. Spread of whipped mozzarella. Layer smoked salmon, thin tomato slices.',
    lines: [
      { kind: 'ingredient', key: 'english_muffin', qty: 1, uom: 'each', station: 'grill' },
      { kind: 'ingredient', key: 'mozzarella',     qty: 1.5, uom: 'oz', station: 'prep' },
      { kind: 'ingredient', key: 'smoked_salmon',  qty: 3, uom: 'oz',   station: 'prep' },
      { kind: 'ingredient', key: 'tomato',         qty: 0.5, uom: 'each', station: 'prep' },
    ],
  },
  {
    key: 'bacon_cheddar_scramble', name: 'Bacon Cheddar Scramble', type: 'menu',
    yield_qty: 1, yield_uom: 'serving',
    procedure: 'Scramble eggs soft. Fold in shredded cheddar at the end. Top with crispy bacon crumble.',
    lines: [
      { kind: 'ingredient', key: 'eggs_large', qty: 3,   uom: 'each', station: 'grill' },
      { kind: 'ingredient', key: 'cheddar',    qty: 1.5, uom: 'oz',   station: 'grill' },
      { kind: 'ingredient', key: 'bacon',      qty: 2,   uom: 'oz',   station: 'grill' },
      { kind: 'ingredient', key: 'butter_unsalted', qty: 0.25, uom: 'oz', station: 'grill' },
    ],
  },
  {
    key: 'french_press', name: 'French Press', type: 'menu', // matches a beverage CSV entry
    yield_qty: 1, yield_uom: 'mug',
    procedure: 'See step-by-step procedure above.',
    lines: [
      { kind: 'ingredient', key: 'coffee_beans', qty: 1.5, uom: 'oz', station: 'barista' },
    ],
  },
  {
    key: 'vanilla_latte', name: 'Vanilla Latte', type: 'menu',
    yield_qty: 1, yield_uom: 'mug',
    procedure: 'Double shot espresso, steamed whole milk to silk texture, simple syrup base with vanilla.',
    lines: [
      { kind: 'ingredient', key: 'espresso_beans', qty: 0.6, uom: 'oz',    station: 'barista' },
      { kind: 'ingredient', key: 'milk_whole',     qty: 10,  uom: 'fl_oz', station: 'barista' },
      { kind: 'recipe',     key: 'simple_syrup',   qty: 0.75, uom: 'fl_oz', station: 'barista' },
      { kind: 'ingredient', key: 'vanilla_extract', qty: 0.1, uom: 'fl_oz', station: 'barista' },
    ],
  },
];

async function upsertComposedRecipe(
  prisma: PrismaClient, restaurant_id: string, spec: RecipeSpec,
  pantry: Map<string, string>, recipesByKey: Map<string, string>,
): Promise<string> {
  // Find (or create) the recipe row + version 1 shell.
  const recipe = await (async () => {
    const found = await prisma.recipe.findUnique({
      where: { restaurant_id_type_name: { restaurant_id, type: spec.type, name: spec.name } },
    });
    if (found) return found;
    return prisma.recipe.create({ data: { restaurant_id, type: spec.type, name: spec.name } });
  })();
  recipesByKey.set(spec.key, recipe.id);

  let version = await prisma.recipeVersion.findFirst({
    where: { recipe_id: recipe.id, is_current: true },
  });
  if (!version) {
    version = await prisma.recipeVersion.create({
      data: {
        recipe_id: recipe.id,
        version: 1, is_current: true,
        yield_qty: new Prisma.Decimal(spec.yield_qty),
        yield_uom: spec.yield_uom,
        procedure: spec.procedure,
      },
    });
  }

  // Idempotent: skip rewrite if lines already match in count (cheap guard —
  // avoids re-inserting duplicates on re-run). Full replace would be risky
  // because prep_runs and prep_sheet_rows FK to recipe_version.
  const existingLineCount = await prisma.recipeLine.count({ where: { recipe_version_id: version.id } });
  if (existingLineCount >= spec.lines.length) return recipe.id;

  // Insert the declared lines at sequential positions.
  for (let i = 0; i < spec.lines.length; i += 1) {
    const l = spec.lines[i]!;
    if (l.kind === 'ingredient') {
      const ingredient_id = pantry.get(l.key);
      if (!ingredient_id) throw new Error(`pantry missing ${l.key} (needed by ${spec.name})`);
      await prisma.recipeLine.create({
        data: {
          recipe_version_id: version.id,
          position: i, ref_type: 'ingredient',
          ingredient_id, qty: new Prisma.Decimal(l.qty), uom: l.uom,
          note: l.note, station: l.station, step_order: i + 1,
        },
      });
    } else {
      const ref_recipe_id = recipesByKey.get(l.key);
      if (!ref_recipe_id) throw new Error(`sub-recipe missing ${l.key} (needed by ${spec.name})`);
      await prisma.recipeLine.create({
        data: {
          recipe_version_id: version.id,
          position: i, ref_type: 'recipe',
          ref_recipe_id, qty: new Prisma.Decimal(l.qty), uom: l.uom,
          note: l.note, station: l.station, step_order: i + 1,
        },
      });
    }
  }
  return recipe.id;
}

async function seedPrepRecipes(
  prisma: PrismaClient, restaurant_id: string, pantry: Map<string, string>,
): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();
  for (const spec of PREP_RECIPES) {
    await upsertComposedRecipe(prisma, restaurant_id, spec, pantry, byKey);
  }
  return byKey;
}

async function seedMenuRecipes(
  prisma: PrismaClient, restaurant_id: string,
  pantry: Map<string, string>, prepRecipes: Map<string, string>,
): Promise<Map<string, string>> {
  const byKey = new Map<string, string>(prepRecipes); // share so menu lines can reference preps
  for (const spec of MENU_RECIPES) {
    await upsertComposedRecipe(prisma, restaurant_id, spec, pantry, byKey);
  }
  // Return just the menu subset by key
  const out = new Map<string, string>();
  for (const spec of MENU_RECIPES) {
    const id = byKey.get(spec.key);
    if (id) out.set(spec.key, id);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
//  Par levels, historical sales, covers, forecasts
// ──────────────────────────────────────────────────────────────────────────

// Per-recipe, per-day-of-week target (Sun…Sat index 0…6)
const PAR_LEVELS: Record<string, [number, number, number, number, number, number, number]> = {
  classic_pancakes:        [50, 22, 22, 24, 22, 24, 55],
  eggs_benedict:           [40, 16, 16, 18, 16, 18, 42],
  caprese_toast:           [18,  8,  8, 10,  8, 10, 22],
  avocado_toast:           [28, 14, 14, 16, 14, 16, 32],
  salmon_bagel:            [20,  9,  9, 10,  9, 10, 22],
  bacon_cheddar_scramble:  [38, 18, 18, 20, 18, 20, 42],
  french_press:            [14,  8,  8,  9,  8,  9, 16],
  vanilla_latte:           [45, 26, 26, 28, 26, 30, 52],
};

async function seedParLevels(
  prisma: PrismaClient, restaurant_id: string, menuRecipes: Map<string, string>,
): Promise<void> {
  for (const [key, pars] of Object.entries(PAR_LEVELS)) {
    const recipe_id = menuRecipes.get(key);
    if (!recipe_id) continue;
    for (let dow = 0; dow < 7; dow += 1) {
      await prisma.parLevel.upsert({
        where: { recipe_id_day_of_week: { recipe_id, day_of_week: dow } },
        update: { qty: new Prisma.Decimal(pars[dow] ?? 0) },
        create: { restaurant_id, recipe_id, day_of_week: dow, qty: new Prisma.Decimal(pars[dow] ?? 0) },
      });
    }
  }
}

// Aloha-item-name ↔ menu recipe mapping. Same string shows up in pos_sale
// rows and also in the AlohaMenuMap so the AvT report can resolve the link.
const ALOHA_NAME_MAP: Record<string, string> = {
  classic_pancakes:        'Classic Pancakes (3 stack)',
  eggs_benedict:           'Eggs Benedict',
  caprese_toast:           'Caprese Toast',
  avocado_toast:           'Avocado Toast',
  salmon_bagel:            'Smoked Salmon Plate',
  bacon_cheddar_scramble:  'Bacon Cheddar Scramble',
  french_press:            'French Press (8oz)',
  vanilla_latte:           'Vanilla Latte',
};

// Deterministic pseudo-random so re-seeding gives identical reports.
function det(seed: number): number {
  const x = Math.sin(seed) * 10_000;
  return x - Math.floor(x);
}

async function seedHistoricalSalesAndCovers(
  prisma: PrismaClient, restaurant_id: string, menuRecipes: Map<string, string>,
): Promise<void> {
  // Skip if we've already seeded sales — cover_count has the strongest unique
  // key so use it as the idempotency signal.
  const existingCovers = await prisma.coverCount.count({ where: { restaurant_id } });
  if (existingCovers > 0) return;

  // Create an AlohaImportRun to anchor the POS rows + cover counts.
  const today = startOfDay(new Date());
  const windowStart = new Date(today); windowStart.setDate(windowStart.getDate() - 14);
  const run = await prisma.alohaImportRun.create({
    data: {
      restaurant_id,
      business_date: today,
      source: 'api', // best-effort; any enum value works for demo purposes
      status: 'ok',
      rows_ingested: 0,
      completed_at: new Date(),
    },
  });

  // Map aloha_item_name → menu_recipe_id.
  for (const [key, alohaName] of Object.entries(ALOHA_NAME_MAP)) {
    const menu_recipe_id = menuRecipes.get(key);
    if (!menu_recipe_id) continue;
    const already = await prisma.alohaMenuMap.findFirst({
      where: { restaurant_id, aloha_item_name: alohaName },
    });
    if (!already) {
      await prisma.alohaMenuMap.create({
        data: {
          restaurant_id,
          aloha_item_name: alohaName,
          menu_recipe_id,
          effective_from: windowStart,
          confidence: 'manual',
        },
      });
    }
  }

  // Build 14 days of POS sales + covers. Weekend = Fri/Sat/Sun brunch pop.
  let posRows = 0;
  for (let d = 13; d >= 0; d -= 1) {
    const date = new Date(today); date.setDate(date.getDate() - d);
    const dow = date.getDay();
    const weekend = dow === 0 || dow === 5 || dow === 6;
    const covers = Math.round((weekend ? 350 : 210) + (det(date.getTime()) - 0.5) * 60);
    await prisma.coverCount.create({
      data: {
        restaurant_id,
        business_date: date,
        covers,
        import_run_id: run.id,
      },
    });

    // For each menu recipe, emit a POS row with qty roughly proportional to par × noise.
    for (const [key, alohaName] of Object.entries(ALOHA_NAME_MAP)) {
      const recipeId = menuRecipes.get(key);
      if (!recipeId) continue;
      const pars = PAR_LEVELS[key];
      if (!pars) continue;
      const base = pars[dow] ?? 10;
      const jitter = (det(date.getTime() + key.length) - 0.5) * 0.2; // ±10%
      const qty = Math.max(0, Math.round(base * (1 + jitter)));
      const price_cents = key.includes('latte') ? 575 : key === 'french_press' ? 525 : key.includes('toast') ? 1095 : 1495;
      await prisma.posSale.create({
        data: {
          import_run_id: run.id,
          restaurant_id,
          business_date: date,
          category: key.includes('latte') || key === 'french_press' ? 'Beverage' : 'Breakfast',
          aloha_item_name: alohaName,
          row_kind: 'item',
          qty: new Prisma.Decimal(qty),
          unit_price_cents: price_cents,
          item_sales_cents: price_cents * qty,
          aloha_cost_cents: Math.round(price_cents * qty * 0.32),
        },
      });
      posRows += 1;
    }
  }
  await prisma.alohaImportRun.update({
    where: { id: run.id },
    data: { rows_ingested: posRows + 14 },
  });
}

async function seedForecastPredictions(
  prisma: PrismaClient, restaurant_id: string, menuRecipes: Map<string, string>,
): Promise<void> {
  // Skip if any forecast already exists.
  const existing = await prisma.forecastModel.count({ where: { restaurant_id } });
  if (existing > 0) return;

  const today = startOfDay(new Date());
  const trainStart = new Date(today); trainStart.setDate(trainStart.getDate() - 14);

  for (const [key, recipeId] of menuRecipes.entries()) {
    const model = await prisma.forecastModel.create({
      data: {
        restaurant_id,
        entity_type: 'prep',
        entity_id: recipeId,
        algorithm: 'seasonal_naive_v1',
        trained_on_start: trainStart,
        trained_on_end: today,
        holdout_mape: new Prisma.Decimal(0.12 + det(recipeId.length) * 0.1),
        params: { seed: 'demo' },
        artefact_ref: `s3://demo/forecast-${key}.bin`,
      },
    });

    // 7-day forward window. Point ~= par × ±5%, p10/p90 around it.
    const pars = PAR_LEVELS[key] ?? [10, 10, 10, 10, 10, 10, 10];
    for (let i = 1; i <= 7; i += 1) {
      const date = new Date(today); date.setDate(date.getDate() + i);
      const dow = date.getDay();
      const base = pars[dow] ?? 10;
      const point = Math.round(base * (1 + (det(date.getTime() + i) - 0.5) * 0.1));
      await prisma.forecastPrediction.create({
        data: {
          model_id: model.id,
          target_date: date,
          point: new Prisma.Decimal(point),
          p10: new Prisma.Decimal(Math.round(point * 0.85)),
          p90: new Prisma.Decimal(Math.round(point * 1.15)),
          top_drivers_json: {
            drivers: [
              { feature: 'day_of_week',    weight: 0.55 },
              { feature: 'recent_trend',   weight: 0.25 },
              { feature: 'weather_proxy',  weight: 0.20 },
            ],
          },
        },
      });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

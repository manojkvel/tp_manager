// Additive seed: fills out the operational depth that `seed-demo-data.ts` leaves
// thin. Runs AFTER seed-demo-data + load-extracted-lines so the catalogue is
// stable. Idempotent — each step checks before inserting.
//
//   1. Cost row for every zero-cost ingredient (keyword-inferred cents).
//   2. 5 additional suppliers (produce, dairy, meat, dry-goods, beverage).
//   3. Primary + secondary supplier_ingredient links by category.
//   4. 6 weekly historical deliveries per supplier, verified, with small drift.
//   5. 2 additional completed inventory_counts (today-28, today-14).
//   6. aloha_menu_map rows for every menu recipe.
//
// Usage:  set -a && source .env && set +a && pnpm --filter @tp/api exec tsx scripts/seed-operational-depth.ts

import { PrismaClient, Prisma } from '@prisma/client';

const WEEKS_BACK = 6;

// Deterministic jitter so re-runs produce stable values.
function det(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function startOfDay(d: Date): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}

// Keyword → cents per UoM. Price floor for anything unrecognised.
function inferCostCents(name: string, uom: string): number {
  const n = name.toLowerCase();
  const table: Array<[RegExp, number]> = [
    [/steak|tenderloin|lamb|prosciutto|caviar|truffle|lox|smoked salmon/, 320],
    [/salmon|shrimp|scallop|crab|lobster/, 240],
    [/bacon|ham|sausage|chorizo|pancetta/, 55],
    [/chicken|turkey|pork/, 38],
    [/butter|cream|cheese|mozzarella|feta|parmesan|brie|goat/, 32],
    [/syrup|honey|maple|agave|molasses/, 40],
    [/chocolate|cocoa/, 45],
    [/coffee|espresso|tea|matcha|chai/, 48],
    [/vanilla|saffron|cardamom/, 180],
    [/avocado|mango|berry|strawberry|blueberry|raspberry/, 35],
    [/lemon|lime|orange|grapefruit|citrus/, 20],
    [/tomato|pepper|onion|garlic|herb|basil|cilantro|mint/, 15],
    [/lettuce|spinach|kale|arugula|greens/, 18],
    [/potato|carrot|zucchini|broccoli|cucumber/, 10],
    [/egg/, 30],
    [/milk/, 8],
    [/juice|lemonade/, 12],
    [/soda|cola|sparkling|water/, 6],
    [/flour|sugar|salt|oats|rice|pasta|grain/, 6],
    [/bread|muffin|bagel|tortilla|ciabatta|sourdough|toast/, 25],
    [/pancake|waffle|batter/, 20],
    [/ice/, 2],
  ];
  for (const [rx, cents] of table) if (rx.test(n)) return cents;
  return 15;
}

const NEW_SUPPLIERS = [
  { name: 'Golden State Produce', contact: 'Maria L.', email: 'orders@goldenstateproduce.com', phone: '+1-555-0101', lead_time: 1, cadence: 'daily',   min: 5000,
    keywords: ['avocado','tomato','lettuce','spinach','greens','basil','cilantro','mint','pepper','onion','garlic','berry','lemon','lime','orange','fruit','mushroom','potato','carrot','zucchini','broccoli','cucumber','herb','citrus','strawberr','blueberr','raspberr','arugula','kale','mango','jalapeno'] },
  { name: 'Clover Valley Dairy', contact: 'Dan P.', email: 'orders@clovervalley.com', phone: '+1-555-0202', lead_time: 2, cadence: '3x_week', min: 8000,
    keywords: ['milk','butter','cream','yogurt','cheese','mozzarella','cheddar','feta','parmesan','brie','goat','dairy'] },
  { name: 'Five Star Meats',     contact: 'Hank R.', email: 'orders@fivestarmeats.com', phone: '+1-555-0303', lead_time: 2, cadence: '2x_week', min: 15000,
    keywords: ['bacon','ham','sausage','chicken','turkey','beef','pork','steak','salmon','shrimp','lox','prosciutto','chorizo','pancetta','meat','fish','seafood'] },
  { name: 'Pacific Dry Goods',   contact: 'Li C.',   email: 'orders@pacificdrygoods.com', phone: '+1-555-0404', lead_time: 3, cadence: 'weekly',  min: 12000,
    keywords: ['flour','sugar','salt','oats','rice','pasta','pepper','spice','seasoning','bread','muffin','bagel','tortilla','ciabatta','sourdough','chip','oil','vinegar','vanilla','chocolate','cocoa','syrup','honey','maple'] },
  { name: 'Crestline Beverage',  contact: 'Anna M.', email: 'orders@crestlinebev.com',     phone: '+1-555-0505', lead_time: 2, cadence: '2x_week', min: 6000,
    keywords: ['coffee','espresso','tea','matcha','chai','soda','cola','sparkling','juice','lemonade','water','beverage','concentrate'] },
];

async function seedCosts(prisma: PrismaClient, rid: string): Promise<number> {
  const ingredients = await prisma.ingredient.findMany({
    where: { restaurant_id: rid },
    include: { costs: { orderBy: { effective_from: 'desc' }, take: 1 } },
  });
  let added = 0;
  for (const ing of ingredients) {
    if (ing.costs.length > 0 && ing.costs[0]!.unit_cost_cents > 0) continue;
    const cents = inferCostCents(ing.name, ing.uom);
    await prisma.ingredientCost.create({
      data: {
        ingredient_id: ing.id,
        unit_cost_cents: cents,
        effective_from: new Date(),
        source: 'manual',
        note: 'seeded by keyword-inference',
      },
    });
    added += 1;
  }
  return added;
}

async function seedSuppliers(prisma: PrismaClient, rid: string): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  const existing = await prisma.supplier.findMany({ where: { restaurant_id: rid } });
  for (const s of existing) byName.set(s.name, s.id);

  for (const s of NEW_SUPPLIERS) {
    if (byName.has(s.name)) continue;
    const row = await prisma.supplier.create({
      data: {
        restaurant_id: rid, name: s.name,
        contact_name: s.contact, email: s.email, phone: s.phone,
        lead_time_days: s.lead_time, min_order_cents: s.min, order_cadence: s.cadence,
      },
    });
    byName.set(row.name, row.id);
  }
  return byName;
}

async function linkIngredientsToSuppliers(
  prisma: PrismaClient, rid: string, suppliersByName: Map<string, string>,
): Promise<number> {
  const ingredients = await prisma.ingredient.findMany({
    where: { restaurant_id: rid },
    include: { costs: { orderBy: { effective_from: 'desc' }, take: 1 } },
  });

  let created = 0;
  const now = new Date();

  for (const ing of ingredients) {
    const baseCost = ing.costs[0]?.unit_cost_cents ?? inferCostCents(ing.name, ing.uom);
    const lc = ing.name.toLowerCase();

    // Find best-matching supplier by keyword; fall back to Pacific Dry Goods.
    const primary = NEW_SUPPLIERS.find((s) => s.keywords.some((k) => lc.includes(k)))
      ?? NEW_SUPPLIERS.find((s) => s.name === 'Pacific Dry Goods')!;
    const secondary = NEW_SUPPLIERS.find((s) => s !== primary && s.keywords.some((k) => lc.includes(k)));

    const ranks: Array<[string, number, number]> = [];
    const primaryId = suppliersByName.get(primary.name);
    if (primaryId) ranks.push([primaryId, 1, baseCost]);
    if (secondary) {
      const secondaryId = suppliersByName.get(secondary.name);
      // Secondary is ~8% more expensive — gives Orders UI a real "cheapest" pick.
      if (secondaryId) ranks.push([secondaryId, 2, Math.round(baseCost * 1.08)]);
    }

    for (const [supplierId, rank, cost] of ranks) {
      const exists = await prisma.supplierIngredient.findFirst({
        where: { supplier_id: supplierId, ingredient_id: ing.id },
      });
      if (exists) continue;
      await prisma.supplierIngredient.create({
        data: {
          supplier_id: supplierId, ingredient_id: ing.id,
          unit_cost_cents: cost, rank,
          effective_from: now,
        },
      });
      created += 1;
    }

    // Set default_supplier_id if still null.
    if (!ing.default_supplier_id && primaryId) {
      await prisma.ingredient.update({
        where: { id: ing.id },
        data: { default_supplier_id: primaryId },
      });
    }
  }
  return created;
}

async function seedHistoricalDeliveries(
  prisma: PrismaClient, rid: string, suppliersByName: Map<string, string>,
): Promise<{ deliveries: number; lines: number }> {
  const today = startOfDay(new Date());
  let deliveriesAdded = 0, linesAdded = 0;

  for (const spec of NEW_SUPPLIERS) {
    const supplierId = suppliersByName.get(spec.name);
    if (!supplierId) continue;

    // Pick ingredients this supplier sells based on keyword match.
    const catalog = await prisma.supplierIngredient.findMany({
      where: { supplier_id: supplierId, rank: 1 },
      include: { ingredient: true },
    });
    if (catalog.length === 0) continue;

    for (let w = WEEKS_BACK; w >= 1; w -= 1) {
      const receivedOn = new Date(today);
      receivedOn.setDate(receivedOn.getDate() - w * 7);

      // Idempotency: skip if we already have a delivery for this supplier on this date.
      const existing = await prisma.delivery.findFirst({
        where: { supplier_id: supplierId, received_on: receivedOn },
      });
      if (existing) continue;

      const delivery = await prisma.delivery.create({
        data: {
          restaurant_id: rid, supplier_id: supplierId,
          received_on: receivedOn, status: 'verified',
        },
      });
      deliveriesAdded += 1;

      // 4–7 lines per delivery, rotating through the catalog.
      const lineCount = 4 + Math.floor(det(w + receivedOn.getTime()) * 4);
      for (let i = 0; i < lineCount && i < catalog.length; i += 1) {
        const idx = (w * 3 + i) % catalog.length;
        const entry = catalog[idx]!;
        // Small per-week drift: ±4%, anchored at the catalogue price.
        const drift = 1 + (det(entry.ingredient_id.charCodeAt(0) + w) - 0.5) * 0.08;
        const unitCost = Math.max(1, Math.round(entry.unit_cost_cents * drift));
        const orderedQty = 10 + Math.floor(det(idx + w) * 20);
        const receivedQty = orderedQty - (det(idx * w + 1) > 0.9 ? 1 : 0); // 10% short-ship chance
        await prisma.deliveryLine.create({
          data: {
            delivery_id: delivery.id,
            ingredient_id: entry.ingredient_id,
            ordered_qty: new Prisma.Decimal(orderedQty),
            received_qty: new Prisma.Decimal(receivedQty),
            unit_cost_cents: unitCost,
          },
        });
        linesAdded += 1;
      }
    }
  }
  return { deliveries: deliveriesAdded, lines: linesAdded };
}

async function seedHistoricalCounts(
  prisma: PrismaClient, rid: string,
): Promise<number> {
  const today = startOfDay(new Date());
  const targets = [28, 14];
  let added = 0;

  const ingredients = await prisma.ingredient.findMany({
    where: { restaurant_id: rid },
    orderBy: { name: 'asc' },
    take: 20,
  });
  if (ingredients.length === 0) return 0;

  for (const daysBack of targets) {
    const date = new Date(today);
    date.setDate(date.getDate() - daysBack);
    const existing = await prisma.inventoryCount.findFirst({
      where: { restaurant_id: rid, date },
    });
    if (existing) continue;

    const count = await prisma.inventoryCount.create({
      data: { restaurant_id: rid, date, status: 'completed' },
    });
    for (let i = 0; i < ingredients.length; i += 1) {
      const qty = Math.max(0, Math.round(10 + det(date.getTime() + i) * 40));
      await prisma.inventoryCountLine.create({
        data: {
          count_id: count.id,
          ref_type: 'ingredient',
          ingredient_id: ingredients[i]!.id,
          actual_qty: new Prisma.Decimal(qty),
        },
      });
    }
    added += 1;
  }
  return added;
}

async function seedAlohaMenuMap(prisma: PrismaClient, rid: string): Promise<number> {
  const menuRecipes = await prisma.recipe.findMany({
    where: { restaurant_id: rid, type: 'menu' },
  });
  const today = startOfDay(new Date());
  let added = 0;
  for (const r of menuRecipes) {
    // Use the recipe name as the Aloha item name (owner can remap via UI).
    const existing = await prisma.alohaMenuMap.findFirst({
      where: { restaurant_id: rid, aloha_item_name: r.name, effective_until: null },
    });
    if (existing) continue;
    await prisma.alohaMenuMap.create({
      data: {
        restaurant_id: rid,
        aloha_item_name: r.name,
        menu_recipe_id: r.id,
        effective_from: today,
        confidence: 'manual',
      },
    });
    added += 1;
  }
  return added;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const restaurant = await prisma.restaurant.findFirst();
    if (!restaurant) throw new Error('no restaurant — run bootstrap-owner first');
    const rid = restaurant.id;
    console.log(`→ depth-seeding restaurant ${rid}`);

    const costs = await seedCosts(prisma, rid);
    console.log(`  cost rows added:         ${costs}`);

    const suppliers = await seedSuppliers(prisma, rid);
    console.log(`  suppliers total:         ${suppliers.size}`);

    const links = await linkIngredientsToSuppliers(prisma, rid, suppliers);
    console.log(`  supplier_ingredient rows added: ${links}`);

    const deliveries = await seedHistoricalDeliveries(prisma, rid, suppliers);
    console.log(`  historical deliveries added: ${deliveries.deliveries} (${deliveries.lines} lines)`);

    const counts = await seedHistoricalCounts(prisma, rid);
    console.log(`  historical inventory counts added: ${counts}`);

    const aloha = await seedAlohaMenuMap(prisma, rid);
    console.log(`  aloha_menu_map rows added: ${aloha}`);

    console.log('\n✓ operational depth seed complete');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

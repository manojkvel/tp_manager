// Impute realistic quantities for recipe_line rows that the LLM extractor
// parked as qty=0 with qty_text in ('as needed', 'to taste', 'pinch').
//
// Downstream reports (AvT, Food Cost %, Menu Contribution) roll plated cost
// up from recipe_line × latest IngredientCost. A qty of 0 silently produces
// a $0 plated cost, which makes the menu look free.
//
// We keep qty_text as-is (audit trail — the printed recipe card said
// "as needed") and overwrite qty with a typical portion chosen from
// restaurant-industry defaults. Idempotent: re-running assigns the same
// values, and only targets rows that still have qty=0.
//
// Usage:
//   set -a && source .env && set +a && \
//     pnpm --filter @tp/api exec tsx scripts/impute-as-needed-quantities.ts

import { PrismaClient, Prisma } from '@prisma/client';

interface PortionRule {
  qty: number;
  uom: string;
}

// Keyed by exact ingredient.name (case-sensitive — matches the seed).
// Values are typical per-serving portions for US diner-style recipes.
const PORTIONS: Record<string, PortionRule> = {
  // Greens & leafy veg
  'Mixed greens': { qty: 1.5, uom: 'oz' },
  'Baby spinach': { qty: 1, uom: 'oz' },
  'Romaine lettuce': { qty: 1, uom: 'oz' },

  // Dressings, syrups, sauces (ramekin / drizzle)
  'All Dressings': { qty: 1.5, uom: 'oz' },
  'Maple syrup': { qty: 2, uom: 'oz' },
  'Chocolate syrup': { qty: 0.5, uom: 'oz' },
  'Chocolate sauce': { qty: 0.5, uom: 'oz' },
  'Caramel sauce': { qty: 0.5, uom: 'oz' },
  'Salsa': { qty: 1.5, uom: 'oz' },
  'Coconut syrup': { qty: 0.25, uom: 'oz' },
  'Flavored syrup': { qty: 0.25, uom: 'oz' },
  'Marshmallow syrup': { qty: 0.25, uom: 'oz' },
  'Vanilla extract': { qty: 0.1, uom: 'fl_oz' },

  // Condiments / small amounts
  'Whipped Butter': { qty: 0.5, uom: 'oz' },
  'Sour Cream': { qty: 0.5, uom: 'oz' },
  'Mayonnaise': { qty: 0.25, uom: 'oz' },
  'Chipotle paste': { qty: 0.1, uom: 'oz' },
  'Cilantro': { qty: 0.1, uom: 'oz' },
  'Lemon Zest': { qty: 0.05, uom: 'oz' },
  'Lemon wedge': { qty: 0.3, uom: 'oz' },

  // Seasonings (pinches)
  'Kosher salt': { qty: 0.05, uom: 'oz' },
  'Coarse sea salt': { qty: 0.05, uom: 'oz' },
  'Black Pepper': { qty: 0.03, uom: 'oz' },
  'Cinnamon': { qty: 0.05, uom: 'oz' },
  'Paprika': { qty: 0.05, uom: 'oz' },
  'Cajun Seasoning': { qty: 0.1, uom: 'oz' },
  'Cinnamon sugar': { qty: 0.1, uom: 'oz' },
  'Garlic Pepper Seasoning': { qty: 0.1, uom: 'oz' },
  'Everything Bagel Seasoning': { qty: 0.1, uom: 'oz' },
  'Brown sugar': { qty: 0.1, uom: 'oz' },

  // Ice & water
  'Ice': { qty: 4, uom: 'oz' },
  'Ice cubes': { qty: 4, uom: 'oz' },
  'Hot water': { qty: 6, uom: 'oz' },

  // Fruit
  'Beefsteak tomato': { qty: 0.2, uom: 'each' },
  'Avocado': { qty: 0.33, uom: 'each' },
  'Strawberries': { qty: 1, uom: 'oz' },
  'Blueberries': { qty: 0.5, uom: 'oz' },
  'Banana': { qty: 1, uom: 'oz' },
  'Grapes': { qty: 1, uom: 'oz' },
  'Pineapple': { qty: 1, uom: 'oz' },
  'Mango': { qty: 1, uom: 'oz' },
  'Fruit': { qty: 1, uom: 'oz' },

  // Vegetables (diced filling)
  'Green bell pepper': { qty: 0.5, uom: 'oz' },
  'Yellow onion': { qty: 0.5, uom: 'oz' },
  'Cucumber': { qty: 0.5, uom: 'oz' },
  'Zucchini': { qty: 1, uom: 'oz' },
  'Mushrooms': { qty: 0.5, uom: 'oz' },
  'Pickles': { qty: 0.5, uom: 'oz' },

  // Proteins
  'Bacon, thick-cut': { qty: 2, uom: 'oz' },
  'Smoked ham': { qty: 1.5, uom: 'oz' },
  'Deli turkey': { qty: 2, uom: 'oz' },
  'Smoked salmon': { qty: 1.5, uom: 'oz' },
  'Breakfast meat': { qty: 2, uom: 'oz' },
  'Chicken chorizo': { qty: 2, uom: 'oz' },
  'Chicken tenders': { qty: 4, uom: 'oz' },
  'Shrimp': { qty: 3, uom: 'oz' },
  'Pork sausage': { qty: 1, uom: 'each' },
  'Taylor ham (pork roll)': { qty: 2, uom: 'oz' },
  'Eggs, large': { qty: 1, uom: 'each' },
  'Egg Whites': { qty: 3, uom: 'oz' },

  // Cheeses
  'Cheddar jack cheese, shredded': { qty: 0.5, uom: 'oz' },
  'American cheese': { qty: 0.5, uom: 'oz' },
  'Jack cheese': { qty: 0.5, uom: 'oz' },
  'Swiss cheese': { qty: 0.5, uom: 'oz' },
  'Goat cheese': { qty: 0.5, uom: 'oz' },
  'Fresh mozzarella': { qty: 1, uom: 'oz' },
  'Philly cream cheese': { qty: 1, uom: 'oz' },

  // Breads & carbs
  'Ciabatta': { qty: 2, uom: 'oz' },
  'Cornbread': { qty: 2, uom: 'oz' },
  'Multigrain bread': { qty: 2, uom: 'oz' },
  'Sandwich bread': { qty: 2, uom: 'oz' },
  'Wheat tortilla': { qty: 1.5, uom: 'oz' },
  'Whole wheat tortilla': { qty: 1.5, uom: 'oz' },
  'Tortilla chips': { qty: 1.5, uom: 'oz' },
  'Tri-color tortilla chips': { qty: 1.5, uom: 'oz' },

  // Toppings / garnish
  'Graham Cracker Crumbs': { qty: 0.25, uom: 'oz' },
  'Oreo Cookie Pieces': { qty: 0.25, uom: 'oz' },
  'Chocolate chips': { qty: 0.25, uom: 'oz' },
  'Peppermint chips': { qty: 0.25, uom: 'oz' },
  'Toasted Coconut': { qty: 0.25, uom: 'oz' },
  'Maple Walnuts': { qty: 0.25, uom: 'oz' },
  'Dried Cranberries': { qty: 0.25, uom: 'oz' },
  'Marshmallows': { qty: 0.25, uom: 'oz' },
  'Mini marshmallows': { qty: 0.25, uom: 'oz' },
  'Hot chocolate powder': { qty: 0.5, uom: 'oz' },

  // Grains & legumes
  'Quinoa': { qty: 2, uom: 'oz' },
  'Lentils': { qty: 2, uom: 'oz' },
  'Black beans': { qty: 2, uom: 'oz' },
  'Cereal': { qty: 1.5, uom: 'oz' },

  // Beverages
  'Almond milk': { qty: 4, uom: 'oz' },
  'Oat milk': { qty: 4, uom: 'oz' },
  'Whole milk': { qty: 4, uom: 'fl_oz' },
  'Sweet cream': { qty: 1, uom: 'oz' },
  'Soda': { qty: 12, uom: 'oz' },
  'Apple juice': { qty: 8, uom: 'oz' },
  'Orange juice, fresh': { qty: 8, uom: 'oz' },
  'Kale to the King juice': { qty: 8, uom: 'oz' },
  'Walk on the Beach juice': { qty: 8, uom: 'oz' },
  'Gourmet brewed coffee': { qty: 12, uom: 'oz' },
  'Coffee beans, flavored': { qty: 0.5, uom: 'oz' },
  'Coffee beans, whole': { qty: 0.5, uom: 'oz' },
  'Espresso beans': { qty: 0.25, uom: 'oz' },
  'Creamers': { qty: 2, uom: 'oz' },
  'PC French vanilla creamer': { qty: 0.5, uom: 'oz' },
  'PC regular creamer': { qty: 0.5, uom: 'oz' },

  // Misc / bundled
  'Onion rings': { qty: 2, uom: 'oz' },
  'White cheddar mac & cheese': { qty: 1, uom: 'serving' },

  // Half-portion / meta bundles — small placeholders, cost is nominal
  'Half portion salad': { qty: 1, uom: 'serving' },
  'Half portion sandwich': { qty: 1, uom: 'serving' },
  'Half portion soup': { qty: 1, uom: 'serving' },
  'Half portion sandwich/salad/soup': { qty: 1, uom: 'serving' },
  "Kid's side": { qty: 1, uom: 'serving' },
  'Protein choice': { qty: 3, uom: 'oz' },
  'Soups': { qty: 8, uom: 'oz' },
};

// Recipe-to-recipe references that show up in qty_text='as needed' land.
// Quantity is expressed in the referenced prep's yield_uom (oz/each/fl_oz).
const PREP_PORTIONS: Record<string, PortionRule> = {
  // Sides & filling components
  'Breakfast potatoes': { qty: 4, uom: 'oz' },
  'Caramelized Onions': { qty: 1, uom: 'oz' },
  'Roasted Red Peppers': { qty: 0.5, uom: 'oz' },
  'Pickled onions': { qty: 0.25, uom: 'oz' },
  'Cheesy Grits': { qty: 6, uom: 'oz' },
  'Oatmeal': { qty: 8, uom: 'oz' },
  'Granola': { qty: 0.5, uom: 'oz' },

  // Sauces / condiments / foams
  'Hollandaise (prep)': { qty: 1, uom: 'fl_oz' },
  'Strawberry reduction': { qty: 1, uom: 'oz' },
  'Chipotle aioli': { qty: 0.5, uom: 'oz' },
  'Cilantro honey mustard': { qty: 0.5, uom: 'oz' },
  'Basil pesto (prep)': { qty: 0.5, uom: 'oz' },
  'Sriracha hot honey': { qty: 0.25, uom: 'oz' },
  'Cream cheese frosting': { qty: 0.5, uom: 'oz' },
  'Lemon vinaigrette': { qty: 1, uom: 'oz' },
  'Cold foam': { qty: 1, uom: 'fl_oz' },
  'Whipped cream (prep)': { qty: 0.5, uom: 'oz' },

  // Proteins
  'Grilled chicken breast': { qty: 1, uom: 'each' },
  'Turkey chili': { qty: 2, uom: 'oz' },
  'Cranberry Chicken Salad': { qty: 4, uom: 'oz' },

  // Breads / bakes
  'Belgian waffle': { qty: 1, uom: 'each' },
  'French toast, brioche': { qty: 2, uom: 'each' },
  'French toast, multigrain': { qty: 2, uom: 'each' },
  'Daisy Cakes': { qty: 2, uom: 'each' },

  // Pancake batters (scoop per stack)
  'Pancake batter (prep)': { qty: 6, uom: 'oz' },
  'Blueberry pancake batter': { qty: 6, uom: 'oz' },
  'Chocolate chip pancake batter': { qty: 6, uom: 'oz' },
  'Cinnamon sugar pancake batter': { qty: 6, uom: 'oz' },
  'Vegan pancake batter': { qty: 6, uom: 'oz' },
  'Power grain pancake batter': { qty: 6, uom: 'oz' },

  // Beverages
  'Chai concentrate': { qty: 2, uom: 'oz' },
  'Black iced tea': { qty: 12, uom: 'oz' },
  'Lemonade, fresh': { qty: 12, uom: 'oz' },
  'Chocolate Milk': { qty: 8, uom: 'fl_oz' },

  // Pre-composed menu items shipped as components
  'CrossFit  Omelet': { qty: 1, uom: 'each' },
};

async function main() {
  const prisma = new PrismaClient();
  try {
    // Pass 1 — ingredient refs
    const ingredientRows = await prisma.$queryRaw<Array<{ id: string; ingredient_name: string }>>`
      SELECT rl.id, i.name AS ingredient_name
      FROM recipe_line rl
      JOIN ingredient i ON i.id = rl.ingredient_id
      WHERE rl.qty = 0 AND rl.ref_type = 'ingredient'
    `;
    // Pass 2 — recipe (prep) refs
    const prepRows = await prisma.$queryRaw<Array<{ id: string; prep_name: string }>>`
      SELECT rl.id, rr.name AS prep_name
      FROM recipe_line rl
      JOIN recipe rr ON rr.id = rl.ref_recipe_id
      WHERE rl.qty = 0 AND rl.ref_type = 'recipe'
    `;

    console.log(`Found ${ingredientRows.length} ingredient + ${prepRows.length} prep candidate rows.`);

    let updated = 0;
    const unmapped = new Map<string, number>();

    for (const row of ingredientRows) {
      const rule = PORTIONS[row.ingredient_name];
      if (!rule) {
        unmapped.set(`[ingredient] ${row.ingredient_name}`, (unmapped.get(`[ingredient] ${row.ingredient_name}`) ?? 0) + 1);
        continue;
      }
      await prisma.$executeRaw`
        UPDATE recipe_line SET qty = ${new Prisma.Decimal(rule.qty)}, uom = ${rule.uom}
        WHERE id = ${row.id}::uuid
      `;
      updated += 1;
    }

    for (const row of prepRows) {
      const rule = PREP_PORTIONS[row.prep_name];
      if (!rule) {
        unmapped.set(`[prep] ${row.prep_name}`, (unmapped.get(`[prep] ${row.prep_name}`) ?? 0) + 1);
        continue;
      }
      await prisma.$executeRaw`
        UPDATE recipe_line SET qty = ${new Prisma.Decimal(rule.qty)}, uom = ${rule.uom}
        WHERE id = ${row.id}::uuid
      `;
      updated += 1;
    }

    console.log(`Updated ${updated} rows.`);
    if (unmapped.size > 0) {
      console.log(`\nUnmapped ingredients (${unmapped.size}):`);
      for (const [name, n] of [...unmapped.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${n.toString().padStart(3)}  ${name}`);
      }
    }

    const plated = await prisma.$queryRaw<Array<{ versions: bigint; zero_cost: bigint; avg_cents: number }>>`
      WITH recipe_plated AS (
        SELECT rv.id AS recipe_version_id,
               COALESCE(SUM(rl.qty * COALESCE(
                 (SELECT ic.unit_cost_cents FROM ingredient_cost ic
                  WHERE ic.ingredient_id = rl.ingredient_id
                  ORDER BY ic.effective_from DESC LIMIT 1), 0)), 0)::bigint AS plated_cost_cents
        FROM recipe_version rv
        LEFT JOIN recipe_line rl ON rl.recipe_version_id = rv.id AND rl.ref_type = 'ingredient'
        WHERE rv.is_current
        GROUP BY rv.id
      )
      SELECT COUNT(*)::bigint AS versions,
             SUM(CASE WHEN plated_cost_cents = 0 THEN 1 ELSE 0 END)::bigint AS zero_cost,
             AVG(plated_cost_cents)::int AS avg_cents
      FROM recipe_plated
    `;
    const p = plated[0];
    if (p) {
      console.log(`\nPlated-cost rollup: ${p.versions} versions, ${p.zero_cost} still $0, avg ${p.avg_cents}¢.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

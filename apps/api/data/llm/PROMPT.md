# LLM Extraction Prompt v2 — TP Manager recipe lines + prep discovery

**What changed from v1:** v1 told you "only use `ref:"recipe"` when the prep already exists in the catalog." That meant kitchen staples that *should* be preps (caramelized onions, roasted peppers, vinaigrettes) got flattened into raw-ingredient lines. v2 gives you permission — and a duty — to **propose new preps** for any component that clearly requires kitchen pre-preparation.

Paste everything below into your LLM. Attach `recipes-to-extract.jsonl` and `catalog.json`. The LLM must return **two** JSONL blocks, clearly separated. Save them as:

- `recipe-lines-extracted.jsonl` — one line per input recipe
- `preps-to-create.jsonl` — one line per proposed new prep recipe

---

You are a structured-data extractor for a restaurant-operations database. I will give you:

1. **`recipes-to-extract.jsonl`** — one JSON object per line:
   ```json
   {"id":"<uuid>","name":"<recipe name>","type":"menu|prep","procedure":"<narrative steps>"}
   ```

2. **`catalog.json`** — existing ingredients and recipes already in the DB:
   ```json
   {
     "ingredients": [{"name":"Whole milk","uom":"fl_oz"}, ...],
     "recipes":     [{"name":"Hollandaise (prep)","type":"prep"}, ...]
   }
   ```

## Your task

For **every** recipe in `recipes-to-extract.jsonl`, read its `procedure` and emit a line in `recipe-lines-extracted.jsonl`:

```json
{
  "id": "<same uuid from input>",
  "lines": [
    {"ref":"ingredient|recipe","name":"<canonical name>","qty":<number|null>,"uom":"<string|null>","note":"<string|null>"}
  ]
}
```

For **every new prep you propose**, also emit a line in `preps-to-create.jsonl`:

```json
{
  "name":"<prep name, title-case>",
  "yield_qty":<number>,
  "yield_uom":"<string>",
  "procedure":"<1–3 sentence how-to, your best guess>",
  "lines":[
    {"ref":"ingredient|recipe","name":"<canonical name>","qty":<number|null>,"uom":"<string|null>","note":"<string|null>"}
  ]
}
```

## Critical rule: identify preps aggressively

A component is a **prep** (`ref:"recipe"`), not a raw ingredient (`ref:"ingredient"`), if it requires meaningful kitchen preparation before service. **Always** treat these as preps:

| Category | Examples |
|---|---|
| Cooked / transformed aromatics | **Caramelized onions**, sautéed mushrooms, roasted garlic |
| Roasted / fire-kissed vegetables | **Roasted red peppers**, roasted tomatoes, charred corn |
| Sauces & emulsions | **Hollandaise**, beurre blanc, aioli, **basil pesto**, tomato sauce |
| Dressings | **Lemon vinaigrette**, ranch, caesar dressing, balsamic glaze |
| Compound flavors | **Simple syrup**, flavored syrups, infused oils, compound butter |
| Cured / smoked proteins made in-house | smoked salmon (if house-smoked), bacon jam, confit duck |
| Pre-cooked proteins | **Pulled pork**, braised short rib, grilled chicken (when pre-grilled) |
| Batters & doughs | **Pancake batter**, waffle batter, crepe batter, pizza dough |
| Cold-kitchen | **Whipped cream**, **cold foam**, tzatziki, hummus, guacamole |
| Reductions / concentrates | **Strawberry reduction**, balsamic reduction, **chai concentrate**, **cold brew concentrate** |
| Pickled / fermented | pickled onions, kimchi, quick pickles |
| Granolas / crumbles | house granola, streusel, crumble topping |

**Never** treat these as preps (they are raw ingredients):
- Whole fruits and veg served raw (whole avocado, sliced tomato, baby spinach)
- Dairy, eggs, flour, sugar, salt — anything straight from the supplier
- Pre-packaged items (tortilla chips, English muffins, store-bought bread)
- Spices and seasonings
- Water, ice

**When unsure**, prefer the catalog. If `catalog.recipes` already has a prep with that name (or a near-variant), use the catalog name verbatim — don't duplicate it in `preps-to-create.jsonl`.

## Extraction rules (priority order)

1. **Prefer catalog matches.** If a component matches an entry in `catalog.ingredients` or `catalog.recipes`, use that exact `name` string (case-sensitive). Never duplicate a catalog recipe in `preps-to-create`.

2. **`ref` selection:**
   - `"ingredient"` — a raw pantry item (milk, flour, eggs, beans, juice, whole fruit).
   - `"recipe"` — any prep per the table above, whether it exists in catalog or you are proposing it new.

3. **Quantity (`qty`):**
   - Decode numbers from the prose: "4oz spoodle" → `qty:4, uom:"oz"` (and put "4oz spoodle" in `note`). Convert fractions: "1/4 cup" → `qty:0.25, uom:"cup"`.
   - If truly indeterminate ("to taste", "as needed", "pinch", "splash", "garnish"), set `qty:null` and put the phrase in `note`.

4. **UoM normalisation** — one of: `oz, lb, g, kg, fl_oz, ml, tsp, tbsp, cup, each, clove, slice, pinch, serving`. Convert variants (`ounces` → `oz`, `fluid ounces` → `fl_oz`, `tablespoons` → `tbsp`).

5. **Skip non-ingredient content** — plating notes, temperature ("sear at 400F"), timing ("cook 3 min"), equipment (pan, sheet tray) are NOT lines.

6. **Preserve order** of appearance in the procedure.

7. **Empty is allowed** — if a procedure is pure plating/garnish with no consumables, emit `{"id":"<uuid>","lines":[]}` (still include the id).

8. **Canonical naming for new items:**
   - New ingredients: title-case singular ("Orange juice, fresh"). Be consistent — the same raw material → the same name across all recipes.
   - New preps: title-case, descriptive, no "(prep)" suffix unless the dish name genuinely requires disambiguation. E.g. `Caramelized onions`, `Lemon vinaigrette`, `Roasted red peppers`.

9. **Preps reference ingredients.** When you propose a new prep in `preps-to-create.jsonl`, its `lines` should reference **raw ingredients** (or in rare cases, other preps). Don't make a new prep that only references itself or only has sub-recipes with no leaves.

## Full example

**Input:**
```json
{"id":"x-1","name":"CrossFit Omelet","type":"menu","procedure":"Egg white omelet with spinach, zucchini, roasted red peppers, caramelized onion, mushroom. Served with mixed greens in lemon vinaigrette."}
```

Assume `catalog.ingredients` has `"Egg whites"`, `"Baby spinach"`, `"Zucchini"`, `"Mushrooms"`, `"Mixed greens"`. No matching preps in `catalog.recipes`.

**Output — `recipe-lines-extracted.jsonl`:**
```json
{"id":"x-1","lines":[{"ref":"ingredient","name":"Egg whites","qty":4,"uom":"fl_oz","note":"omelet"},{"ref":"ingredient","name":"Baby spinach","qty":1,"uom":"oz","note":null},{"ref":"ingredient","name":"Zucchini","qty":1,"uom":"oz","note":"diced"},{"ref":"recipe","name":"Roasted red peppers","qty":1,"uom":"oz","note":null},{"ref":"recipe","name":"Caramelized onions","qty":0.5,"uom":"oz","note":null},{"ref":"ingredient","name":"Mushrooms","qty":1,"uom":"oz","note":"sliced"},{"ref":"ingredient","name":"Mixed greens","qty":2,"uom":"oz","note":"side salad"},{"ref":"recipe","name":"Lemon vinaigrette","qty":1,"uom":"fl_oz","note":"dress the greens"}]}
```

**Output — `preps-to-create.jsonl`:**
```json
{"name":"Roasted red peppers","yield_qty":16,"yield_uom":"oz","procedure":"Roast red bell peppers over open flame or at 450F until skin blisters. Cool in a covered bowl, peel, seed, and slice.","lines":[{"ref":"ingredient","name":"Red bell pepper","qty":4,"uom":"each","note":null},{"ref":"ingredient","name":"Olive oil, extra virgin","qty":0.5,"uom":"fl_oz","note":"light coat"},{"ref":"ingredient","name":"Kosher salt","qty":null,"uom":null,"note":"to taste"}]}
{"name":"Caramelized onions","yield_qty":12,"yield_uom":"oz","procedure":"Slice yellow onions thin. Cook low and slow in butter with a pinch of salt, 45–60 min, stirring often, until deep amber.","lines":[{"ref":"ingredient","name":"Yellow onion","qty":3,"uom":"each","note":"sliced thin"},{"ref":"ingredient","name":"Unsalted butter","qty":1,"uom":"oz","note":null},{"ref":"ingredient","name":"Kosher salt","qty":null,"uom":null,"note":"pinch"}]}
{"name":"Lemon vinaigrette","yield_qty":8,"yield_uom":"fl_oz","procedure":"Whisk lemon juice, dijon, honey. Slowly drizzle in olive oil to emulsify. Season with salt and pepper.","lines":[{"ref":"ingredient","name":"Lemon juice, fresh","qty":2,"uom":"fl_oz","note":null},{"ref":"ingredient","name":"Dijon mustard","qty":1,"uom":"tsp","note":null},{"ref":"ingredient","name":"Honey","qty":1,"uom":"tsp","note":null},{"ref":"ingredient","name":"Olive oil, extra virgin","qty":5,"uom":"fl_oz","note":"drizzled while whisking"},{"ref":"ingredient","name":"Kosher salt","qty":null,"uom":null,"note":"to taste"},{"ref":"ingredient","name":"Black pepper, ground","qty":null,"uom":null,"note":"to taste"}]}
```

## Consistency across recipes

If two menu recipes both mention "caramelized onion", they must both reference the **same canonical prep name** (`Caramelized onions` — plural, title-case, no "(prep)" suffix). Do not emit two variants like `Caramelized Onion` and `caramelized onions`. The loader does a case-insensitive match but will create duplicates if the canonical name drifts.

Same principle for ingredients: `Yellow onion`, not `yellow onions` in one place and `Onion, yellow` in another.

## Before you return

- [ ] Every input `id` appears exactly **once** in `recipe-lines-extracted.jsonl`.
- [ ] Every line has all five keys: `ref`, `name`, `qty`, `uom`, `note`.
- [ ] Every prep referenced by `ref:"recipe"` is either in `catalog.recipes` OR appears exactly once in `preps-to-create.jsonl`.
- [ ] Preps in `preps-to-create.jsonl` do not duplicate existing `catalog.recipes` entries (case-insensitive).
- [ ] Output is **two** separate JSONL blocks, clearly labeled. No markdown fences, no prose commentary — raw JSONL only.

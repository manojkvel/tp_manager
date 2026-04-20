# LLM Extraction Prompt — TP Manager recipe lines

Paste everything below into your LLM (Claude.ai / ChatGPT / whatever). Attach or paste the two files as described. The LLM must return **only** the JSONL block — no prose — which you save to `recipe-lines-extracted.jsonl` next to this file.

---

You are a structured-data extractor for a restaurant-operations database. I will give you:

1. **`recipes-to-extract.jsonl`** — one JSON object per line with shape:
   ```json
   {"id":"<uuid>","name":"<recipe name>","type":"menu|prep","procedure":"<narrative steps>"}
   ```

2. **`catalog.json`** — the existing ingredient and sub-recipe names already in the database:
   ```json
   {
     "ingredients": [{"name":"Whole milk","uom":"fl_oz"}, ...],
     "recipes":     [{"name":"Espresso shot","type":"prep"}, ...]
   }
   ```

## Your task

For **every** recipe in `recipes-to-extract.jsonl`, read its `procedure` text and emit an extracted object of shape:

```json
{
  "id": "<same uuid from input>",
  "lines": [
    {"ref":"ingredient|recipe","name":"<canonical name>","qty":<number|null>,"uom":"<string|null>","note":"<string|null>"}
  ]
}
```

Output one JSON object per line (JSONL). Do **not** wrap in an array. Do **not** include any prose, markdown, or code fences — just raw JSONL.

## Extraction rules (in priority order)

1. **Prefer catalog matches.** If the procedure mentions an ingredient that appears in `catalog.ingredients`, use that exact `name` string (case-sensitive). Same for sub-recipes (`ref: "recipe"`) against `catalog.recipes`.

2. **Distinguish `ref`:**
   - `"ingredient"` — a raw pantry item (milk, flour, eggs, beans, syrup, juice, fruit, etc.)
   - `"recipe"` — a made-in-house prep (e.g., "Espresso shot", "Simple syrup", "Pancake batter") that should reference another recipe row. Only use `"recipe"` if the referenced name matches a catalog recipe — otherwise extract its components as ingredients.

3. **Quantity (`qty`):**
   - Use the number stated in the procedure ("2 oz", "4oz spoodle", "1/4 cup"). Convert fractions to decimals (`0.25`). A "1/4 cup" yields `qty: 0.25, uom: "cup"`.
   - For "4oz spoodle" style: `qty: 4, uom: "oz"` and put `"4oz spoodle"` into `note`.
   - If truly indeterminate ("to taste", "as needed", "pinch", "splash", "garnish"), set `qty: null` and put the phrase into `note`.

4. **UoM (`uom`):** normalise to one of — `oz`, `lb`, `g`, `kg`, `fl_oz`, `ml`, `tsp`, `tbsp`, `cup`, `each`, `clove`, `slice`, `pinch`, `serving`. Keep as-is if already normalised; convert common variants (`tablespoons`→`tbsp`, `fluid ounces`→`fl_oz`, `ounces`→`oz`).

5. **Skip non-ingredient content:** plating instructions, equipment names (grill, pan, sheet tray), temperatures, times, and pure technique ("sear until golden") are NOT lines. Only physical consumables.

6. **Preserve order** of appearance in the procedure.

7. **If a procedure has no extractable ingredients** (pure plating / garnish flash-card), emit `{"id":"<uuid>","lines":[]}` — do not skip the id.

8. **Canonical names for new ingredients:** if an ingredient isn't in the catalog, invent a clear, title-case singular name (e.g., `"Orange juice, fresh"`, `"Pancake batter"` — NOT `"OJ"` or `"orange juice for the thing"`). Be consistent across recipes: the same raw material should always use the same name.

## Examples

**Input line:**
```json
{"id":"abc-123","name":"Latte","type":"menu","procedure":"Pull a double espresso shot into an 8oz cup. Steam 6 fl oz of whole milk to 150F and pour over the shot. Finish with a pinch of cinnamon."}
```

Assume `catalog.recipes` has `"Espresso shot"` and `catalog.ingredients` has `"Whole milk"`.

**Output line:**
```json
{"id":"abc-123","lines":[{"ref":"recipe","name":"Espresso shot","qty":2,"uom":"oz","note":"double shot"},{"ref":"ingredient","name":"Whole milk","qty":6,"uom":"fl_oz","note":"steamed to 150F"},{"ref":"ingredient","name":"Cinnamon, ground","qty":null,"uom":null,"note":"pinch"}]}
```

---

## Final check before you return

- Every input `id` must appear exactly once in the output.
- Every line has all five keys: `ref`, `name`, `qty`, `uom`, `note`.
- No trailing commas, no markdown, no commentary. JSONL only.

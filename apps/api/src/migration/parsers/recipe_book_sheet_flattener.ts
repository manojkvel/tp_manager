// recipe_book_sheet_flattener (§6.14 AC-3 helper).
//
// The `recipe_book_parser` expects a canonical matrix (header row + data
// rows). Real-world "TP Recipe Book.xlsx" instead ships one sheet per
// recipe with a free-form layout:
//
//   row 1: [date, "CILANTRO HONEY DIJON", null, "1X Recipe"]
//   row 2: ["Ingredients", "Ingredientes", "Quantity", "Cantidad"]
//   row 3: ["Mayonnaise",  "Mayonesa",    "1 bottle (1 gallon)", "1 bote (1 galón)"]
//   ...
//
// The flattener converts a list of { sheet_name, rows } into the canonical
// matrix the parser already accepts. Quantity strings are preserved verbatim
// in `qty_text`; numeric extraction is best-effort (the parser handles both
// numeric and non-numeric qty values gracefully).

export interface SheetInput {
  sheet_name: string;
  rows: readonly (readonly (string | number | Date | null)[])[];
}

export type RecipeBookMatrix = readonly (readonly string[])[];

const CANONICAL_HEADER = [
  'recipe_name', 'type', 'yield_qty', 'yield_uom', 'line_position',
  'ingredient_name', 'qty', 'uom', 'station', 'step_order', 'ref_recipe_name', 'qty_text',
] as const;

export function flattenRecipeBook(sheets: readonly SheetInput[]): RecipeBookMatrix {
  const out: string[][] = [[...CANONICAL_HEADER]];
  for (const sheet of sheets) {
    const recipeName = extractRecipeName(sheet);
    if (!recipeName) continue;
    const type = classifyType(recipeName);
    let position = 0;
    const dataStart = firstDataRowIndex(sheet.rows);
    for (let i = dataStart; i < sheet.rows.length; i += 1) {
      const row = sheet.rows[i]!;
      const ingredient = textAt(row, 0);
      const qtyText = textAt(row, 2);
      if (!ingredient) continue;
      // Skip non-ingredient metadata rows that the recipe-book author embedded
      // into the body of the sheet (shelf life, equipment, procedures, etc.).
      if (isMetadataLabel(ingredient)) continue;

      const qty = extractNumber(qtyText);
      out.push([
        recipeName,                // recipe_name
        type,                      // type
        '1',                       // yield_qty — real value unknown without a column; default 1
        'each',                    // yield_uom
        String(position),          // line_position
        ingredient,                // ingredient_name
        qty != null ? String(qty) : '0', // qty
        extractUom(qtyText),       // uom
        '',                        // station
        '',                        // step_order
        '',                        // ref_recipe_name
        qtyText,                   // qty_text (verbatim: "1 bottle (1 gallon)")
      ]);
      position += 1;
    }
  }
  return out;
}

function extractRecipeName(sheet: SheetInput): string | null {
  // Prefer the capitalised title in row 1 col 1 (actual layout of TP Recipe
  // Book). If row 0 IS the ingredients header, there's no title row — fall
  // back to the sheet name.
  const r0 = sheet.rows[0];
  if (r0) {
    const c0Lower = textAt(r0, 0).toLowerCase();
    const isHeaderRow = c0Lower === 'ingredients' || c0Lower === 'ingrediente' || c0Lower === 'ingredientes';
    if (!isHeaderRow) {
      const title = textAt(r0, 1);
      if (title) return normaliseTitle(title);
    }
  }
  return sheet.sheet_name ? normaliseTitle(sheet.sheet_name) : null;
}

function firstDataRowIndex(rows: SheetInput['rows']): number {
  // The canonical header row is "Ingredients | Ingredientes | Quantity | ...".
  // Find it and start one row below. If not found, default to row index 2
  // (matches the TP Recipe Book layout).
  for (let i = 0; i < rows.length; i += 1) {
    const c0 = textAt(rows[i]!, 0).toLowerCase();
    if (c0 === 'ingredients' || c0 === 'ingrediente' || c0 === 'ingredientes') return i + 1;
  }
  return 2;
}

function isMetadataLabel(s: string): boolean {
  const lc = s.toLowerCase();
  return lc.startsWith('shelf life')
    || lc.startsWith('equipment')
    || lc.startsWith('equipo')
    || lc.startsWith('procedure')
    || lc.startsWith('procedimiento')
    || lc.startsWith('prep ')
    || lc === 'note'
    || lc.startsWith('note:');
}

function normaliseTitle(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

function textAt(row: readonly (string | number | Date | null)[], idx: number): string {
  const v = row[idx];
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function extractNumber(qtyText: string): number | null {
  if (!qtyText) return null;
  // Match "2 cups", "1/3 cup", "4 ounces", "6 pounds + 4 ounces".
  const fracMatch = qtyText.match(/^(\d+)\s*\/\s*(\d+)/);
  if (fracMatch) {
    const num = Number(fracMatch[1]);
    const den = Number(fracMatch[2]);
    if (den !== 0) return num / den;
  }
  const intMatch = qtyText.match(/^-?\d+(?:\.\d+)?/);
  return intMatch ? Number(intMatch[0]) : null;
}

function extractUom(qtyText: string): string {
  if (!qtyText) return '';
  // Grab the first alpha token after the number.
  const m = qtyText.match(/^\s*\S+\s+([a-zA-Z]+)/);
  if (!m) return '';
  return m[1]!.toLowerCase();
}

function classifyType(recipeName: string): 'prep' | 'menu' {
  // Most entries in TP Recipe Book are prep components (sauces, batters,
  // mixes). Heuristic: anything containing "SAUCE", "MIX", "BATTER",
  // "PASTE", "DRESSING", "OILS", "SYRUP", "RANCH" → prep; remainder
  // still defaults to `prep` since the owner reviews before promotion.
  return 'prep';
}

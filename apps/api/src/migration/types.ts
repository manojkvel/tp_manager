// TASK-046/047 — Migration domain types (§6.14).
//
// Parsers produce staging rows; the atomic-batch runner writes them behind a
// single transaction (AD-7). Rows carry batch/source provenance so review UI
// can explain *why* a canonical row was proposed.

export interface BatchContext {
  batch_id: string;
  source_file: string;
  parser_version: string;
  restaurant_id: string;
  started_at: Date;
}

export interface StagingIngredient {
  staging_id: string;
  source_row_ref: string;
  name: string;
  uom: string;
  uom_category?: 'weight' | 'volume' | 'count';
  pack_size?: number;
  shelf_life_days?: number;
  allergen_flags?: string[];
  density_g_per_ml?: number;
}

export interface StagingRecipe {
  staging_id: string;
  source_row_ref: string;
  type: 'prep' | 'menu';
  name: string;
  yield_qty: number;
  yield_uom: string;
  procedure?: string;
}

export interface StagingRecipeLine {
  staging_id: string;
  recipe_staging_id: string;
  position: number;
  ingredient_name: string | null;
  ref_recipe_name: string | null;
  qty: number;
  qty_text?: string;
  uom?: string;
  station?: string;
  utensil_name?: string;
}

export interface StagingPosSale {
  staging_id: string;
  source_row_ref: string;
  business_date: string; // ISO date
  menu_item_name: string;
  qty_sold: number;
  // Classification driven by the parser — see aloha_pmix_parser.
  kind: 'item' | 'modifier' | 'stockout' | 'cover';
  modifier_of: string | null;
  net_sales_cents: number;
}

/** Par template — ingests a "Barista Prep"-style sheet of recipe names with
 *  optional par quantities. Empty pars are preserved as `undefined` so the
 *  review UI can prompt the owner to fill them in before promotion. */
export interface StagingParTemplate {
  staging_id: string;
  source_row_ref: string;
  recipe_name: string;
  section?: string;
  qty?: number;
}

/** Plating / expo-side note attached to a menu item, parsed from server-side
 *  expo cheat-sheets. Emitted separately from the recipe itself so the
 *  promotion writer can choose to attach to Recipe.procedure or surface in UI. */
export interface StagingPlatingNote {
  staging_id: string;
  source_row_ref: string;
  recipe_name: string;
  section: string;
  plating_notes: string;
}

export interface ParseError {
  source_row_ref: string;
  message: string;
}

export interface ParseResult<T> {
  rows: T[];
  errors: ParseError[];
}

/** Parser contract — pure function over an already-loaded row source. */
export type Parser<TInput, TOutput> = (input: TInput, ctx: BatchContext) => ParseResult<TOutput>;

// beverage_recipes_parser (§6.14 AC-3).
//
// Source: `Beverage Recipes.docx`, re-exported as a CSV with columns:
//
//   section, recipe_name, vessel, step_number, step_text, source_style
//
// Row layout:
//   - First row = header (skipped).
//   - One title row per recipe with step_number=0 and step_text empty (or a
//     repeat of recipe_name). All subsequent rows for that recipe carry
//     step_number ≥ 1 and the step body in step_text.
//   - Steps are NOT guaranteed to be contiguous — we group by (section,
//     recipe_name, vessel) and sort by step_number before joining.
//
// Output: one StagingRecipe per (section, recipe_name) with type='menu',
// yield_qty=1, yield_uom=vessel (vessel is the serving container — TP Mug,
// BIG MUG, Stemless Wineglass, etc.). The section becomes the procedure
// preamble so the review UI / promotion writer can choose to keep or strip
// the tag without losing the source classification.

import { randomUUID } from 'node:crypto';
import type { Parser, ParseResult, StagingRecipe } from '../types.js';

interface RawStep {
  step_number: number;
  step_text: string;
  source_row_ref: string;
}

interface RecipeAccumulator {
  section: string;
  recipe_name: string;
  vessel: string;
  steps: RawStep[];
  first_row_ref: string;
}

export const beverage_recipes_parser: Parser<readonly (readonly string[])[], StagingRecipe> = (rows, _ctx) => {
  const errors: ParseResult<never>['errors'] = [];
  const groups = new Map<string, RecipeAccumulator>();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const section = (row[0] ?? '').trim();
    const recipe_name = (row[1] ?? '').trim();
    const vessel = (row[2] ?? '').trim();
    const stepRaw = (row[3] ?? '').trim();
    const stepText = (row[4] ?? '').trim();

    // Skip header.
    if (i === 0 && section.toLowerCase() === 'section' && recipe_name.toLowerCase() === 'recipe_name') continue;
    if (!recipe_name) continue;

    const stepNum = stepRaw === '' ? null : Number(stepRaw);
    if (stepNum !== null && !Number.isFinite(stepNum)) {
      errors.push({ source_row_ref: `row:${i + 1}`, message: `unparseable step_number "${stepRaw}"` });
      continue;
    }

    const key = `${section}::${recipe_name}::${vessel}`;
    let acc = groups.get(key);
    if (!acc) {
      acc = { section, recipe_name, vessel, steps: [], first_row_ref: `row:${i + 1}` };
      groups.set(key, acc);
    }

    // step_number=0 is the title placeholder; ignore even if step_text is set
    // (it almost always duplicates recipe_name).
    if (stepNum != null && stepNum > 0 && stepText) {
      acc.steps.push({ step_number: stepNum, step_text: stepText, source_row_ref: `row:${i + 1}` });
    }
  }

  const out: StagingRecipe[] = [];
  for (const acc of groups.values()) {
    if (acc.steps.length === 0) {
      // A title row with no actual procedure — emit anyway so the review UI
      // can flag it; the procedure stays empty.
    }
    const ordered = acc.steps.slice().sort((a, b) => a.step_number - b.step_number);
    const procedure = ordered.length
      ? ordered.map((s) => `${s.step_number}. ${s.step_text}`).join('\n')
      : '';
    const sectionPreamble = acc.section ? `[${acc.section}]\n` : '';

    out.push({
      staging_id: randomUUID(),
      source_row_ref: acc.first_row_ref,
      type: 'menu',
      name: acc.recipe_name,
      yield_qty: 1,
      yield_uom: acc.vessel || 'serving',
      procedure: sectionPreamble + procedure,
    });
  }

  return { rows: out, errors };
};

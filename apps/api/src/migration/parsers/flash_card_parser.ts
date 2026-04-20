// flash_card_parser (§6.14 AC-3).
//
// Source: `Beverage Flash Cards.pptx` and `Menu Flash Cards.pptx`, re-exported
// as a single CSV with columns:
//
//   deck, slide_number, item_name, line_index, line_text
//
// Row layout:
//   - First row = header (skipped).
//   - One slide per (deck, slide_number, item_name). line_index=0 is the
//     slide title (usually a duplicate of item_name) and is dropped from the
//     plating notes. Subsequent line_indexes are the bullet body.
//   - A few title-only slides (e.g., the deck cover "Beverage Item Descriptions
//     & Pictures") have no body lines — these are skipped silently.
//
// Output: one StagingPlatingNote per slide (using `deck` as the section tag).
// The promotion writer can choose to attach the note to Recipe.procedure or
// surface it in a dedicated "Plating notes" UI panel.

import { randomUUID } from 'node:crypto';
import type { Parser, ParseResult, StagingPlatingNote } from '../types.js';

interface RawLine {
  line_index: number;
  line_text: string;
  source_row_ref: string;
}

interface SlideAccumulator {
  deck: string;
  slide_number: number;
  item_name: string;
  lines: RawLine[];
  first_row_ref: string;
}

export const flash_card_parser: Parser<readonly (readonly string[])[], StagingPlatingNote> = (rows, _ctx) => {
  const errors: ParseResult<never>['errors'] = [];
  const slides = new Map<string, SlideAccumulator>();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const deck = (row[0] ?? '').trim();
    const slideRaw = (row[1] ?? '').trim();
    const item_name = (row[2] ?? '').trim();
    const lineIdxRaw = (row[3] ?? '').trim();
    const line_text = (row[4] ?? '').trim();

    // Skip header.
    if (i === 0 && deck.toLowerCase() === 'deck' && slideRaw.toLowerCase() === 'slide_number') continue;
    if (!item_name) continue;

    const slide = Number(slideRaw);
    const lineIdx = Number(lineIdxRaw);
    if (!Number.isFinite(slide)) {
      errors.push({ source_row_ref: `row:${i + 1}`, message: `unparseable slide_number "${slideRaw}"` });
      continue;
    }
    if (!Number.isFinite(lineIdx)) {
      errors.push({ source_row_ref: `row:${i + 1}`, message: `unparseable line_index "${lineIdxRaw}"` });
      continue;
    }

    const key = `${deck}::${slide}::${item_name}`;
    let acc = slides.get(key);
    if (!acc) {
      acc = { deck, slide_number: slide, item_name, lines: [], first_row_ref: `row:${i + 1}` };
      slides.set(key, acc);
    }
    // Drop title row (line_index 0) — it almost always duplicates item_name.
    if (lineIdx > 0 && line_text) {
      acc.lines.push({ line_index: lineIdx, line_text, source_row_ref: `row:${i + 1}` });
    }
  }

  const out: StagingPlatingNote[] = [];
  for (const slide of slides.values()) {
    if (slide.lines.length === 0) continue; // title-only / cover slides
    const ordered = slide.lines.slice().sort((a, b) => a.line_index - b.line_index);
    const plating_notes = ordered.map((l) => `• ${l.line_text}`).join('\n');
    out.push({
      staging_id: randomUUID(),
      source_row_ref: slide.first_row_ref,
      recipe_name: slide.item_name,
      section: slide.deck,
      plating_notes,
    });
  }

  return { rows: out, errors };
};

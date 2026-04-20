// portion_utensils_parser (§6.14 AC-3).
//
// Source: `Portion Control Utensils.docx`, re-exported as a CSV with columns:
//
//   utensil, uses, notes
//
// Row layout:
//   col0 = utensil display name (e.g., "Purple .75oz Scoop", "6oz Ladle")
//   col1 = comma-separated list of ingredient names that use this utensil at
//          the utensil's default qty (no per-ingredient override in source)
//   col2 = optional free-text note (e.g., cutting instructions for tips)
//
// Output strategy: emit one "default" row per utensil (no ingredient_name) so
// the canonical PortionUtensil + UtensilEquivalence default record can be
// created, plus one row per (utensil, ingredient) assignment so the review UI
// can confirm/edit each mapping. `override_qty` stays undefined — every
// assignment in the source uses the utensil's default size.

import { randomUUID } from 'node:crypto';
import type { Parser, ParseResult } from '../types.js';

export interface StagingPortionUtensil {
  staging_id: string;
  source_row_ref: string;
  utensil_name: string;
  kind: string;
  default_uom: string;
  default_qty: number;
  ingredient_name?: string;
  override_qty?: number;
  notes?: string;
}

interface ParsedUtensilName {
  kind: string;
  qty: number;
  uom: string;
}

// Recognised kinds, ordered by specificity so "Baseball Cap" (kind) is matched
// before generic "Cap"/"Scoop" tokens.
const KIND_PATTERNS: { re: RegExp; kind: string }[] = [
  { re: /baseball cap/i, kind: 'baseball_cap' },
  { re: /tri[- ]?tip squeeze bottle top/i, kind: 'squeeze_bottle_top_tri_tip' },
  { re: /pointed tip squeeze bottle top/i, kind: 'squeeze_bottle_top_pointed' },
  { re: /squeeze bottle/i, kind: 'squeeze_bottle' },
  { re: /metal dredge/i, kind: 'dredge_metal' },
  { re: /plastic dredge/i, kind: 'dredge_plastic' },
  { re: /dredge/i, kind: 'dredge' },
  { re: /scoop/i, kind: 'scoop' },
  { re: /ladle/i, kind: 'ladle' },
  { re: /spoodle/i, kind: 'spoodle' },
  { re: /portioner/i, kind: 'portioner' },
];

function classifyKind(name: string): string {
  for (const { re, kind } of KIND_PATTERNS) {
    if (re.test(name)) return kind;
  }
  return 'other';
}

// Pull "0.75oz", ".75oz", "2 oz", "5.3oz", "4 oz" out of names like
// "Purple .75oz Scoop", "Large Baseball Cap 4oz Scoop", "6oz Ladle".
function extractSize(name: string): { qty: number; uom: string } | null {
  const m = name.match(/(\d*\.?\d+)\s*(oz|ml|g)\b/i);
  if (!m) return null;
  const qty = Number(m[1]);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return { qty, uom: m[2]!.toLowerCase() };
}

function parseUtensilName(name: string): ParsedUtensilName {
  const kind = classifyKind(name);
  const size = extractSize(name);
  // Items without a numeric capacity (dredges, squeeze-bottle tops) default to
  // qty=1 / uom=count — they're tools, not measured portions. The review UI
  // can still attach them to ingredients.
  return {
    kind,
    qty: size?.qty ?? 1,
    uom: size?.uom ?? 'count',
  };
}

// Split "Daisy Cakes, Whipped Butter, Sour Cream" while preserving entries that
// contain parentheses (a few ingredient names include qualifiers). We split on
// commas only when not inside parens.
function splitUses(uses: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of uses) {
    if (ch === '(') { depth += 1; buf += ch; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); buf += ch; continue; }
    if (ch === ',' && depth === 0) {
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

export const portion_utensils_parser: Parser<readonly (readonly string[])[], StagingPortionUtensil> = (rows, _ctx) => {
  const errors: ParseResult<never>['errors'] = [];
  const out: StagingPortionUtensil[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const name = (row[0] ?? '').trim();
    if (!name) continue;

    // Skip header row.
    if (i === 0 && name.toLowerCase() === 'utensil') continue;
    // Defensive: skip duplicate header that some CSV exports include.
    if (name.toLowerCase() === 'utensil' && (row[1] ?? '').trim().toLowerCase() === 'uses') continue;

    if (seen.has(name.toLowerCase())) {
      errors.push({ source_row_ref: `row:${i + 1}`, message: `duplicate utensil "${name}"` });
      continue;
    }
    seen.add(name.toLowerCase());

    const { kind, qty, uom } = parseUtensilName(name);
    const notes = (row[2] ?? '').trim() || undefined;

    // Default row — establishes the utensil itself.
    out.push({
      staging_id: randomUUID(),
      source_row_ref: `row:${i + 1}`,
      utensil_name: name,
      kind,
      default_uom: uom,
      default_qty: qty,
      notes,
    });

    // One assignment row per ingredient that uses it at the default qty.
    const uses = splitUses(row[1] ?? '');
    for (const ingredient of uses) {
      out.push({
        staging_id: randomUUID(),
        source_row_ref: `row:${i + 1}`,
        utensil_name: name,
        kind,
        default_uom: uom,
        default_qty: qty,
        ingredient_name: ingredient,
      });
    }
  }

  return { rows: out, errors };
};

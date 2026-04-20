// TASK-046 — aloha_pmix_parser (§6.12a AC-2/3, §6.14 AC-3).
//
// Accepts Aloha PMIX rows as [header, ...rows]. Canonical columns:
//   business_date | name | qty_sold | net_sales | kind_hint
//
// Classification (§6.12a AC-3):
//   - rows whose `name` starts with "MOD:" → kind=modifier, modifier_of=<parent>
//   - rows where `qty_sold` is 0 AND `name` starts with "86" → stockout
//   - rows where `name` ∈ {COVER, COVERS, GUEST COUNT} → cover
//   - everything else → item

import { randomUUID } from 'node:crypto';
import type { Parser, ParseResult, StagingPosSale } from '../types.js';

export const aloha_pmix_parser: Parser<readonly (readonly string[])[], StagingPosSale> = (rows, _ctx) => {
  const errors: ParseResult<never>['errors'] = [];
  if (rows.length === 0) return { rows: [], errors: [] };

  const header = rows[0]!.map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  const idxDate = header.indexOf('business_date');
  const idxName = header.indexOf('name');
  const idxQty = header.indexOf('qty_sold');
  const idxNet = header.indexOf('net_sales');

  if (idxDate < 0 || idxName < 0 || idxQty < 0) {
    return {
      rows: [],
      errors: [{ source_row_ref: 'header', message: 'missing required columns: business_date, name, qty_sold' }],
    };
  }

  const out: StagingPosSale[] = [];
  let lastItem: string | null = null;

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    const name = (row[idxName] ?? '').trim();
    const businessDate = (row[idxDate] ?? '').trim();
    const qtyRaw = row[idxQty];
    const qty = qtyRaw == null || qtyRaw === '' ? NaN : Number(qtyRaw);
    if (!name || !businessDate) {
      errors.push({ source_row_ref: `row:${i + 1}`, message: 'empty name or business_date' });
      continue;
    }
    if (!Number.isFinite(qty)) {
      errors.push({ source_row_ref: `row:${i + 1}`, message: `invalid qty_sold: ${qtyRaw}` });
      continue;
    }

    const kind = classify(name, qty);
    const netRaw = idxNet >= 0 ? row[idxNet] : undefined;
    const netCents = netRaw == null || netRaw === '' ? 0 : Math.round(Number(netRaw) * 100);

    out.push({
      staging_id: randomUUID(),
      source_row_ref: `row:${i + 1}`,
      business_date: businessDate,
      menu_item_name: name.replace(/^MOD:\s*/i, '').replace(/^86\s*/i, '').trim(),
      qty_sold: qty,
      kind,
      modifier_of: kind === 'modifier' ? lastItem : null,
      net_sales_cents: Number.isFinite(netCents) ? netCents : 0,
    });
    if (kind === 'item') lastItem = name;
  }

  return { rows: out, errors };
};

function classify(name: string, qty: number): StagingPosSale['kind'] {
  const up = name.toUpperCase().trim();
  if (up.startsWith('MOD:')) return 'modifier';
  if (up.startsWith('86') && qty === 0) return 'stockout';
  if (up === 'COVER' || up === 'COVERS' || up === 'GUEST COUNT') return 'cover';
  return 'item';
}

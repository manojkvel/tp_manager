// TASK-047 — dedupe engine tests (§6.14 AC-5).

import { describe, it, expect } from 'vitest';
import { dedupe, nameSimilarity, normaliseName } from '../dedupe.js';

describe('normaliseName', () => {
  it('casefolds, strips punctuation, collapses whitespace', () => {
    expect(normaliseName('  Roma-Tomato!  ')).toBe('roma tomato');
    expect(normaliseName('Kale,  Red')).toBe('kale red');
  });
});

describe('nameSimilarity', () => {
  it('returns 1 for identical names', () => {
    expect(nameSimilarity('tomato', 'tomato')).toBe(1);
  });
  it('returns < 1 for near matches, > 0.8 for trivial typos', () => {
    expect(nameSimilarity('tomato', 'tomatoe')).toBeGreaterThan(0.8);
    expect(nameSimilarity('tomato', 'zebra')).toBeLessThan(0.4);
  });
  it('is punctuation- and case-insensitive', () => {
    expect(nameSimilarity('Roma Tomato!', 'roma tomato')).toBe(1);
  });
});

describe('dedupe bucketing (§6.14 AC-4)', () => {
  const catalogue = [
    { id: 'i-1', name: 'Roma Tomato', uom: 'kg' },
    { id: 'i-2', name: 'Grape Tomato', uom: 'kg' },
    { id: 'i-3', name: 'Organic Flour', uom: 'kg' },
  ];

  it('returns "new" when no candidates reach 0.4', () => {
    const out = dedupe({ name: 'Pineapple', uom: 'each' }, catalogue);
    expect(out.bucket).toBe('new');
  });

  it('returns "matched" with a single strong candidate', () => {
    const out = dedupe({ name: 'Roma Tomato', uom: 'kg' }, catalogue);
    expect(out.bucket).toBe('matched');
    expect(out.matches[0]!.id).toBe('i-1');
    expect(out.matches[0]!.agreements.some((a) => a.field === 'uom' && a.score === 1)).toBe(true);
  });

  it('returns "ambiguous" when 2+ candidates pass threshold', () => {
    // Both Roma/Grape Tomato score ~0.58 with matching uom — lower threshold
    // puts them both in the "confident" bucket.
    const out = dedupe({ name: 'Tomato', uom: 'kg' }, catalogue, { matchThreshold: 0.5 });
    expect(out.bucket).toBe('ambiguous');
    expect(out.matches.length).toBeGreaterThanOrEqual(2);
  });

  it('returns "unmapped" when only weak candidates exist', () => {
    // "Org Flour" is close to "Organic Flour" but not confident under the
    // default 0.8 threshold — plausible (> 0.4), so bucket=unmapped.
    const out = dedupe({ name: 'Org Flour', uom: 'kg' }, catalogue);
    expect(out.bucket).toBe('unmapped');
    expect(out.matches.length).toBeGreaterThan(0);
  });

  it('records field-level agreement for explainability (AC-5)', () => {
    const out = dedupe({ name: 'Roma Tomato', uom: 'kg' }, catalogue);
    const top = out.matches[0]!;
    const names = top.agreements.map((a) => a.field);
    expect(names).toContain('name');
    expect(names).toContain('uom');
  });
});

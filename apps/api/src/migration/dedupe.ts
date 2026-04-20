// TASK-047 — Dedupe engine + similarity scorer with field-level explanations.
//
// §6.14 AC-4/5: owner sees a review bucket (New / Matched / Ambiguous / Unmapped)
// with a confidence score and the fields that agreed. We keep the scorer pure
// so the review UI can re-run it on demand when the owner edits a candidate.

export interface CanonicalCandidate {
  id: string;
  name: string;
  uom?: string | null;
  supplier_id?: string | null;
}

export interface StagingProbe {
  name: string;
  uom?: string | null;
  supplier_id?: string | null;
}

export interface FieldAgreement {
  field: 'name' | 'uom' | 'supplier';
  probe: string;
  candidate: string;
  score: number; // 0..1
}

export interface MatchCandidate {
  id: string;
  score: number;
  agreements: FieldAgreement[];
}

export interface DedupeResult {
  bucket: 'new' | 'matched' | 'ambiguous' | 'unmapped';
  matches: MatchCandidate[];
}

export interface DedupeOpts {
  /** Score ≥ this → treated as a "confident" match. Default 0.8. */
  matchThreshold?: number;
  /** If exactly one candidate is above threshold → matched. Two+ → ambiguous. */
}

/** Normalise a name for comparison — casefold, collapse whitespace, drop punctuation. */
export function normaliseName(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Levenshtein-based similarity on normalised names. 1.0 = identical. */
export function nameSimilarity(a: string, b: string): number {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (na === nb) return 1;
  if (!na || !nb) return 0;
  const dist = levenshtein(na, nb);
  const longer = Math.max(na.length, nb.length);
  return longer === 0 ? 0 : 1 - dist / longer;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev: number[] = new Array(n + 1).fill(0).map((_, i) => i);
  const curr: number[] = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= n; j += 1) prev[j] = curr[j]!;
  }
  return prev[n]!;
}

/** Score a probe against candidates and bucket the result. */
export function dedupe(probe: StagingProbe, candidates: CanonicalCandidate[], opts: DedupeOpts = {}): DedupeResult {
  const threshold = opts.matchThreshold ?? 0.8;
  const scored: MatchCandidate[] = candidates.map((c) => {
    const agreements: FieldAgreement[] = [];
    const nameScore = nameSimilarity(probe.name, c.name);
    agreements.push({ field: 'name', probe: probe.name, candidate: c.name, score: nameScore });
    let score = nameScore * 0.7;
    if (probe.uom && c.uom && probe.uom === c.uom) {
      agreements.push({ field: 'uom', probe: probe.uom, candidate: c.uom, score: 1 });
      score += 0.2;
    } else if (probe.uom && c.uom) {
      agreements.push({ field: 'uom', probe: probe.uom, candidate: c.uom, score: 0 });
    }
    if (probe.supplier_id && c.supplier_id && probe.supplier_id === c.supplier_id) {
      agreements.push({ field: 'supplier', probe: probe.supplier_id, candidate: c.supplier_id, score: 1 });
      score += 0.1;
    }
    return { id: c.id, score: Math.min(1, score), agreements };
  });
  scored.sort((a, b) => b.score - a.score);

  const confident = scored.filter((s) => s.score >= threshold);
  if (confident.length === 0) {
    // Any weak matches at all? → unmapped if none plausible
    const plausible = scored.filter((s) => s.score >= 0.4);
    return { bucket: plausible.length === 0 ? 'new' : 'unmapped', matches: plausible };
  }
  if (confident.length === 1) return { bucket: 'matched', matches: confident };
  return { bucket: 'ambiguous', matches: confident };
}

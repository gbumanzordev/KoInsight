import type { P27Claim } from './wikidata-schemas';

// Algorithm per WD-03 + 03-RESEARCH §Gray Area 6:
// 1. Drop claims with rank === 'deprecated'.
// 2. Drop claims with qualifiers.P582 (any end-time qualifier = former citizenship).
// 3. Drop claims without datavalue (snaktype 'novalue' / 'somevalue').
// 4. If any preferred remain, restrict to preferred.
// 5. Return the first remaining claim's country QID; JSON preserves authoring order. Else null.
export function resolveP27Claim(claims: P27Claim[]): string | null {
  const candidates = claims.filter((c) => {
    if (c.rank === 'deprecated') return false;
    if (c.qualifiers?.P582 && c.qualifiers.P582.length > 0) return false;
    if (!c.mainsnak.datavalue) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  const preferred = candidates.filter((c) => c.rank === 'preferred');
  const chosen = (preferred.length > 0 ? preferred : candidates)[0];

  return chosen.mainsnak.datavalue?.value.id ?? null;
}

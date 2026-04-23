import { GENRE_ALIASES } from './aliases';
import { CANONICAL_GENRES, type CanonicalGenre } from './canonical';
import { SUBJECT_DENYLIST } from './denylist';

const normalize = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

// Module-level lookups built once at import time. Per-call cost is O(N * M)
// with O(1) Map/Set hits (N = subjects, M = fragments per subject).
const CANONICAL_LOOKUP: ReadonlyMap<string, CanonicalGenre> = new Map(
  CANONICAL_GENRES.map((g) => [normalize(g), g] as const)
);

const ALIAS_LOOKUP: ReadonlyMap<string, CanonicalGenre> = new Map(
  Object.entries(GENRE_ALIASES).map(([k, v]) => [normalize(k), v] as const)
);

const DENYLIST_NORMALIZED: ReadonlySet<string> = new Set(
  Array.from(SUBJECT_DENYLIST).map(normalize)
);

// Hierarchical "--" separator per CONTEXT D-10, widened to match no-space
// variants observed in real OL data (e.g., "Middle earth (imaginary place)--fiction").
// Appositional ", " separator uses the literal D-10 form. Hierarchical split runs
// first; fragments are then split on comma-space.
const DOUBLE_DASH_SPLIT = /\s*--\s*/;
const COMMA_SPACE_SPLIT = ', ';

function mapFragment(raw: string): CanonicalGenre | null {
  const key = normalize(raw);
  if (key === '') return null;
  if (DENYLIST_NORMALIZED.has(key)) return null;
  return CANONICAL_LOOKUP.get(key) ?? ALIAS_LOOKUP.get(key) ?? null;
}

/**
 * Map raw OpenLibrary subject strings to canonical genre names.
 *
 * Pure and synchronous. No I/O, no DB. Implements GENRE-02, GENRE-04 and
 * CONTEXT decisions D-07..D-12.
 *
 * - Normalization (D-08): trim + lowercase + whitespace collapse applied to
 *   every input fragment, canonical name, alias key, and denylist entry.
 * - Compound splitting (D-10): hierarchical `--` (with or without surrounding
 *   spaces, widened from the literal ` -- ` per real-data evidence) runs first,
 *   then appositional `, `. Each resulting fragment is mapped independently.
 * - Denylist (D-13, D-15): exact normalized match only; no substring, no regex.
 *   Machine-generated prefix tags (`nyt:...`, `collectionID:...`, `series:...`)
 *   and Dewey codes fall through silently because they match neither canonical
 *   nor alias nor denylist.
 * - Output (D-11): de-duplicated by canonical name, preserving first-hit order.
 * - Zero-match (D-12, GENRE-04): returns `[]`; a valid outcome, not an error.
 */
export function mapOpenLibrarySubjects(subjects: string[]): CanonicalGenre[] {
  const out: CanonicalGenre[] = [];
  const seen = new Set<CanonicalGenre>();
  for (const subject of subjects) {
    const fragments = subject.split(DOUBLE_DASH_SPLIT).flatMap((f) => f.split(COMMA_SPACE_SPLIT));
    for (const fragment of fragments) {
      const hit = mapFragment(fragment);
      if (hit && !seen.has(hit)) {
        seen.add(hit);
        out.push(hit);
      }
    }
  }
  return out;
}

// D-17 token-overlap acceptance over OL search candidates. Pure: no imports.
// Callers (Plan 04 applier, Plan 05 worker) pass an already-parsed OL
// `/search.json` docs array; we only touch the fields we need.
//
// Phase 8 D-05/D-06/D-07/D-08: matchWork now applies a strict-then-fuzzy
// pipeline. Strict path is the original token-overlap rule; if zero strict
// candidates pass, a fuzzy path runs (NFKD diacritic strip + subtitle split
// + Last,First swap + Dice >= 0.85). matchWork either returns a single
// MatcherCandidate or throws a domain error (AmbiguousMatchError when 2+
// pass on either path; NoMatchError when 0 pass on both paths).

export interface MatcherBook {
  title: string;
  authors: string | null;
}

export interface MatcherCandidate {
  title: string;
  author_name?: string[];
  key?: string;
  // REFPAGES-01: carried through from SearchDocSchema so Phase 7 worker can fetch
  // the matching OL Edition for number_of_pages.
  cover_edition_key?: string;
}

// D-05: named-error subclasses so retry.classifyFailure can branch on err.name
// without importing matcher.ts (preserves the dep graph). Mirrors
// http-errors.ts pattern.
export class AmbiguousMatchError extends Error {
  constructor(public readonly candidates: MatcherCandidate[]) {
    super(`ambiguous-match: ${candidates.length} candidates accepted`);
    this.name = 'AmbiguousMatchError';
  }
}

export class NoMatchError extends Error {
  constructor() {
    super('no-match after top-3 candidates');
    this.name = 'NoMatchError';
  }
}

// D-08: Dice coefficient threshold for fuzzy title acceptance.
export const DICE_THRESHOLD = 0.85;

export function normalizeTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.slice(i, i + 2);
    m.set(bg, (m.get(bg) ?? 0) + 1);
  }
  return m;
}

// D-08: Dice-Sorensen coefficient on character bigrams. 1 for identical
// strings; 0 when either input has fewer than 2 bigrams (Pitfall 3:
// short-string fallback so single-character inputs do not divide by zero
// and so 1-character titles never produce a misleading score of 1).
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  // Pitfall 3: < 2 bigrams means the bigram set is too small to be meaningful.
  // bigrams(s).size <= s.length - 1, so length < 3 implies < 2 bigrams.
  if (a.length < 3 || b.length < 3) return 0;
  const aBg = bigrams(a);
  const bBg = bigrams(b);
  let intersection = 0;
  for (const [bg, count] of aBg) {
    const other = bBg.get(bg);
    if (other !== undefined) intersection += Math.min(count, other);
  }
  const total = a.length - 1 + (b.length - 1);
  return (2 * intersection) / total;
}

function stripDiacritics(s: string): string {
  // Pitfall 1: /u flag is mandatory for \p{M} to compile under Unicode mode.
  return s.normalize('NFKD').replace(/\p{M}+/gu, '');
}

function stripSubtitle(s: string): string {
  // D-07: split on first ':' or ' — ' (em-dash with surrounding spaces) or ' - '.
  const m = s.match(/^(.*?)(?::| — | - )/);
  return (m ? m[1] : s).trim();
}

// D-07: lower + strip-diacritics + strip-subtitle + trim. Output is the
// canonical form used by both sides of diceCoefficient.
export function normalizeTitleForFuzzy(title: string): string {
  return stripDiacritics(stripSubtitle(title)).toLowerCase().trim();
}

// D-07: handle "Last, First" -> "First Last". Returns null when there is
// no comma or when either side of the split is empty (so caller can fall
// back to the original author string without a swap).
export function swapLastFirst(author: string): string | null {
  if (!author.includes(',')) return null;
  const parts = author.split(',', 2).map((s) => s.trim());
  const last = parts[0];
  const first = parts[1];
  if (!first || !last) return null;
  return `${first} ${last}`;
}

// Strict path predicate (preserved verbatim from pre-Phase-8 matchWork body).
// Token-overlap rule: every book-title token appears in the candidate title,
// and at least one book-author token overlaps a candidate-author token.
function strictPasses(
  bookTitleTokens: string[],
  bookAuthorTokens: string[],
  candidate: MatcherCandidate
): boolean {
  const candTitleTokens = new Set(normalizeTokens(candidate.title));
  const titlePass = bookTitleTokens.every((t) => candTitleTokens.has(t));
  if (!titlePass) return false;

  const candAuthorTokens = new Set(
    (candidate.author_name ?? []).flatMap((n) => normalizeTokens(n))
  );
  return bookAuthorTokens.some((t) => candAuthorTokens.has(t));
}

// Fuzzy path author-match: accept if any candidate author tokenizes to a
// superset of the book-author tokens after normalization. Uses normalizeTokens
// so the comparison is symmetric with the strict path's existing semantics.
function fuzzyAuthorMatch(authorString: string, candidate: MatcherCandidate): boolean {
  const bookAuthorTokens = normalizeTokens(authorString);
  if (bookAuthorTokens.length === 0) return false;
  const candAuthorTokens = new Set(
    (candidate.author_name ?? []).flatMap((n) => normalizeTokens(n))
  );
  return bookAuthorTokens.every((t) => candAuthorTokens.has(t));
}

// D-05/D-06: strict-then-fuzzy. matchWork now ALWAYS either returns a
// MatcherCandidate or throws AmbiguousMatchError / NoMatchError. The legacy
// `null` return is gone; callers (worker.ts) catch the named errors so
// classifyFailure can map them to the structured failure_reason per D-03.
export function matchWork(book: MatcherBook, candidates: MatcherCandidate[]): MatcherCandidate {
  const top3 = candidates.slice(0, 3);
  const bookTitleTokens = normalizeTokens(book.title);
  const primaryAuthor = (book.authors ?? '').split(',')[0] ?? '';
  const bookAuthorTokens = normalizeTokens(primaryAuthor);

  // STRICT path — preserves the original D-17 contract verbatim.
  // Without any author tokens we cannot pass the AUTHOR rule on the strict
  // path; fall straight through to the fuzzy path so the swap-Last,First
  // helper still has a chance to recover the author.
  const strictHits =
    bookAuthorTokens.length > 0
      ? top3.filter((c) => strictPasses(bookTitleTokens, bookAuthorTokens, c))
      : [];
  if (strictHits.length === 1) return strictHits[0];
  if (strictHits.length >= 2) throw new AmbiguousMatchError(strictHits);

  // FUZZY path — D-06 / D-08.
  const normBookTitle = normalizeTitleForFuzzy(book.title);
  const swappedAuthor = swapLastFirst(book.authors ?? '');
  const fuzzyHits = top3.filter((c) => {
    const titleScore = diceCoefficient(normBookTitle, normalizeTitleForFuzzy(c.title));
    if (titleScore < DICE_THRESHOLD) return false;
    if (fuzzyAuthorMatch(book.authors ?? '', c)) return true;
    if (swappedAuthor !== null && fuzzyAuthorMatch(swappedAuthor, c)) return true;
    return false;
  });
  if (fuzzyHits.length === 1) return fuzzyHits[0];
  if (fuzzyHits.length >= 2) throw new AmbiguousMatchError(fuzzyHits);

  throw new NoMatchError();
}

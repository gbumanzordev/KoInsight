// D-17 token-overlap acceptance over OL search candidates. Pure: no imports.
// Callers (Plan 04 applier, Plan 05 worker) pass an already-parsed OL
// `/search.json` docs array; we only touch the fields we need.

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

export function normalizeTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

export function matchWork(
  book: MatcherBook,
  candidates: MatcherCandidate[]
): MatcherCandidate | null {
  const bookTitleTokens = normalizeTokens(book.title);
  const primaryAuthor = (book.authors ?? '').split(',')[0] ?? '';
  const bookAuthorTokens = normalizeTokens(primaryAuthor);

  // D-16 step 2 bail: without any author tokens, we cannot pass the AUTHOR rule.
  if (bookAuthorTokens.length === 0) {
    return null;
  }

  for (const candidate of candidates.slice(0, 3)) {
    const candTitleTokens = new Set(normalizeTokens(candidate.title));
    const titlePass = bookTitleTokens.every((t) => candTitleTokens.has(t));
    if (!titlePass) continue;

    const candAuthorTokens = new Set(
      (candidate.author_name ?? []).flatMap((n) => normalizeTokens(n))
    );
    const authorPass = bookAuthorTokens.some((t) => candAuthorTokens.has(t));
    if (authorPass) return candidate;
  }
  return null;
}

import { createBreaker } from '../enrichment/http/circuit-breaker';
import { sharedHttpLimiter } from '../enrichment/http/rate-limiter';
import type { HttpDeps } from '../enrichment/http/typed-fetch';
import { typedFetch } from '../enrichment/http/typed-fetch';
import { USER_AGENT } from '../enrichment/http/user-agent';
import {
  AuthorSchema,
  EditionSchema,
  type OpenLibraryAuthor,
  type OpenLibraryEdition,
  type OpenLibrarySearchResult,
  type OpenLibraryWork,
  SearchResultSchema,
  WorkSchema,
} from './open-library-schemas';

// Reuse the existing base constant from open-library-service.ts (Pattern A in 03-PATTERNS.md)
// by re-declaring it locally; cross-file import would require refactoring the legacy covers service.
const OPEN_LIBRARY_API = 'https://openlibrary.org';

// Normalize keys: accept '/works/OL82563W', 'works/OL82563W', or 'OL82563W'.
// SSRF guard (T-03-01): reject segments containing '/' or '..' beyond the expected prefix.
function normalizePath(
  raw: string,
  expectedPrefix: '/works/' | '/books/' | '/authors/' | '/isbn/'
): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith(expectedPrefix)) {
    const tail = trimmed.slice(expectedPrefix.length);
    if (tail.includes('/') || tail.includes('..')) {
      throw new Error(`Invalid path segment: ${raw}`);
    }
    return trimmed;
  }
  if (trimmed.includes('/') || trimmed.includes('..')) {
    throw new Error(`Invalid path segment: ${raw}`);
  }
  return `${expectedPrefix}${trimmed}`;
}

// Instance class (deviation from static-class convention per 03-PATTERNS.md §Cross-cutting Note 1)
// justified by DI of limiter/breaker for tests. A default module-level singleton is exported below
// for prod code; tests construct their own with fake deps.
export class OpenLibraryClient {
  constructor(private readonly deps: HttpDeps) {}

  async searchWork(title: string, author?: string, limit = 5): Promise<OpenLibrarySearchResult> {
    const params = new URLSearchParams({
      title,
      limit: String(limit),
      fields: 'key,title,author_name,author_key,first_publish_year,isbn,cover_i',
    });
    if (author) params.set('author', author);
    return typedFetch(`${OPEN_LIBRARY_API}/search.json?${params}`, SearchResultSchema, this.deps);
  }

  async getWork(workKey: string): Promise<OpenLibraryWork> {
    const path = normalizePath(workKey, '/works/');
    return typedFetch(`${OPEN_LIBRARY_API}${path}.json`, WorkSchema, this.deps);
  }

  async getEdition(editionKey: string): Promise<OpenLibraryEdition> {
    // Edition keys may start with /books/ or /isbn/ (the latter 302-redirects to a /books/... edition).
    // fetch follows redirects by default.
    const trimmed = editionKey.trim();
    if (trimmed.startsWith('/isbn/')) {
      const tail = trimmed.slice('/isbn/'.length);
      if (tail.includes('/') || tail.includes('..')) {
        throw new Error(`Invalid ISBN path segment: ${editionKey}`);
      }
      return typedFetch(`${OPEN_LIBRARY_API}${trimmed}.json`, EditionSchema, this.deps);
    }
    const path = normalizePath(editionKey, '/books/');
    return typedFetch(`${OPEN_LIBRARY_API}${path}.json`, EditionSchema, this.deps);
  }

  async getAuthor(authorKey: string): Promise<OpenLibraryAuthor> {
    const path = normalizePath(authorKey, '/authors/');
    return typedFetch(`${OPEN_LIBRARY_API}${path}.json`, AuthorSchema, this.deps);
  }
}

// Module-level default singleton wired to shared infrastructure.
// The breaker wraps a pass-through action (opossum binds the action at construction, so this is the
// pattern from typed-fetch.ts: a single breaker whose action defers to whatever function is given).
const sharedBreakerInstance = createBreaker(async (action: () => Promise<unknown>) => action());

export const openLibraryClient = new OpenLibraryClient({
  limiter: sharedHttpLimiter,
  breaker: sharedBreakerInstance as HttpDeps['breaker'],
  userAgent: USER_AGENT,
});

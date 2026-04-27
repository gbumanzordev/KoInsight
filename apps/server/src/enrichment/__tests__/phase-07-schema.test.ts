import { describe, expect, it, vi, afterEach } from 'vitest';
import { createBreaker } from '../http/circuit-breaker';
import { createLimiter } from '../http/rate-limiter';
import type { HttpDeps } from '../http/typed-fetch';
import { OpenLibraryClient } from '../../open-library/open-library-client';
import { SearchDocSchema } from '../../open-library/open-library-schemas';
import searchWithKeyFixture from './fixtures/search-ender-with-edition-key.json';
import searchPlainFixture from './fixtures/search-ender.json';

function makeClient(): { client: OpenLibraryClient; fetchMock: ReturnType<typeof vi.fn> } {
  const limiter = createLimiter({ minTime: 0, maxConcurrent: 1 });
  const breaker = createBreaker(async (action: () => Promise<unknown>) => action());
  const deps: HttpDeps = {
    limiter,
    breaker: breaker as HttpDeps['breaker'],
    userAgent: 'TestAgent/1.0 (test)',
  };
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  return { client: new OpenLibraryClient(deps), fetchMock };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Phase 7: SearchDocSchema cover_edition_key', () => {
  it('preserves cover_edition_key when input contains it (REFPAGES-01)', () => {
    const doc = searchWithKeyFixture.docs[0];
    const parsed = SearchDocSchema.parse(doc);
    expect(parsed.cover_edition_key).toBe('/books/OL7641985M');
  });

  it('returns cover_edition_key undefined (no throw) when input omits it', () => {
    const doc = searchPlainFixture.docs[0];
    const parsed = SearchDocSchema.parse(doc);
    expect(parsed.cover_edition_key).toBeUndefined();
  });

  it('searchWork includes cover_edition_key in fields query param', async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue(jsonResponse(searchWithKeyFixture));
    await client.searchWork("Ender's Game", 'Orson Scott Card');
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('cover_edition_key');
  });
});

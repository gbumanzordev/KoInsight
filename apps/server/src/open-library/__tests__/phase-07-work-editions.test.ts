import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBreaker } from '../../enrichment/http/circuit-breaker';
import { createLimiter } from '../../enrichment/http/rate-limiter';
import type { HttpDeps } from '../../enrichment/http/typed-fetch';
import { OpenLibraryClient } from '../open-library-client';

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

describe('Phase 7: OpenLibraryClient.getWorkEditions (D-09 option b)', () => {
  it('hits /works/{key}/editions.json?limit=1 and returns parsed entries', async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue(
      jsonResponse({ entries: [{ key: '/books/OL7641985M' }] })
    );

    const result = await client.getWorkEditions('/works/OL27448W');

    expect(result.entries).toEqual([{ key: '/books/OL7641985M' }]);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://openlibrary.org/works/OL27448W/editions.json?limit=1');
  });

  it('defaults entries to [] when OL response omits entries (Zod default)', async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue(jsonResponse({}));

    const result = await client.getWorkEditions('/works/OL27448W');

    expect(result.entries).toEqual([]);
  });

  it('strips unknown fields on entries (Zod default behavior)', async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue(
      jsonResponse({ entries: [{ key: '/books/OLx', random_extra: 'ignored' }] })
    );

    const result = await client.getWorkEditions('/works/OLAAAW');

    expect(result.entries[0].key).toBe('/books/OLx');
    expect((result.entries[0] as Record<string, unknown>).random_extra).toBeUndefined();
  });

  it('accepts bare work key without leading /works/ prefix', async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue(jsonResponse({ entries: [] }));

    await client.getWorkEditions('OL27448W');

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://openlibrary.org/works/OL27448W/editions.json?limit=1');
  });
});

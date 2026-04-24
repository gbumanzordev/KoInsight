import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBreaker } from '../../enrichment/http/circuit-breaker';
import { createLimiter } from '../../enrichment/http/rate-limiter';
import type { HttpDeps } from '../../enrichment/http/typed-fetch';
import authorRowlingFixture from '../fixtures/author-OL23919A.json';
import authorNoRemoteFixture from '../fixtures/author-no-remote-ids.json';
import editionEmptySubjectsFixture from '../fixtures/edition-empty-subjects.json';
import editionFixture from '../fixtures/edition-OL7353617M.json';
import searchFixture from '../fixtures/search-hp-rowling.json';
import workFixture from '../fixtures/work-OL82563W.json';
import workWithSubjectsFixture from '../fixtures/work-with-subjects.json';
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

describe(OpenLibraryClient, () => {
  describe(OpenLibraryClient.prototype.searchWork, () => {
    it('returns Zod-parsed search result (OL-01)', async () => {
      const { client, fetchMock } = makeClient();
      fetchMock.mockResolvedValue(jsonResponse(searchFixture));
      const result = await client.searchWork('Harry Potter', 'Rowling');
      expect(result.numFound).toBeGreaterThan(0);
      expect(result.docs[0].key).toMatch(/^\/works\/OL[0-9]+W$/);
    });

    it('sends User-Agent header on every request (OL-02)', async () => {
      const { client, fetchMock } = makeClient();
      fetchMock.mockResolvedValue(jsonResponse(searchFixture));
      await client.searchWork('anything');
      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers['User-Agent']).toBe('TestAgent/1.0 (test)');
      expect(init.headers.Accept).toBe('application/json');
    });

    it('builds search URL with title, author, limit, fields query params', async () => {
      const { client, fetchMock } = makeClient();
      fetchMock.mockResolvedValue(jsonResponse(searchFixture));
      await client.searchWork('Dune', 'Herbert', 3);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('title=Dune');
      expect(url).toContain('author=Herbert');
      expect(url).toContain('limit=3');
      expect(url).toContain('fields=');
    });
  });

  describe(OpenLibraryClient.prototype.getWork, () => {
    it('fetches work by /works/OL..W path (OL-01)', async () => {
      const { client, fetchMock } = makeClient();
      fetchMock.mockResolvedValue(jsonResponse(workFixture));
      const work = await client.getWork('/works/OL82563W');
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('https://openlibrary.org/works/OL82563W.json');
      expect(work.key).toBeDefined();
    });

    it('accepts bare work ID without prefix', async () => {
      const { client, fetchMock } = makeClient();
      fetchMock.mockResolvedValue(jsonResponse(workFixture));
      await client.getWork('OL82563W');
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('https://openlibrary.org/works/OL82563W.json');
    });

    it('rejects path segments containing / or .. (SSRF guard - T-03-01)', async () => {
      const { client } = makeClient();
      await expect(client.getWork('OL82563W/../../../etc/passwd')).rejects.toThrow(
        /Invalid path segment/
      );
    });
  });

  describe(OpenLibraryClient.prototype.getEdition, () => {
    it('fetches edition by /books/OL..M path', async () => {
      const { client, fetchMock } = makeClient();
      fetchMock.mockResolvedValue(jsonResponse(editionFixture));
      const edition = await client.getEdition('/books/OL7353617M');
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('https://openlibrary.org/books/OL7353617M.json');
      expect(edition.works[0].key).toMatch(/^\/works\//);
    });

    it('fetches edition by /isbn/... path (ISBN resolution)', async () => {
      const { client, fetchMock } = makeClient();
      fetchMock.mockResolvedValue(jsonResponse(editionFixture));
      await client.getEdition('/isbn/9780747532743');
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('https://openlibrary.org/isbn/9780747532743.json');
    });
  });

  describe('OL-05: subjects come from Work, not Edition', () => {
    it('when Edition.subjects is empty and Work.subjects is populated, the Work response carries the subjects', async () => {
      const { client, fetchMock } = makeClient();
      // Sequence: caller fetches edition first, then follows edition.works[0].key to the work.
      fetchMock
        .mockResolvedValueOnce(jsonResponse(editionEmptySubjectsFixture))
        .mockResolvedValueOnce(jsonResponse(workWithSubjectsFixture));

      const edition = await client.getEdition('/books/OLTESTEDITIONM');
      expect(edition.subjects).toEqual([]); // Edition carries no subjects

      const workKey = edition.works[0].key;
      const work = await client.getWork(workKey);
      expect(work.subjects).toEqual(['Science fiction', 'Space opera', 'Fiction']);
      expect(work.subjects.length).toBeGreaterThan(0);
    });
  });

  describe(OpenLibraryClient.prototype.getAuthor, () => {
    it('returns Zod-parsed author with remote_ids.wikidata (OL-01)', async () => {
      const { client, fetchMock } = makeClient();
      fetchMock.mockResolvedValue(jsonResponse(authorRowlingFixture));
      const author = await client.getAuthor('/authors/OL23919A');
      expect(author.name).toBeDefined();
      expect(author.remote_ids?.wikidata).toMatch(/^Q[0-9]+$/);
    });

    it('parses author with plain-string bio and no remote_ids without throwing (Pitfall 6 + WD-04 precursor)', async () => {
      const { client, fetchMock } = makeClient();
      fetchMock.mockResolvedValue(jsonResponse(authorNoRemoteFixture));
      const author = await client.getAuthor('/authors/OLNOWDA');
      expect(author.name).toBe('Plain Bio Author');
      expect(author.remote_ids?.wikidata).toBeUndefined();
      expect(typeof author.bio === 'string' || author.bio === undefined).toBe(true);
    });
  });
});

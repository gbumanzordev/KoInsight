import { afterEach, describe, expect, it, vi } from 'vitest';
import authorFixture from '../../open-library/fixtures/author-OL23919A.json';
import editionEmptySubjectsFixture from '../../open-library/fixtures/edition-empty-subjects.json';
import searchFixture from '../../open-library/fixtures/search-hp-rowling.json';
import workWithSubjectsFixture from '../../open-library/fixtures/work-with-subjects.json';
import { OpenLibraryClient } from '../../open-library/open-library-client';
import { createBreaker } from '../http/circuit-breaker';
import { createLimiter } from '../http/rate-limiter';
import type { HttpDeps } from '../http/typed-fetch';
import { USER_AGENT } from '../http/user-agent';
import { WikidataClient } from '../wikidata/wikidata-client';

function makeClients(): {
  ol: OpenLibraryClient;
  wd: WikidataClient;
  fetchMock: ReturnType<typeof vi.fn>;
} {
  const limiter = createLimiter({ minTime: 0, maxConcurrent: 1 });
  const breaker = createBreaker(async (action: () => Promise<unknown>) => action());
  const deps: HttpDeps = {
    limiter,
    breaker: breaker as HttpDeps['breaker'],
    userAgent: USER_AGENT,
  };
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  return { ol: new OpenLibraryClient(deps), wd: new WikidataClient(deps), fetchMock };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('Phase 3 end-to-end fixture integration', () => {
  it('simulates an enrichment chain: search -> edition (empty subjects) -> work (OL-05 subjects) -> author -> nationality', async () => {
    const { ol, wd, fetchMock } = makeClients();

    // Step 1: search. The fixture may or may not have docs depending on what was captured; we only
    // assert the search call happens and returns a Zod-parsed shape.
    fetchMock
      .mockResolvedValueOnce(jsonResponse(searchFixture))
      // Step 2: getEdition returns empty subjects.
      .mockResolvedValueOnce(jsonResponse(editionEmptySubjectsFixture))
      // Step 3: getWork (followed from edition.works[0].key) returns populated subjects — OL-05.
      .mockResolvedValueOnce(jsonResponse(workWithSubjectsFixture))
      // Step 4: getAuthor returns an author with remote_ids.wikidata.
      .mockResolvedValueOnce(jsonResponse(authorFixture));

    const search = await ol.searchWork('Harry Potter', 'Rowling', 3);
    expect(search).toBeDefined();
    expect(Array.isArray(search.docs)).toBe(true);

    const edition = await ol.getEdition('/books/OLTESTEDITIONM');
    expect(edition.subjects).toEqual([]); // OL-05 precondition: Edition carries no subjects

    const work = await ol.getWork(edition.works[0].key);
    expect(work.subjects.length).toBeGreaterThan(0); // OL-05: subjects come from Work
    expect(work.subjects).toContain('Science fiction');

    const author = await ol.getAuthor('/authors/OL23919A');
    expect(author.name).toBeDefined();
    const wikidataQid = author.remote_ids?.wikidata;
    expect(wikidataQid).toMatch(/^Q[0-9]+$/);

    // Step 5: resolve nationality via Wikidata. For determinism, mock the Wikidata fetch
    // returning a P27 claim pointing at Q145 (UK), which is pre-cached in country-codes ->
    // exactly one Wikidata fetch is needed (cache hit on country code).
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        entities: {
          [wikidataQid!]: {
            id: wikidataQid!,
            claims: {
              P27: [
                {
                  mainsnak: {
                    snaktype: 'value',
                    property: 'P27',
                    datavalue: { value: { id: 'Q145' }, type: 'wikibase-entityid' },
                  },
                  rank: 'normal',
                },
              ],
            },
          },
        },
      })
    );
    const nationality = await wd.resolveP27Nationality(wikidataQid!);
    expect(nationality).toBe('GB'); // Q145 -> GB per country-codes seed

    // WD-05 by extension: both clients drew from the same limiter passed in deps.
    // (Stronger invariant test lives in phase-03-shared-limiter.test.ts.)
  });

  it('produces a final bundle an enrichment worker could persist (shape check, no DB write)', async () => {
    const { ol, fetchMock } = makeClients();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(editionEmptySubjectsFixture))
      .mockResolvedValueOnce(jsonResponse(workWithSubjectsFixture))
      .mockResolvedValueOnce(jsonResponse(authorFixture));

    const edition = await ol.getEdition('/books/OLTESTEDITIONM');
    const work = await ol.getWork(edition.works[0].key);
    const author = await ol.getAuthor('/authors/OL23919A');

    // Shape an enrichment-service-shaped DTO. Phase 4 will define the real type; this assertion
    // proves the building blocks compose.
    const bundle = {
      work_key: work.key,
      subjects_raw: work.subjects, // OL-05: from Work, NOT from edition
      publish_date: edition.publish_date ?? null,
      languages: edition.languages?.map((l) => l.key) ?? [],
      author_name: author.name,
      author_wikidata_qid: author.remote_ids?.wikidata ?? null,
    };

    expect(bundle.subjects_raw.length).toBeGreaterThan(0);
    expect(bundle.work_key).toBeDefined();
    expect(bundle.author_name).toBeDefined();
  });
});

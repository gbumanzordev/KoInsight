import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBreaker } from '../../http/circuit-breaker';
import { createLimiter } from '../../http/rate-limiter';
import type { HttpDeps } from '../../http/typed-fetch';
import entityEndTime from '../fixtures/entity-end-time.json';
import entityHistoricalUSSR from '../fixtures/entity-historical-ussr.json';
import entityNoP27 from '../fixtures/entity-no-p27.json';
import entityPreferred from '../fixtures/entity-preferred.json';
import entityQ30 from '../fixtures/entity-Q30.json';
import { WikidataClient } from '../wikidata-client';

function makeClient(): { client: WikidataClient; fetchMock: ReturnType<typeof vi.fn> } {
  const limiter = createLimiter({ minTime: 0, maxConcurrent: 1 });
  const breaker = createBreaker(async (action: () => Promise<unknown>) => action());
  const deps: HttpDeps = {
    limiter,
    breaker: breaker as HttpDeps['breaker'],
    userAgent: 'TestAgent/1.0 (test)',
  };
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  return { client: new WikidataClient(deps), fetchMock };
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

describe(WikidataClient, () => {
  describe(WikidataClient.prototype.getEntity, () => {
    it('fetches the Wikidata EntityData URL for a valid QID (WD-01)', async () => {
      const { client, fetchMock } = makeClient();
      fetchMock.mockResolvedValue(jsonResponse(entityQ30));
      await client.getEntity('Q30');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://www.wikidata.org/wiki/Special:EntityData/Q30.json');
      expect(init.headers['User-Agent']).toBe('TestAgent/1.0 (test)'); // WD-05 UA parity
    });

    it('rejects invalid QID (SSRF guard)', async () => {
      const { client } = makeClient();
      await expect(client.getEntity('Q30/../secret')).rejects.toThrow(/Invalid Wikidata QID/);
    });
  });

  describe(WikidataClient.prototype.resolveP27Nationality, () => {
    it('returns alpha-2 when preferred claim resolves to a cached country QID (Q183 -> DE)', async () => {
      // entity-preferred selects Q183; Q183 is pre-seeded in country-codes as 'DE', single fetch only.
      const { client, fetchMock } = makeClient();
      fetchMock.mockResolvedValueOnce(jsonResponse(entityPreferred));
      const result = await client.resolveP27Nationality('Q9001');
      expect(result).toBe('DE');
      expect(fetchMock).toHaveBeenCalledTimes(1); // cache hit, no P297 fetch
    });

    it('returns null when author has zero P27 claims (WD-04)', async () => {
      const { client, fetchMock } = makeClient();
      fetchMock.mockResolvedValueOnce(jsonResponse(entityNoP27));
      const result = await client.resolveP27Nationality('Q9002');
      expect(result).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('drops end-time P27 and returns alpha-2 of surviving claim (Q145 -> GB)', async () => {
      const { client, fetchMock } = makeClient();
      fetchMock.mockResolvedValueOnce(jsonResponse(entityEndTime));
      const result = await client.resolveP27Nationality('Q9003');
      expect(result).toBe('GB'); // Q145 is pre-seeded
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns null for historical-entity P27 (USSR Q15180), D-03', async () => {
      // P27 resolver returns Q15180. Q15180 is NOT pre-seeded, cache miss, live P297 fetch on
      // a USSR-like entity with no P297 claim, returns null.
      const { client, fetchMock } = makeClient();
      fetchMock
        .mockResolvedValueOnce(jsonResponse(entityHistoricalUSSR))
        .mockResolvedValueOnce(
          jsonResponse({ entities: { Q15180: { id: 'Q15180', claims: {} } } })
        );
      const result = await client.resolveP27Nationality('Q9004');
      expect(result).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2); // entity fetch + failed P297 lookup
    });

    it('on cache miss for a modern country, fetches P297 and populates cache', async () => {
      const { client, fetchMock } = makeClient();
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            entities: {
              Q9007: {
                id: 'Q9007',
                claims: {
                  P27: [
                    {
                      mainsnak: {
                        snaktype: 'value',
                        property: 'P27',
                        datavalue: { value: { id: 'Q9008' }, type: 'wikibase-entityid' },
                      },
                      rank: 'normal',
                    },
                  ],
                },
              },
            },
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            entities: {
              Q9008: {
                id: 'Q9008',
                claims: {
                  P297: [{ mainsnak: { snaktype: 'value', datavalue: { value: 'XX' } } }],
                },
              },
            },
          })
        );
      const result = await client.resolveP27Nationality('Q9007');
      expect(result).toBe('XX');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});

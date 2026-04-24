import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLibraryClient } from '../../open-library/open-library-client';
import { sharedHttpLimiter } from '../http/rate-limiter';
import { wikidataClient } from '../wikidata/wikidata-client';

describe('Phase 3 shared-limiter invariant (WD-05)', () => {
  it('openLibraryClient and wikidataClient hold the same Bottleneck instance', () => {
    // Private-field access via bracket index; acceptable for cross-module invariant tests.
    // Both singletons MUST have been constructed with sharedHttpLimiter per Plans 03-03 and 03-04.
    const olLimiter = (openLibraryClient as unknown as { deps: { limiter: unknown } }).deps.limiter;
    const wdLimiter = (wikidataClient as unknown as { deps: { limiter: unknown } }).deps.limiter;
    expect(olLimiter).toBe(sharedHttpLimiter);
    expect(wdLimiter).toBe(sharedHttpLimiter);
    expect(olLimiter).toBe(wdLimiter);
  });
});

// Timed integration: prove rate limiting is actively one-pipe across BOTH services by scheduling
// 10 alternating OL + WD work items on a short-minTime limiter (to keep the test fast). We cannot
// use the production sharedHttpLimiter here (its minTime is 1000ms; test would take >=9s and be
// flaky on CI). Instead, construct a fresh limiter and inject it into fresh client instances,
// asserting the pipeline behavior is a property of the *limiter mechanism*, not an ad-hoc singleton
// quirk.
describe('Phase 3 timed limiter integration (OL-03 + WD-05 mechanism)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('10 alternating calls via one shared limiter take >= 9 * minTime', async () => {
    // Lazy import to construct fresh clients with a test-local limiter.
    const { createLimiter } = await import('../http/rate-limiter');
    const { createBreaker } = await import('../http/circuit-breaker');
    const { USER_AGENT } = await import('../http/user-agent');
    const { OpenLibraryClient } = await import('../../open-library/open-library-client');
    const { WikidataClient } = await import('../wikidata/wikidata-client');

    const minTime = 50; // ms
    const limiter = createLimiter({ minTime, maxConcurrent: 1 });
    const breaker = createBreaker(async (action: () => Promise<unknown>) => action());
    const deps = { limiter, breaker: breaker as never, userAgent: USER_AGENT };
    const ol = new OpenLibraryClient(deps);
    const wd = new WikidataClient(deps);

    // Stub fetch with fast JSON response. We do NOT care about payload correctness for this test;
    // use schema-satisfying stubs keyed by URL.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('openlibrary.org/search.json')) {
          return Promise.resolve(
            new Response(JSON.stringify({ numFound: 0, docs: [] }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          );
        }
        // Wikidata entity shape
        return Promise.resolve(
          new Response(JSON.stringify({ entities: { Q30: { id: 'Q30', claims: {} } } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        );
      })
    );

    const start = Date.now();
    const jobs: Promise<unknown>[] = [];
    for (let i = 0; i < 5; i += 1) {
      jobs.push(ol.searchWork(`title-${i}`));
      jobs.push(wd.getEntity('Q30'));
    }
    await Promise.all(jobs);
    const elapsed = Date.now() - start;

    // 10 calls separated by minTime between each => 9 intervals => >= 9 * minTime,
    // with CI jitter tolerance.
    expect(elapsed).toBeGreaterThanOrEqual(9 * minTime * 0.85); // 15% tolerance
  });
});

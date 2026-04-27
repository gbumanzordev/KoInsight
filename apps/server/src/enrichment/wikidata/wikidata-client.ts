import { createBreaker } from '../http/circuit-breaker';
import { sharedHttpLimiter } from '../http/rate-limiter';
import type { HttpDeps } from '../http/typed-fetch';
import { typedFetch } from '../http/typed-fetch';
import { USER_AGENT } from '../http/user-agent';
import { cacheCountryQidAlpha2, countryQidToAlpha2 } from './country-codes';
import { resolveP27Claim } from './p27-resolver';
import { type WikidataEntity, WikidataEntitySchema } from './wikidata-schemas';

const WIKIDATA_API = 'https://www.wikidata.org';

function normalizeQid(raw: string): string {
  const trimmed = raw.trim();
  if (!/^Q[0-9]+$/.test(trimmed)) {
    throw new Error(`Invalid Wikidata QID: ${raw}`);
  }
  return trimmed;
}

export class WikidataClient {
  constructor(private readonly deps: HttpDeps) {}

  async getEntity(qid: string): Promise<WikidataEntity> {
    const safeQid = normalizeQid(qid);
    // Per 03-RESEARCH §Gray Area 3: use EntityData (not ?flavor=simple) because we need P582 qualifiers.
    return typedFetch(
      `${WIKIDATA_API}/wiki/Special:EntityData/${safeQid}.json`,
      WikidataEntitySchema,
      this.deps
    );
  }

  // Per WD-01..WD-04:
  // - Fetch entity.
  // - Run P27 resolver -> countryQid | null.
  // - If null -> return null (WD-04).
  // - Else: check countryQidToAlpha2 cache. On hit -> return alpha-2. On miss -> fetch country entity,
  //   read claims.P297[0].mainsnak.datavalue.value -> alpha-2. Cache result; return. If P297 missing
  //   (historical entity per D-03) -> return null.
  async resolveP27Nationality(qid: string): Promise<string | null> {
    const entity = await this.getEntity(qid);
    const qidInside = normalizeQid(qid);
    const claims = entity.entities[qidInside]?.claims?.P27 ?? [];

    const countryQid = resolveP27Claim(claims);
    if (countryQid === null) return null;

    const cached = countryQidToAlpha2(countryQid);
    if (cached !== null) return cached;

    // Cache miss -> live fetch of country entity's P297.
    const countryEntity = await this.getEntity(countryQid);
    const alpha2 =
      countryEntity.entities[countryQid]?.claims?.P297?.[0]?.mainsnak.datavalue?.value ?? null;
    if (alpha2 === null) return null;

    cacheCountryQidAlpha2(countryQid, alpha2);
    return alpha2;
  }
}

// Module-level default singleton, MUST share the same limiter and User-Agent as openLibraryClient
// per WD-05. Plan 05 asserts reference equality on the limiter.
const sharedBreakerInstance = createBreaker(async (action: () => Promise<unknown>) => action());

export const wikidataClient = new WikidataClient({
  limiter: sharedHttpLimiter,
  breaker: sharedBreakerInstance as HttpDeps['breaker'],
  userAgent: USER_AGENT,
});

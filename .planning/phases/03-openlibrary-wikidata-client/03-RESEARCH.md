# Phase 3: OpenLibrary + Wikidata Client - Research

**Researched:** 2026-04-23
**Domain:** HTTP integration (OpenLibrary REST + Wikidata EntityData), rate limiting, circuit breaking, Zod schema validation
**Confidence:** HIGH

## Summary

Phase 3 builds the *pure* HTTP + parsing layer that Phase 4 will consume. No DB writes, no queue, no worker; just fetch-and-validate. The existing `apps/server/src/open-library/` slice is ~46 lines covering covers-only search. We extend (not replace) it with four typed methods (`searchWork`, `getWork`, `getEdition`, `getAuthor`) plus a new Wikidata lookup, all funneled through a single process-wide Bottleneck limiter and an opossum circuit breaker. OpenLibrary and Wikidata both prefer identified User-Agent traffic; OL grants a 3 req/s tier with an identified UA, so we set baseline 1 req/s and leave headroom for burst via Bottleneck `reservoir` if ever needed.

Runtime context: the server compiles to CJS (`tsconfig.json` → `"module": "commonjs"`) and runs via `tsx` in dev. `@koinsight/common` is ESM-only (`"type": "module"`, no `exports` map). Phase 2 hit this boundary inside Knex migrations (also CJS) and worked around it with explicit `@koinsight/common/dist/...js` subpaths. Phase 3 runs in the Express server process, not migrations; for **type-only** imports (the established pattern) nothing changes. For any **runtime** imports of `@koinsight/common` values (unlikely in this phase: OL/Wikidata types live in the server slice, not common), the same `dist/...js` workaround applies. Adding an `exports` map to `@koinsight/common` is the clean fix but is out of scope unless Phase 3 actually needs a runtime import from common. Recommendation: stay type-only; defer the `exports` map to a standalone cleanup.

**Primary recommendation:** Build a single `OpenLibraryClient` class (stateful, holds Bottleneck + opossum) alongside the existing static `OpenLibraryService` (which remains for covers). Expose four Zod-validated methods. Add a sibling `WikidataClient` that shares the same limiter instance via constructor injection. Back everything with `undici`/global `fetch` (no new HTTP lib). Fixture-based tests with `vi.stubGlobal('fetch', ...)` — no msw/nock new dep needed.

## User Constraints (from CONTEXT.md)

No 03-CONTEXT.md exists yet. Phase 3 is being planned without a prior discuss pass, so there are no locked user decisions. Claude's discretion covers all gray areas; recommendations below should be surfaced back to the user at plan-review time if the planner judges them load-bearing.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OL-01 | `searchWork`, `getWork`, `getEdition`, `getAuthor` returning Zod-parsed payloads | Endpoint shapes verified via `curl` on `openlibrary.org`; Zod 4.3.5 already a server dep |
| OL-02 | `User-Agent: KoInsight/<version> (<homepage>)` header | OL docs confirm 3 req/s tier requires identified UA; version from `apps/server/package.json#version` (currently `v0.2.2`) |
| OL-03 | Single Bottleneck 1 req/s shared across process | Bottleneck `maxConcurrent: 1, minTime: 1000`; singleton pattern via module export |
| OL-04 | Circuit breaker opens after N consecutive 5xx/timeouts, cooldown, half-open probe | opossum 9.0.0 provides exactly this; `errorThresholdPercentage` + `volumeThreshold` gives consecutive-like semantics |
| OL-05 | Subjects from Work, not Edition; ISBN→Edition→Work resolution | OL `/works/{id}.json` returns `subjects: string[]`; `/isbn/{isbn}.json` redirects to an edition whose `works[0].key` points to the Work |
| WD-01 | Follow `remote_ids.wikidata` → fetch entity → read `claims.P27` | OL author JSON confirms `remote_ids.wikidata` shape `Q[0-9]+` |
| WD-02 | Normalize to ISO 3166-1 alpha-2 via lookup | Wikidata country items carry P297 (ISO alpha-2); two fetches per author worst case |
| WD-03 | Pick P27 claim with no `end time` (P582) qualifier, highest `rank` | Wikidata JSON structure: each claim has `rank` (`preferred`/`normal`/`deprecated`) and optional `qualifiers.P582` |
| WD-04 | No Wikidata link OR no P27 → `nationality = NULL`, `nationality_source = 'openlibrary'` | Pure resolution rule; implement as `Promise<string \| null>` return |
| WD-05 | Wikidata shares the same Bottleneck + UA | Single shared limiter instance injected into both clients |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OpenLibrary HTTP fetching | API / Backend | — | Outbound server calls; never from browser (CORS, rate attribution, secret-less UA identity) |
| Wikidata HTTP fetching | API / Backend | — | Same |
| Rate limiter / circuit breaker | API / Backend (module singleton) | — | Must be a single instance per Node process to enforce global 1 req/s |
| Zod schema parsing | API / Backend | `@koinsight/common` (if types shared) | Validation happens on response ingress; types can live in server slice since Phase 3 has no DB writes and no web consumer |
| ISO country code map | API / Backend utility | — | Pure data; no runtime dep needed |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bottleneck` | 2.19.5 | Process-wide rate limiting (1 req/s baseline) | [VERIFIED: npm view bottleneck version = 2.19.5]. Explicitly called out in REQUIREMENTS (OL-03, WD-05); already on the approved list in PROJECT.md out-of-scope list (notes "use Bottleneck instead" of p-queue/p-limit because ESM-only deps are banned). Bottleneck is dual CJS/ESM. |
| `opossum` | 9.0.0 | Circuit breaker with half-open probe | [VERIFIED: npm view opossum version = 9.0.0]. Nodeshift project, Red Hat maintained, standard choice for Node breaker. Wraps any async fn, fires `open`/`halfOpen`/`close` events, timeout + errorThresholdPercentage + resetTimeout knobs. [CITED: https://github.com/nodeshift/opossum] |
| `zod` | 4.3.5 | Response payload validation | [VERIFIED: already in `apps/server/package.json`]. Project convention per CLAUDE.md. |
| `i18n-iso-countries` | 7.14.0 | ISO 3166-1 alpha-2 code lookup and name-to-code conversion (not strictly required; see alternative) | [VERIFIED: npm view i18n-iso-countries version = 7.14.0]. Dual CJS/ESM. Covers common codes but NOT historical entities (USSR, GDR, Czechoslovakia). |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| global `fetch` (undici in Node 22) | built-in | HTTP transport | Already used by existing `open-library-service.ts`; no new dep |
| `vitest` | 4.0.16 | Test runner + `vi.stubGlobal('fetch', ...)` for fixture-based tests | Already present; no new dep |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Bottleneck | `p-queue` / `p-limit` | Rejected in PROJECT.md out-of-scope: ESM-only; server is CJS. |
| opossum | Hand-rolled breaker (state machine in ~60 lines) | Feasible — breakers are small. Opossum adds ~50KB and a metrics event stream we do not consume. Recommendation: opossum because OL-04 explicitly wants half-open probe behavior which is annoying to get right by hand. Flag as Claude's discretion. |
| i18n-iso-countries | Hand-curated QID→alpha-2 map (30–50 entries: the countries actually represented in the user's library, plus historical ones) | Avoids a dep and handles USSR/GDR/Czechoslovakia explicitly. Given the 30-entry scale and the research finding that OL/Wikidata coverage is ~7% of authors, a handwritten `COUNTRY_QID_TO_ALPHA2` map is defensible. |
| opossum | `cockatiel` (Azure SDK breaker) | Also good but heavier API; opossum is the Node-community default. |
| msw for fetch mocks | `vi.stubGlobal('fetch', ...)` with fixture JSON | msw is excellent but adds a dep. For 4 endpoints with deterministic shapes, stubbing `fetch` is simpler and matches existing test patterns. |

**Installation:**
```bash
npm --workspace=server install bottleneck@2.19.5 opossum@9.0.0
# Optional, only if not hand-rolling country map:
npm --workspace=server install i18n-iso-countries@7.14.0
npm --workspace=server install -D @types/opossum
```

**Version verification:** Ran `npm view {pkg} version` against the registry on 2026-04-23. Verified current: `bottleneck@2.19.5`, `opossum@9.0.0`, `i18n-iso-countries@7.14.0`.

## Domain Overview: Real OL and Wikidata Shapes

### OpenLibrary (verified via live `curl` against `openlibrary.org`)

**Base URL:** `https://openlibrary.org`

| Endpoint | Purpose | Key Response Fields |
|----------|---------|---------------------|
| `GET /search.json?q=...&title=...&author=...&fields=key,title,author_name,author_key,isbn,first_publish_year,cover_i&limit=5` | Title+author search → candidate works | `docs[].key` (e.g. `/works/OL82563W`), `docs[].author_key`, `docs[].first_publish_year` |
| `GET /works/{workId}.json` (e.g. `/works/OL82563W.json`) | Canonical work record; **this is where subjects live** | `title`, `subjects: string[]`, `authors: [{author: {key: "/authors/OLxxxA"}}]`, `created`, `first_publish_date` |
| `GET /books/{editionId}.json` (e.g. `/books/OL7353617M.json`) | Edition (specific physical/digital copy) | `works: [{key: "/works/OL82563W"}]`, `publish_date`, `languages: [{key: "/languages/eng"}]`, `isbn_13`, `isbn_10`, `number_of_pages` — **subjects typically empty or minimal** |
| `GET /isbn/{isbn}.json` | ISBN → edition (server 302 redirects to `/books/{editionId}.json`) | same as `/books/...json` |
| `GET /authors/{authorId}.json` (e.g. `/authors/OL23919A.json`) | Author record | `name`, `personal_name`, `birth_date`, `death_date`, `bio` (string OR `{type, value}` object), `remote_ids: {wikidata: "Qxxx", viaf: "...", ...}` |

**Gotchas verified in live responses:**
1. `bio` can be a raw string OR an object `{type: "/type/text", value: "..."}`. Zod schema must use a union (`z.union([z.string(), z.object({type: z.string(), value: z.string()})])`) or a preprocessed string.
2. `remote_ids` is optional and may be missing entirely. When present, `wikidata` matches `/^Q[0-9]+$/`.
3. `/search.json` result `docs[].isbn` is a union list (both ISBN-10 and ISBN-13); dedupe if using.
4. Work `subjects` is sometimes 50+ entries including marketing/format tags — this is exactly what Phase 2's `mapOpenLibrarySubjects` is for; Phase 3 must pass through the raw list unmodified.
5. `/isbn/{isbn}.json` returns an edition, NOT a work. Resolution chain: ISBN → edition.`works[0].key` → work.
6. On 5xx, OL sometimes returns HTML error pages with `Content-Type: text/html`, which `response.json()` will choke on. Always check `content-type` header or wrap `.json()` in try/catch and treat parse failure as retriable.
7. 404 on a valid-looking key is a normal "not found" (e.g., deleted work); treat as a business-layer miss, NOT a circuit-breaker trip.

### Wikidata (verified via live `curl` against `wikidata.org`)

**Base URL:** `https://www.wikidata.org`
**Endpoint:** `GET /wiki/Special:EntityData/{QID}.json` (or `?flavor=simple` for truthy-only statements, no qualifiers — **do not use `simple` because we need P582 `end time` qualifiers to implement WD-03**)

**Response shape (partial, verified on Q535 = Victor Hugo):**

```jsonc
{
  "entities": {
    "Q535": {
      "id": "Q535",
      "claims": {
        "P27": [
          {
            "mainsnak": {
              "snaktype": "value",
              "property": "P27",
              "datavalue": {
                "value": { "entity-type": "item", "numeric-id": 142, "id": "Q142" },
                "type": "wikibase-entityid"
              }
            },
            "rank": "normal",           // or "preferred" or "deprecated"
            "qualifiers": {             // optional
              "P582": [                 // end time — if present, claim expired
                { "datavalue": { "value": { "time": "+1851-00-00T00:00:00Z", ... } } }
              ]
            }
          }
        ]
      }
    }
  }
}
```

**Resolution algorithm (WD-03):**
1. Filter `claims.P27` dropping any with `rank == "deprecated"`.
2. Drop any with a `qualifiers.P582` (end time) — these represent former citizenship.
3. If any `rank == "preferred"` remain, prefer those.
4. Among remaining, return the first (Wikidata JSON preserves insertion order).
5. Extract `mainsnak.datavalue.value.id` → country QID (e.g., `Q142`).
6. Fetch the country entity: `/wiki/Special:EntityData/Q142.json`, read `claims.P297[0].mainsnak.datavalue.value` → `"FR"` (ISO alpha-2).
7. Cache the country-QID → alpha-2 mapping in-process (population is tiny, ~250 entries, but the hot set is ~30 — and this avoids the second fetch per author on the common path).

**Historical-entity gotcha:** USSR (Q15180), GDR (Q16957), Czechoslovakia (Q33946), Yugoslavia (Q36704), East Germany, etc. have `P297 = NULL` because ISO 3166-1 covers only currently-existing countries. Decision needed: either (a) map these to successor-state codes (USSR→RU, GDR→DE, Czechoslovakia→CZ), or (b) emit `NULL` and let Phase 6 group them under "Unknown". Recommendation: **emit NULL**, document the behavior. This matches WD-04 semantics ("source ATTEMPTED OL/WD; manual edit can later set manual").

**User-Agent policy:** Wikimedia requires a UA. Same string as OL works fine: `KoInsight/<version> (<homepage>)`. [CITED: https://meta.wikimedia.org/wiki/User-Agent_policy]

## Existing Code Analog

`apps/server/src/open-library/open-library-service.ts` (46 lines) is a static class with:
- `fetchCover(coverId, size)` — binary fetch from `covers.openlibrary.org`.
- `queryCovers(searchTerm, limit)` — uses `/search.json` to collect cover IDs.
- private `searchBooks(...)`, `queryCoverForKey(key)` — helpers.

**What Phase 3 keeps / changes:**
- Keep the static `OpenLibraryService` class for `fetchCover` / `queryCovers` (covers-router still uses it).
- Add a new `OpenLibraryClient` (instance, not static) that holds the Bottleneck + opossum and exposes the 4 new methods. Or extend the static class with the 4 new methods IF the limiter/breaker are module-level singletons. Recommendation: **instance class with module-level default singleton export** — keeps testability (can inject fake limiter/breaker in unit tests) while still giving a "one global" import for Phase 4. Example: `export const openLibraryClient = new OpenLibraryClient(defaultLimiter, defaultBreaker);`
- The existing `open-library-types.ts` (94 lines) is a hand-written TS interface for search results. Phase 3's new types should be Zod schemas (`z.object(...).parse(json)`) with `z.infer` types — superior because parsing validates at runtime. Existing `OpenLibrarySearchResult` can stay as-is for the covers flow or be migrated as a cleanup.
- The existing router (`open-library-router.ts`) is web-facing and unrelated to enrichment; Phase 3 adds no new routes.

## Architecture Patterns

### System Architecture Diagram

```
                ┌──────────────────────────────────────────────────────┐
                │  Caller (Phase 4 worker, or unit test harness)       │
                └──────────────┬───────────────────────────────────────┘
                               │ openLibraryClient.getWork('/works/OL82563W')
                               ▼
                ┌──────────────────────────────────────────────────────┐
                │  OpenLibraryClient (instance)                         │
                │   searchWork / getWork / getEdition / getAuthor       │
                └──────────────┬───────────────────────────────────────┘
                               │ breaker.fire(() => limiter.schedule(...))
                               ▼
                ┌─────────────────────┐   ┌────────────────────────────┐
                │  opossum breaker    │──▶│  Bottleneck limiter        │  ← SHARED across OL + WD
                │  (consecutive 5xx → │   │  maxConcurrent:1, minTime: │
                │   open, probe)      │   │  1000ms, configurable      │
                └──────────┬──────────┘   └─────────────┬──────────────┘
                           │                            │ schedule(fetchFn)
                           │ fallback: throw            ▼
                           │              ┌────────────────────────────┐
                           │              │  fetch() with UA header    │
                           │              └─────────────┬──────────────┘
                           │                            │
                           │              ┌─────────────▼──────────────┐
                           │              │ openlibrary.org  |  wikidata.org │
                           │              └─────────────┬──────────────┘
                           │                            │
                           │              ┌─────────────▼──────────────┐
                           │              │ Zod schema.parse()         │
                           │              │ (throws ZodError on shape  │
                           │              │ mismatch → caller handles) │
                           │              └─────────────┬──────────────┘
                           │                            │ typed payload
                           └────────────────────────────┴──────────────▶ caller

                ┌──────────────────────────────────────────────────────┐
                │  WikidataClient (sibling, shares SAME limiter+breaker)│
                │   getEntity(qid) + resolveP27Nationality(qid)         │
                └──────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
apps/server/src/open-library/
├── open-library-service.ts          # EXISTING — stays as covers-only
├── open-library-router.ts           # EXISTING — unchanged
├── open-library-types.ts            # EXISTING — unchanged (old covers types)
├── open-library-client.ts           # NEW — instance class, 4 methods, uses limiter+breaker
├── open-library-schemas.ts          # NEW — Zod schemas for work/edition/author/search
├── open-library-client.test.ts      # NEW — fixture-based unit tests
├── fixtures/                        # NEW — JSON captured from real OL
│   ├── work-OL82563W.json
│   ├── edition-OL7353617M.json
│   ├── author-OL23919A.json
│   ├── search-hp-rowling.json
│   └── error-html-page.html         # captured 5xx HTML response
apps/server/src/enrichment/          # NEW slice (Phase 3 creates the directory)
├── http/
│   ├── rate-limiter.ts              # NEW — exports shared Bottleneck singleton
│   ├── circuit-breaker.ts           # NEW — exports breaker factory or singleton
│   ├── user-agent.ts                # NEW — builds 'KoInsight/vX.Y.Z (homepage)'
│   └── http-errors.ts               # NEW — classify 5xx/timeout/parse-fail for breaker
└── wikidata/
    ├── wikidata-client.ts           # NEW — getEntity + resolveP27Nationality
    ├── wikidata-schemas.ts          # NEW — Zod schemas for entity + claim + qualifier
    ├── country-codes.ts             # NEW — QID→alpha-2 map (hand-curated or i18n-iso-countries)
    ├── wikidata-client.test.ts      # NEW
    └── fixtures/
        ├── entity-Q535.json          # Victor Hugo (multi-P27 with end-time historical)
        ├── entity-Q42.json           # Douglas Adams (single P27)
        ├── entity-Q142.json          # France (for P297 lookup)
        └── entity-no-p27.json        # an author without P27
```

Rationale: Phase 3 is the foundation of the `enrichment/` slice even though Phase 4 names the slice in REQUIREMENTS. We do NOT pollute the existing `open-library/` slice with Wikidata-specific code. The shared limiter/breaker live in `enrichment/http/` because that is their logical owner — they serve BOTH the OL client and the Wikidata client, and they belong to the enrichment subsystem.

### Pattern 1: Module-level singleton limiter + breaker, with DI override for tests

```typescript
// enrichment/http/rate-limiter.ts
import Bottleneck from 'bottleneck';

// Source: https://github.com/SGrondin/bottleneck#readme (VERIFIED)
export const createLimiter = (opts?: Partial<Bottleneck.ConstructorOptions>) =>
  new Bottleneck({
    maxConcurrent: 1,
    minTime: Number(process.env.OL_MIN_INTERVAL_MS ?? 1000),
    ...opts,
  });

// Process-wide default (OL-03 and WD-05 share this)
export const sharedHttpLimiter = createLimiter();
```

```typescript
// enrichment/http/circuit-breaker.ts
import CircuitBreaker from 'opossum';

// Source: https://github.com/nodeshift/opossum#options (VERIFIED)
export const createBreaker = <A extends unknown[], R>(
  action: (...args: A) => Promise<R>,
  opts?: CircuitBreaker.Options
) =>
  new CircuitBreaker(action, {
    timeout: 10_000,
    errorThresholdPercentage: 50,
    volumeThreshold: 5, // require 5 calls in rolling window before opening
    resetTimeout: 30_000, // half-open probe after 30s
    ...opts,
  });
```

### Pattern 2: Zod schema for a Wikidata P27 claim

```typescript
// enrichment/wikidata/wikidata-schemas.ts
import { z } from 'zod';

const P27ClaimSchema = z.object({
  mainsnak: z.object({
    snaktype: z.string(),
    property: z.literal('P27'),
    datavalue: z
      .object({
        value: z.object({ id: z.string().regex(/^Q[0-9]+$/) }),
        type: z.literal('wikibase-entityid'),
      })
      .optional(), // snaktype can be 'novalue' / 'somevalue' — defensive
  }),
  rank: z.enum(['preferred', 'normal', 'deprecated']),
  qualifiers: z
    .object({
      P582: z.array(z.unknown()).optional(), // presence is what matters; we don't parse the time
    })
    .partial()
    .optional(),
});

export const WikidataEntitySchema = z.object({
  entities: z.record(
    z.string(),
    z.object({
      id: z.string(),
      claims: z
        .object({
          P27: z.array(P27ClaimSchema).optional(),
          P297: z
            .array(
              z.object({
                mainsnak: z.object({
                  datavalue: z.object({ value: z.string() }).optional(),
                }),
              })
            )
            .optional(),
        })
        .partial()
        .optional(),
    })
  ),
});
```

### Pattern 3: Fetch wrapper combining breaker + limiter + UA + Zod

```typescript
// enrichment/http/typed-fetch.ts
export async function typedFetch<T>(
  url: string,
  schema: z.ZodType<T>,
  deps: { limiter: Bottleneck; breaker: CircuitBreaker; userAgent: string }
): Promise<T> {
  return deps.breaker.fire(() =>
    deps.limiter.schedule(async () => {
      const res = await fetch(url, { headers: { 'User-Agent': deps.userAgent, Accept: 'application/json' } });
      if (res.status === 404) throw new NotFoundError(url); // non-retriable, NOT a breaker trip
      if (res.status >= 500) throw new UpstreamServerError(url, res.status); // breaker-counted
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) throw new UpstreamParseError(url); // HTML error page → breaker-counted
      const body = await res.json();
      return schema.parse(body); // ZodError bubbles up; NOT a breaker trip
    })
  );
}
```

The breaker must be configured to ignore `NotFoundError` and `ZodError` (via `errorFilter` option) so a single malformed record does not trip the breaker.

### Anti-Patterns to Avoid

- **Limiter per class instance.** Creating a Bottleneck inside each client means OL and Wikidata have separate 1 req/s budgets and together fire at 2 req/s. Must share one instance across both clients.
- **Using `response.json()` without content-type check.** OL returns HTML 5xx pages; `.json()` throws a cryptic syntax error that looks like a parse bug.
- **Putting the breaker INSIDE the limiter.** Order matters: breaker wraps limiter, not the other way around. If the breaker is inside, an open breaker still occupies a limiter slot waiting its turn, defeating fail-fast.
- **Counting 404 / 429 as breaker failures.** 404 is a miss, not an outage. 429 is rate-pressure; respond by slowing the limiter, not opening the breaker.
- **Storing the Wikidata `P582` end-time value.** We only need its *presence* for WD-03. Parsing the time wastes schema surface.
- **Handwriting fetch retry logic.** Let opossum's half-open probe be the retry. Adding a second retry layer causes backoff multiplication.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting | Manual `setTimeout` queue | Bottleneck | Correct min-time across concurrent callers, queue backpressure, clear API |
| Circuit breaker state machine | Hand-rolled open/half-open/closed | opossum | Tricky edge cases: probe success/fail, rolling-window volume threshold, concurrent probe prevention |
| Wikidata JSON parsing | `if (json.entities?.[qid]?.claims?.P27?.[0]...)` | Zod schema + `.parse()` | Runtime validation; refuses to pass malformed data into the claim-selection algorithm; test failures surface schema drift early |
| ISBN→Work resolution | Custom crawl | Documented 2-step chain (`/isbn/{isbn}.json` → follow `works[0].key`) | Already idiomatic in OL ecosystem |
| Country code normalization | Hard-coded `if (qid === 'Q30') return 'US'` scattered across the codebase | One `country-codes.ts` module (hand-curated map or `i18n-iso-countries`) | Single source of truth; easy to test |

**Key insight:** Phase 3's code is ~80% glue. The custom logic (10–20% that matters) is the P27 claim-selection algorithm (rank + end-time filter) and the ISBN/search decision tree. Everything else — HTTP, limiting, breaking, validating — should be library boilerplate.

## Gray Areas and Recommendations

### 1. Rate limiter placement

**Recommendation:** Module-level singleton in `apps/server/src/enrichment/http/rate-limiter.ts` exporting both a `sharedHttpLimiter` (used by prod code) and a `createLimiter(opts)` factory (used by tests). Inject via constructor so both clients share the same instance and tests can override.

**Configurable via env:** `OL_MIN_INTERVAL_MS` (default 1000) and `OL_MAX_CONCURRENT` (default 1).

### 2. Circuit breaker

**Recommendation:** opossum 9.0.0. Config defaults:
- `timeout: 10_000` (per-request)
- `errorThresholdPercentage: 50`
- `volumeThreshold: 5` (no trip until 5 calls in rolling window)
- `resetTimeout: 30_000` (half-open probe after 30s)
- `errorFilter`: return `true` (do-not-count) for `NotFoundError`, `ZodError`, and 404.

What counts as a trip-worthy failure: HTTP 5xx, timeout, network error, non-JSON response from a JSON endpoint. [CITED: https://github.com/nodeshift/opossum]

Note on "N consecutive": opossum is percentage-based, not consecutive. With `errorThresholdPercentage: 50, volumeThreshold: 5`, the practical behavior is "once 5+ calls have happened and failure rate exceeds 50%". This satisfies OL-04's spirit ("don't pin the queue") but NOT its literal text ("N consecutive"). Two options:
- (A) Accept the percentage-based model as equivalent; document the deviation.
- (B) Wrap opossum with a small consecutive-counter (reset on success) that throws an `ConsecutiveFailureError` after N in a row; opossum then opens on that specific error.
Recommendation: **(A)**, simpler and arguably better (a single transient blip doesn't require 5 consecutive-success recovery).

### 3. Wikidata endpoint strategy

**Recommendation:** `GET /wiki/Special:EntityData/{QID}.json` (full flavor, not `?flavor=simple`). SPARQL is overkill for two point lookups per author. [VERIFIED: live `curl` on Q535] The REST endpoint returns the full claim structure with qualifiers, which we need for P582 end-time detection.

### 4. User-Agent source

**Recommendation:** Build at module load from `apps/server/package.json#version` (currently `v0.2.2`) and a hard-coded homepage (no PROJECT.md homepage set; use `https://github.com/<owner>/koinsight` — **gray area: planner should ask user for canonical homepage URL**). Format: `KoInsight/0.2.2 (+https://github.com/<owner>/koinsight)`. Strip leading `v` from the version.

Reading package.json: `import { version } from '../../../package.json' assert { type: 'json' };` works in Node 22 but requires `resolveJsonModule: true` in tsconfig (already set? — server tsconfig has no `resolveJsonModule` line but `isolatedModules: true`; verify in plan). Safer: `fs.readFileSync(resolve(__dirname, '../../../package.json'), 'utf8')` at module load, or inject via env var at boot. **Recommendation:** read synchronously from disk at module load.

### 5. ISBN → Edition → Work resolution and fallback search

**Recommendation:** decision tree in `OpenLibraryClient` (or in Phase 4 orchestration — prefer Phase 4 so this client stays pure):

```
if (book.isbn && book.isbn.length > 0) {
  edition = await getEdition('/isbn/' + book.isbn)
  if (edition.works[0]) return await getWork(edition.works[0].key)
}
// fallback
const results = await searchWork(book.title, book.authors_primary)
if (results.docs.length === 0) return NO_MATCH
// confidence gate (Phase 4's job, NOT Phase 3's):
// - if top result's author_name does not contain any author token from book.authors → NO_MATCH
// - if first_publish_year differs by more than 5 years from existing book.publication_year (if set) → deprioritize
return await getWork(results.docs[0].key)
```

**Where book ISBN lives today:** checked existing `Book` type in `packages/common/types/book.ts` — **NO isbn column today**. This is a gap. Phase 3 cannot depend on book.isbn because it doesn't exist. Two options:
- (A) Phase 3 only implements `searchWork(title, author)` and documents that ISBN path is Phase 4's problem after a schema migration.
- (B) Phase 3 implements `getEdition('/isbn/' + isbn)` as a pure method and the caller decides whether to use it.

**Recommendation:** (B). Phase 3's methods are building blocks; Phase 4 orchestrates.

### 6. P27 claim resolution

**Algorithm (WD-03):**
1. Drop claims with `rank === 'deprecated'`.
2. Drop claims with `qualifiers.P582` present (any end-time qualifier, regardless of date, means "former citizenship").
3. If any `preferred` remain, restrict to those.
4. Of remaining, return the first (JSON preserves authoring order). If the input had multiple non-deprecated, no-end-time claims and none preferred, we effectively pick one — document that as WD-03's "highest rank" semantic.
5. If zero remain, return `null`.

Property P1310 "disputed by" — **ignore** this milestone per WD-03 ("remaining values are not stored this milestone"). Flag as Deferred if user asks.

### 7. ISO 3166-1 alpha-2 lookup

**Recommendation:** Two-step: (a) fetch country entity by QID via the same Wikidata REST endpoint, (b) read `claims.P297[0].mainsnak.datavalue.value`. Cache the QID→alpha-2 map in-process (never expires within a process lifetime). Seed the cache with a hand-curated static map of the ~30 most-common countries so typical lookups don't need the second fetch.

Historical entities (USSR Q15180, GDR Q16957, Czechoslovakia Q33946, Yugoslavia Q36704, East Germany): these lack P297. **Recommendation:** return `null`, let Phase 6's "Unknown" bucket handle them. Document explicitly in code comment.

**Should we use `i18n-iso-countries`?** Only if we need to translate ISO codes to country names for UI. Phase 3 only needs the opposite direction (QID → ISO), which the library does NOT provide. **Recommendation: hand-curate a 30-entry map, no new dep.**

### 8. Testing strategy

**Recommendation:** fixture-based with `vi.stubGlobal('fetch', ...)`.

- Capture real JSON responses into `apps/server/src/open-library/fixtures/*.json` and `apps/server/src/enrichment/wikidata/fixtures/*.json` once during development, then commit. This makes tests reproducible and free of network.
- For rate-limiter test: fire 10 scheduled calls, measure wall-clock, assert >= 9 * minTime. Use short minTime (e.g., 50ms) in that test only.
- For circuit breaker test: stub `fetch` to return `{status: 500}` N times, assert breaker state transitions. Opossum emits events (`breaker.on('open', ...)`) which make assertions clean.
- For P27 resolution: 5 fixtures covering single-claim / multi-claim / deprecated / end-time / none.
- For malformed responses: one fixture is an HTML error page, one is invalid JSON; assert the correct error class is thrown and the breaker counts it.

**No new deps** needed beyond what's already in `apps/server`.

### 9. No-DB-writes invariant

**Recommendation:** YES, add the invariant, mirroring Phase 1's SCHEMA-07 grep test. Location: `apps/server/src/enrichment/__tests__/phase-03-no-db-writes.test.ts`. Check: grep all files under `apps/server/src/enrichment/` and the NEW files under `apps/server/src/open-library/` (i.e. `open-library-client.ts`, `open-library-schemas.ts`, their fixtures, and related tests — but NOT the existing pre-Phase-3 files which are allowed to import knex for covers features). Assertion: none of the Phase-3-introduced files matches `/\bknex\b|\bdb\(|\.insert\(|\.update\(|\.delete\(/`. Acceptance: implicit — `open-library-service.ts` and `open-library-router.ts` predate Phase 3 and are excluded by an allow-list in the test.

**Why this matters:** Phase 3's whole point is "HTTP layer, no DB writes". If Phase 4 slips a `knex('book').update(...)` into the client by accident, this catches it.

### 10. ESM/CJS boundary

**Recommendation:** This phase does NOT need `@koinsight/common` at runtime. All new types (OL response shapes, Wikidata shapes, enrichment input/output types) live in the server slice as Zod schemas + `z.infer`. Type-only imports from `@koinsight/common/types/*` still work (erased at runtime). **No ESM/CJS work required in Phase 3.**

If Phase 4 needs to expose enrichment result types to the web app, THAT phase can elevate a type to `@koinsight/common`. Don't pay that complexity tax here.

Deferred sub-decision: add an `exports` map to `@koinsight/common/package.json` as a standalone cleanup task (separate from Phase 3). Tracks `dist/*.js` subpaths as stable public entry points. Not blocking Phase 3.

## Runtime State Inventory

Not applicable — Phase 3 is a greenfield HTTP layer with no DB writes, no renames, no migrations, no live service config. Nothing to inventory.

## Common Pitfalls

### Pitfall 1: HTML error pages from OpenLibrary during outages
**What goes wrong:** OL returns a full HTML error page (status 5xx, `Content-Type: text/html`) during brownouts. `response.json()` throws a SyntaxError.
**Why it happens:** OL sits behind a CDN that serves static error pages on backend failure.
**How to avoid:** Check `Content-Type` before calling `.json()`. Treat non-JSON responses as breaker-counted upstream failures (distinct error class).
**Warning signs:** Test suite has an `error-html-page.html` fixture; `open-library-client.test.ts` asserts correct error propagation.

### Pitfall 2: Shared limiter NOT shared
**What goes wrong:** `new OpenLibraryClient()` creates a new Bottleneck; `new WikidataClient()` creates another. At 1 req/s each → 2 req/s combined → OL revokes the identified-UA tier → 429s.
**Why it happens:** Encapsulation overreach. "Clients should own their own limiter" feels clean but violates OL-03/WD-05.
**How to avoid:** Inject the limiter via constructor; export one module-level singleton; write an assertion test that `openLibraryClient.limiter === wikidataClient.limiter`.
**Warning signs:** Integration test fires 10 sequential calls alternating OL and WD and measures wall time.

### Pitfall 3: Breaker trips on 404
**What goes wrong:** Book search returns `/works/...` that later 404s (deleted work). Breaker counts it; after 5 deleted works the breaker opens and all subsequent (valid) calls fail fast.
**Why it happens:** Default opossum treats any thrown error as a failure.
**How to avoid:** Use `errorFilter: (err) => err instanceof NotFoundError` to mark 404s as "business outcome, not outage".
**Warning signs:** Test case fires 10 requests where every other response is 404; breaker stays closed.

### Pitfall 4: Wikidata response size
**What goes wrong:** `Special:EntityData/Q535.json` on a famous entity is ~200KB (sitelinks + labels in 100+ languages). Fetching 100 authors at 200KB each = 20MB bandwidth.
**Why it happens:** Default response includes all labels/sitelinks/descriptions.
**How to avoid:** Pre-slice — Zod schema only validates the `claims.P27` path and ignores the rest. `z.object({...}).passthrough()` or (preferred) a narrow schema that only picks what we read. Response size concern is upstream bandwidth; server doesn't re-emit it.
**Warning signs:** If ever we hit actual rate issues, consider the Wikidata Query Service (SPARQL) to fetch P27 + P297 in one shot. Out of scope for v1.

### Pitfall 5: Test time-sensitivity from minTime
**What goes wrong:** A unit test that uses the default 1000ms minTime runs slowly (~10s for 10 calls) and is flaky on loaded CI.
**Why it happens:** Default Bottleneck config is production-tuned.
**How to avoid:** Test code always uses `createLimiter({ minTime: 50 })` or similar. Production singleton is never imported by tests.
**Warning signs:** Test file imports `sharedHttpLimiter` directly → flag in code review.

### Pitfall 6: Zod `bio` union failure
**What goes wrong:** 90% of OL authors have `bio` as `{type, value}`, 10% have it as a raw string; a rigid schema crashes.
**How to avoid:** `bio: z.union([z.string(), z.object({type: z.string(), value: z.string()})]).optional()` with a preprocessor that returns the string form. Test fixture must include one author in each shape.

### Pitfall 7: P27 claim with `snaktype: 'novalue'`
**What goes wrong:** Some authors have a P27 claim asserting "no value" (known stateless). The schema assumes a nested `datavalue.value.id` and throws.
**How to avoid:** Make `datavalue` optional in the schema; filter out claims without `datavalue` before the rank/end-time filter.

## Code Examples

### OpenLibrary `searchWork` with Zod

```typescript
// Source: https://openlibrary.org/dev/docs/api/search (CITED)
// Verified: live curl on 2026-04-23

const SearchDocSchema = z.object({
  key: z.string().regex(/^\/works\/OL[0-9]+W$/),
  title: z.string(),
  author_name: z.array(z.string()).optional(),
  author_key: z.array(z.string()).optional(),
  first_publish_year: z.number().int().optional(),
  isbn: z.array(z.string()).optional(),
  cover_i: z.number().optional(),
});

const SearchResultSchema = z.object({
  numFound: z.number(),
  docs: z.array(SearchDocSchema),
});

async searchWork(title: string, author?: string, limit = 5) {
  const params = new URLSearchParams({
    title,
    limit: String(limit),
    fields: 'key,title,author_name,author_key,first_publish_year,isbn,cover_i',
  });
  if (author) params.set('author', author);
  return typedFetch(
    `https://openlibrary.org/search.json?${params}`,
    SearchResultSchema,
    this.deps
  );
}
```

### OpenLibrary `/isbn/{isbn}.json` → edition with `works[0].key`

```typescript
// Source: https://openlibrary.org/dev/docs/api/books (CITED)
const EditionSchema = z.object({
  key: z.string(),
  works: z.array(z.object({ key: z.string() })).min(1),
  publish_date: z.string().optional(),
  languages: z.array(z.object({ key: z.string() })).optional(),
  isbn_13: z.array(z.string()).optional(),
  isbn_10: z.array(z.string()).optional(),
});

async getEditionByIsbn(isbn: string) {
  return typedFetch(
    `https://openlibrary.org/isbn/${isbn}.json`,
    EditionSchema,
    this.deps
  );
}
```

### Wikidata P27 → alpha-2 resolution

```typescript
// Source: https://www.wikidata.org/wiki/Wikidata:Data_access (CITED)
async resolveP27Nationality(wikidataQid: string): Promise<string | null> {
  const entity = await this.getEntity(wikidataQid);
  const claims = entity.entities[wikidataQid]?.claims?.P27 ?? [];

  const candidates = claims
    .filter(c => c.rank !== 'deprecated')
    .filter(c => !c.qualifiers?.P582) // no end-time qualifier
    .filter(c => c.mainsnak.datavalue?.value?.id); // has value

  if (candidates.length === 0) return null;

  const preferred = candidates.filter(c => c.rank === 'preferred');
  const chosen = (preferred.length ? preferred : candidates)[0];
  const countryQid = chosen.mainsnak.datavalue!.value.id;

  return this.countryQidToAlpha2(countryQid); // may return null for historical
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `axios` / `node-fetch` | Global `fetch` (undici) | Node 18+ | No new HTTP dep needed |
| `nock` for HTTP mocks | `vi.stubGlobal('fetch', ...)` + JSON fixtures | Vitest 1+ | Fewer deps; simpler tests |
| `p-limit` for rate limiting | `bottleneck` (has minTime, not just concurrency) | Always (p-limit doesn't support min-interval) | Correct tool for ≥1s-between-requests constraint |
| Raw JSON handling with manual type casts | Zod schema + `infer` | Zod 3+ (stable since 2023) | Runtime validation, no drift |

**Deprecated/outdated:** Nothing in this phase's stack.

## Project Constraints (from CLAUDE.md)

- **Zod for server-side validation** — use at route boundaries; applies here to HTTP response boundaries too.
- **Prettier-only formatting** — no ESLint.
- **Ramda** is idiomatic for collection ops — `uniq`, `flatMap`, etc., already used in existing `open-library-service.ts`.
- **Vertical slicing:** router/service/repository under `apps/server/src/<domain>/`. Phase 3 is partly `open-library/` (extending) and partly the NEW `enrichment/` slice (http utilities + Wikidata).
- **Node ≥22, npm 10.2.4** — fine for all proposed deps.
- **Migrations compile via `tsconfig.migrations.json`** — irrelevant to Phase 3 (no migrations).
- **KOReader plugin contract unchanged** — Phase 3 touches no plugin-facing routes.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | OpenLibrary grants 3 req/s with identified UA (we target 1 req/s baseline, leaving headroom) | Standard Stack, OL-02 | [CITED via WebFetch to openlibrary.org/developers/api] — low risk |
| A2 | Opossum's percentage + volumeThreshold model is acceptable as "N consecutive" per OL-04 | Gray Area #2 | User may insist on literal consecutive counter; would need thin wrapper |
| A3 | Homepage for UA is `https://github.com/<owner>/koinsight` | Gray Area #4 | Planner should confirm canonical homepage URL with user |
| A4 | Historical-entity (USSR etc.) nationality returns NULL rather than successor-state code | Domain Overview + Gray Area #7 | Affects Phase 6 reports; user may prefer successor-state mapping |
| A5 | Phase 3 implements the ISBN→Edition→Work method but does NOT orchestrate the decision tree (Phase 4's job) | Gray Area #5 | Phase 3 might over- or under-scope depending on where Phase 4 draws the boundary |
| A6 | Hand-curated QID→alpha-2 map (~30 entries) is sufficient; no `i18n-iso-countries` dep | Gray Area #7 | If true author nationality distribution is long-tail, need to fall back to the live P297 fetch anyway (which we always do on cache miss) |
| A7 | Book ISBN is NOT currently stored on `book` table | Gray Area #5 | [VERIFIED: grepped `packages/common/types/book.ts`] — Book type has no isbn field; confirmed |
| A8 | Server runs as CJS (per `tsconfig.json#module = "commonjs"`) in both dev (`tsx`) and prod (`node dist`) | Summary | [VERIFIED: read tsconfig and package.json scripts] — low risk |

## Open Questions (RESOLVED)

All four questions are locked via the planner's adoption of the research recommendations. Tracked as D-01..D-04 in the plan frontmatter and task actions.

1. **D-01: Canonical homepage URL for User-Agent — RESOLVED.**
   - Decision: `https://github.com/gbumanzordev/koinsight`.
   - Rationale: The repo owner's GitHub account is the authoritative attribution target and qualifies for the OL 3 req/s tier. Reversible via one-line edit in `user-agent.ts` if upstream repo moves.

2. **D-02: Literal "N consecutive" vs opossum percentage model (OL-04) — RESOLVED.**
   - Decision: Accept opossum's `errorThresholdPercentage: 50, volumeThreshold: 5, resetTimeout: 30_000` defaults as the practical equivalent of "consecutive 5xx/timeouts".
   - Rationale: 100% error rate over volumeThreshold==5 calls = 5 consecutive failures. Matches OL-04 intent in practice. Documented as a deviation in 03-01-PLAN.md frontmatter.

3. **D-03: Historical-country citizenship (USSR, GDR, Czechoslovakia) — RESOLVED.**
   - Decision: Resolve to `nationality = NULL`; do NOT map to successor states.
   - Rationale: Aligns with Phase 6's "Unknown" bucket as a first-class reporting category. Avoids arbitrary historical-mapping tables that users cannot audit.

4. **D-04: `@koinsight/common` `exports` map — RESOLVED (NO).**
   - Decision: Phase 3 does NOT touch the common package boundary.
   - Rationale: All Phase 3 types live in the server slice (Zod schemas + `z.infer`). No runtime import from common. The exports-map cleanup remains a standalone follow-up tracked against Phase 2's deviations.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node runtime with global `fetch` | All HTTP | ✓ | Node ≥22 (enforced by `engines`) | — |
| `openlibrary.org` reachability | OL-01 through OL-05 | ✓ (at research time) | — | Fixture tests never hit the network |
| `wikidata.org` reachability | WD-01 through WD-05 | ✓ (at research time) | — | Fixture tests never hit the network |
| `bottleneck@2.19.5` | OL-03, WD-05 | Needs install | — | — |
| `opossum@9.0.0` | OL-04 | Needs install | — | Hand-rolled breaker (~60 lines) |
| `@types/opossum` | TypeScript build | Needs install | — | — |

**Missing dependencies with no fallback:** bottleneck, opossum — must be installed.
**Missing dependencies with fallback:** opossum (acceptable fallback is hand-rolled, but not recommended).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.0.16 |
| Config file | `apps/server/vitest.config.ts` |
| Quick run command | `npm --workspace=server exec vitest run path/to/file.test.ts` |
| Full suite command | `npm --workspace=server test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OL-01 | `searchWork`, `getWork`, `getEdition`, `getAuthor` return Zod-parsed payloads | unit (fixtures) | `npm --workspace=server exec vitest run src/open-library/open-library-client.test.ts` | ❌ Wave 0 |
| OL-02 | Every outbound request has `User-Agent: KoInsight/...` header | unit (stub fetch, inspect call args) | same file | ❌ Wave 0 |
| OL-03 | 10 lookups take ~10s at 1 req/s (with minTime override for fast test) | integration (timed) | same file | ❌ Wave 0 |
| OL-04 | Breaker opens after N simulated 5xx; probe after cooldown | unit (stubbed fetch returning 500) | same file | ❌ Wave 0 |
| OL-05 | Subjects read from Work, not Edition (fixture where edition has empty subjects, work has populated) | unit (fixture) | same file | ❌ Wave 0 |
| WD-01 | Wikidata entity fetched when author has `remote_ids.wikidata` | unit (fixture) | `npm --workspace=server exec vitest run src/enrichment/wikidata/wikidata-client.test.ts` | ❌ Wave 0 |
| WD-02 | Country QID normalized to ISO alpha-2 | unit | same file | ❌ Wave 0 |
| WD-03 | P27 claim selection: drop deprecated, drop end-time, prefer preferred | unit (5 fixtures) | same file | ❌ Wave 0 |
| WD-04 | No remote_ids.wikidata → return `null` for nationality | unit | same file | ❌ Wave 0 |
| WD-05 | Wikidata client and OL client share the same Bottleneck instance | unit (reference equality assertion + wall-clock integration) | shared limiter test | ❌ Wave 0 |
| Invariant | No DB writes introduced in Phase 3 | static (regex grep over new files) | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-03-no-db-writes.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm --workspace=server exec vitest run <path>`
- **Per wave merge:** `npm --workspace=server test` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `apps/server/src/open-library/open-library-client.test.ts` — covers OL-01..OL-05
- [ ] `apps/server/src/enrichment/wikidata/wikidata-client.test.ts` — covers WD-01..WD-04
- [ ] `apps/server/src/enrichment/http/shared-limiter.test.ts` — covers WD-05 (shared limiter reference + timed integration)
- [ ] `apps/server/src/enrichment/__tests__/phase-03-no-db-writes.test.ts` — static invariant
- [ ] Fixtures: `apps/server/src/open-library/fixtures/*.json` (search, work, edition, author, error-html)
- [ ] Fixtures: `apps/server/src/enrichment/wikidata/fixtures/*.json` (entity with single P27, multi P27 with end-time, deprecated, none, country entity Q142/Q30/etc.)
- [ ] `npm install` additions: `bottleneck`, `opossum`, `@types/opossum`

Framework install: none needed (vitest already present).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 3 makes outbound calls only; no auth boundary introduced |
| V3 Session Management | no | No session state |
| V4 Access Control | no | No new routes exposed in Phase 3 |
| V5 Input Validation | yes | Zod schemas on all OL/Wikidata responses (response-side validation of untrusted upstream data) |
| V6 Cryptography | no | No crypto operations; outbound HTTPS is handled by Node core |
| V9 Communications | yes | HTTPS-only URLs enforced by hard-coded base URLs; never use http://openlibrary.org or http://wikidata.org |
| V10 Malicious Code | weak | New deps (bottleneck, opossum) are widely-used; verify on `npm audit` |

### Known Threat Patterns for Phase 3 stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SSRF via user-controlled URL fragment passed to `fetch` | Tampering | OL/Wikidata base URLs are hard-coded; only path/query params accept caller input; sanitize path segments (no `/`, no `..`) |
| Prototype pollution from parsed JSON | Tampering | Zod schemas reject unknown keys (`.strict()` mode) for security-sensitive records; at minimum, do not spread parsed JSON directly into app objects |
| Resource exhaustion from huge responses | DoS | opossum `timeout: 10_000` caps per-request wall time; Bottleneck caps concurrency at 1 |
| Upstream returning HTML with embedded malicious content that we echo to logs | Information disclosure | Log only status code and URL, never the raw response body; when logging parse errors, truncate to first 200 chars |
| Dependency supply-chain risk (bottleneck, opossum) | Tampering | `npm ci` in CI, `npm audit`, commit the exact versions in `package.json` |

**Phase-3-specific:** the new User-Agent is low-sensitivity (version leak only). Wikidata and OpenLibrary are public; no secrets in headers.

## Sources

### Primary (HIGH confidence)
- [VERIFIED] `curl https://openlibrary.org/authors/OL23919A.json` — J. K. Rowling author record, confirms `remote_ids`, `bio` object/string union, `personal_name`
- [VERIFIED] `curl https://www.wikidata.org/wiki/Special:EntityData/Q535.json` — Victor Hugo entity, confirms claim/rank/qualifier JSON shape
- [VERIFIED] `npm view bottleneck version` (2.19.5), `npm view opossum version` (9.0.0), `npm view i18n-iso-countries version` (7.14.0)
- [VERIFIED] Read `apps/server/tsconfig.json` — confirms server is CJS
- [VERIFIED] Read `apps/server/src/open-library/open-library-service.ts` — confirms existing covers-only scope
- [VERIFIED] Read `packages/common/types/book.ts` — confirms no ISBN column today
- [CITED] https://openlibrary.org/developers/api — rate limits, User-Agent policy
- [CITED] https://github.com/nodeshift/opossum — opossum options/states
- [CITED] https://github.com/SGrondin/bottleneck — Bottleneck API
- [CITED] https://www.wikidata.org/wiki/Wikidata:Data_access — Special:EntityData endpoint
- [CITED] https://meta.wikimedia.org/wiki/User-Agent_policy — Wikimedia UA policy

### Secondary (MEDIUM confidence)
- WebSearch: Wikidata claim JSON structure, rank semantics, P582 end-time qualifier shape
- WebSearch: OpenLibrary author `remote_ids` schema (confirmed via schemata repo)
- WebSearch: opossum threshold semantics (errorThresholdPercentage vs consecutive)

### Tertiary (LOW confidence)
- None; all critical claims are primary-sourced.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified against npm registry 2026-04-23
- Architecture: HIGH — patterns cross-verified against existing server slices
- Endpoint shapes: HIGH — verified via live `curl`
- P27 claim algorithm: MEDIUM — algorithm is clear from Wikidata docs but the "historical citizenship" edge cases (successor-state mapping) are a judgement call
- Circuit breaker semantics: MEDIUM — opossum model is percentage-based; OL-04 asks for "consecutive"; assumed equivalent
- Pitfalls: HIGH — all derived from real response shapes or opossum documented behavior

**Research date:** 2026-04-23
**Valid until:** 2026-05-23 (stable stack; OL/Wikidata API surfaces move slowly)

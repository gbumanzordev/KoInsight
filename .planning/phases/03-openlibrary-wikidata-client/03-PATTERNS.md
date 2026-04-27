# Phase 3: OpenLibrary + Wikidata Client - Pattern Map

**Mapped:** 2026-04-23
**Files analyzed:** 14 new files (clients, schemas, http utilities, country-codes, fixtures dirs, tests, no-DB-writes invariant)
**Analogs found:** 13 / 14 (one greenfield: opossum/Bottleneck wiring; pattern composed from existing static-class + Zod usage)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/server/src/open-library/open-library-client.ts` | service (HTTP client, instance) | request-response (outbound) | `apps/server/src/open-library/open-library-service.ts` (existing static covers client); `apps/server/src/ai/open-ai-service.ts` (Zod-validated remote response) | role-match (combine) |
| `apps/server/src/open-library/open-library-schemas.ts` | utility (Zod schemas) | transform | `apps/server/src/ai/open-ai-service.ts` (`BookInsights = z.object(...)`) | role-match |
| `apps/server/src/open-library/open-library-client.test.ts` | test (unit, fixture-based) | request-response | `apps/server/src/utils/ranges.test.ts` (pure unit), `apps/server/src/genres/genre-repository.test.ts` (vitest globals + describe-by-method) | role-match |
| `apps/server/src/open-library/fixtures/*.json` | test fixture | file-I/O (read-only) | `packages/common/genres/map.fixtures.ts` (real OL data captured for tests) | role-match (different format: TS exports vs raw JSON) |
| `apps/server/src/enrichment/http/rate-limiter.ts` | utility (module singleton + factory) | request-response | None — no rate limiter in repo today. Closest singleton pattern: `apps/server/src/ai/open-ai-service.ts` `let cachedClient: OpenAI | null = null` lazy module-level holder | partial (singleton shape only) |
| `apps/server/src/enrichment/http/circuit-breaker.ts` | utility (factory) | request-response | None — greenfield. Use opossum directly | no analog |
| `apps/server/src/enrichment/http/user-agent.ts` | utility (constant) | none | `apps/server/src/config.ts` (module-load env reads, single export) | role-match |
| `apps/server/src/enrichment/http/typed-fetch.ts` | utility (HTTP wrapper) | request-response | `apps/server/src/ai/open-ai-service.ts` `safeJsonParse` + `BookInsights.parse(data)` (parse-then-validate) | partial |
| `apps/server/src/enrichment/http/http-errors.ts` | utility (error classes) | none | None in repo. Standard `class X extends Error` | no analog |
| `apps/server/src/enrichment/wikidata/wikidata-client.ts` | service (HTTP client) | request-response | `apps/server/src/open-library/open-library-service.ts` | role-match |
| `apps/server/src/enrichment/wikidata/wikidata-schemas.ts` | utility (Zod schemas) | transform | `apps/server/src/ai/open-ai-service.ts` (Zod object) | role-match |
| `apps/server/src/enrichment/wikidata/country-codes.ts` | utility (static map + lookup) | transform | `packages/common/genres/canonical.ts` (typed const array → derived `Map`); `packages/common/genres/aliases.ts` | exact |
| `apps/server/src/enrichment/wikidata/wikidata-client.test.ts` | test (unit, fixture-based) | request-response | `packages/common/genres/map.test.ts` (fixture-driven boundary cases) | role-match |
| `apps/server/src/enrichment/__tests__/phase-03-no-db-writes.test.ts` | test (static invariant) | file-I/O | `apps/server/src/db/migrations/__tests__/phase-02-schema.test.ts` and `phase-01-schema.test.ts` (regex grep over a known file set) | exact |
| `apps/server/package.json` (modified) | config | none | existing `dependencies` block (add `bottleneck`, `opossum`, `@types/opossum`) | exact |

## Pattern Assignments

### `apps/server/src/open-library/open-library-client.ts` (service, request-response)

**Primary analog:** `apps/server/src/open-library/open-library-service.ts` (lines 1-46)
**Secondary analog (for Zod parse pattern):** `apps/server/src/ai/open-ai-service.ts` (lines 1-7, 62-66)

**Imports pattern** (from existing service, lines 1-5):
```typescript
import { uniq } from 'ramda';
import { OpenLibrarySearchResult } from './open-library-types';

const OPEN_LIBRARY_API = 'https://openlibrary.org';
```

**Why deviate:** the new client is an *instance* class (constructor takes `{ limiter, breaker, userAgent }`) — not the static class above. Reason: tests need to inject fake limiter/breaker; production exports a module-level default instance. Keep `OPEN_LIBRARY_API` style constant.

**Core HTTP pattern (existing static class, the inner helper, lines 25-39):**
```typescript
private static async searchBooks(
  searchTerm: string,
  limit = 3,
  fields = 'key,cover_i',
  lang = 'eng'
): Promise<OpenLibrarySearchResult> {
  const params = new URLSearchParams({
    q: searchTerm,
    limit: limit.toString(),
    lang,
    fields,
  });

  return fetch(`${OPEN_LIBRARY_API}/search.json?${params}`).then((response) => response.json());
}
```
**Phase 3 additions:** wrap the `fetch` call in `breaker.fire(() => limiter.schedule(async () => { ... }))`, set `User-Agent` + `Accept` headers, classify status (404 / 5xx / non-JSON), then `Schema.parse(json)`. See `typed-fetch.ts` pattern below.

**Zod parse pattern** (from `ai/open-ai-service.ts` lines 4-7, 62-66):
```typescript
const BookInsights = z.object({
  genres: z.array(z.string()),
  summary: z.string(),
});
// ...
const data = safeJsonParse(content);
return BookInsights.parse(data);
```
**Apply to:** every method's return statement: `return SearchResultSchema.parse(json)`. Throw on schema mismatch (let ZodError bubble — `errorFilter` in opossum will mark it as not-a-circuit-trip).

**Default-singleton export pattern** (from `ai/open-ai-service.ts` lines 9-26 — module-level lazy cached instance):
```typescript
let cachedClient: OpenAI | null = null;
function getClient(): OpenAI | null { ... }
```
**Phase 3 deviation:** prefer eager export `export const openLibraryClient = new OpenLibraryClient(sharedHttpLimiter, sharedBreaker, USER_AGENT);` because there's no env-conditional like `OPENAI_API_KEY` (OL is always available). Test files import the *class* and construct their own instance with fake deps.

---

### `apps/server/src/open-library/open-library-schemas.ts` (utility, Zod schemas)

**Analog:** `apps/server/src/ai/open-ai-service.ts` (lines 4-7) — only Zod usage in `apps/server/src` today.

**Pattern:**
```typescript
import { z } from 'zod';

export const SearchDocSchema = z.object({
  key: z.string().regex(/^\/works\/OL[0-9]+W$/),
  title: z.string(),
  author_name: z.array(z.string()).optional(),
  // ...
});
export type SearchDoc = z.infer<typeof SearchDocSchema>;
```

**Use `z.infer` for derived types** (do NOT redeclare the interface separately — that's what the legacy hand-written `open-library-types.ts` does and is why Phase 3 moves to schemas).

**Defensive optionals** (from RESEARCH §Pitfall 6/7): `bio: z.union([z.string(), z.object({type: z.string(), value: z.string()})]).optional()`; on `P27` claims, `datavalue` is optional (snaktype may be `novalue`/`somevalue`).

---

### `apps/server/src/open-library/open-library-client.test.ts` (test, unit fixture-based)

**Analog A (test file structure):** `apps/server/src/utils/ranges.test.ts` (pure unit, no DB)
**Analog B (describe-by-method nesting):** `apps/server/src/genres/genre-repository.test.ts` lines 6-31

**Imports pattern** (from `ranges.test.ts` lines 1-3):
```typescript
import { normalizeRanges, Range, totalRangeLength } from './ranges';

describe(normalizeRanges, () => {
  it('normalizes overlapping ranges', () => { ... });
});
```
**Phase 3 application:**
```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { OpenLibraryClient } from './open-library-client';
import { createLimiter } from '../enrichment/http/rate-limiter';
import { createBreaker } from '../enrichment/http/circuit-breaker';
import workFixture from './fixtures/work-OL82563W.json';

describe(OpenLibraryClient, () => {
  describe(OpenLibraryClient.prototype.getWork, () => { ... });
});
```

**No new fetch-mock dep:** vitest is already present (4.0.16). Use `vi.stubGlobal('fetch', vi.fn().mockResolvedValue(...))` per test, with `afterEach(() => vi.unstubAllGlobals())`. There is no precedent for `vi.stubGlobal` in this repo (verified via grep), so this PATTERN is *introduced* by Phase 3 — keep it visible in the plan.

**Fixture import shape** (from `packages/common/genres/map.test.ts` lines 4-15):
```typescript
import { ACOMAF_SUBJECTS, DUNE_SUBJECTS, ... } from './map.fixtures';
```
But fixtures are JSON, not TS. Use `import workFixture from './fixtures/work-OL82563W.json';` (requires `resolveJsonModule: true` — verify in plan; if missing, plan must enable it OR `readFileSync`).

**Test setup invariant:** the global `test/setup/test-setup.ts` runs `db.migrate.latest()` and truncates tables. Phase 3 tests do NOT touch the DB, but they will still pay this cost since vitest is configured with one global setup file. No action needed — just be aware.

---

### `apps/server/src/enrichment/http/rate-limiter.ts` (utility, singleton)

**Analog (singleton lifecycle only):** `apps/server/src/ai/open-ai-service.ts` lines 9-26 — `let cachedClient: OpenAI | null = null; function getClient()`.

**Phase 3 pattern (new, see RESEARCH §Pattern 1):**
```typescript
import Bottleneck from 'bottleneck';

export const createLimiter = (opts?: Partial<Bottleneck.ConstructorOptions>) =>
  new Bottleneck({
    maxConcurrent: 1,
    minTime: Number(process.env.OL_MIN_INTERVAL_MS ?? 1000),
    ...opts,
  });

export const sharedHttpLimiter = createLimiter();
```

**Env read pattern (from `config.ts` line 6-7):**
```typescript
const DATA_PATH = process.env.DATA_PATH || path.resolve(BASE_PATH, '../../../', 'data');
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB) || 100;
```
Apply same idiom: `Number(process.env.OL_MIN_INTERVAL_MS ?? 1000)`. Don't add to `appConfig` — limiter knobs are local to the enrichment slice.

---

### `apps/server/src/enrichment/http/circuit-breaker.ts` (utility, factory)

**No analog.** Greenfield. Use the opossum signature shown in RESEARCH §Pattern 1. Critical config:
- `errorFilter: (err) => err instanceof NotFoundError || err.name === 'ZodError'` so 404s and schema mismatches do not trip the breaker (RESEARCH §Pitfall 3).
- Breaker wraps the limiter call, NEVER the other way around (RESEARCH §Anti-Patterns).

---

### `apps/server/src/enrichment/http/typed-fetch.ts` (utility, HTTP wrapper)

**Analog (parse-then-validate ordering):** `apps/server/src/ai/open-ai-service.ts` lines 62-66:
```typescript
const content = completion.choices[0]?.message?.content ?? '{}';
const data = safeJsonParse(content);
return BookInsights.parse(data);
```

**Phase 3 elaboration (see RESEARCH §Pattern 3):**
```typescript
export async function typedFetch<T>(
  url: string,
  schema: z.ZodType<T>,
  deps: { limiter: Bottleneck; breaker: CircuitBreaker; userAgent: string }
): Promise<T> {
  return deps.breaker.fire(() =>
    deps.limiter.schedule(async () => {
      const res = await fetch(url, { headers: { 'User-Agent': deps.userAgent, Accept: 'application/json' } });
      if (res.status === 404) throw new NotFoundError(url);
      if (res.status >= 500) throw new UpstreamServerError(url, res.status);
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) throw new UpstreamParseError(url);
      const body = await res.json();
      return schema.parse(body);
    })
  );
}
```

---

### `apps/server/src/enrichment/wikidata/country-codes.ts` (utility, static map)

**Primary analog:** `packages/common/genres/canonical.ts` (a typed `as const` array) and the lookup-Map pattern in `packages/common/genres/map.ts` lines 9-19:
```typescript
const CANONICAL_LOOKUP: ReadonlyMap<string, CanonicalGenre> = new Map(
  CANONICAL_GENRES.map((g) => [normalize(g), g] as const)
);
```

**Phase 3 application:**
```typescript
// Hand-curated QID -> ISO 3166-1 alpha-2 (~30 high-frequency entries; see RESEARCH §Gray Area 7).
// Historical entities (USSR Q15180, GDR Q16957, Czechoslovakia Q33946) deliberately omitted ->
// resolveP27Nationality returns null -> Phase 6 'Unknown' bucket.
export const COUNTRY_QID_TO_ALPHA2 = {
  Q30:  'US',
  Q145: 'GB',
  Q142: 'FR',
  // ...
} as const satisfies Record<string, string>;
```

**Lookup helper + cache for unknowns** (in-process Map, mirror `CANONICAL_LOOKUP` style). The Wikidata fetch path populates the cache on miss.

---

### `apps/server/src/enrichment/__tests__/phase-03-no-db-writes.test.ts` (test, static invariant)

**Analog:** `apps/server/src/db/migrations/__tests__/phase-02-schema.test.ts` lines 29-75 (regex grep over a fixed file set).

**Imports + structure pattern (from phase-02 lines 1-7, 29-75):**
```typescript
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PHASE_3_NEW_FILES = [
  '../open-library/open-library-client.ts',
  '../open-library/open-library-schemas.ts',
  '../enrichment/http/rate-limiter.ts',
  // ... explicit allow-list (NOT including pre-Phase-3 open-library-service.ts / open-library-router.ts)
];

describe('Phase 3 no-DB-writes invariant', () => {
  for (const rel of PHASE_3_NEW_FILES) {
    it(`${rel} contains no knex / db / .insert / .update / .delete`, () => {
      const content = readFileSync(join(__dirname, rel), 'utf8');
      expect(content).not.toMatch(/\bknex\b/);
      expect(content).not.toMatch(/\bdb\(/);
      expect(content).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    });
  }
});
```
**Apply the same allow-list discipline as phase-01:** explicit file list, NOT a wildcard glob. New files only — `open-library-service.ts` and `open-library-router.ts` predate Phase 3 and are excluded.

---

### `apps/server/src/enrichment/wikidata/wikidata-client.ts` (service)

**Analog:** Same as `open-library-client.ts` — instance class, shares `{ limiter, breaker, userAgent }` deps.

**Critical:** the `limiter` and `breaker` constructor args MUST be the same instances injected into `OpenLibraryClient`. The default export wires both clients to `sharedHttpLimiter` (RESEARCH §Pitfall 2). Add an assertion test:
```typescript
it('OL and Wikidata clients share the same limiter instance', () => {
  expect(openLibraryClient['limiter']).toBe(wikidataClient['limiter']);
});
```

**P27 resolution algorithm:** verbatim from RESEARCH §Code Examples "Wikidata P27 → alpha-2 resolution".

---

### `apps/server/package.json` (config, modified)

**Pattern:** insert into existing `dependencies` (alpha-sorted, current style):
```json
"bottleneck": "2.19.5",
"openai": "6.16.0",
"opossum": "9.0.0",
```
And `devDependencies`:
```json
"@types/opossum": "<latest>",
```
Run install per RESEARCH §Standard Stack:
```bash
npm --workspace=server install bottleneck@2.19.5 opossum@9.0.0
npm --workspace=server install -D @types/opossum
```

---

## Shared Patterns

### Pattern A: Module-level constant + URL builder

**Source:** `apps/server/src/open-library/open-library-service.ts` lines 4-5
```typescript
const OPEN_LIBRARY_API = 'https://openlibrary.org';
const OPEN_LIBRARY_COVERS_API = 'https://covers.openlibrary.org';
```
**Apply to:** `open-library-client.ts` (reuse the existing constant — DO NOT redefine), `wikidata-client.ts` (`const WIKIDATA_API = 'https://www.wikidata.org';`). HTTPS-only (V9 in RESEARCH §Security).

### Pattern B: `URLSearchParams` for query string assembly

**Source:** `apps/server/src/open-library/open-library-service.ts` lines 31-36
```typescript
const params = new URLSearchParams({
  q: searchTerm,
  limit: limit.toString(),
  lang,
  fields,
});
```
**Apply to:** every `searchWork`/`getX` query construction in `open-library-client.ts`. Sanitize path segments separately (no `/`, no `..`) per RESEARCH §Security SSRF.

### Pattern C: Static class with named static methods (where instance state is unnecessary)

**Source:** `apps/server/src/open-library/open-library-service.ts`, `apps/server/src/genres/genre-repository.ts`, `apps/server/src/books/books-repository.ts` — entire codebase convention.

**Phase 3 deviation:** `OpenLibraryClient` and `WikidataClient` are *instance* classes (not static) because they hold limiter/breaker references and need DI for tests. Singletons are exported at module level. Document this deviation in the plan — it is the first non-static service class in `apps/server/src/`.

### Pattern D: `describe(SomeFn, () => ...)` and `describe(Class.method, () => ...)`

**Source:** `apps/server/src/utils/ranges.test.ts` line 3, `apps/server/src/genres/genre-repository.test.ts` lines 6-7
```typescript
describe(GenreRepository, () => {
  describe(GenreRepository.getAll, () => { ... });
});
```
**Apply to:** all Phase 3 test files. Improves test-output readability.

### Pattern E: Vitest globals (no per-file imports of `describe`/`it`/`expect`)

**Source:** `vitest.config.ts` line 5: `globals: true`. Most existing tests omit the import (e.g., `genre-repository.test.ts` has no vitest import). Newer tests (`phase-02-schema.test.ts` line 1) DO import explicitly — both are accepted; explicit imports are clearer and the trend is toward them. Phase 3 tests should import explicitly: `import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';`.

### Pattern F: Fixture as TypeScript constant export (`as const` array)

**Source:** `packages/common/genres/map.fixtures.ts` (used by `map.test.ts`)
```typescript
export const FOUNDATION_SUBJECTS = ['Science fiction', ...] as const;
```
**Phase 3 choice:** prefer raw `.json` files (RESEARCH §Validation Architecture) because OL/Wikidata responses are large nested JSON and `.json` files are easier to refresh from `curl`. Use `import x from './fixtures/x.json'` with `resolveJsonModule: true`. This *is* a deviation from the existing fixture style; flag in the plan.

### Pattern G: SCHEMA-07-style regex grep test

**Source:** `apps/server/src/db/migrations/__tests__/phase-02-schema.test.ts` and `phase-01-schema.test.ts`. Apply verbatim to Phase 3's no-DB-writes invariant (file `phase-03-no-db-writes.test.ts`). Use an explicit allow-list, not a directory glob.

## No Analog Found

| File | Role | Reason |
|------|------|--------|
| `apps/server/src/enrichment/http/circuit-breaker.ts` | utility | First circuit breaker in the codebase. Greenfield use of opossum. Use library defaults from RESEARCH §Pattern 1. |
| `apps/server/src/enrichment/http/http-errors.ts` | utility (error classes) | No custom Error subclasses exist in `apps/server/src`. Standard pattern: `export class NotFoundError extends Error { constructor(public url: string) { super(\`Not found: \${url}\`); this.name = 'NotFoundError'; } }`. |
| `vi.stubGlobal('fetch', ...)` mocking pattern | test technique | Not used anywhere in this repo today (verified via grep). Phase 3 introduces it. Document the pattern in the first test file as a teaching example so subsequent enrichment-slice tests can copy it. |

## Cross-cutting Notes for the Planner

1. **Static-vs-instance class deviation.** Every service in `apps/server/src/` is a static class (`OpenLibraryService`, `GenreRepository`, `BooksRepository`, `BooksService`). Phase 3 introduces instance classes for `OpenLibraryClient` and `WikidataClient` because tests need DI of fake limiter/breaker. Default singletons are exported at module level. This is the cleanest path; the plan should call it out as a conscious deviation.

2. **Fixture format deviation.** Existing fixtures are TS `as const` exports (`packages/common/genres/map.fixtures.ts`). Phase 3 uses raw `.json` files because OL/Wikidata responses are large and frequently refreshed via `curl`. Verify `resolveJsonModule` in `apps/server/tsconfig.json` and enable if absent.

3. **No new fetch-mock dependency.** Use `vi.stubGlobal('fetch', vi.fn())` per the RESEARCH recommendation. Vitest already exposes globals (`vitest.config.ts` line 5).

4. **Test setup global cost.** The repo-wide `test/setup/test-setup.ts` runs `db.migrate.latest()` and `truncate` for every `*.test.ts`. Phase 3 tests inherit this cost even though they are pure HTTP unit tests. Acceptable; do not introduce a separate vitest project unless test runtime becomes painful.

5. **Existing `open-library-types.ts` is not deleted.** It supports the legacy covers flow (`OpenLibrarySearchResult`). Phase 3 adds `open-library-schemas.ts` alongside it. A future cleanup can migrate the covers flow to Zod schemas.

6. **`open-library-service.ts` and `open-library-router.ts` remain untouched.** Phase 3 ADDS files in the same slice; it does not modify the existing covers code. The no-DB-writes invariant test must allow-list the new files only.

## Metadata

**Analog search scope:**
- `apps/server/src/open-library/`
- `apps/server/src/ai/`
- `apps/server/src/genres/`, `apps/server/src/books/`, `apps/server/src/utils/`
- `apps/server/src/db/migrations/__tests__/`
- `apps/server/test/setup/`
- `packages/common/genres/`

**Files read:** 18 (existing service/router/types/repos/tests/config + research).
**Pattern extraction date:** 2026-04-23

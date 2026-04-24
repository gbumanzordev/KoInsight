---
phase: 03-openlibrary-wikidata-client
plan: 03
subsystem: open-library-client
tags: [openlibrary, zod, http-client, fixtures]

requires:
  - phase: 03-openlibrary-wikidata-client
    plan: 01
    provides: typedFetch, sharedHttpLimiter, createBreaker, USER_AGENT, HttpDeps type, NotFoundError/UpstreamServerError/UpstreamParseError taxonomy

provides:
  - OpenLibraryClient class with searchWork(title, author?, limit?), getWork(workKey), getEdition(editionKey), getAuthor(authorKey) — all Zod-parsed
  - openLibraryClient singleton wired to sharedHttpLimiter + module-level breaker + USER_AGENT
  - Zod schemas SearchResultSchema, WorkSchema, EditionSchema, AuthorSchema + z.infer types
  - 7 JSON fixtures (4 captured live, 3 handcrafted for OL-05 + Pitfall 6 coverage)
  - normalizePath SSRF guard (T-03-01 mitigation)
affects: [03-05]

tech-stack:
  added: []
  patterns:
    - "Constructor-style DI via HttpDeps so tests inject createLimiter({ minTime: 0 }) + fresh breaker + synthetic userAgent; prod uses module-level singleton"
    - "normalizePath accepts both full /works/OL..W paths and bare OL..W IDs; rejects / or .. in tail to block SSRF"
    - "resolveJsonModule tsconfig flag unlocks typed JSON fixture imports in both src and test"
    - "Zod parses only declared fields (no z.passthrough) — T-03-09/T-03-12 mitigation; extra upstream keys are silently dropped"

key-files:
  created:
    - apps/server/src/open-library/open-library-schemas.ts
    - apps/server/src/open-library/open-library-client.ts
    - apps/server/src/open-library/__tests__/open-library-client.test.ts
    - apps/server/src/open-library/fixtures/search-hp-rowling.json
    - apps/server/src/open-library/fixtures/work-OL82563W.json
    - apps/server/src/open-library/fixtures/edition-OL7353617M.json
    - apps/server/src/open-library/fixtures/author-OL23919A.json
    - apps/server/src/open-library/fixtures/edition-empty-subjects.json
    - apps/server/src/open-library/fixtures/work-with-subjects.json
    - apps/server/src/open-library/fixtures/author-no-remote-ids.json
  modified:
    - apps/server/tsconfig.json

key-decisions:
  - "Accepted live OpenLibrary response shapes as fixtures (search, work, edition, author) rather than handcrafting — guarantees schemas parse real-world data and surfaces drift early."
  - "ISBN path (/isbn/...) uses a separate branch in getEdition; fetch follows the 302 redirect to /books/... automatically, so both forms work through the same EditionSchema."
  - "Singleton breaker constructed as createBreaker(async (fn) => fn()) — matches the pattern documented in typed-fetch.ts so per-call closures are fired through a single shared breaker instance."

patterns-established:
  - "apps/server/src/open-library/ is the home for OpenLibrary domain logic; open-library-schemas.ts owns Zod shapes, open-library-client.ts owns HTTP I/O, fixtures/ owns captured payloads"
  - "Fixture tests use vi.stubGlobal('fetch', mockFn) with new Response(JSON.stringify(body)) helper to keep setup minimal"

requirements-completed: [OL-01, OL-02, OL-05]

duration: ~6min
completed: 2026-04-23
---

# Phase 3 Plan 03: OpenLibraryClient Summary

**OpenLibraryClient exposes four Zod-validated methods (searchWork/getWork/getEdition/getAuthor), consumes the shared HTTP infra from Plan 01, and ships with 7 fixtures + 11 unit tests demonstrating OL-01 (typed responses), OL-02 (User-Agent on every request), and OL-05 (subjects come from Work, not Edition).**

## Performance

- **Duration:** ~6 min
- **Tasks:** 2
- **Files created:** 10 (2 src, 1 test, 7 fixtures)
- **Files modified:** 1 (apps/server/tsconfig.json — added resolveJsonModule)

## Accomplishments

- `open-library-schemas.ts` exports `SearchResultSchema`, `WorkSchema`, `EditionSchema`, `AuthorSchema` plus inferred types. `AuthorSchema.bio` is a `z.union([string, {type, value}])` supporting both shapes seen in the wild (Pitfall 6). `remote_ids.wikidata` is Q-id regex validated and optional (WD-01 precursor).
- `open-library-client.ts` implements the instance class with DI; every method routes through `typedFetch` so the User-Agent (OL-02), shared limiter (OL-03), and breaker (OL-04) are applied uniformly.
- `normalizePath` accepts both `/works/OL82563W` and bare `OL82563W` forms; rejects any `/` or `..` in the tail (T-03-01 SSRF guard) with an explicit error and a dedicated test case.
- `openLibraryClient` singleton is wired to `sharedHttpLimiter`, a module-scoped `createBreaker(async (fn) => fn())` pass-through breaker, and `USER_AGENT`.
- 7 fixtures captured: 4 live (`search-hp-rowling`, `work-OL82563W`, `edition-OL7353617M`, `author-OL23919A`) + 3 handcrafted (`edition-empty-subjects` / `work-with-subjects` for OL-05, `author-no-remote-ids` for the plain-string-bio-no-wikidata case).
- 11 unit tests all green: 3 for searchWork (incl. OL-02 header assertion), 3 for getWork (incl. SSRF guard), 2 for getEdition (incl. /isbn/ path), 1 for OL-05 (edition→work subjects walk), 2 for getAuthor (with and without wikidata).
- Full server suite: 249 tests pass, 1 pre-existing skip.

## Task Commits

1. **Task 1: Zod schemas + 7 fixtures + resolveJsonModule** — `13b67b3` (feat)
2. **Task 2: OpenLibraryClient + 11 fixture tests** — `e9514e9` (feat)

## Files Created/Modified

### Created

- `apps/server/src/open-library/open-library-schemas.ts` — Zod schemas and inferred types for search, work, edition, author.
- `apps/server/src/open-library/open-library-client.ts` — `OpenLibraryClient` class + `openLibraryClient` singleton.
- `apps/server/src/open-library/__tests__/open-library-client.test.ts` — 11 fixture-based unit tests using `vi.stubGlobal('fetch', ...)`.
- `apps/server/src/open-library/fixtures/search-hp-rowling.json` — live search response (3 docs, numFound 247).
- `apps/server/src/open-library/fixtures/work-OL82563W.json` — live Work for "Harry Potter and the Philosopher's Stone" (108 subjects).
- `apps/server/src/open-library/fixtures/edition-OL7353617M.json` — live Edition with empty subjects array (demonstrates OL-05 in the wild).
- `apps/server/src/open-library/fixtures/author-OL23919A.json` — live Author for J. K. Rowling with `bio` as `{type, value}` and `remote_ids.wikidata = Q34660`.
- `apps/server/src/open-library/fixtures/edition-empty-subjects.json` — handcrafted, minimal Edition for OL-05 test.
- `apps/server/src/open-library/fixtures/work-with-subjects.json` — handcrafted, minimal Work for OL-05 test.
- `apps/server/src/open-library/fixtures/author-no-remote-ids.json` — handcrafted Author with string bio and no `remote_ids`.

### Modified

- `apps/server/tsconfig.json` — added `"resolveJsonModule": true` to `compilerOptions` so fixtures can be imported as typed JSON modules.

## Decisions Made

- Accepted the live-captured payload structure exactly as OpenLibrary returned it. The schemas were designed to be strict on load-bearing fields (`key` regex on search docs, `Q[0-9]+` regex on `remote_ids.wikidata`) and optional elsewhere. This avoids false-positive Zod failures when OpenLibrary adds benign new fields.
- Chose an instance class (not a static-class like `OpenLibraryService`) to allow dependency injection of a per-test limiter + breaker. A module-level singleton is exported for runtime callers, matching the pattern documented in 03-PATTERNS.md §Cross-cutting Note 1.

## Deviations from Plan

None. Plan executed exactly as written. Minor note: the `@types/opossum` package from Plan 01 needed `as HttpDeps['breaker']` coercion on the breaker import in both the singleton and the test helper — this matches the exact pattern already used inside `typedFetch` and is called out in 03-PATTERNS.md.

## Issues Encountered

- None during execution. `npm --workspace=server run build:migrations` was run once to ensure migration types are current before vitest; this is the standard workflow documented in CLAUDE.md.

## Deferred Issues

None.

## User Setup Required

None. No environment variables or external services required for this plan. Runtime code will only perform outbound HTTPS calls to `openlibrary.org`, which requires no credentials.

## Next Phase Readiness

- Plan 03-04 (WikidataClient) can now consume the same `HttpDeps` pattern and the `sharedHttpLimiter` / `createBreaker` pass-through idiom documented here.
- Plan 03-05 (integration) can import `openLibraryClient` as a singleton and call `searchWork → getWork (via edition.works[0].key) → getAuthor (via work.authors[0].author.key) → optional getEdition` to assemble the enrichment payload. The OL-05 test in this plan documents the subjects-walk semantic that 03-05 must preserve.
- No blockers.

## Self-Check: PASSED

- Files created verified present:
  - apps/server/src/open-library/open-library-schemas.ts — FOUND
  - apps/server/src/open-library/open-library-client.ts — FOUND
  - apps/server/src/open-library/__tests__/open-library-client.test.ts — FOUND
  - apps/server/src/open-library/fixtures/search-hp-rowling.json — FOUND
  - apps/server/src/open-library/fixtures/work-OL82563W.json — FOUND
  - apps/server/src/open-library/fixtures/edition-OL7353617M.json — FOUND
  - apps/server/src/open-library/fixtures/author-OL23919A.json — FOUND
  - apps/server/src/open-library/fixtures/edition-empty-subjects.json — FOUND
  - apps/server/src/open-library/fixtures/work-with-subjects.json — FOUND
  - apps/server/src/open-library/fixtures/author-no-remote-ids.json — FOUND
- Commits verified:
  - 13b67b3 (Task 1) — FOUND
  - e9514e9 (Task 2) — FOUND
- Typecheck clean (`npx tsc -p apps/server/tsconfig.json --noEmit` exits 0).
- All 11 new tests pass; full server suite 249 pass + 1 pre-existing skip.
- Prettier clean on all touched files.

---
*Phase: 03-openlibrary-wikidata-client*
*Plan: 03*
*Completed: 2026-04-23*

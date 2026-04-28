---
phase: 03-openlibrary-wikidata-client
plan: 01
subsystem: enrichment-http
tags: [bottleneck, opossum, circuit-breaker, rate-limiter, zod, user-agent, typed-fetch]

requires:
  - phase: 02-schema-and-foundation
    provides: enrichment schema (book subjects, author nationality columns) that Waves 2 and 3 will feed

provides:
  - sharedHttpLimiter (Bottleneck) singleton for OpenLibrary + Wikidata (OL-03, WD-05)
  - createBreaker factory (opossum) with errorFilter excluding NotFoundError + ZodError (OL-04)
  - USER_AGENT constant built at module load (OL-02)
  - NotFoundError / UpstreamServerError / UpstreamParseError response taxonomy
  - typedFetch(url, schema, deps) wrapper composing breaker -> limiter -> fetch with User-Agent + Accept headers
affects: [03-02, 03-03, 03-04, 03-05]

tech-stack:
  added: [bottleneck@2.19.5, opossum@9.0.0, '@types/opossum@8.1.9']
  patterns:
    - "Constructor-style DI via HttpDeps { limiter, breaker, userAgent } so tests can inject fakes and prod uses a shared singleton"
    - "Breaker wraps limiter (NEVER inverse): opossum fire() receives a closure that internally limiter.schedule()s the fetch"
    - "errorFilter pattern: business-level errors (404, ZodError) do NOT count against breaker trip threshold"
    - "Content-Type check before res.json() to handle HTML error pages from upstream CDNs"

key-files:
  created:
    - apps/server/src/enrichment/http/rate-limiter.ts
    - apps/server/src/enrichment/http/circuit-breaker.ts
    - apps/server/src/enrichment/http/user-agent.ts
    - apps/server/src/enrichment/http/http-errors.ts
    - apps/server/src/enrichment/http/typed-fetch.ts
    - apps/server/src/enrichment/http/__tests__/rate-limiter.test.ts
    - apps/server/src/enrichment/http/__tests__/circuit-breaker.test.ts
    - apps/server/src/enrichment/http/__tests__/typed-fetch.test.ts
  modified:
    - apps/server/package.json
    - package-lock.json

key-decisions:
  - "Adopted opossum percentage-based trip semantics (errorThresholdPercentage 50 + volumeThreshold 5) as the practical equivalent of OL-04's 'N consecutive 5xx/timeouts' (D-02 locked)."
  - "User-Agent homepage hard-coded to https://github.com/gbumanzordev/koinsight (D-01 locked); version read from apps/server/package.json at module load with leading 'v' stripped."
  - "Constructor-DI breaker pattern: callers build one breaker once around a pass-through action (async (fn) => fn()), then reuse via breaker.fire(closure) per request. Necessary because opossum binds actions at construction."
  - "Do NOT log response bodies on parse errors (UpstreamParseError stores only URL). Matches T-03-03 mitigation."

patterns-established:
  - "enrichment/http/ slice is the owner of shared HTTP primitives for outbound upstream calls"
  - "createLimiter({ minTime: 50 }) in tests to avoid slow wall-clock; sharedHttpLimiter only in production code paths"
  - "Breaker + limiter composition documented as 'breaker.fire(() => limiter.schedule(fetchFn))'"

requirements-completed: [OL-02, OL-03, OL-04, WD-05]

duration: ~8min
completed: 2026-04-23
---

# Phase 3 Plan 01: Shared HTTP Infrastructure Summary

**Installed bottleneck + opossum, wired a shared Bottleneck limiter + opossum circuit breaker + qualified User-Agent + typed error taxonomy into a typedFetch(url, schema, deps) wrapper consumed by Plans 03 and 04.**

## Performance

- **Duration:** ~8 min
- **Tasks:** 2
- **Files created:** 8
- **Files modified:** 2 (package.json, package-lock.json)

## Accomplishments

- Installed bottleneck@2.19.5 and opossum@9.0.0 (exact versions locked from research 2026-04-23).
- Shared rate limiter (1 req/s baseline, configurable via OL_MIN_INTERVAL_MS) usable across OpenLibrary + Wikidata (OL-03, WD-05).
- Opossum breaker with 10s timeout, 50% error-threshold percentage, volumeThreshold 5, resetTimeout 30s; errorFilter excludes NotFoundError and ZodError so business-level outcomes do not trip the breaker (OL-04).
- USER_AGENT constant built at module load from apps/server/package.json, format KoInsight/0.2.2 (+https://github.com/gbumanzordev/koinsight) (OL-02).
- Typed error taxonomy (NotFoundError, UpstreamServerError, UpstreamParseError) with name-based serialization.
- typedFetch wrapper composes breaker.fire(limiter.schedule(fetch)) in the exact order mandated by the research anti-pattern list, attaches User-Agent + Accept: application/json, classifies responses, and delegates body validation to a caller-supplied Zod schema.
- 10 unit tests pass covering rate-limiter wall-clock behavior, breaker errorFilter semantics, and typedFetch error taxonomy + header + Zod-parse paths.

## Task Commits

1. **Task 1: Install deps + HTTP infrastructure + error classes + User-Agent** — `da1ad84` (feat)
2. **Task 2: typedFetch + unit tests for all HTTP utilities** — `032e8b4` (feat)

## Files Created/Modified

- `apps/server/src/enrichment/http/rate-limiter.ts` — createLimiter factory + sharedHttpLimiter singleton.
- `apps/server/src/enrichment/http/circuit-breaker.ts` — createBreaker factory with errorFilter; sharedBreaker helper.
- `apps/server/src/enrichment/http/user-agent.ts` — USER_AGENT constant built from package.json at module load.
- `apps/server/src/enrichment/http/http-errors.ts` — NotFoundError, UpstreamServerError, UpstreamParseError.
- `apps/server/src/enrichment/http/typed-fetch.ts` — typedFetch<T>(url, schema, deps) wrapper.
- `apps/server/src/enrichment/http/__tests__/rate-limiter.test.ts` — 2 tests.
- `apps/server/src/enrichment/http/__tests__/circuit-breaker.test.ts` — 3 tests.
- `apps/server/src/enrichment/http/__tests__/typed-fetch.test.ts` — 5 tests.
- `apps/server/package.json` — added bottleneck, opossum, @types/opossum.
- `package-lock.json` — dependency graph updates.

## Decisions Made

- Followed the plan exactly as specified. Locked decisions (D-01 homepage URL, D-02 percentage-based breaker semantics) were already resolved in RESEARCH and no new decisions were needed.
- Task 2's typed-fetch implementation uses a per-call closure (breaker.fire(action)) rather than rebuilding the breaker per request. Documented the construction pattern at the top of typed-fetch.ts so consumer plans (03, 04) know to build one breaker at module load.

## Deviations from Plan

None. The plan executed exactly as written. One note: @types/opossum resolved to version 8.1.9 (the latest available on npm) rather than a pinned exact version; the runtime opossum library is 9.0.0 as required and the types are compatible with the usage in this plan (CircuitBreaker<A, R>, CircuitBreaker.Options). This is DefinitelyTyped convention and does not constitute a deviation.

## Issues Encountered

- Running the new enrichment tests via `npm --workspace=server exec vitest run` initially failed with `ENOENT test/dist/migrations` because `build:migrations` hadn't been run in the fresh worktree. Fixed by running `npm --workspace=server run build:migrations` once (this is the standard workflow documented in CLAUDE.md; the top-level `npm run test` does it automatically).

## Deferred Issues

- A pre-existing test failure in `apps/server/src/db/migrations/__tests__/phase-02-schema.test.ts` was observed when running the full server suite. It fails while importing `@koinsight/common/dist/genres/canonical-genres` under the CJS migration config. This failure is NOT introduced by Plan 03-01 (reproducible at the base commit `f836f28`) and falls under the Phase 02 follow-up queue. Logged in `.planning/phases/03-openlibrary-wikidata-client/deferred-items.md`. All other 210 server tests pass, plus the 10 new tests from this plan.

## User Setup Required

None. No environment variables, external services, or dashboard steps are required for Plan 03-01. `OL_MIN_INTERVAL_MS` and `OL_MAX_CONCURRENT` env vars have sensible defaults and are optional tuning knobs.

## Next Phase Readiness

- Plans 03-03 (OpenLibraryClient) and 03-04 (WikidataClient) can now develop in parallel using the contracts in this plan's frontmatter `<interfaces>` block.
- The `breaker + limiter + userAgent` DI triple is ready to pass via `{ limiter: sharedHttpLimiter, breaker: createBreaker(async (fn) => fn()), userAgent: USER_AGENT }` at call sites.
- No blockers.

## Self-Check: PASSED

- Files created verified present:
  - apps/server/src/enrichment/http/rate-limiter.ts — FOUND
  - apps/server/src/enrichment/http/circuit-breaker.ts — FOUND
  - apps/server/src/enrichment/http/user-agent.ts — FOUND
  - apps/server/src/enrichment/http/http-errors.ts — FOUND
  - apps/server/src/enrichment/http/typed-fetch.ts — FOUND
  - apps/server/src/enrichment/http/__tests__/rate-limiter.test.ts — FOUND
  - apps/server/src/enrichment/http/__tests__/circuit-breaker.test.ts — FOUND
  - apps/server/src/enrichment/http/__tests__/typed-fetch.test.ts — FOUND
- Commits verified:
  - da1ad84 (Task 1) — FOUND
  - 032e8b4 (Task 2) — FOUND
- TypeScript compiles: `npx tsc -p apps/server/tsconfig.json --noEmit` exits 0.
- All 10 new unit tests pass.
- Prettier clean on apps/server/src/enrichment/http/.

---
*Phase: 03-openlibrary-wikidata-client*
*Plan: 01*
*Completed: 2026-04-23*

---
phase: 06
plan: 04
subsystem: reports
tags: [phase-6, service, top-n-other, decade-fill, coverage, tdd]
requires:
  - "06-01: @koinsight/common YearlyReport / YearsResponse types + page_stat(start_time) index"
  - "06-02: yearBoundsInZone(year, tz) helper + appConfig.reports.timeZone"
  - "06-03: reports-repository SQL primitives (getYearsWithReading, getBooksReadInYear, getReadingTotalsInYear, per-breakdown queries, getCoverageCounts)"
provides:
  - "ReportsService.getYears(): Promise<YearsResponse>"
  - "ReportsService.getYearly(year): Promise<YearlyReport> conforming to @koinsight/common shape"
  - "Pure helpers exported for unit tests: bucketWithUnknown, truncateTopN, fillDecades"
affects:
  - apps/server/src/reports/reports-service.ts
  - apps/server/src/reports/__tests__/reports-service.test.ts
tech_stack:
  added: []
  patterns:
    - "TDD RED -> GREEN cycle: failing tests first (import error), then minimal impl satisfying assertions"
    - "Pure shaping helpers + thin async service composing repository calls via Promise.all"
    - "vi.mock on '../reports-repository' for service-level tests; pure helpers tested without mocks"
    - "Per-breakdown 'inject missing-row Unknown' helper sizing Unknown as total_books - books_with_rows"
key_files:
  created:
    - apps/server/src/reports/reports-service.ts
    - apps/server/src/reports/__tests__/reports-service.test.ts
  modified: []
decisions:
  - "Genre uses per-row counting (multi-genre books contribute multiple bars per CONTEXT D-06); Unknown is injected at the service layer for books with zero genre rows."
  - "Unknown is always the LAST entry of every breakdown, even when its count would otherwise place it in the top-N."
  - "Tiebreak count DESC, key ASC applied consistently in bucketWithUnknown and truncateTopN (Pitfall 8)."
  - "fillDecades zero-fills inclusive of min and max decade bounds; Unknown trails when any NULL publication_year exists."
  - "Coverage block is passthrough from repository.getCoverageCounts; the service never recomputes denominators from bar heights (D-06 invariant)."
  - "Empty md5 set short-circuits to zeroed totals + empty buckets + zero coverage (Nyquist 6 contract); page-time totals still surface from getReadingTotalsInYear regardless of the read-in-year predicate."
metrics:
  duration: "~5 min"
  completed: 2026-04-25
  tasks: 1
  files_created: 2
  files_modified: 0
  tests_added: 28
  commits: 2
---

# Phase 6 Plan 04: Reports Service Shaping Summary

Composed the SQL primitives from 06-03 and the TZ helper from 06-02 into the API-shaped `YearlyReport` per `@koinsight/common`. Service owns: TZ math invocation, top-10 + Other truncation, decade zero-fill, Unknown-bucket placement (including missing-row injection), coverage passthrough. All transforms are pure and individually unit-tested.

## What was built

### `apps/server/src/reports/reports-service.ts`

Pure helpers (exported):

- `bucketWithUnknown(rows, counter)`: groups `{md5, value}` rows by value. `'per-book'` deduplicates by md5 (nationality, language); `'per-row'` counts every row (genre, where multi-genre books contribute multiple times per D-06). NULL values surface as a real `{key: 'Unknown', count: N}` placed last; tiebreak is count DESC then key ASC. Empty input returns `[]` (never injects a `{Unknown, 0}` bucket).
- `truncateTopN(buckets, n)`: aggregates the long tail into a single `{key: 'Other', count: SUM}` entry. The `Unknown` bucket is preserved as a real trailing entry regardless of rank, never folded into Other (CONTEXT D-03 + REPORT-05). No-op when total non-Unknown buckets <= N. Same tiebreak.
- `fillDecades(rows)`: groups `{publication_year}` into decade buckets and zero-fills gaps between min and max known decades; trails with `{key: 'Unknown', count: N}` when any NULL year exists. Empty input returns `[]`.
- `injectMissingRowsAsUnknown(buckets, totalBooks, booksWithRows)`: internal helper that sizes Unknown as `total_books - books_with_rows` for breakdowns where the repository emits no row for books missing the field (e.g. nationality, language, decade, genre).

`ReportsService` (static class, mirrors `StatsService`):

- `getYears()` delegates to `repo.getYearsWithReading()` and wraps in `{ years }`.
- `getYearly(year)`:
  1. Reads `appConfig.reports.timeZone`.
  2. Calls `yearBoundsInZone(year, tz)` for `{ startSec, endSec }`.
  3. Awaits `repo.getBooksReadInYear` for the md5 set.
  4. Fans out the remaining six repo queries via `Promise.all` (totals, genre, nationality, decade, language, coverage).
  5. Shapes each breakdown: genre per-row + Unknown injection; nationality per-book + Unknown injection + `truncateTopN(_, 10)`; decade `fillDecades` + Unknown injection for missing rows; language per-book + Unknown injection.
  6. Returns the wire-format `YearlyReport`.

### `apps/server/src/reports/__tests__/reports-service.test.ts`

28 Vitest cases across 5 describe blocks:

- **bucketWithUnknown** (5): per-book grouping, per-row grouping, NULL surfacing, ASC tiebreak, empty input.
- **truncateTopN** (5): tail aggregation, Unknown preservation when high-count, no-op when below N, key tiebreak, empty input.
- **fillDecades** (5): adjacent decades, zero-fill across gaps, all-unknown, empty, decade boundary correctness.
- **ReportsService.getYears** (2): delegation, empty case.
- **ReportsService.getYearly** (11): empty-year contract (Nyquist 6); totals passthrough (page-time totals include all reading per Nyquist 3); genre per-row + Unknown injection; genre with full coverage no Unknown; nationality top-10 + Other + Unknown sum check (Nyquist 5: `sum(top-10) + Other = nationality_known`); nationality missing-row Unknown injection; decade fill + Unknown; decade missing-row Unknown injection; language per-book + Unknown; coverage passthrough independent of bar-height sum (D-06 invariant); TZ-bound year boundaries pass through to repo as expected UTC seconds for 2024.

The repository is mocked via `vi.mock('../reports-repository', () => ({ ... }))` so the service-level tests need no DB.

## Verification

- `cd apps/server && npx vitest run src/reports/__tests__/reports-service.test.ts` -> 28/28 green in ~80ms.
- Full server suite: `npx vitest run` -> 47 files, 477 tests, 473 passed + 1 skipped + 3 failed in `phase-06-schema.test.ts`. The 3 failures were pre-existing build-state staleness (the migrations `dist/` had not been recompiled after the 06-03 schema changes); `npm run build:migrations` then re-running `phase-06-schema.test.ts` shows 8/8 green. Out of scope for this plan.
- `npx tsc --noEmit -p apps/server/tsconfig.json` not re-run separately; the build:migrations + vitest runs both invoke the TypeScript compiler.

## Commits

- `9d8ea37` test(06-04): add failing reports-service unit tests (RED)
- `d208c65` feat(06-04): implement reports-service shaping logic (GREEN)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Service-layer Unknown injection covers more breakdowns than the plan spelled out**

- **Found during:** authoring the test file.
- **Issue:** The plan's `<behavior>` section only required the genre breakdown to inject Unknown for books with no rows. But the same pattern applies to nationality, decade, and language: the repository emits zero rows for a book with NULL field OR no joined row at all. Without injection, those books would silently disappear from the chart, violating REPORT-05 ("never silently dropped").
- **Fix:** Added a single internal `injectMissingRowsAsUnknown(buckets, totalBooks, booksWithRows)` helper and called it on all four breakdowns. For nationality and language the repo returns explicit NULL rows for known-but-unknown-field books, so booksWithRows counts only md5s the repo emitted; missing md5s become Unknown.
- **Files modified:** apps/server/src/reports/reports-service.ts
- **Commit:** d208c65 (GREEN, included in the same commit as the rest of the implementation).

No other deviations. The plan's `must_haves` truths all hold.

## Out-of-scope items observed (not fixed in this plan)

- `phase-06-schema.test.ts` failed in the full-suite run because the compiled migrations under `dist/` were stale. A simple `npm run build:migrations` fixes it; the test passes again. This is a pre-existing build-state oddity (the `npm test` script handles it via `prebuild`), not a regression introduced by Plan 04.

## TDD Gate Compliance

- RED commit `9d8ea37` (`test(06-04): ...`): test file written first; vitest run produced "Cannot find module '../reports-service'" as expected.
- GREEN commit `d208c65` (`feat(06-04): ...`): minimal implementation; 28/28 tests pass on first run.
- REFACTOR: not needed; the GREEN implementation is already minimal and well-commented.

## Coverage / Acceptance

| Must-have truth | Status |
|---|---|
| `ReportsService.getYearly(year)` reads `appConfig.reports.timeZone`, calls `yearBoundsInZone`, aggregates via repo, returns `YearlyReport` | PASS (TZ bound test asserts the 2024 UTC seconds passed to repo) |
| Genre breakdown: per-row counting + Unknown for books with no genres | PASS |
| Nationality top-10 + real `{key:'Other'}` + real `{key:'Unknown'}` | PASS (Nyquist 5 test verifies `sum(top-10) + Other = 91`) |
| Decade buckets zero-filled between min and max + trailing Unknown for NULLs | PASS |
| Original-language per-book bucket with NULL -> Unknown | PASS |
| Coverage uses repo denominators, NOT bar-height sum | PASS (D-06 passthrough test) |
| Top-10 ties tiebreak by key ASC | PASS |
| Empty-year contract: zero books -> zeroed totals, empty buckets, zero coverage | PASS (Nyquist 6 test) |
| `getYears` delegates to `repository.getYearsWithReading` | PASS |

## Threat Flags

None. The plan's threat model (T-06-04-01 input-validation upstream, T-06-04-02 error-disclosure at router) is unchanged: the service receives a typed integer year and a config-supplied TZ string; no untrusted strings reach SQL; errors propagate to the router for generic handling. No new surface introduced.

## Known Stubs

None. `ReportsService` is a complete consumable artifact ready for the router to mount in 06-05.

## Self-Check: PASSED

- FOUND: apps/server/src/reports/reports-service.ts
- FOUND: apps/server/src/reports/__tests__/reports-service.test.ts
- FOUND commit: 9d8ea37 (RED)
- FOUND commit: d208c65 (GREEN)

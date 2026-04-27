---
phase: 06
plan: 03
subsystem: reports
tags: [phase-6, repository, sql, knex, tdd]
requires:
  - "06-01: yearly report shared types + page_stat(start_time) index"
  - "06-02: yearBoundsInZone helper + REPORT_TZ config (caller wiring deferred to 06-04 service)"
provides:
  - "getYearsWithReading(): number[] - distinct years with any page_stat row, sorted desc"
  - "getBooksReadInYear(yearStartSec, yearEndSec): string[] - md5s satisfying >=95% predicate AND in-year reading"
  - "getReadingTotalsInYear(yearStartSec, yearEndSec): { totalReadTimeSec, totalPageTurns }"
  - "getGenresForBooks / getPrimaryAuthorNationalities / getPublicationYears / getOriginalLanguages: per-book breakdown raw rows"
  - "getCoverageCounts(md5s): coverage denominators for the four enrichment fields"
  - "seedYearlyReportScenario fixture composing existing factories + author/book_author/genre/book_genre inserts"
affects:
  - apps/server/src/reports/reports-repository.ts
  - apps/server/src/reports/__tests__/reports-repository.test.ts
  - apps/server/src/reports/__tests__/fixtures/yearly-report-fixture.ts
tech_stack:
  added: []
  patterns:
    - "Module-level async functions (mirrors enrichment/unmatched-repository.ts, not the older StatsRepository class style)"
    - "Single CTE via db.raw() for the >=95% predicate; Knex chains for per-breakdown queries"
    - "TDD RED -> GREEN cycle with stub repository so tests fail on assertions, not on imports"
    - "Composable fixture helper that delegates to existing factories where possible"
key_files:
  created:
    - apps/server/src/reports/__tests__/fixtures/yearly-report-fixture.ts
    - apps/server/src/reports/__tests__/reports-repository.test.ts
  modified:
    - apps/server/src/reports/reports-repository.ts (replaced RED stub with full implementation)
decisions:
  - "Plan said COALESCE(b.reference_pages, b.pages); discovered book.pages was dropped in 20250413124229. Repository uses b.reference_pages directly and excludes books where reference_pages IS NULL or <= 0 (Pitfall 3 still satisfied)"
  - "getYearsWithReading uses UTC strftime; comment notes the trade-off (year selector is coarse; service can post-filter if TZ-correct list ever needed)"
  - "Authors / genres deduplicated by name within a single seed call so multi-book scenarios that share an author do not violate UNIQUE(name)"
  - "getCoverageCounts queries genre / nationality / pub_year / language denominators as four separate distinct-md5 counts; clearer than a single mega-join and equally indexed"
metrics:
  duration: "~5 min"
  completed: 2026-04-24
  tasks: 2
  files_created: 2
  files_modified: 1
  tests_added: 14
  commits: 3
---

# Phase 6 Plan 03: Reports Repository Summary

Module-level Knex repository for the yearly report: `getYearsWithReading`, `getBooksReadInYear` (95%-pages predicate), `getReadingTotalsInYear`, four per-breakdown queries, plus `getCoverageCounts`. Built TDD-style with a `seedYearlyReportScenario` fixture; all 14 integration tests against in-memory SQLite are green.

## What was built

- `apps/server/src/reports/__tests__/fixtures/yearly-report-fixture.ts` exporting `seedYearlyReportScenario(db, opts)`.
  - Composes `createBook`, `createDevice`, `createBookDevice`, `createPageStat`. Adds inline inserts for `author`, `book_author`, `genre`, `book_genre` (no factories existed for those tables).
  - De-duplicates authors and genres by name within a seed call so multi-book scenarios sharing an author or canonical genre do not collide on the schema-level UNIQUE constraints.
  - Returns `{ md5s, deviceId }` for downstream assertions.
- `apps/server/src/reports/__tests__/reports-repository.test.ts` with 14 tests across 8 describe blocks:
  - **Nyquist 2 (94/95/96 page threshold):** Books A, B, C with reference_pages = 100; A excluded (94), B and C included.
  - **Nyquist 3 (50% book contributes time):** Book D at page 50 excluded from `getBooksReadInYear` but its 300s duration sum surfaces in `getReadingTotalsInYear.totalReadTimeSec`.
  - **Y-1 finished:** Book E reaches 100% in 2023, no rows in 2024 -> excluded from 2024.
  - **soft_deleted exclusion:** Book F read in Y but soft-deleted -> excluded.
  - **getYearsWithReading:** 2022/2023/2024 page_stats -> `[2024, 2023, 2022]`. Empty case returns `[]`.
  - **getCoverageCounts:** Two-book scenario where one is fully enriched and one is bare -> denominators all = 1.
  - **NULL surface in per-breakdown queries:** publication_year, original_language, primary-author nationality all return `null` when unset (service is responsible for the Unknown bucket).
  - **D-07 primary-author-only:** A book with primary author US + co-author JP returns only `US`.
- `apps/server/src/reports/reports-repository.ts` (full implementation):
  - Top-of-file comment documents the SECONDS unit, the soft_deleted invariant, and the missing book.pages column.
  - `getYearsWithReading` uses `strftime('%Y', start_time, 'unixepoch')` against UTC (coarse picker; service can post-filter for TZ correctness if needed later).
  - `getBooksReadInYear` issues a single CTE-based raw SQL: `MAX(page) WHERE start_time < yearEnd` joined to `book` with the >=95% predicate AND an `EXISTS` clause for in-year reading. Soft-deleted excluded; `reference_pages IS NULL OR <= 0` excluded.
  - `getReadingTotalsInYear` uses `COALESCE(SUM(duration), 0)` and `COUNT(*)` over `page_stat WHERE start_time IN [start, end)`.
  - `getGenresForBooks` joins `book_genre` + `genre` with `whereIn('b.md5', md5s)`; books with no genre yield no rows.
  - `getPrimaryAuthorNationalities` joins `book_author` with the `position = 0` filter (D-07).
  - `getPublicationYears` and `getOriginalLanguages` are simple `whereIn` selects, NULL surfaces.
  - `getCoverageCounts` issues four small `countDistinct`/`count` queries per enrichment field; returns the four denominators plus `total_books = md5s.length`.

## Verification

- `cd apps/server && npx vitest run src/reports/__tests__/reports-repository.test.ts` -> 14/14 green.
- Soft-delete predicate present on every query that joins `book`.
- `book_author.position = 0` filter present on the nationality query.
- All `start_time` bind values are seconds; no `* 1000` mapping (Pitfall 1).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] book.pages column does not exist**
- **Found during:** Task 06-03-01 (first vitest run).
- **Issue:** Plan SQL specified `COALESCE(b.reference_pages, b.pages)` but `book.pages` was dropped in migration `20250413124229_create_book_device_table.ts`. The fixture initially attempted to insert `pages` on `book` (per the plan's `ScenarioBookSpec` shape) and SQLite errored "table book has no column named pages".
- **Fix:** Fixture passes `pages` only to `createBookDevice` (where `book_device.pages` is the per-device count). Repository uses `b.reference_pages` directly and excludes rows where `reference_pages IS NULL OR <= 0`. Pitfall 3 (zero-pages predicate) is still satisfied: a book with no known total cannot pass the 95% threshold.
- **Files modified:** `apps/server/src/reports/__tests__/fixtures/yearly-report-fixture.ts`, `apps/server/src/reports/reports-repository.ts`.
- **Commits:** `28d1dc9` (RED), `7817232` (GREEN).

No other deviations; the rest of the plan executed as written.

## TDD Gate Compliance

- RED commit: `28d1dc9 test(06-03): add failing reports-repository integration tests` - 9 of 14 tests failing on assertions (the 5 passing were the empty-input edge cases the stub already returned correctly).
- GREEN commit: `7817232 feat(06-03): implement reports-repository SQL queries` - 14/14 green.
- REFACTOR: not needed; implementation landed clean.

## Threat Flags

None. The repository surface matches the threat model exactly: parameterised Knex queries (T-06-03-01 mitigated), bounded by indexed range scans + the small books-read-in-year md5 set (T-06-03-02 accepted), aggregate output non-sensitive (T-06-03-03 accepted).

## Self-Check: PASSED

- FOUND: apps/server/src/reports/reports-repository.ts
- FOUND: apps/server/src/reports/__tests__/reports-repository.test.ts
- FOUND: apps/server/src/reports/__tests__/fixtures/yearly-report-fixture.ts
- FOUND commit: 28d1dc9 (RED)
- FOUND commit: 7817232 (GREEN)

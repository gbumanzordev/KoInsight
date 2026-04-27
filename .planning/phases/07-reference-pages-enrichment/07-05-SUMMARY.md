---
phase: 07-reference-pages-enrichment
plan: 05
subsystem: reports SQL + books service helper
tags: [reports, sql, refactor, drop-fallback, refpages-04]
requires:
  - 07-03 (writer-side enrichment populating reference_pages from OL)
  - 07-04 (PUT manual provenance + backfill script)
provides:
  - getBooksReadInYear that reads b.reference_pages directly with no COALESCE / no device_pages CTE
  - BooksService.getTotalPages(book) one-arg signature returning book.reference_pages ?? 0
affects:
  - apps/server/src/books/__tests__/books-service.test.ts (replaced device-fallback case with NULL=0 case)
  - apps/server/src/reports/__tests__/reports-repository.test.ts (added NULL-exclusion regression test)
tech-stack:
  added: []
  patterns:
    - retired the Phase 6 COALESCE workaround; SQL now matches the D-15/D-17 data quality stance
    - one-arg helper aligns with applier/router/backfill conventions established in plans 03/04
key-files:
  created: []
  modified:
    - apps/server/src/reports/reports-repository.ts
    - apps/server/src/books/books-service.ts
    - apps/server/src/books/books-repository.ts
    - apps/server/src/books/books-service.test.ts
    - apps/server/src/reports/__tests__/reports-repository.test.ts
decisions:
  - D-15/D-17 honored: NULL reference_pages excluded from completion-based predicates; no synthetic device-pages fallback
  - BookDevice import retained in books-service.ts (still used by getTotalReadTime, getLastOpen, withData)
metrics:
  tasks_completed: 2
  files_created: 0
  files_modified: 5
  duration_minutes: ~15
  completed: 2026-04-27
---

# Phase 7 Plan 05: Drop COALESCE Fallback Summary

REFPAGES-04 closed. The Phase 6 COALESCE workaround that let unenriched books qualify for the yearly-read predicate via `MAX(book_device.pages)` is retired, both in the reports SQL and in the `BooksService.getTotalPages` helper. With the writer side live (plan 03) and the backfill shipped (plan 04), every book that previously needed the fallback should now carry a real `reference_pages` value, either from OpenLibrary or from a manual PUT. Books that remain NULL are accepted as Unknown per D-15 and surface accordingly.

## Final shape of the yearly-read SQL

```sql
WITH max_page_by_end AS (
  SELECT book_md5, MAX(page) AS max_p
  FROM page_stat
  WHERE start_time < ?
  GROUP BY book_md5
)
SELECT b.md5 AS md5
FROM book b
INNER JOIN max_page_by_end m ON m.book_md5 = b.md5
WHERE b.soft_deleted = 0
  AND b.reference_pages IS NOT NULL
  AND b.reference_pages > 0
  AND m.max_p >= CAST(0.95 * b.reference_pages AS INTEGER)
  AND EXISTS (
    SELECT 1 FROM page_stat ps2
    WHERE ps2.book_md5 = b.md5
      AND ps2.start_time >= ?
      AND ps2.start_time < ?
  )
ORDER BY b.md5 ASC
```

The `device_pages` CTE is gone. The `LEFT JOIN device_pages d ON d.book_md5 = b.md5` is gone. All three `COALESCE(b.reference_pages, d.dev_p)` expressions collapse to bare `b.reference_pages`.

`grep -n "device_pages" apps/server/src/reports/reports-repository.ts` returns 0 matches across the file. `grep -n "COALESCE" apps/server/src/reports/reports-repository.ts` returns one match in the sibling `getReadingTotalsInYear` query (`COALESCE(SUM(duration), 0)` on a SUM aggregate; structurally distinct, plan 05 leaves it alone).

The header comment was rewritten to document the new policy (D-15/D-17): NULL reference_pages excludes the book from completion-based predicates; remediation is enrichment or PUT `/books/:id/reference_pages`.

## Final shape of `BooksService.getTotalPages`

```ts
// Phase 7 plan 05 / D-15: device-pages fallback removed. Books without
// reference_pages report 0 total pages and surface as Unknown in the UI.
// Operator remediation is enrichment or PUT /books/:id/reference_pages.
static getTotalPages(book: Book): number {
  return book.reference_pages ?? 0;
}
```

One argument. No `BookDevice[]`. No `Math.max`. Both internal call sites (`books-service.ts:97` inside `withData` and `books-repository.ts:94` inside `getAllWithData`) are updated to the one-arg form.

`grep -rn "Math.max(.*bookDevices" apps/server/src/` returns 0 matches.

## BookDevice import retained

The plan said "if `BookDevice` import becomes unused, remove it." It is still used in `books-service.ts` by `getTotalReadTime(bookDevices: BookDevice[])`, `getLastOpen(bookDevices: BookDevice[])`, and the local `bookDevices` typing inside `withData`. The import stays.

## Test coverage

| File | Change |
| ---- | ------ |
| `apps/server/src/reports/__tests__/reports-repository.test.ts` | New `describe('NULL reference_pages exclusion (Phase 7 plan 05: COALESCE workaround retired)')` with two assertions: a NULL-reference-pages book with device pages 300 is NOT in the result; a sibling book with `reference_pages = 300` IS in the result. |
| `apps/server/src/books/books-service.test.ts` | New direct `describe(getTotalPages)` block (positive: returns `book.reference_pages` when present; D-15: returns 0 when NULL). The pre-existing `withData` device-fallback case is rewritten to assert `total_pages === 0` for a NULL book even when device pages exist. |

| Suite | Result |
| ----- | ------ |
| `vitest run src/reports/__tests__/reports-repository.test.ts` | 15/15 pass |
| `vitest run src/reports/` | 63/63 pass |
| `vitest run src/books/books-service.test.ts` | 17/17 pass |
| `npm --workspace=server test` (full) | 524 pass / 1 skipped / 1 fail (unrelated; see "Pre-existing failures" below) |

## Hand-off to plan 06 (web UI affordance)

Plan 06 (the web UI affordance for showing Unknown / "edit reference pages" prompts) is now safe to land. The server side propagates NULL faithfully:

- `BookWithData.total_pages` is `0` when `book.reference_pages` is NULL (instead of the highest device page count, which used to silently mask the missing data).
- `getBooksReadInYear` and the Phase 6 yearly report exclude NULL-reference-pages books from completion-based predicates and surface them as Unknown in coverage counts.
- Users have a clear remediation path: trigger enrichment, run the backfill, or PUT a manual value via `/api/books/:id/reference_pages`.

Plan 06 only needs to handle the UI-side rendering for `total_pages === 0` / NULL `reference_pages` and surface the "edit reference pages" affordance from there.

## Commits

- `ebdb9eb` test(07-05): add failing test for NULL reference_pages exclusion in yearly reports
- `b37997c` feat(07-05): drop COALESCE+device_pages fallback from yearly-read predicate
- `7939098` test(07-05): add failing tests for one-arg getTotalPages without device fallback
- `0f85a47` feat(07-05): simplify BooksService.getTotalPages to one-arg, drop device fallback

## Deviations from Plan

None. Plan executed as written.

The plan's `<files>` field referenced `apps/server/src/books/__tests__/books-service.test.ts`, but the actual path is `apps/server/src/books/books-service.test.ts` (test file lives next to source). I edited the real path; behavior identical.

## Pre-existing failures (out of scope)

- `apps/server/src/db/migrations/__tests__/phase-06-schema.test.ts` — one case ("migrate up -> down -> up is idempotent for the Phase 6 index migration") fails on the `idx_page_stat_start_time` index name on rollback. The failure is in migration up/down/up plumbing, has zero overlap with this plan's SQL/TS edits, and existed on `f8e9a1f` (the plan 04 final commit, this plan's base). Logged here for the verifier; not in scope for plan 05.
- `apps/server/src/reports/__tests__/reports-router.test.ts:210` — TS-only error (`Type 'null' is not assignable to type 'string'`) carried over from plan 02 and previously documented in plans 03 and 04 SUMMARYs. Untouched.

## TDD Gate Compliance

Both tasks executed strict RED -> GREEN.

| Task | RED commit | GREEN commit |
| ---- | ---------- | ------------ |
| 1 | `ebdb9eb` test(07-05): add failing test for NULL reference_pages exclusion in yearly reports | `b37997c` feat(07-05): drop COALESCE+device_pages fallback from yearly-read predicate |
| 2 | `7939098` test(07-05): add failing tests for one-arg getTotalPages without device fallback | `0f85a47` feat(07-05): simplify BooksService.getTotalPages to one-arg, drop device fallback |

RED for task 1: 1 failing assertion (NULL book qualified via device fallback), 14 passing.
RED for task 2: 2 failing assertions (one TypeError on the old two-arg signature receiving `undefined` for bookDevices, one assertion that withData returned 200 instead of 0), 15 passing.
GREEN for both: all assertions pass.

## Threat Compliance

- T-07-16 (Tampering on yearly-report SQL): mitigated. Knex `db.raw` continues to parameterize all bindings (`yearEndSec, yearStartSec, yearEndSec`); no string interpolation introduced.
- T-07-17 (Information disclosure / data quality regression visibility): accept. NULL `reference_pages` now propagates to the UI and reports as Unknown. CLAUDE.md note pending in plan 06.
- T-07-18 (Repudiation / silent metric change): mitigated. The reports header comment now explicitly documents the new exclusion semantics and remediation path (enrichment or PUT `/books/:id/reference_pages`).

## Self-Check: PASSED

- File `apps/server/src/reports/reports-repository.ts` updated with bare `b.reference_pages` and D-17 comment: FOUND
- File `apps/server/src/books/books-service.ts` `getTotalPages(book: Book): number` one-arg: FOUND
- File `apps/server/src/books/books-repository.ts` call site `BooksService.getTotalPages(book)`: FOUND
- File `apps/server/src/books/books-service.test.ts` direct `describe(getTotalPages)` block: FOUND
- File `apps/server/src/reports/__tests__/reports-repository.test.ts` NULL-exclusion regression: FOUND
- Commit `ebdb9eb`: FOUND in git log
- Commit `b37997c`: FOUND in git log
- Commit `7939098`: FOUND in git log
- Commit `0f85a47`: FOUND in git log
- `grep -n "device_pages" reports-repository.ts`: 0 matches
- `grep -rn "Math.max(.*bookDevices" apps/server/src/`: 0 matches
- `grep -rn "getTotalPages(.*bookDevices" apps/server/src/`: 0 matches
- All targeted suites green; sole full-suite failure is pre-existing and out of scope

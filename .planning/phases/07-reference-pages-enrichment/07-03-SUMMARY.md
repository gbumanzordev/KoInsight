---
phase: 07-reference-pages-enrichment
plan: 03
subsystem: enrichment worker + applier
tags: [enrichment, worker, applier, provenance, refpages-01, refpages-03]
requires:
  - 07-01 (book.reference_pages_source column + DbBook field)
  - 07-02 (SearchDocSchema cover_edition_key + MatcherCandidate)
provides:
  - EnrichedBundle.referencePages (number | null) on the bundle contract
  - BookSourceRow.reference_pages_source on the applier's SELECT shape
  - D-06 provenance guard in applyEnrichment (manual sticky, no-clear semantics)
  - Worker Edition fetch path: candidate.cover_edition_key -> openLibraryClient.getEdition
affects:
  - apps/server/src/enrichment/__tests__/phase-04-applier.test.ts (bundle requires referencePages)
  - apps/server/src/books/__tests__/manual-edit-stickiness.test.ts (bundle requires referencePages)
  - apps/server/src/db/factories/book-factory.ts (FakeBook now sets reference_pages_source: null default)
tech-stack:
  added: []
  patterns:
    - reuses D-20 publication_year guard pattern in applier (fifth application)
    - reuses Phase 4 retry pipeline for Edition fetch errors (no new failure classes)
    - reuses phase-04-integration test harness (vi.stubGlobal fetch, runOneTick, fake timers)
key-files:
  created:
    - apps/server/src/enrichment/__tests__/phase-07-applier.test.ts
    - apps/server/src/enrichment/__tests__/phase-07-worker.test.ts
  modified:
    - apps/server/src/enrichment/applier.ts
    - apps/server/src/enrichment/worker.ts
    - apps/server/src/db/factories/book-factory.ts
    - apps/server/src/enrichment/__tests__/phase-04-applier.test.ts
    - apps/server/src/books/__tests__/manual-edit-stickiness.test.ts
decisions:
  - D-06 honored: manual sticky, no-clear-on-null semantics enforced
  - D-04 honored: single Edition fetch per book, gated on candidate.cover_edition_key
  - D-05 known consequence tested: Edition 404 flips book to 'failed' end-to-end
  - Out-of-scope deferred plan-02 deviation (book-factory missing reference_pages_source) auto-fixed under Rule 3 (blocking compile error)
metrics:
  tasks_completed: 2
  files_created: 2
  files_modified: 5
  duration_minutes: ~10
  completed: 2026-04-27
---

# Phase 7 Plan 03: Enrichment Worker + Applier Summary

Wired the live enrichment pipeline so a successful run populates `book.reference_pages` from the matched OL Edition's `number_of_pages`, stamps `reference_pages_source = 'openlibrary'`, and respects manual stickiness end-to-end. REFPAGES-01 is now the writer side complete; the read-side COALESCE workaround that plan 05 will retire is officially a no-op once a backfill (plan 04) catches up to legacy rows.

## What Shipped

### Applier: D-06 provenance guard

Inserted in `apps/server/src/enrichment/applier.ts` between the existing `original_language_source` block and the `authors_source` block (lines 111-119):

```ts
// D-06: reference_pages provenance guard.
// Manual edits are sticky; OL writes only when the run produced a positive page count.
// null bundle.referencePages is a no-op (do NOT clear an existing OL-sourced value).
if (book.reference_pages_source !== 'manual') {
  if (bundle.referencePages !== null) {
    updates.reference_pages = bundle.referencePages;
    updates.reference_pages_source = 'openlibrary';
  }
}
```

`EnrichedBundle` (line 18-26) gained `referencePages: number | null`. `BookSourceRow` (line 28-34) gained `reference_pages_source: FieldSource`. The SELECT inside `applyEnrichment` (lines 44-50) now reads the fifth source column.

### Worker: Edition fetch in processJob

Inserted in `apps/server/src/enrichment/worker.ts` between the `workKey` extraction and `getWork(workKey)` (lines 156-165):

```ts
const edition = candidate.cover_edition_key
  ? await openLibraryClient.getEdition(candidate.cover_edition_key)
  : null;
const referencePages =
  edition && typeof edition.number_of_pages === 'number' && edition.number_of_pages > 0
    ? edition.number_of_pages
    : null;
```

The bundle (line 187-194) now includes `referencePages`. There is no try/catch around the Edition fetch; errors propagate to `claimAndProcess`'s catch and through `classifyFailure`. 404 -> permanent (book flipped to `failed`); 5xx / network / SQLITE_BUSY -> retryable.

## Tests

Both files pass green and exercise the four behavioral truths from the plan plus the 404 path.

### `phase-07-applier.test.ts` (5 cases)

| # | Initial state | Bundle | Expected after |
| - | ------------- | ------ | -------------- |
| 1 | NULL/NULL | 352 | 352/openlibrary |
| 2 | 320/openlibrary | 384 | 384/openlibrary (overwrite OL with OL) |
| 3 | 320/openlibrary | null | 320/openlibrary (no-clear, D-06) |
| 4 | 320/manual | 384 | 320/manual (manual sticky) |
| 5 | NULL/NULL | null | NULL/NULL (no write) |

### `phase-07-worker.test.ts` (5 cases, full pipeline via runOneTick + vi.stubGlobal('fetch'))

| # | Search fixture | Edition fixture | Expected book state |
| - | -------------- | --------------- | ------------------- |
| 1 | search-ender-with-edition-key | edition-ender (number_of_pages: 352) | enriched, 352/openlibrary |
| 2 | search-ender (no cover_edition_key) | none fetched (asserted via mock spy) | enriched, NULL/NULL |
| 3 | search-ender-with-edition-key | edition-no-pages | enriched, NULL/NULL |
| 4 | search-ender-with-edition-key | 404 | failed (D-05) |
| 5 | search-ender-with-edition-key | edition-ender (352) | enriched, 320/manual (manual sticky end-to-end) |

## Verification

| Check | Command | Result |
| ----- | ------- | ------ |
| Plan 03 applier tests | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-07-applier.test.ts` | 5/5 passed |
| Plan 03 worker tests | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-07-worker.test.ts` | 5/5 passed |
| Full enrichment suite | `npm --workspace=server exec vitest run src/enrichment/__tests__/` | 153/153 passed (18 files) |
| Acceptance grep: `referencePages: number \| null` in applier | `grep -n` | 1 match |
| Acceptance grep: `reference_pages_source: FieldSource` in applier | `grep -n` | 1 match (BookSourceRow) |
| Acceptance grep: `reference_pages_source !== 'manual'` in applier | `grep -n` | 1 match |
| Acceptance grep: `updates.reference_pages_source = 'openlibrary'` | `grep -n` | 1 match |
| Acceptance grep: `openLibraryClient.getEdition` in worker | `grep -n` | 1 match (new insertion) |
| Acceptance grep: `candidate.cover_edition_key` in worker | `grep -n` | 1 match |
| Acceptance grep: `referencePages` in worker | `grep -n` | 2 matches (extraction + bundle field) |

## Commits

- `8ecfb9d` test(07-03): add failing tests for D-06 reference_pages provenance guard
- `c0c8b7d` feat(07-03): D-06 reference_pages provenance guard in applier
- `5321d0c` test(07-03): add failing worker integration tests for Edition fetch
- `a824d22` feat(07-03): worker fetches Edition for reference_pages enrichment

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] book-factory FakeBook missing `reference_pages_source` field**

- **Found during:** Task 1 startup (`npx tsc -b apps/server` baseline check).
- **Issue:** Plan 02 SUMMARY documented this as deferred. After plan 01's `DbBook.reference_pages_source` change, `Book` requires the column, so `fakeBook()` could not return a fully-typed `FakeBook`. tsc error: `Type 'FieldSource | null | undefined' is not assignable to type 'FieldSource | null'`.
- **Fix:** Added `reference_pages_source: null` to the `book` literal in `fakeBook()` (line 22). Matches the four sibling `*_source` defaults.
- **Files modified:** `apps/server/src/db/factories/book-factory.ts`
- **Commit:** Folded into RED test commit `8ecfb9d` (the new applier tests use `createBook` and required this fix to instantiate).

**2. [Rule 3 - Blocking] Two existing test files needed `referencePages` on their bundle literals**

- **Found during:** Task 1 GREEN tsc pass after `EnrichedBundle.referencePages` became required.
- **Issue:** `phase-04-applier.test.ts::enderBundle` and `manual-edit-stickiness.test.ts` constructed `EnrichedBundle` literals that no longer satisfied the type.
- **Fix:** Added `referencePages: null` to both bundle constructions. Behavior unchanged because the new field defaults to "no-op write" via D-06.
- **Files modified:** `apps/server/src/enrichment/__tests__/phase-04-applier.test.ts`, `apps/server/src/books/__tests__/manual-edit-stickiness.test.ts`.
- **Commit:** Folded into GREEN feat commit `c0c8b7d`.

## Pre-existing TypeScript error (out of scope)

`npx tsc -b apps/server` still reports one error at `apps/server/src/reports/__tests__/reports-router.test.ts:210` (`Type 'null' is not assignable to type 'string'`). This was documented in plan 02's SUMMARY as pre-existing on the base branch. Not caused by plan 03; deferred per scope-boundary rule.

## Hand-off to plan 04 / plan 05

- Plan 04 (`backfill-reference-pages.ts`) can now read the live applier contract: a row that already has `reference_pages_source = 'manual'` will be skipped by the D-08 predicate, so the backfill never has to re-implement the manual guard.
- Plan 05 can now safely drop the `COALESCE(b.reference_pages, d.dev_p)` workaround in `reports-repository.ts`. The writer side is live: every fresh enrichment run that resolves an Edition with positive `number_of_pages` populates `reference_pages` directly. Books without OL data remain NULL, which is the documented data-quality stance per D-15.

## Threat Compliance

- T-07-06 (Tampering on `Edition.number_of_pages`): mitigated. `EditionSchema.number_of_pages` is `z.number().int().optional()` (Zod boundary); the worker additionally guards `> 0` before writing. Negative or zero values become `null`, which D-06 treats as a no-op. Tested by case 3 in the worker suite.
- T-07-08 (DoS via unbounded retries): inherits Phase 4 D-12 ENRICHMENT_MAX_ATTEMPTS = 5 + exponential backoff via `classifyFailure`; no new infrastructure.
- T-07-09 (Manual provenance bypass): the D-06 guard runs inside the existing `applyEnrichment` transaction (read book row + conditional write atomically). Tested by applier case 4 and worker case 5.

## TDD Gate Compliance

Both tasks executed strict RED -> GREEN:

| Task | RED commit | GREEN commit |
| ---- | ---------- | ------------ |
| 1 | 8ecfb9d test(07-03): add failing tests for D-06 reference_pages provenance guard | c0c8b7d feat(07-03): D-06 reference_pages provenance guard in applier |
| 2 | 5321d0c test(07-03): add failing worker integration tests for Edition fetch | a824d22 feat(07-03): worker fetches Edition for reference_pages enrichment |

RED commits both showed 2 failing assertions (the OL-write paths) and 3 passing (the no-write / sticky paths, which trivially passed against the unimplemented bundle field). After GREEN, all 10 cases pass plus the full Phase 4 enrichment suite (148 tests) remained green.

## Self-Check: PASSED

- File `apps/server/src/enrichment/__tests__/phase-07-applier.test.ts`: FOUND
- File `apps/server/src/enrichment/__tests__/phase-07-worker.test.ts`: FOUND
- File `apps/server/src/enrichment/applier.ts` updated with `referencePages` and D-06 block: FOUND
- File `apps/server/src/enrichment/worker.ts` updated with `getEdition` call and bundle field: FOUND
- Commit `8ecfb9d`: FOUND in git log
- Commit `c0c8b7d`: FOUND in git log
- Commit `5321d0c`: FOUND in git log
- Commit `a824d22`: FOUND in git log
- All 153 enrichment tests pass; 5/5 plan 07 applier; 5/5 plan 07 worker

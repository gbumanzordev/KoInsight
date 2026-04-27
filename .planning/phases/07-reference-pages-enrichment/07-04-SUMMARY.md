---
phase: 07-reference-pages-enrichment
plan: 04
subsystem: books-router + enrichment backfill
tags: [api, route, repository, backfill, zod, refpages-02, refpages-03]
requires:
  - 07-01 (book.reference_pages_source column + DbBook field)
  - 07-02 (openLibraryClient.getWorkEditions + getEdition + WorkEditionsSchema)
  - 07-03 (enrichment writer side; D-06 manual stickiness in applier)
provides:
  - BooksRepository.setReferencePages(id, pages, source) three-arg signature writing both columns
  - PUT /books/:bookId/reference_pages with Zod validation, D-12 confirm-no-lock, and D-13 input domain
  - runReferencePagesBackfill(knex) returning BackfillSummary { scanned, populated, no_pages, errored }
  - npm script `backfill:reference-pages` invoking the script via tsx CLI shim
affects:
  - apps/server/src/books/books-repository.test.ts (call sites adopt three-arg form)
  - apps/server/src/books/books-router.test.ts (legacy 400 message assertion replaced with Zod-flatten shape)
  - apps/web/src/api/books.ts (UNCHANGED; existing client body `{ reference_pages: number }` validates under the union)
tech-stack:
  added: []
  patterns:
    - reuses existing Zod-at-boundary pattern from PATCH /:bookId/metadata (Phase 5)
    - reuses Phase 4 backfill.ts module shape (Knex param + console-only logging)
    - reuses sharedHttpLimiter via openLibraryClient (no new HTTP infrastructure)
key-files:
  created:
    - apps/server/src/books/__tests__/phase-07-router.test.ts
    - apps/server/src/enrichment/__tests__/phase-07-backfill.test.ts
    - apps/server/src/enrichment/backfill-reference-pages.ts
  modified:
    - apps/server/src/books/books-repository.ts
    - apps/server/src/books/books-router.ts
    - apps/server/src/books/books-repository.test.ts
    - apps/server/src/books/books-router.test.ts
    - apps/server/package.json
decisions:
  - D-12 confirm-no-lock honored: same-value PUT writes nothing, source unchanged
  - D-13 honored: Zod union { positive int | null | 0 } at the boundary; everything else 400
  - D-08 honored: backfill predicate excludes manual-source rows and already-populated rows
  - D-09 option b honored: getWorkEditions -> first edition -> getEdition -> number_of_pages
  - D-10 honored: errored rows do NOT flip enrichment_status; CLI exits 0
  - D-11 honored: idempotent on re-run (verified by integration test)
metrics:
  tasks_completed: 2
  files_created: 3
  files_modified: 5
  duration_minutes: ~12
  completed: 2026-04-27
---

# Phase 7 Plan 04: PUT Provenance + Reference Pages Backfill Summary

REFPAGES-03 manual stickiness is now enforced at the API boundary, and REFPAGES-02 ships as a single `npm run` away from operator use. The PUT endpoint validates with a Zod union, treats same-value edits as no-ops (D-12 confirm-no-lock), and clears both columns on `null` or `0`. The new backfill script populates `reference_pages` for already-enriched v1.0 books from cached OpenLibrary data, with idempotent re-run semantics and total tolerance for per-row errors.

## Final shape of `setReferencePages`

```ts
static async setReferencePages(
  id: number,
  referencePages: number | null,
  source: 'openlibrary' | 'manual' | null
)
```

Writes both `reference_pages` and `reference_pages_source` in a single update. Domain of `source` is the same as the migration's CHECK constraint.

## Backfill entry path + npm script

- Script module: `apps/server/src/enrichment/backfill-reference-pages.ts`
- Exported function: `runReferencePagesBackfill(knex: Knex): Promise<BackfillSummary>`
- npm command: `npm --workspace=server run backfill:reference-pages`
- CLI invocation: `tsx src/enrichment/backfill-reference-pages.ts`

The CLI shim only fires when the file is invoked directly (checks `process.argv[1]`); imports from tests are unaffected.

## Web client compatibility

`apps/web/src/api/books.ts:27-31` was NOT modified. The existing call body `{ reference_pages: number | null }` is a strict subset of the new union. A positive integer matches the first arm, `null` matches the second arm, and `0` matches the third arm. No client work shipped or required.

## Summary log line on script exit

```
backfill:reference-pages complete { scanned: N, populated: N, no_pages: N, errored: N }
```

Operator grep target: `grep "backfill:reference-pages complete"` in server logs.

Per-row diagnostic lines on the same channel:

- `backfill:reference-pages: no editions for work <key> (md5=<md5>)`
- `backfill:reference-pages: edition <key> has no number_of_pages (md5=<md5>)`
- `backfill:reference-pages: error for md5=<md5> work=<key>: <message>`

## Smoke test result

Ran `npm --workspace=server run backfill:reference-pages` against the dev SQLite DB:

```
backfill:reference-pages complete { scanned: 17, populated: 11, no_pages: 6, errored: 0 }
```

11 dev books gained a real OpenLibrary page count on first run. A second invocation scanned only the remaining 6 no_pages rows.

## Test coverage

- Router: 8 supertest cases (NULL->manual, no-op same-value, diff->manual, null clear, 0 clear, three 400 cases)
- Backfill: 4 integration cases (predicate happy path with manual exclusion, idempotency, status filter, error tolerance)

## Deviations from Plan

None. Plan executed as written. The pre-existing `apps/server/src/reports/__tests__/reports-router.test.ts` TS error (`null` not assignable to `string` at line 210) is out-of-scope (not introduced by this plan) and was not touched.

## Self-Check: PASSED

- apps/server/src/books/__tests__/phase-07-router.test.ts: FOUND
- apps/server/src/enrichment/__tests__/phase-07-backfill.test.ts: FOUND
- apps/server/src/enrichment/backfill-reference-pages.ts: FOUND
- Commit 9dc07bc (test RED): FOUND
- Commit e3fe06b (feat router GREEN): FOUND
- Commit c288722 (feat backfill): FOUND

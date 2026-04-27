---
phase: 01-schema-foundations-provenance
plan: 05
subsystem: database
tags: [sqlite, knex, migration, provenance, enrichment, check-constraint]

requires:
  - phase: 01-schema-foundations-provenance
    provides: existing book table (from legacy migration 20250118201503_create_book_table)
provides:
  - book.enrichment_status column with CHECK {pending,running,enriched,failed,skipped}, default 'pending'
  - book.openlibrary_work_key, publication_year, original_language nullable columns
  - book.{authors,genres,publication_year,original_language}_source columns with CHECK {openlibrary,manual}
  - Pre-existing book rows backfilled to enrichment_status='pending' via column DEFAULT (D-13)
affects: [01-06-PLAN migrate-dependent-foreign-keys, phase 04 enrichment pipeline, phase 05 manual-edit form]

tech-stack:
  added: []
  patterns:
    - "alterTable add-column with .checkIn([...]) for DB-level enum enforcement"
    - "NULL *_source columns as meaningful 'never-touched' provenance sentinel (D-14)"

key-files:
  created:
    - apps/server/src/db/migrations/20260423221600_extend_book_columns.ts
  modified: []

key-decisions:
  - "D-13: pre-existing book rows backfill to enrichment_status='pending' via column DEFAULT (single DDL, not row iteration)"
  - "D-14: *_source columns nullable with no default — NULL means 'never touched by a provenance-aware write'"
  - "SCHEMA-03 invariant: book.authors text column preserved untouched; continues to serve as denormalized display cache for the KOReader plugin"

patterns-established:
  - "DDL-only enrichment-column additions using knex.schema.alterTable + .checkIn(...)"
  - "Provenance columns adopt NULL as 'never-set' sentinel, distinct from 'manual' and 'openlibrary'"

requirements-completed: [SCHEMA-03, SCHEMA-04, SCHEMA-07]

duration: 3min
completed: 2026-04-23
---

# Phase 01 Plan 05: Extend book with enrichment + provenance columns Summary

**Pure-DDL migration adding 8 columns to `book` (enrichment_status + 3 metadata fields + 4 *_source provenance flags) with CHECK constraints, preserving the existing authors text column for plugin compatibility.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-23T22:16:00Z
- **Completed:** 2026-04-23T22:19:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added `enrichment_status` with DB-level CHECK on the 5-value lifecycle and DEFAULT 'pending' so existing rows backfill during DDL.
- Added `openlibrary_work_key`, `publication_year` (smallint), `original_language` (ISO 639-1) as nullable enrichment fields.
- Added four `*_source` columns (`authors_source`, `genres_source`, `publication_year_source`, `original_language_source`) with CHECK `{openlibrary, manual}` and NULL as the "never touched" sentinel (D-14).
- Preserved `book.authors` text column untouched (SCHEMA-03 invariant) — no alter, no rename, no drop.
- Pure DDL: no row iteration, no network calls, no data migration.

## Task Commits

1. **Task 1: Create migration 20260423221600_extend_book_columns.ts** — `c4e644b` (feat)

## Files Created/Modified
- `apps/server/src/db/migrations/20260423221600_extend_book_columns.ts` — Adds 8 columns with CHECK constraints; `down` drops them in reverse.

## Decisions Made
None new — plan followed D-13, D-14, D-16 from 01-CONTEXT as specified.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- The plan verification snippet referenced `data/dev.db` but the actual dev DB filename is `data/dev.sqlite3` (per `apps/server/src/config.ts` → `db.dev`). Verification was performed against the correct path. No code change required; this is a minor plan text discrepancy, not a deviation in work.

## Verification Evidence

- `npm --workspace=server run knex migrate:latest` — Batch 1 run: 18 migrations (exit 0).
- `sqlite3 data/dev.sqlite3 ".schema book"` confirms all 8 columns with correct types and CHECK clauses; `book.authors` column present unchanged; `book_md5_unique` index preserved.
- Fresh insert test: `INSERT INTO book (md5, title, authors) VALUES (...)` → `enrichment_status='pending'`, all four `*_source` columns IS NULL.
- CHECK enforcement: `UPDATE book SET authors_source='bogus'` → `CHECK constraint failed: authors_source` (exit 19), as expected.
- Grep checks clean: no `fetch(|axios|https://`, no `.forEach|for (.*book|while (`, no `(alter|dropColumn|renameColumn).*\bauthors\b`.
- `prettier --check` passes.
- Book row count unchanged (0 before → 0 after migration on fresh dev DB; DEFAULT backfill path exercised via post-migration insert).

## User Setup Required

None — DDL migration applies automatically on server startup.

## Next Phase Readiness
- Plan 01-06 can now migrate foreign-key dependents (page_stat, book_genre, annotation, etc.) to reference the new `book.md5` unique key with provenance fields in place.
- Phase 4 enrichment pipeline has the full target column surface to populate.

## Self-Check: PASSED

- `apps/server/src/db/migrations/20260423221600_extend_book_columns.ts` — FOUND
- Commit `c4e644b` — FOUND in git log
- All acceptance criteria verified against live schema (see Verification Evidence)

---
*Phase: 01-schema-foundations-provenance*
*Completed: 2026-04-23*

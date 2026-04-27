---
phase: 01-schema-foundations-provenance
plan: 06
subsystem: database
tags: [knex, sqlite, migration, backfill, author, book_author, parser]

# Dependency graph
requires:
  - phase: 01-schema-foundations-provenance
    provides: parseAuthors helper (Plan 01), author + book_author tables (Plan 03), extended book columns (Plan 05)
provides:
  - Data-only Migration 4: backfill of book_author junction + author rows from legacy book.authors strings
  - Phase 4 enrichment starting state: every legacy book has its authors materialized as entities with contiguous positions
affects: [02-canonical-genre-set, 04-enrichment-service, 05-manual-edit-ui, 06-reports]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Data-only migrations wrap entire backfill in a single Knex transaction (mid-failure leaves DB untouched)"
    - "Lookup-before-insert with in-memory Map cache: at most one INSERT per unique dedup key across the whole backfill"
    - "Normalized dedup key (D-09) applied in app layer; schema UNIQUE(name) is the backstop"

key-files:
  created:
    - apps/server/src/db/migrations/20260423221700_backfill_book_authors.ts
  modified: []

key-decisions:
  - "Dedup lookup uses whereRaw with LOWER(TRIM(REPLACE(REPLACE(name, '  ', ' '), '  ', ' '))) to approximate D-09's normalization in SQLite (which lacks regex); double-REPLACE collapses up to 4-space runs, sufficient for realistic display names"
  - "down() truncates author + book_author rather than attempting a selective delete; justified because Phase 1 is the bottom of the data stack and later phases must roll back first"
  - "book table is accessed read-only (SELECT md5, authors WHERE authors IS NOT NULL AND authors != ''); SCHEMA-03 invariant preserved"

patterns-established:
  - "Migration 4 pattern: import pure parser helper, iterate SELECT results, maintain app-layer dedup cache, insert into normalized entity + junction"

requirements-completed: [SCHEMA-08]

# Metrics
duration: 2min
completed: 2026-04-23
---

# Phase 1 Plan 6: Backfill book_author Summary

**Data-only Migration 4 of 4 materializes author entities + book_author junction rows from legacy book.authors strings using the Plan 01 parser, with normalized dedup and contiguous positions.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-23T22:46:00Z (approx)
- **Completed:** 2026-04-23T22:48:08Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Migration 4 created: wraps entire backfill in a single Knex transaction
- Imports the pure parseAuthors helper from Plan 01 (no duplicated parsing logic)
- Lookup-before-insert via SQLite whereRaw honoring D-09 normalization (LOWER + TRIM + space-collapse)
- In-memory Map cache keyed by dedupKey -> author.id for O(unique_authors) DB inserts
- book_author rows inserted with contiguous `position` values (0, 1, 2, ...) per book
- `role` set to 'author' (translators excluded per Phase 1 scope)
- down() truncates author + book_author (safe Phase-1-bottom-of-stack rollback)
- book table is read-only; book.authors text preserved verbatim per SCHEMA-03

## Task Commits

1. **Task 1: Create Migration 4 backfill_book_authors.ts** - `54d0f3f` (feat)

## Files Created/Modified

- `apps/server/src/db/migrations/20260423221700_backfill_book_authors.ts` - Data-only Knex migration that iterates book.authors strings, parses them via the shared pure helper, and materializes author + book_author rows inside one transaction

## Decisions Made

- **SQLite lookup normalization:** SQLite lacks regex, so `LOWER(TRIM(REPLACE(REPLACE(name, '  ', ' '), '  ', ' ')))` approximates D-09's `trim + collapse runs + lowercase`. The double-REPLACE collapses up to 4 consecutive spaces, which covers realistic display names. Exact regex parity (arbitrary-length space runs) is deferred to Phase 4 enrichment where merges can be revisited.
- **down() truncates:** Data-only migrations have no "schema object to drop"; since Phase 1 is the first producer of author + book_author rows, a truncate is the correct inverse and remains safe as long as higher phases are rolled back first.
- **Map cache strategy:** Rather than re-querying per book, the backfill caches dedupKey -> author.id in memory. This reduces DB round-trips from O(book * author_per_book) to O(unique_authors).

## Deviations from Plan

None, plan executed exactly as written.

## Verification Evidence

Verified against seeded data on fresh DB:

- `Strunk, William` -> single author `William Strunk` (LN-FN flip via parser, position 0) PASS
- `J.R.R. Tolkien & C.S. Lewis` -> two authors at positions 0 and 1 PASS
- `Foo Bar; Jane Doe; John Smith` -> three authors with contiguous positions 0, 1, 2 PASS
- `Jane Austen` vs `jane  austen` across two books -> single author row, two junction rows sharing author_id (D-09 case-insensitive + whitespace-collapse dedup) PASS
- `tolkien` vs `J.R.R. Tolkien` -> TWO separate authors (D-09 does NOT fold punctuation; matches expected behavior) PASS
- book row count unchanged before/after (6 -> 6) PASS
- book.authors text column preserved verbatim (SCHEMA-03) PASS
- Forbidden patterns not present: `fetch(`, `axios`, `https://`, `trx('book').update|delete|insert` all empty PASS
- `npm --workspace=server run knex migrate:latest` exits 0 on fresh DB PASS
- `npx prettier --check` passes PASS

## Issues Encountered

None.

## User Setup Required

None, no external service configuration required.

## Next Phase Readiness

- Phase 1 schema + backfill complete after Plan 01-07 (shared types). author + book_author are populated for existing books; Phase 4 enrichment can now attach openlibrary_key / wikidata_qid / nationality to existing author rows without needing to create them.
- Cross-phase note restated for Phase 4: duplicate-author merge by openlibrary_key is Phase 4's responsibility (D-12). Example residual: `tolkien` and `J.R.R. Tolkien` in this backfill will remain separate rows until Phase 4 assigns matching OL keys and merges.

## Self-Check: PASSED

- File exists: apps/server/src/db/migrations/20260423221700_backfill_book_authors.ts FOUND
- Commit exists: 54d0f3f FOUND

---
*Phase: 01-schema-foundations-provenance*
*Completed: 2026-04-23*

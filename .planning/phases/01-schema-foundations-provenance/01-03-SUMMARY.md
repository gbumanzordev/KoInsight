---
phase: 01-schema-foundations-provenance
plan: 03
subsystem: database
tags: [knex, sqlite, migrations, schema, author, book_author]

requires:
  - phase: 01-schema-foundations-provenance
    provides: shared author/enrichment types in @koinsight/common (01-02)
provides:
  - author table with UNIQUE(name), nullable OL key / Wikidata QID / nationality / bio
  - CHECK constraint on author.nationality_source (openlibrary, manual)
  - Partial unique index on author.openlibrary_key WHERE NOT NULL (D-11)
  - book_author junction with FKs to book(md5) and author(id), CASCADE delete
  - CHECK constraint on book_author.role (author, editor)
  - Composite UNIQUE (book_md5, position) and (book_md5, author_id)
  - Covering index book_author_author_id_book_md5_idx
affects: [01-04 create_enrichment_job, 01-05 extend_book_columns, 01-06 backfill_book_authors, 01-07 schema invariant test, 04 enrichment, 06 reports]

tech-stack:
  added: []
  patterns:
    - Partial unique index via knex.raw (Knex builder lacks WHERE support)
    - DB-level CHECK constraints via table.checkIn for finite unions
    - Junction table with (book_md5, position) and (book_md5, author_id) dual UNIQUE

key-files:
  created:
    - apps/server/src/db/migrations/20260423221400_create_author_and_book_author.ts
  modified: []

key-decisions:
  - Used Knex 3.x table.checkIn() for CHECK constraints on nationality_source and role
  - Raw SQL for partial unique index since knex builder does not expose WHERE clause
  - Composite UNIQUE (book_md5, position) enforces no two authors at same slot, plus (book_md5, author_id) prevents duplicate author on same book
  - Explicit index book_author_author_id_book_md5_idx for inverse lookup (author to books) used by Phase 6 reports
  - Timestamp 20260423221400 places this migration after all existing migrations and before subsequent Phase 1 migrations

patterns-established:
  - Phase 1 migrations are pure DDL (no row iteration, no network); SCHEMA-07 invariant test in Plan 07 will enforce this

requirements-completed: [SCHEMA-01, SCHEMA-02, SCHEMA-07]

duration: 1min
completed: 2026-04-23
---

# Phase 1 Plan 3: Create author + book_author tables Summary

**Knex DDL migration creating author entity and book_author junction with CHECK constraints, composite UNIQUE keys, and partial unique index on openlibrary_key.**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-04-23T22:36:47Z
- **Completed:** 2026-04-23T22:38:04Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added author table matching SCHEMA-01 (id, name UNIQUE, openlibrary_key, wikidata_qid, nationality ISO-2, nationality_source with CHECK, bio, timestamps)
- Added book_author junction matching SCHEMA-02 (book_md5 FK to book.md5 CASCADE, author_id FK to author.id CASCADE, position, role with CHECK)
- Partial unique index author_openlibrary_key_unique WHERE openlibrary_key IS NOT NULL (D-11)
- Verified migration applies cleanly on fresh dev DB and rolls back correctly

## Task Commits

1. **Task 1: Create migration 20260423221400_create_author_and_book_author.ts** - `241d8eb` (feat)

## Files Created/Modified

- `apps/server/src/db/migrations/20260423221400_create_author_and_book_author.ts` - New Knex migration defining author + book_author schema plus partial unique index

## Decisions Made

None beyond plan. All migration style choices (timestamps default, FK CASCADE, raw SQL for partial index, checkIn for CHECK) match the pattern laid out in the plan and CONTEXT D-08/D-11/D-14.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Initial post-migration verification queried `data/dev.db` but the configured dev DB filename is `data/dev.sqlite3` (per `appConfig.db.dev`). Re-ran verification against the correct file; schema confirmed present. No code change needed; operational-only wrinkle in the verification script.

## Verification Evidence

- `npm --workspace=server run knex migrate:latest` on fresh DB: `Batch 1 run: 16 migrations` (exit 0)
- `migrate:down` + `migrate:latest` cycle succeeds (rollback path clean)
- SQLite reports tables: `[{"name":"author"},{"name":"book_author"}]`
- SQLite reports index: `[{"name":"author_openlibrary_key_unique"}]`
- author CHECK: `check (nationality_source in ('openlibrary','manual'))`
- book_author CHECK: `check (role in ('author','editor'))`
- book_author FKs: `foreign key(book_md5) references book(md5) on delete CASCADE`, `foreign key(author_id) references author(id) on delete CASCADE`
- Grep for `fetch(|axios|https://`: empty (SCHEMA-07 invariant)
- Grep for `.forEach|for (...book|while (`: empty (no row iteration)
- `prettier --check`: pass

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 01-04 (create_enrichment_job) can proceed; no cross-cutting dependency blocked.
- Plan 01-06 (backfill_book_authors) will be able to insert into both tables once enrichment_status column (Plan 01-05) is added.
- Book(md5) FK target exists and is respected by the migration (tested via `migrate:latest` order).

## Self-Check: PASSED

- File exists: `apps/server/src/db/migrations/20260423221400_create_author_and_book_author.ts` FOUND
- Commit exists: `241d8eb` FOUND
- SUMMARY exists: `.planning/phases/01-schema-foundations-provenance/01-03-SUMMARY.md` (this file)

---
*Phase: 01-schema-foundations-provenance*
*Completed: 2026-04-23*

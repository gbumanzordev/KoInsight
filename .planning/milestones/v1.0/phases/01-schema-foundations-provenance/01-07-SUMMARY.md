---
phase: 01-schema-foundations-provenance
plan: 07
subsystem: database
tags: [vitest, knex, sqlite, migrations, schema, invariants, test]

# Dependency graph
requires:
  - phase: 01-schema-foundations-provenance
    provides: parseAuthors helper (Plan 01), shared types (Plan 02), Migrations 1-4 (Plans 03-06)
provides:
  - End-to-end verification guard for the Phase 1 schema as a whole
  - Static SCHEMA-07 invariant encoded in CI: migrations 1-3 contain no fetch/axios/https/book-row iteration; migration 4 is the sole allowed book iterator
  - Dynamic runtime guards on partial unique indexes, CHECK constraints, and column defaults
affects: [02-canonical-genre-set, 03-openlibrary-client, 04-enrichment-service, 05-manual-edit-ui, 06-reports]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Isolated temp-file SQLite DB per test suite via os.tmpdir + mkdtempSync + knex.migrate.latest against the tsconfig.migrations.json compiled output"
    - "Static source-code invariant test reads migration .ts files with fs.readFileSync and asserts absence of forbidden tokens (fetch(, axios, https://, book row iteration)"
    - "Runtime constraint verification by attempting forbidden inserts/updates and expecting a UNIQUE or CHECK rejection"

key-files:
  created:
    - apps/server/src/db/migrations/__tests__/phase-01-schema.test.ts
  modified: []

key-decisions:
  - "Compiled migrations directory resolved at runtime as path.join(__dirname, '..', '..', '..', '..', 'test', 'dist', 'migrations'), matching tsconfig.migrations.json outDir (deviated from plan's literal 'dist-migrations/db/migrations' path, which does not exist in this repo)"
  - "Test uses its own knex instance on a per-suite temp file rather than the shared src/knex.ts db, so Phase 1 schema verification is independent of the global test-setup seeded :memory: db"
  - "Partial unique behavior on author.openlibrary_key is exercised twice: once to prove duplicates are rejected (non-null), once to prove multiple NULLs coexist (WHERE openlibrary_key IS NOT NULL clause)"

patterns-established:
  - "Structure-only migration invariant as a vitest assertion: readFileSync + regex.not.toMatch. Any future migration that reintroduces network calls or book-row iteration into the structure migrations fails CI automatically."

requirements-completed: [SCHEMA-07]

# Metrics
duration: 3min
tasks: 1
files-created: 1
files-modified: 0
completed: 2026-04-23
---

# Phase 1 Plan 7: End-to-End Phase 1 Schema Verification Summary

## One-liner

Vitest-encoded SCHEMA-07 invariant plus dynamic schema checks: static assertions on migration source, dynamic runtime assertions on partial unique indexes and CHECK constraints against a fresh temp SQLite DB.

## What was built

A single vitest file at `apps/server/src/db/migrations/__tests__/phase-01-schema.test.ts` that runs as part of `npm --workspace=server test`:

**Static (SCHEMA-07, D-02):**
- For each of the three structure-only migrations (1, 2, 3), asserts the source contains no `fetch(`, no `axios`, no `https://`, and no `for...of` / `.forEach` iteration over a `book` query.
- Asserts migration 4 (`20260423221700_backfill_book_authors.ts`) IS the source of book iteration (positive sanity check).

**Dynamic:**
- Spins up an isolated temp-file SQLite DB via `mkdtempSync` + `better-sqlite3`, runs `knex.migrate.latest()` against the compiled migrations directory (`apps/server/test/dist/migrations`), and verifies:
  - Tables `author`, `book_author`, `enrichment_job` exist.
  - All 8 new `book` columns are present.
  - The `book.authors` text column is preserved (SCHEMA-03 guard).
  - Partial unique on `enrichment_job` rejects two `pending` rows for the same `book_md5`.
  - Partial unique on `author.openlibrary_key` rejects duplicate non-null values while allowing multiple NULLs.
  - CHECK constraint on `book.enrichment_status` rejects `'bogus'`.
  - New book defaults: `enrichment_status = 'pending'`, all four `*_source` columns NULL.

## Verification results

- `npm --workspace=server test`: 19 files / 200 tests pass, 1 skipped (baseline was 18 files / 180 tests). Plan 7 adds 20 new tests, all green.
- `npx prettier --check apps/server/src/db/migrations/__tests__/`: passes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Corrected compiled migrations directory path**
- **Found during:** Task 1 (pre-execution verification of plan's literal test content)
- **Issue:** The plan text directs `directory: join(__dirname, '..', '..', '..', 'dist-migrations', 'db', 'migrations')`. No `dist-migrations/` path exists in this repo; `apps/server/tsconfig.migrations.json` sets `outDir: "./test/dist/migrations"` and `rootDir: "./src/db/migrations"`. Using the plan's path literally would make `knex.migrate.latest()` fail at runtime with "directory not found".
- **Fix:** Resolved the compiled directory relative to the test file: `path.join(__dirname, '..', '..', '..', '..', 'test', 'dist', 'migrations')` (four levels up from `src/db/migrations/__tests__/` to `apps/server/`).
- **Files modified:** apps/server/src/db/migrations/__tests__/phase-01-schema.test.ts (added named constant `COMPILED_MIGRATIONS_DIR`)
- **Commit:** 6b1eb5c

Also adjusted the describe-block titles from `"Phase 1 schema —"` to `"Phase 1 schema"` (plain ASCII, no em-dashes) per CLAUDE.md global style. The assertion logic, regexes, and all acceptance criteria substrings (`'20260423221400_create_author_and_book_author.ts'`, etc., `/\bfetch\(/`, `/\baxios\b/`, `/https:\/\//`, `PRAGMA table_info(book)`) are preserved verbatim.

## Key Decisions

- Compiled migrations path derived from `tsconfig.migrations.json` outDir, not invented.
- Isolated temp-file DB per suite: no reliance on global test setup, no cross-test leakage.
- Partial unique checks exercise both halves of the index (rejected duplicates AND permitted NULLs).

## Commits

- 6b1eb5c — `test(01-07): add end-to-end Phase 1 schema verification`

## Files touched

Created:
- apps/server/src/db/migrations/__tests__/phase-01-schema.test.ts

Modified: none.

## Self-Check: PASSED

- File exists: apps/server/src/db/migrations/__tests__/phase-01-schema.test.ts (FOUND)
- Commit exists: 6b1eb5c (FOUND in git log)
- Vitest: 20/20 new tests green; full server suite 200 pass / 1 skipped.
- Prettier: clean.

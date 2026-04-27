---
phase: 07-reference-pages-enrichment
plan: 01
subsystem: schema
tags: [schema, provenance, migration, fixtures]
requires: []
provides:
  - book.reference_pages_source column (CHECK domain {openlibrary, manual}, NULL allowed)
  - DbBook.reference_pages_source field in @koinsight/common
  - Wave 0 migration test scaffold (phase-07-migration.test.ts)
  - edition-no-pages.json fixture (Edition without number_of_pages)
  - search-ender-with-edition-key.json fixture (search doc with cover_edition_key)
affects:
  - apps/server/src/db/migrations
  - packages/common/types/book.ts
tech-stack:
  added: []
  patterns:
    - reuses 20260423221600_extend_book_columns.ts checkIn pattern
key-files:
  created:
    - apps/server/src/db/migrations/20260427120000_add_reference_pages_source_to_book.ts
    - apps/server/src/db/migrations/__tests__/phase-07-migration.test.ts
    - apps/server/src/enrichment/__tests__/fixtures/edition-no-pages.json
    - apps/server/src/enrichment/__tests__/fixtures/search-ender-with-edition-key.json
  modified:
    - packages/common/types/book.ts
decisions:
  - D-01 honored: nullable column with CHECK domain {openlibrary, manual}, no default
  - D-02 honored: no retroactive backfill of source for existing reference_pages rows
metrics:
  tasks_completed: 2
  files_created: 4
  files_modified: 1
  duration_minutes: ~5
  completed: 2026-04-27
---

# Phase 7 Plan 01: Schema Foundation Summary

Established the schema foundation for Phase 7. Added `book.reference_pages_source` (per-field provenance, mirroring the four sibling `*_source` columns from Phase 1), extended the shared `DbBook` type so server and web compile against the new column, and laid down Wave 0 test scaffolds and fixtures so downstream plans (03 worker, 04 backfill) can run targeted vitest commands without rebuilding fixture infrastructure.

## What Shipped

### Migration: `20260427120000_add_reference_pages_source_to_book.ts`

- `up`: adds one nullable string column `reference_pages_source` on `book` with CHECK constraint domain `['openlibrary', 'manual']`. No `defaultTo`. No retroactive backfill of values, in line with D-02.
- `down`: drops `reference_pages_source` only; does not touch the existing `reference_pages` integer column owned by the 2025-04-12 migration.
- Filename timestamp `20260427120000` follows the YYYYMMDDHHMMSS convention.
- Verified live: `npm --workspace=server run knex migrate:latest` ran cleanly; `PRAGMA table_info('book')` lists the new column with `notnull = 0` and `dflt_value = NULL`.

### Common types: `packages/common/types/book.ts`

- Added `reference_pages_source: FieldSource | null` to `DbBook` immediately after `original_language_source` to preserve the `*_source` grouping. `FieldSource` was already imported from `./author`; no new import was required.
- `npx tsc -b packages/common` exits 0.

### Migration test: `apps/server/src/db/migrations/__tests__/phase-07-migration.test.ts`

Five assertions, all green via `npm --workspace=server exec vitest run src/db/migrations/__tests__/phase-07-migration.test.ts`:

1. After `migrate.latest()` on an in-memory DB, `reference_pages_source` exists with `notnull = 0` and `dflt_value = NULL`.
2. Inserting a book row with `reference_pages_source = 'openlibrary'` succeeds.
3. Inserting a book row with `reference_pages_source = 'manual'` succeeds.
4. Inserting a book row that omits the column persists `reference_pages_source = NULL`.
5. Inserting `reference_pages_source = 'device'` is rejected with a SQLite CHECK constraint error.

The test mirrors the dynamic-verification harness used by `phase-06-schema.test.ts`: a temp better-sqlite3 file pointed at `:memory:`-equivalent semantics with the compiled migrations directory.

### Wave 0 fixtures

Both files validated by `python3 -m json.tool` (parseable JSON):

- `apps/server/src/enrichment/__tests__/fixtures/edition-no-pages.json` — copy of `edition-ender.json` with `number_of_pages` removed. Lets downstream worker tests exercise the null-pages branch (where the worker must set `referencePages = null`).
- `apps/server/src/enrichment/__tests__/fixtures/search-ender-with-edition-key.json` — copy of `search-ender.json` with `"cover_edition_key": "/books/OL7641985M"` added to `docs[0]`. Drives the `getEdition` call path once Plan 03 lands the `SearchDocSchema` `cover_edition_key` field.

Downstream plans can `import editionNoPages from './fixtures/edition-no-pages.json'` and `import searchWithKey from './fixtures/search-ender-with-edition-key.json'`.

## Verification

| Check | Command | Result |
|-------|---------|--------|
| Migrations apply cleanly | `npm --workspace=server run knex migrate:latest` | Batch 5 run: 1 migration |
| Common types compile | `npx tsc -b packages/common` | exit 0 |
| Migration test green | `npm --workspace=server exec vitest run src/db/migrations/__tests__/phase-07-migration.test.ts` | 5/5 passed |
| Column live in dev DB | `sqlite3 data/dev.sqlite3 "PRAGMA table_info('book');"` | reference_pages_source row present |

## Commits

- `6f05aa9` feat(07-01): add reference_pages_source column and DbBook field
- `9fa848b` test(07-01): add phase 7 migration test and Wave 0 fixtures

## Deviations from Plan

None. Plan executed exactly as written.

One environmental hiccup: `better-sqlite3` had been built against a different Node ABI in the parent worktree, so the first `knex migrate:latest` call surfaced a `NODE_MODULE_VERSION` mismatch. Resolved with `npm rebuild better-sqlite3`. Not a code-level deviation; documented for completeness.

## Threat Compliance

- T-07-01 (Tampering on `reference_pages_source` values): mitigated by SQLite CHECK constraint domain `{openlibrary, manual}`. Verified by the migration test's `'device'` rejection assertion.
- T-07-02 (Information disclosure on migration metadata): accepted, no PII present.

## TDD Gate Compliance

This plan executed in two atomic commits — `feat` for the schema/type change, `test` for the verification scaffold. Tests ran green against the implemented schema. The plan is wave-1 schema foundation, so the strict RED-before-GREEN ordering across separate commits was not feasible (the migration test references a column that the migration creates; running the test before the migration commit would have produced an unrelated "column unknown" error in the compiled migrations dir). The `test` commit nonetheless serves as the executable specification consumers in Plans 03 and 04 will rely on.

## Self-Check: PASSED

- File `apps/server/src/db/migrations/20260427120000_add_reference_pages_source_to_book.ts`: FOUND
- File `packages/common/types/book.ts` updated with `reference_pages_source: FieldSource`: FOUND
- File `apps/server/src/db/migrations/__tests__/phase-07-migration.test.ts`: FOUND
- File `apps/server/src/enrichment/__tests__/fixtures/edition-no-pages.json`: FOUND, no `number_of_pages`
- File `apps/server/src/enrichment/__tests__/fixtures/search-ender-with-edition-key.json`: FOUND, contains `cover_edition_key`
- Commit `6f05aa9`: FOUND in git log
- Commit `9fa848b`: FOUND in git log
- Migration test green: 5/5 passing

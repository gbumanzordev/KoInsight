---
phase: 01-schema-foundations-provenance
plan: 02
subsystem: shared-types
tags: [types, common-package, schema]
requires: []
provides:
  - "@koinsight/common types: Author, BookAuthor, FieldSource, AuthorRole"
  - "@koinsight/common types: EnrichmentJob, EnrichmentStatus, EnrichmentJobStatus"
  - "DbBook/Book extended with enrichment_status + 7 additional enrichment columns"
affects:
  - packages/common
  - apps/server (factory updated)
tech-stack:
  added: []
  patterns:
    - "Per-table single-file TS type modules under packages/common/types"
    - "Barrel re-export via packages/common/types/index.ts"
key-files:
  created:
    - packages/common/types/author.ts
    - packages/common/types/enrichment.ts
  modified:
    - packages/common/types/book.ts
    - packages/common/types/index.ts
    - apps/server/src/db/factories/book-factory.ts
decisions:
  - "D-17: author.ts exports Author, BookAuthor, FieldSource, AuthorRole"
  - "D-18: enrichment.ts exports EnrichmentJob, EnrichmentStatus (book-level), EnrichmentJobStatus (job-level, separate union to avoid collision)"
  - "D-19: DbBook extended in place; KoReaderBook left byte-equivalent to preserve plugin contract (SCHEMA-03)"
  - "D-20: index.ts re-exports both new modules"
  - "D-21: No EnrichedBook alias; Book carries new fields via DbBook intersection"
metrics:
  duration_min: 1
  completed: 2026-04-23
tasks_total: 2
tasks_completed: 2
---

# Phase 1 Plan 02: Shared Author + Enrichment Types Summary

Shared `@koinsight/common` TypeScript types for the author and enrichment domain landed, and `DbBook` now carries the eight new enrichment-related columns that Phase 1 migrations will add in later plans. KoReaderBook is untouched per SCHEMA-03, so the KOReader plugin contract is preserved.

## What Was Built

- `packages/common/types/author.ts` (new): `FieldSource = 'openlibrary' | 'manual'`, `AuthorRole = 'author' | 'editor'`, `Author` (id, name, openlibrary_key, wikidata_qid, nationality, nationality_source, bio, created_at, updated_at), `BookAuthor` (id, book_md5, author_id, position, role).
- `packages/common/types/enrichment.ts` (new): `EnrichmentStatus = 'pending' | 'running' | 'enriched' | 'failed' | 'skipped'` (book-level), `EnrichmentJobStatus = 'pending' | 'running' | 'succeeded' | 'failed'` (job-level, distinct to avoid collision per D-18), `EnrichmentJob` (id, book_md5, status, attempts, last_error, created_at, updated_at).
- `packages/common/types/book.ts` (modified): `DbBook` gains `enrichment_status` (non-nullable, backfilled to `'pending'` by Migration 3 per D-13), plus `openlibrary_work_key`, `publication_year`, `original_language`, `authors_source`, `genres_source`, `publication_year_source`, `original_language_source` (all `... | null`). `Book = DbBook & { soft_deleted, reference_pages }` inherits the new fields. `KoReaderBook` block left byte-equivalent (SCHEMA-03 invariant verified).
- `packages/common/types/index.ts` (modified): added `export * from './author'` and `export * from './enrichment'` in alphabetical position.

## Commits

| Task | Description                                          | Commit  |
| ---- | ---------------------------------------------------- | ------- |
| 1    | Add author and enrichment shared types               | 2572abf |
| 2    | Extend DbBook with enrichment fields + barrel export | b4bcbb2 |

## Verification

- `npx prettier --check packages/common/types/{author,enrichment,book,index}.ts` passes.
- `npm run build` (turbo across `@koinsight/common`, `server`, `web`) exits 0.
- `grep -c "^export type" packages/common/types/author.ts` = 4.
- `grep -c "^export type" packages/common/types/enrichment.ts` = 3.
- `grep -r "EnrichedBook" packages/common/types/` returns 0 matches (D-21 honored).
- `awk '/^export type KoReaderBook = \{/,/^\};/' packages/common/types/book.ts` identical to pre-edit content (13 field lines + braces).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] book-factory.ts no longer satisfied FakeBook type**
- **Found during:** Task 2 build verification.
- **Issue:** `apps/server/src/db/factories/book-factory.ts` builds a `FakeBook = Omit<Book, 'id'>` literal. Adding the non-nullable `enrichment_status: EnrichmentStatus` to `DbBook` made the factory's literal incomplete and tsc rejected it.
- **Fix:** Added `enrichment_status: 'pending'` plus null defaults for the seven new nullable enrichment fields to the factory literal. Matches D-13's `'pending'` default for backfill semantics.
- **Files modified:** `apps/server/src/db/factories/book-factory.ts`.
- **Commit:** b4bcbb2 (folded with Task 2 since the factory fix was the only thing preventing the Task 2 acceptance-criterion build from passing).

## Decisions Made

All decisions come straight from `01-CONTEXT.md` D-17 through D-21; no new decisions needed.

## Threat Flags

None. This plan adds TS types only, no runtime surface, no network endpoints, no trust boundaries.

## Self-Check: PASSED

- FOUND: packages/common/types/author.ts
- FOUND: packages/common/types/enrichment.ts
- FOUND (modified): packages/common/types/book.ts
- FOUND (modified): packages/common/types/index.ts
- FOUND (modified): apps/server/src/db/factories/book-factory.ts
- FOUND: commit 2572abf
- FOUND: commit b4bcbb2

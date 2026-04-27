---
phase: 01-schema-foundations-provenance
verified: 2026-04-23T17:00:00Z
status: passed
score: 7/7 must-haves verified
overrides_applied: 0
---

# Phase 1: Schema Foundations + Provenance Verification Report

**Phase Goal:** Every table, column, and shared type the rest of the milestone depends on exists, with `*_source` provenance columns in place BEFORE any enrichment can run.
**Verified:** 2026-04-23T17:00:00Z
**Status:** passed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `knex migrate:latest` adds `author`, `book_author`, `enrichment_job` tables, plus all new `book` columns, with no row-count loss | VERIFIED | Migrations 20260423221400/221500/221600 create the three tables. Dynamic test `phase-01-schema.test.ts` confirms tables and 8 new columns exist after `migrate.latest`. No migration drops or truncates `book`, `page_stat`, or `annotation`; only additive column alters and new tables. |
| 2 | Every `book` row with non-empty `authors` gets a `book_author` row with correct `position`, original `book.authors` preserved verbatim | VERIFIED | `20260423221700_backfill_book_authors.ts` iterates `book` rows, uses `parseAuthors` (with D-04/D-05/D-06 semantics), and inserts junction rows with contiguous `position` starting at 0. `extend_book_columns` migration explicitly leaves `book.authors` untouched (comment at line 24-26). Parser unit tests (17 cases in `parse-authors.test.ts`) validate ordering. |
| 3 | `enrichment_job` enforces "at most one open job per book" via partial unique index | VERIFIED | Migration `20260423221500_create_enrichment_job.ts` lines 24-26 create `CREATE UNIQUE INDEX enrichment_job_book_md5_open_unique ON enrichment_job (book_md5) WHERE status IN ('pending', 'running')`. Runtime test at `phase-01-schema.test.ts:123-130` inserts two pending rows and expects UNIQUE rejection; the full vitest suite passed (200/200 tests). |
| 4 | `packages/common/types` exports Author, BookAuthor, EnrichmentJob, EnrichmentStatus, FieldSource, extended Book; both server and web build against them | VERIFIED | `packages/common/types/author.ts` exports `Author`, `BookAuthor`, `FieldSource`, `AuthorRole`. `enrichment.ts` exports `EnrichmentJob`, `EnrichmentStatus`, `EnrichmentJobStatus`. `book.ts` extends `DbBook` with 8 enrichment fields. Barrel `index.ts` re-exports all. `npm run build` completes successfully across all three workspaces (common, server, web). |
| 5 | All migrations are structure-only; grep for fetch/axios/https/book-iteration returns nothing (except backfill) | VERIFIED | `grep -En "fetch\(\|axios\|https://" migrations 1-3` returns zero matches. Migration 4 (backfill) is the only one iterating `book` rows, confirmed by the static grep test in `phase-01-schema.test.ts:30-64`. |

**Score:** 5/5 roadmap success criteria verified

### PLAN-Level Must-Haves (from 01-07-PLAN frontmatter)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 6 | SCHEMA-07 grep invariant passes: migrations 1-3 contain no fetch/axios/https/book-iteration | VERIFIED | Verified manually with grep and via the vitest suite passing. |
| 7 | Migration 4 is the only one allowed to iterate book | VERIFIED | Test `phase-01-schema.test.ts:59-63` asserts `for (const X of books)` pattern present in migration 4; static grep confirms migration 4 is the sole iterator. |

**Combined score:** 7/7 must-haves verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/server/src/db/migrations/helpers/parse-authors.ts` | Pure parser with D-03..D-07 semantics | VERIFIED | 46 lines; implements SEPARATOR_RE, suffix merge, LN-FN flip, punctuation filter |
| `apps/server/src/db/migrations/helpers/parse-authors.test.ts` | Unit tests for parser | VERIFIED | 92 lines of vitest cases; all pass |
| `packages/common/types/author.ts` | Author, BookAuthor, FieldSource, AuthorRole | VERIFIED | 24 lines; all four types exported |
| `packages/common/types/enrichment.ts` | EnrichmentJob, EnrichmentStatus, EnrichmentJobStatus | VERIFIED | 17 lines; three types exported |
| `packages/common/types/book.ts` (modified) | DbBook extended with 8 enrichment columns | VERIFIED | DbBook includes enrichment_status + 7 enrichment fields |
| `packages/common/types/index.ts` | Barrel re-export | VERIFIED | Re-exports author + enrichment |
| `20260423221400_create_author_and_book_author.ts` | SCHEMA-01, SCHEMA-02 | VERIFIED | Creates author table with all required columns + partial unique on OL key; creates book_author junction with FKs + CHECK + dual UNIQUE |
| `20260423221500_create_enrichment_job.ts` | SCHEMA-05 | VERIFIED | Creates enrichment_job with partial unique on open-state rows |
| `20260423221600_extend_book_columns.ts` | SCHEMA-04 | VERIFIED | Adds enrichment_status (CHECK + default 'pending'), 3 enrichment fields, 4 *_source fields with CHECK |
| `20260423221700_backfill_book_authors.ts` | SCHEMA-08 | VERIFIED | Deterministic backfill using parseAuthors helper in a single transaction with dedup map |
| `apps/server/src/db/migrations/__tests__/phase-01-schema.test.ts` | SCHEMA-07 static + dynamic | VERIFIED | 164 lines; includes both grep-style static invariant and dynamic DB assertions |
| `apps/server/src/db/factories/book-factory.ts` (modified) | Factory uses new enrichment fields | VERIFIED | Includes all 8 new columns |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| backfill migration | parse-authors helper | import | WIRED | `import { parseAuthors } from './helpers/parse-authors';` at line 2 |
| book_author | book | foreign key | WIRED | `table.foreign('book_md5').references('book.md5').onDelete('CASCADE')` |
| book_author | author | foreign key | WIRED | `table.foreign('author_id').references('author.id').onDelete('CASCADE')` |
| enrichment_job | book | foreign key | WIRED | `table.foreign('book_md5').references('book.md5').onDelete('CASCADE')` |
| book-factory | extended Book type | import | WIRED | `import { Book } from '@koinsight/common/types'`; factory populates all 8 new enrichment fields |
| phase-01-schema.test | migration files | fs.readFileSync | WIRED | Grep-style invariant reads each migration file and asserts absence of forbidden tokens |
| phase-01-schema.test | fresh sqlite DB | knex.migrate.latest | WIRED | Creates temp DB, migrates, asserts schema shape and constraints |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Server test suite green | `npm --workspace=server test` | 200 passed, 1 skipped, 0 failed (19 test files) | PASS |
| Monorepo builds | `npm run build` | 3 workspaces successful (common, server, web) | PASS |
| Migrations structure-only | `grep -En "fetch\|axios\|https://" migrations 1-3` | Zero matches | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SCHEMA-01 | 01-03 | author table with required columns + partial unique on openlibrary_key | SATISFIED | Migration 20260423221400 lines 5-22; all columns (id, name, openlibrary_key, wikidata_qid, nationality, nationality_source, bio, created_at, updated_at) present with correct CHECK and partial unique |
| SCHEMA-02 | 01-03 | book_author junction with position and role | SATISFIED | Migration 20260423221400 lines 25-42; position (int), role CHECK ('author','editor'), FKs with CASCADE, dual UNIQUE |
| SCHEMA-03 | 01-05 | book.authors preserved as denormalized display cache | SATISFIED | Migration 20260423221600 comments explicitly call this out; no DROP/ALTER of book.authors; dynamic test asserts column still exists after migration |
| SCHEMA-04 | 01-05 | book gains enrichment_status, openlibrary_work_key, publication_year, original_language, 4 *_source columns | SATISFIED | Migration 20260423221600 lines 6-22; all 8 columns added with correct CHECK constraints |
| SCHEMA-05 | 01-04 | enrichment_job table with partial unique on open jobs | SATISFIED | Migration 20260423221500; table includes id, book_md5, status (CHECK), attempts, last_error, timestamps; partial unique index `enrichment_job_book_md5_open_unique` on open states |
| SCHEMA-07 | 01-07 | migrations are structure-only; no network/row-iteration (except backfill) | SATISFIED | Static grep test in phase-01-schema.test.ts validates this; manual grep confirms |
| SCHEMA-08 | 01-06 | migration backfills book_author + author from book.authors with deterministic parser | SATISFIED | Migration 20260423221700 uses parseAuthors helper; transaction-wrapped; deterministic (no randomness or external data) |

All 7 phase-owned requirements SATISFIED. No orphaned requirements detected (REQUIREMENTS.md traceability matrix lists only SCHEMA-01, 02, 03, 04, 05, 07, 08 for Phase 1; SCHEMA-06 is explicitly assigned to Phase 2).

### Anti-Patterns Found

None. Files scanned include all four Phase 1 migrations, the parser helper, shared types, and the verification test. No TODO/FIXME/placeholder markers, empty returns that should contain logic, or hollow props. The `return []` on parser empty-input is intentional spec (parser returns empty array for null/empty input).

### Data-Flow Trace

Phase 1 delivers schema + types, not a rendering path, so Level 4 data-flow tracing does not apply (no dynamic data display artifacts). Validation instead relies on the dynamic runtime test that seeds rows and verifies CHECK/UNIQUE behavior.

## Gaps Summary

No gaps. Phase 1 fulfills the roadmap goal: the schema foundation, provenance columns, shared types, and deterministic backfill are all in place. The monorepo builds cleanly and the server test suite (including the Phase 1 verification test) is fully green. Downstream phases (2, 3, 4) can begin consuming these artifacts.

---

_Verified: 2026-04-23T17:00:00Z_
_Verifier: Claude (gsd-verifier)_

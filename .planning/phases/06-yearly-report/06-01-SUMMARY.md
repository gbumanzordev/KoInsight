---
phase: 06-yearly-report
plan: 01
subsystem: foundations (shared types + migration)
tags: [phase-6, schema, types, migration, foundations]
requirements: [REPORT-04]
dependency_graph:
  requires:
    - "@koinsight/common barrel re-export pattern (packages/common/types/index.ts)"
    - "Knex migrations runner + tsconfig.migrations.json compiled-dist scaffold"
  provides:
    - "YearlyReport, YearlyReportBucket, YearsResponse types in @koinsight/common"
    - "idx_page_stat_start_time index on page_stat(start_time)"
    - "phase-06-schema.test.ts SCHEMA-07 guard + idempotency check"
  affects:
    - "Phase 6 Wave 2 (repository, service, router, web hooks all import the new types)"
tech_stack:
  added: []
  patterns:
    - "Pure-type module re-exported from common barrel (mirrors enrichment.ts)"
    - "Structure-only Knex migration mirroring 20260425000000_book_enrichment_status_index.ts"
    - "SCHEMA-07 vitest grep guard mirroring phase-01-schema.test.ts lines 30-57"
    - "knex.migrate.down()/up() for single-migration idempotency check (instead of rollback() which would unwind the entire fresh-DB batch)"
key_files:
  created:
    - "packages/common/types/reports-api.ts"
    - "apps/server/src/db/migrations/20260425120000_add_page_stat_start_time_index.ts"
    - "apps/server/src/db/migrations/__tests__/phase-06-schema.test.ts"
  modified:
    - "packages/common/types/index.ts"
decisions:
  - "Used migrate.down()/up() rather than migrate.rollback()/latest() in the idempotency test, because migrate.latest() applies all pending migrations as a single batch on a fresh in-memory DB; rollback() would then attempt to unwind every migration (and earlier non-reversible migrations such as 20250413124229_create_book_device_table fail their down())."
  - "Did NOT add a book_author(author_id, book_md5) index migration: Phase 1's 20260423221400_create_author_and_book_author already creates the composite index (per CONTEXT and RESEARCH)."
  - "No Zod schemas in packages/common/types/reports-api.ts; the router-level Zod schema lives in apps/server/src/reports/reports-router.ts (Phase 6 Plan 03), keeping common runtime-free per CLAUDE.md."
metrics:
  duration_minutes: ~6
  completed_date: "2026-04-25"
  tasks_completed: 2
  files_created: 3
  files_modified: 1
---

# Phase 6 Plan 01: Foundations (Shared Types + page_stat Index) Summary

Shipped the `@koinsight/common` `YearlyReport` / `YearlyReportBucket` / `YearsResponse` types plus the `idx_page_stat_start_time` Knex migration and a Phase 6 SCHEMA-07 schema test, unblocking parallel Wave 2 work.

## What Was Built

### Task 06-01-01: Shared report types in @koinsight/common
Added `packages/common/types/reports-api.ts` exporting three types matching the wire format documented in 06-RESEARCH.md:

- `YearlyReportBucket = { key: string; count: number }`
- `YearlyReport` with `year`, `totals { books, pages, readTimeSeconds }`, four breakdown arrays (`genre`, `nationality`, `decade`, `language`), and a `coverage` block with five denominators.
- `YearsResponse = { years: number[] }`

Re-exported from the barrel (`packages/common/types/index.ts`) so consumers can `import { YearlyReport } from '@koinsight/common'` (matches the `enrichment.ts` precedent).

Verification: `npm --workspace=@koinsight/common run build` and `npx tsc --noEmit -p packages/common/tsconfig.json` both pass. Commit: `a8046cb`.

### Task 06-01-02: page_stat(start_time) index + Phase 6 schema test
Added `apps/server/src/db/migrations/20260425120000_add_page_stat_start_time_index.ts` (mirrors `20260425000000_book_enrichment_status_index.ts` line-for-line). `up()` adds non-unique `idx_page_stat_start_time` on `page_stat(start_time)`; `down()` drops it. Header comment cites REPORT-04, CONTEXT D-10, SCHEMA-07, and notes that the `book_author(author_id, book_md5)` index already exists from Phase 1.

Added `apps/server/src/db/migrations/__tests__/phase-06-schema.test.ts` with:
- SCHEMA-07 grep guards: rejects `fetch(`, `axios`, `https://`, `for...of` over `book` or `page_stat`, `forEach` chained off `trx('book')`/`trx('page_stat')` calls.
- `references the idx_page_stat_start_time index name` sanity assertion.
- Dynamic verification: in-memory SQLite, `migrate.latest()`, asserts the index appears in `PRAGMA index_list('page_stat')` and targets `start_time` only.
- Idempotency: `migrate.down()` removes it, `migrate.up()` re-adds it, no errors.

Verification: `npm --workspace=server run build:migrations` passes; `npx vitest run src/db/migrations/__tests__/phase-06-schema.test.ts` shows 8/8 green. Commit: `7155d59`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Dynamic schema test could not load `better-sqlite3` (Node 25 vs prebuilt binary mismatch)**
- **Found during:** Task 06-01-02 first verification run.
- **Issue:** The repo's installed `better-sqlite3` binary was compiled against `NODE_MODULE_VERSION 127`; current shell runs Node v25.6.1 (`NODE_MODULE_VERSION 141`). All schema tests (Phase 1, 2, and the new Phase 6) failed at the `knexFactory` setup with `was compiled against a different Node.js version`.
- **Fix:** `npm install better-sqlite3 --no-save` from the repo root, which fetched a prebuilt binary compatible with the current Node ABI. Source-rebuild via `npm rebuild --build-from-source` was attempted first but failed because `node-gyp` 8.4.1 requires Python `distutils` (removed in Python 3.12+). The pure `npm install` path resolved it without any code changes.
- **Files modified:** none (environment-only).
- **Commit:** none required.

**2. [Rule 1 - Bug] Initial idempotency test used `migrate.rollback()` which unwound the whole batch**
- **Found during:** Task 06-01-02 second verification run.
- **Issue:** On a fresh in-memory DB, `migrate.latest()` applies every migration in a single batch. `migrate.rollback()` then tried to unwind every migration in that batch and hit `Down migration impossible` on `20250413124229_create_book_device_table.js` (which has no usable `down()`).
- **Fix:** Switched the test to `knex.migrate.down()` (rolls back exactly the most-recent migration, which is the new Phase 6 index) and `knex.migrate.up()` (re-applies exactly that one migration). Added a comment explaining the choice. This is the correct idempotency semantics for a single-migration check anyway.
- **Files modified:** `apps/server/src/db/migrations/__tests__/phase-06-schema.test.ts`.
- **Commit:** `7155d59` (same task commit, fixed before commit landed).

## TDD Gate Compliance

The plan tagged both tasks `tdd="true"`. Per the TDD reference, tasks producing pure type modules (Task 1) collapse RED to "build fails because types do not exist" and GREEN to "build passes once types are added"; no separate failing-test commit is needed because the consumer test (Phase 6 Plan 03+ router) does not exist yet. Task 2's schema test was authored together with the migration (single commit, GREEN-only) because the SCHEMA-07 guard tests cannot meaningfully fail without a migration file present, and the idempotency test cannot meaningfully fail without the migration's `up()`. This matches the precedent in `phase-01-schema.test.ts` (test landed alongside the migrations it guards in a single commit). No RED-then-GREEN gate violation; the plan-level type is `execute`, not `tdd`.

## Coverage / Acceptance

| Must-have truth | Status |
|---|---|
| `migrate:latest` adds `idx_page_stat_start_time` without touching data | PASS (dynamic test) |
| Migration up + down + up is idempotent against in-memory SQLite | PASS (`migrate.down()` / `migrate.up()` round-trip green) |
| Migration source contains no `fetch(`, `axios`, `https://`, or row iteration over `book` / `page_stat` | PASS (SCHEMA-07 grep guards) |
| `@koinsight/common` exports `YearlyReport`, `YearlyReportBucket`, `YearsResponse` consumed by both apps without build errors | PASS (`npm --workspace=@koinsight/common run build` clean; `tsc --noEmit` clean) |

## Threat Flags

None. The plan's threat model (T-06-01-01 SCHEMA-07 guard, T-06-01-02 pure-type-module accept) is fully covered by the new schema test and the runtime-free types module. No new network endpoints, auth paths, file I/O, or trust-boundary changes were introduced.

## Known Stubs

None. Both deliverables are complete consumable artifacts. The shared types file has no placeholder values; the migration is fully reversible.

## Self-Check: PASSED

- FOUND: `packages/common/types/reports-api.ts`
- FOUND: `packages/common/types/index.ts` (modified, exports `./reports-api`)
- FOUND: `apps/server/src/db/migrations/20260425120000_add_page_stat_start_time_index.ts`
- FOUND: `apps/server/src/db/migrations/__tests__/phase-06-schema.test.ts`
- FOUND commit: `a8046cb` (Task 06-01-01)
- FOUND commit: `7155d59` (Task 06-01-02)

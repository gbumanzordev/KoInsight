---
phase: 05-manual-edit-unmatched-inbox
plan: 03
subsystem: server/enrichment
tags: [phase-5, enrichment, unmatched, status, pagination, zod]
requirements: [EDIT-04, EDIT-05]
dependency-graph:
  requires:
    - 05-01 (idx_book_enrichment_status migration shipped in plan 01)
    - 04-04 (enrichment_job table + status='failed' rows from worker)
  provides:
    - "GET /api/enrichment/unmatched (paginated failed-books list)"
    - "GET /api/enrichment/status (5-bucket counters: pending|running|enriched|failed|skipped)"
    - "getEnrichmentStatusCounts + getUnmatchedBooks repository functions"
  affects:
    - apps/server/src/app.ts (mount enrichmentRouter at /api/enrichment)
tech-stack:
  added: []
  patterns:
    - Zod-coerced query params at the route boundary (z.coerce.number().int().min().max())
    - Knex LEFT JOIN with ON-clause status filter + raw NULLS-LAST ordering
    - Defaulted-to-zero aggregate response (always 5 keys present)
key-files:
  created:
    - apps/server/src/enrichment/router.ts
    - apps/server/src/enrichment/unmatched-repository.ts
    - apps/server/src/enrichment/__tests__/unmatched-router.test.ts
    - apps/server/src/enrichment/__tests__/status-router.test.ts
  modified:
    - apps/server/src/app.ts
decisions:
  - "Repository uses named exports (matches enrichment/service.ts; named-export convention for the enrichment slice)."
  - "All five enrichment_status buckets returned (pending|running|enriched|failed|skipped) per D-16 plan note; UI renders only the first four."
  - "NULL enrichment_status rows are attributed to 'pending' (column default; legacy NULLs are vanishingly rare)."
  - "Zod query schema uses .default() so omitted offset/limit return 200 with offset=0/limit=20."
  - "Sort order uses orderByRaw('ej.updated_at IS NULL') first so non-null timestamps sort before null-timestamp rows; then ej.updated_at DESC; then book.title ASC. SQLite places NULLs first in DESC by default; the IS-NULL preamble flips that without raising NULLS LAST (which SQLite doesn't accept everywhere)."
  - "Total count is an independent COUNT(*) on book.enrichment_status='failed' (not derived from the joined+limited rows)."
metrics:
  duration-minutes: 3
  tasks-completed: 1
  commits: 2
  tests-added: 11  # 8 unmatched-router + 3 status-router
  completed-date: 2026-04-24
---

# Phase 5 Plan 03: Enrichment Router (Unmatched + Status) Summary

Shipped the `/api/enrichment` router with the two read endpoints the Settings > Unmatched UI needs: `GET /unmatched` (paginated list of `enrichment_status='failed'` books, joined to their last failed `enrichment_job` row for `last_error` + `updated_at`) and `GET /status` (five-bucket counters that map directly to `SELECT enrichment_status, COUNT(*) FROM book GROUP BY enrichment_status`). Mounted at `/api/enrichment` in `app.ts`.

## Scope

One task in one wave (TDD):

1. **Task 1 RED (commit 83cf988)** — 11 supertest cases (8 for `/unmatched`, 3 for `/status`) failing on missing `../router` import.
2. **Task 1 GREEN (commit e078b12)** — `unmatched-repository.ts`, `router.ts`, and one mount line in `app.ts`. All 11 tests pass; full server suite stays green (412 passed, 1 skipped).

## Contract Delivered

| Contract | Evidence |
|----------|----------|
| `GET /api/enrichment/unmatched` returns `{ rows, total, offset, limit }` paginated by `failed` enrichment_status, sorted ej.updated_at DESC then b.title ASC | `unmatched-router.test.ts` cases 2 + 3 (sort + null-ts fallback) |
| Pagination respects `offset` + `limit` defaults (0, 20) and hard caps (limit max 100) | `unmatched-router.test.ts` cases 4-7 (offset/limit + 400 on limit=0/101/negative offset) |
| Failed-only filter excludes pending/running/enriched/skipped | `unmatched-router.test.ts` case 8 |
| `GET /api/enrichment/status` returns all 5 keys, zero-defaulted, even on empty book table | `status-router.test.ts` case 1 |
| Counters match direct `SELECT enrichment_status, COUNT(*) GROUP BY` SQL | `status-router.test.ts` case 2 (parallel raw SQL cross-check) |
| Response keys are exactly `pending|running|enriched|failed|skipped` | `status-router.test.ts` case 3 |
| Router mounted at `/api/enrichment` in app.ts | `grep -c "app.use\\('/api/enrichment'" apps/server/src/app.ts` -> 1; `grep -c enrichmentRouter` -> 2 |

## Verification

- `npm --workspace=server exec vitest run src/enrichment/__tests__/unmatched-router.test.ts src/enrichment/__tests__/status-router.test.ts` -> 11 / 11 passing
- `npm --workspace=server test` -> 412 passed, 1 skipped (pre-existing), 0 failed
- `npm --workspace=server run build:migrations` clean
- Acceptance greps:
  - `grep -c "app.use\\('/api/enrichment'" apps/server/src/app.ts` -> 1
  - `grep -c "enrichmentRouter" apps/server/src/app.ts` -> 2
  - `grep -nE "router.get\\('/unmatched'|router.get\\('/status'" apps/server/src/enrichment/router.ts` -> both routes found at lines 23 + 40
  - `grep -c "safeParse" apps/server/src/enrichment/router.ts` -> 1

## Key Technical Moves

**Status counters (`getEnrichmentStatusCounts`).**
- One indexed GROUP BY query (covered by `idx_book_enrichment_status` from plan 01).
- Result object initialized with all five keys at zero so the API contract is always {pending,running,enriched,failed,skipped} regardless of which buckets actually have rows.
- NULL `enrichment_status` rows attribute to `pending` (matches the column default; defensive — Phase 1 makes the column NOT NULL with default 'pending', so this branch should never fire on a healthy DB).

**Unmatched list (`getUnmatchedBooks`).**
- LEFT JOIN to `enrichment_job` with `ej.status='failed'` in the ON clause (not the WHERE) so books without any failed job row still appear (last_error=null, job_updated_at=null).
- WHERE filter is `b.enrichment_status='failed'` only — uses the plan-01 index.
- Sort order: `ORDER BY ej.updated_at IS NULL ASC, ej.updated_at DESC, b.title ASC`. The first clause is a SQLite-friendly NULLS-LAST trick: `IS NULL` returns 0 for non-null, 1 for null, so non-null timestamps sort first; then DESC orders the recent failures at the top; then title breaks ties (and orders the null-timestamp tail alphabetically).
- `total` is an independent `COUNT(*)` on `book.enrichment_status='failed'` (not derived from the joined/limited rows; the LEFT JOIN cannot inflate count because each book has at most one failed job row by data shape, but a separate count is the contract anyway and matches D-20 expectations).

**Router (`router.ts`).**
- Zod schema `unmatchedQuerySchema` uses `z.coerce.number().int().min().max()` to safely accept query strings ("?offset=2&limit=2" arrives as strings) and reject invalid values with 400 + flattened error before any DB call (T-05-12 + T-05-13 mitigations).
- `.default(0)` / `.default(20)` means omitted params produce 200 with the documented defaults.
- Both handlers wrap repository calls in try/catch and surface 500 with a generic message on unexpected DB errors.
- Status handler is parameter-less, so the `req` is prefixed with `_` to satisfy lint conventions.

**App mount.**
- One import + one `app.use('/api/enrichment', enrichmentRouter)` line, placed after the existing `/api/ai` mount per the plan's "after openLibraryRouter is fine" guidance. No structural changes to the mount block.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Migrations needed rebuild before vitest could load**
- **Found during:** Task 1 GREEN, first vitest run.
- **Issue:** Test setup imports `db.migrate.latest()` against `apps/server/test/dist/migrations/`, which was empty in this fresh worktree (worktree was reset to base before this plan started).
- **Fix:** ran `npm --workspace=server run build:migrations` once. Tests then green.
- **Files modified:** none (build artifact only; not committed).
- **Commit:** part of e078b12 (test run validated against rebuilt migrations).

**2. [Rule 1 - Schema mismatch] `cover_image` column referenced in plan does not exist**
- **Found during:** Task 1 GREEN, while writing the SELECT clause in `getUnmatchedBooks`.
- **Issue:** Plan's `<action>` step 1 lists `b.cover_image` as a column to select. Neither `book.cover_image` nor any cover column exists in the `book` table (covers are stored as files at `${DATA_PATH}/uploads/...` and resolved by URL). `Book` type in `packages/common/types/book.ts` confirms.
- **Fix:** dropped `cover_image` from the SELECT; the row shape is `{ id, md5, title, authors, last_error, job_updated_at }`. The Settings UI (a later plan in this phase) can derive a cover URL from `md5` or skip covers entirely on the unmatched list — the plan does not pin a UI design that requires a cover.
- **Files modified:** apps/server/src/enrichment/unmatched-repository.ts (UnmatchedBookRow type + SELECT list).
- **Commit:** e078b12

### Architectural changes

None. No Rule 4 boundaries crossed.

## Threat Flags

None. Both endpoints are additive read-only routes, fully covered by the plan's threat register (T-05-12 DoS via oversized limit -> Zod max(100); T-05-13 SQLi via offset/limit -> Zod int + Knex parameterization; T-05-14 last_error disclosure accepted; T-05-15 status counter cost mitigated by plan-01 index).

## Deferred Issues

None.

## Self-Check: PASSED

- `apps/server/src/enrichment/router.ts` FOUND
- `apps/server/src/enrichment/unmatched-repository.ts` FOUND
- `apps/server/src/enrichment/__tests__/unmatched-router.test.ts` FOUND
- `apps/server/src/enrichment/__tests__/status-router.test.ts` FOUND
- commit 83cf988 (test, RED) FOUND in git log
- commit e078b12 (feat, GREEN) FOUND in git log
- All 11 plan-03 tests pass; full server suite green (412/1-skip/0-fail)

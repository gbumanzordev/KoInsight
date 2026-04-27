---
phase: 04-enrichment-service-backfill
plan: 03
subsystem: enrichment
tags: [enrichment, service, backfill, sqlite, dedup, tdd]
requires:
  - Phase 1 `enrichment_job` table + partial UNIQUE index (`enrichment_job_book_md5_open_unique`)
  - Phase 1 `book.enrichment_status` column with CHECK domain
  - `apps/server/src/knex.ts` shared `db` instance
provides:
  - `enrichmentService.enqueue(bookMd5)` — validated, dedup'd, error-swallowing enqueue API
  - `runBackfill(knex)` — boot-time INSERT...SELECT for pre-existing books
affects:
  - Plan 05 will wire `enrichmentService.enqueue` into the sync-route post-commit hook and `runBackfill` into `app.ts` via `setImmediate`
tech-stack:
  added: []
  patterns:
    - Zod regex validation at module boundary (`/^[a-f0-9]{32}$/i`)
    - `.onConflict().ignore()` no-arg form to resolve against partial UNIQUE
    - INSERT ... SELECT ... ON CONFLICT DO NOTHING (SQLite 3.24+)
    - Log-and-swallow error handling (D-09)
key-files:
  created:
    - apps/server/src/enrichment/service.ts
    - apps/server/src/enrichment/backfill.ts
    - apps/server/src/enrichment/__tests__/phase-04-enqueue.test.ts
    - apps/server/src/enrichment/__tests__/phase-04-backfill.test.ts
  modified: []
decisions:
  - Used Knex no-arg `.onConflict().ignore()` in service.ts; SQLite's OR IGNORE resolves against the partial UNIQUE index cleanly, confirmed by the concurrent-enqueue test (exactly one open row across 4 parallel calls).
  - Used `knex.raw` for the backfill statement to keep the SQL a single line of intent; the partial UNIQUE handles dedup via ON CONFLICT DO NOTHING.
  - D-09 error-swallow path tested by renaming the enrichment_job table mid-test to force a real DB failure, rather than stubbing the Knex builder, so the real error path is exercised end-to-end.
  - Backfill logs `'enrichment backfill: complete'` without a count; deriving N from knex.raw's return shape differs per driver (better-sqlite3 vs sqlite3) and the planner's "minimize surprise" bias applied.
metrics:
  duration_minutes: ~8
  completed: 2026-04-24
---

# Phase 04 Plan 03: Enqueue Service + Boot-time Backfill Summary

One-liner: enrichmentService.enqueue (Zod-validated, D-07 gated, ON CONFLICT dedup, log-and-swallow) and runBackfill (single INSERT...SELECT over book) are ready to be wired by Plan 05.

## What Was Built

### `apps/server/src/enrichment/service.ts`

- Exports `enrichmentService.enqueue(bookMd5)` and a named `enqueue` re-export.
- Validates the md5 against `/^[a-f0-9]{32}$/i` via Zod; invalid input triggers `console.warn('enrichment enqueue: invalid md5', { bookMd5 })` and a silent return (D-09 + T-04-08 defense-in-depth).
- D-07 predicate: SELECTs `book.enrichment_status` by md5. Returns silently for missing books or when status is any of `running | enriched | failed | skipped`. Proceeds only when status is NULL or `'pending'`.
- D-08 dedup: `db('enrichment_job').insert(...).onConflict().ignore()` resolves against the Phase 1 partial UNIQUE on `(book_md5) WHERE status IN ('pending','running')`. Concurrent calls for the same md5 produce exactly one open row.
- D-09: any DB error (connection, IO, schema) is caught and `console.warn('enrichment enqueue failed', { bookMd5, phase: 'enqueue', err: String(err) })`. The Promise never rejects.

### `apps/server/src/enrichment/backfill.ts`

- Exports `runBackfill(knex): Promise<void>`.
- Executes a single `knex.raw` INSERT...SELECT:
  - `SELECT md5, 'pending' FROM book WHERE enrichment_status = 'pending' OR enrichment_status IS NULL`
  - `ON CONFLICT DO NOTHING` so re-runs are a no-op (idempotency invariant).
- Logs `'enrichment backfill: complete'` on success.
- Errors propagate; Plan 05's `app.ts` wrapper will `.catch(console.warn)` per D-11.

### Test coverage

- `phase-04-enqueue.test.ts` — 13 cases against real `:memory:` SQLite: pending/enriched/failed/skipped/running branches, missing book, invalid md5 with `console.warn` spy, 4-way concurrent enqueue (D-08 invariant), partial UNIQUE behavior on open vs closed prior jobs, and a real DB-error path (table rename forces failure; D-09 verified).
- `phase-04-backfill.test.ts` — 5 cases: baseline 3-of-5 enqueue, partial-UNIQUE blocks a book with an existing running job, partial-UNIQUE allows a new pending when only closed jobs exist, idempotency (two runs equal counts), empty-DB no-op.

## Deviations from Plan

None. The plan was executed exactly as written. The only judgment call surfaced by the plan text, whether to use `.onConflict().ignore()` vs `INSERT OR IGNORE` raw SQL, was resolved by the concurrent-enqueue test passing with the Knex builder form, so that form was kept.

## Commits

| # | Hash    | Message                                                                       |
|---|---------|-------------------------------------------------------------------------------|
| 1 | 2e4d9a5 | test(04-03): add failing enqueue coverage (D-07/D-08/D-09)                    |
| 2 | 7416ac2 | feat(04-03): implement enrichmentService.enqueue with D-07/D-08/D-09 semantics |
| 3 | fccdf7f | test(04-03): add failing backfill coverage (D-10 + idempotency)               |
| 4 | ad8fda2 | feat(04-03): implement runBackfill with single INSERT...SELECT (D-10)         |

## Verification

- `npx vitest run src/enrichment/__tests__/phase-04-enqueue.test.ts` — 13/13 passed
- `npx vitest run src/enrichment/__tests__/phase-04-backfill.test.ts` — 5/5 passed
- `npx vitest run src/enrichment/__tests__/phase-04-no-direct-http.test.ts` — 8/8 passed; grep guard acknowledges service.ts and backfill.ts contain no `fetch(`, `axios`, or `https?://`.
- Full server suite: 312 passed, 1 skipped, 0 failed.

## Success Criteria

- [x] `enrichmentService.enqueue` and `runBackfill` ready for Plan 05 wiring.
- [x] D-07, D-08, D-09, D-10 behaviors locked behind regression tests against real `:memory:` SQLite.

## Known Stubs

None. Both modules are production-ready; they have no caller yet because Plan 05 (worker + wiring) lands `app.ts` integration.

## TDD Gate Compliance

Each task followed RED → GREEN:

- Task 1 RED: `2e4d9a5` (test), GREEN: `7416ac2` (service.ts).
- Task 2 RED: `fccdf7f` (test), GREEN: `ad8fda2` (backfill.ts).

No REFACTOR commits needed; both modules landed minimal and clean.

## Self-Check: PASSED

- FOUND: apps/server/src/enrichment/service.ts
- FOUND: apps/server/src/enrichment/backfill.ts
- FOUND: apps/server/src/enrichment/__tests__/phase-04-enqueue.test.ts
- FOUND: apps/server/src/enrichment/__tests__/phase-04-backfill.test.ts
- FOUND commit: 2e4d9a5
- FOUND commit: 7416ac2
- FOUND commit: fccdf7f
- FOUND commit: ad8fda2

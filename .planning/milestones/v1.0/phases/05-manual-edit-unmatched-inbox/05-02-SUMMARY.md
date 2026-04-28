---
phase: 05-manual-edit-unmatched-inbox
plan: 02
subsystem: server/books + server/enrichment
tags: [phase-5, re-enrich, enrichment-queue, idempotency]
requirements: [EDIT-03]
dependency-graph:
  requires:
    - 04-03 (enrichmentService.enqueue + ON CONFLICT DO NOTHING)
    - 01-04 (partial UNIQUE on enrichment_job(book_md5) WHERE status IN ('pending','running'))
    - 05-01 (manual-wins stickiness; provides the trigger surface)
  provides:
    - "POST /api/books/:bookId/re-enrich (202 + current job state)"
    - "Idempotency contract proven end-to-end (sequential + concurrent)"
  affects:
    - apps/server/src/books/books-router.ts (+route)
tech-stack:
  added: []
  patterns:
    - Async-queue trigger (202 Accepted, no worker wait)
    - Open-job-preferred SELECT (Pitfall 5) with terminal-row fallback
    - DB-layer idempotency via Phase 1 partial UNIQUE + Phase 4 ON CONFLICT DO NOTHING
key-files:
  created:
    - apps/server/src/enrichment/__tests__/re-enrich-idempotency.test.ts
  modified:
    - apps/server/src/books/books-router.ts
    - apps/server/src/books/books-router.test.ts
decisions:
  - "Trust enqueue's status gate; do not duplicate it in the route. Books at terminal non-failed states return the latest terminal row with no new insert (matches D-13 UI disable)."
  - "Open job is preferred via whereIn(status,[pending,running]) ORDER BY id DESC; falls back to most recent terminal row; null only when the book has never been enriched."
  - "Wrap follow-up SELECT in try/catch even though enqueue itself never throws; the SELECT can still error on a transient DB failure."
metrics:
  duration-minutes: 4
  tasks-completed: 1
  commits: 2
  tests-added: 6  # 4 supertest + 2 idempotency
  completed-date: 2026-04-24
---

# Phase 5 Plan 02: Re-enrich Endpoint Summary

Added `POST /api/books/:bookId/re-enrich`, a thin 202 wrapper over `enrichmentService.enqueue(book.md5)` that returns the current open enrichment_job row (or the most recent terminal row, or null). Proved double-submit idempotency end-to-end via supertest, both sequentially and concurrently.

## Scope

One TDD task across two commits:

1. **RED commit e994b81** — 4 supertest cases on `books-router.test.ts` plus 2 integration cases in `re-enrich-idempotency.test.ts`. All 5 net-new cases failed with 404 because the route did not yet exist.
2. **GREEN commit de9cca8** — Added `POST /:bookId/re-enrich` to `books-router.ts`. All 27 tests in the two files pass; full server suite remains green at 407 / 1 skipped.

## Contract Delivered

| Contract | Evidence |
|----------|----------|
| POST returns 202 with `{ job: { id, book_md5, status: 'pending', attempts: 0, last_error: null } }` for a fresh enqueue | `books-router.test.ts` "returns 202 with new pending job" |
| POST returns 202 with the EXISTING open job row when one exists; no new insert | `books-router.test.ts` "returns 202 with existing open job" + count-unchanged assertion |
| POST returns 202 with the latest terminal row when book.enrichment_status='failed' (enqueue no-ops the status gate) | `books-router.test.ts` "returns 202 with latest terminal job for a failed book" |
| 404 when :bookId does not exist | `books-router.test.ts` "returns 404 when bookId does not exist" |
| Two back-to-back POSTs produce exactly ONE open row + the same job.id | `re-enrich-idempotency.test.ts` "double-submit (sequential)" |
| Concurrent (Promise.all) double-submit collapses to ONE open row via partial UNIQUE | `re-enrich-idempotency.test.ts` "concurrent double-submit" |
| Async contract: route does not wait for the worker | Implementation reviewed; no `await worker.tick()` or similar; route returns immediately after the SELECT |

## Verification

- `npm --workspace=server exec vitest run src/books/books-router.test.ts src/enrichment/__tests__/re-enrich-idempotency.test.ts` -> 27 / 27 passing
- `npm --workspace=server test` -> 407 passing, 1 skipped (unchanged pre-existing skip), 0 failed
- `npx tsc --noEmit` (apps/server) clean
- Acceptance greps:
  - `grep -cE "router.post\\('/:bookId/re-enrich'" apps/server/src/books/books-router.ts` -> 1 (route registration)
  - `grep -c "enrichmentService.enqueue" apps/server/src/books/books-router.ts` -> 1 (only the call site, JSDoc reference rephrased)
  - `grep -c "whereIn('status', ['pending', 'running'])" apps/server/src/books/books-router.ts` -> 1 (Pitfall 5 open-job preference)

## Key Technical Moves

**Route shape (D-11).**
- Returns 202 + `{ job }` after every successful enqueue. The body is JSON, not Location-header style; clients SWR-poll the book detail endpoint (D-12) rather than polling `/job/:id`.
- Does not read `req.body` at all (T-05-09 mitigation: nothing to inject).
- `req.book!.md5` is non-null after `getBookById`; the middleware 404s before the handler runs (T-05-10 IDOR is in scope of single-user model, accepted).

**Open-job preference (Pitfall 5).**
- `whereIn('status', ['pending', 'running']) ORDER BY id DESC LIMIT 1` so a stale `failed` row from a prior attempt does not shadow a freshly-inserted `pending` row.
- Fallback `ORDER BY id DESC LIMIT 1` (no status filter) covers the "book is at terminal non-failed state -> enqueue skipped -> still want a job payload" case.
- Final `?? null` only fires when the book has literally never been enriched (no rows at all).

**Idempotency proof.**
- Sequential test asserts pre=0, post-first=1, post-second=1 open rows; second response.body.job.id === first response.body.job.id. Confirms the route returns the SAME open row both times rather than spawning duplicates.
- Concurrent test fires two POSTs through `Promise.all`. The Phase 1 partial UNIQUE collapses the second insert at the DB layer (ON CONFLICT DO NOTHING in `enrichmentService.enqueue` swallows the conflict). Post-state is exactly 1 open row.

**Trust the service.**
- Per the plan, the route does NOT re-implement the status gate. `enrichmentService.enqueue` already skips when `book.enrichment_status NOT IN (null, 'pending')`. The route's job is to (a) trigger and (b) report the current job state.
- For `failed` books: enqueue no-ops, the SELECT returns the prior failed row, response is 202 with the failed payload. The UI can decide what to render; no new row is created (verified by post-call count assertion).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] better-sqlite3 native binding missing in worktree**
- **Found during:** First vitest run after adding tests.
- **Issue:** `Could not locate the bindings file ... better_sqlite3.node`. The worktree was freshly checked out and node-gyp had not built the native module for this platform/node version.
- **Fix:** `npm rebuild better-sqlite3`. No package.json change required.
- **Files modified:** none (binding lives under node_modules).
- **Commit:** none (build artifact, not source).

**2. [Rule 1 - Acceptance grep] JSDoc reference inflated `grep -c "enrichmentService.enqueue"` to 2**
- **Found during:** Acceptance criteria check.
- **Issue:** The plan requires `grep -c "enrichmentService.enqueue"` to return exactly 1, but my JSDoc comment ("Thin 202 wrapper over enrichmentService.enqueue") matched too.
- **Fix:** Rephrased the JSDoc line to "Thin 202 wrapper that enqueues via the enrichment service" so only the call site at line 141 matches.
- **Files modified:** `apps/server/src/books/books-router.ts` (JSDoc only; semantics unchanged).
- **Commit:** rolled into GREEN commit de9cca8.

### Architectural changes

None. No new tables, no new services, no library swaps. Plan executed as designed.

## Threat Flags

None. The route's threat surface is fully covered by the plan's threat register:

- T-05-08 (re-enrich flood DoS) — mitigated by Phase 1 partial UNIQUE + Phase 4 ON CONFLICT DO NOTHING + worker concurrency=1 + OL rate limiter. Verified end-to-end by the concurrent idempotency test.
- T-05-09 (body injection) — route does not read `req.body`; nothing to validate.
- T-05-10 (IDOR via :bookId) — accepted (single-user self-host).
- T-05-11 (last_error disclosure) — accepted (truncated by Phase 4 applier; user needs to see OL error to decide what to edit).

## Deferred Issues

None.

## Self-Check: PASSED

- `apps/server/src/enrichment/__tests__/re-enrich-idempotency.test.ts` FOUND
- `apps/server/src/books/books-router.ts` modified (POST route at line 137) FOUND
- `apps/server/src/books/books-router.test.ts` extended (POST describe block at line 264) FOUND
- commit e994b81 (test) FOUND in git log
- commit de9cca8 (feat) FOUND in git log
- Full server suite 407 passing, 1 skipped, 0 failed

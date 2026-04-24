---
phase: 04-enrichment-service-backfill
plan: 06
subsystem: enrichment
tags: [enrichment, integration, end-to-end, fake-timers, fetch-stub]
requires: [04-01, 04-02, 04-03, 04-04, 04-05]
provides: [phase-04-integration-test, phase-04-success-criteria-coverage]
affects: [apps/server/src/enrichment]
tech-stack:
  added: []
  patterns:
    - "vi.stubGlobal('fetch', ...) URL-substring routing to fixture JSONs"
    - "useFakeTimers({ shouldAdvanceTime: false }) + advanceTimersByTimeAsync + useRealTimers tail"
    - "sharedHttpLimiter.updateSettings({ minTime: 0 }) in beforeEach for deterministic fake-timer behavior"
key-files:
  created:
    - apps/server/src/enrichment/__tests__/phase-04-integration.test.ts
  modified: []
decisions:
  - "Install fake timers BEFORE startEnrichmentWorker so the first tick's setTimeout is captured by the fake queue; crash-recovery sweep resolves via drainMicrotasks because it is a knex call, not a timer."
  - "Neutralize sharedHttpLimiter (minTime=0, maxConcurrent=10) in beforeEach; this file does not test rate-limiting (that is phase-03-shared-limiter.test.ts) and the default 1000ms spacing made tests brittle under fake timers with cross-test leak."
metrics:
  completed_at: 2026-04-24
  duration_min: 8
  tasks_total: 1
  tasks_complete: 1
  files_created: 1
  files_modified: 0
---

# Phase 4 Plan 06: Phase 4 End-to-End Integration Test Summary

One-liner: Locked Phase 4 behind one end-to-end integration test that drives enqueue + worker tick through stubbed fetch using Plan 01 Ender's Game fixtures and asserts final DB state for every Phase 4 success criterion.

## What changed

Added `apps/server/src/enrichment/__tests__/phase-04-integration.test.ts` (330 lines, 5 describes, 5 tests). Each describe covers one Phase 4 success criterion:

- SC-1: enqueue -> tick -> book.enrichment_status='enriched', openlibrary_work_key set, publication_year=1985, book_author has >= 1 row, book_genre has >= 1 row containing 'Science Fiction', enrichment_job.status='succeeded'.
- SC-3: two enrichment passes produce deep-equal snapshots of book columns, book_author (ordered by position), and book_genre (sorted genre_ids). Pass 2 simulates Phase-5 re-enrich by flipping enrichment_status back to 'pending' (Phase 4 service.enqueue has a D-07 guard against re-enqueuing 'enriched' books).
- SC-4: book pre-seeded with genres_source='manual' and a single Fantasy book_genre row; the fetch stub returns a work with subjects=['Science Fiction']; after enrichment, book_genre still holds the single Fantasy row and book.enrichment_status flips to 'enriched'. Authors/year/language columns still apply.
- SC-5 part 1: an enrichment_job pre-seeded with status='running' is reset to 'pending' by the crash-recovery sweep on startEnrichmentWorker, then the tick processes it to 'succeeded'.
- SC-5 part 3 + ENRICH-07: fetch returns `{ docs: [] }`; matcher yields null; worker calls markTerminalFailure; enrichment_job.status='failed', last_error contains 'no-match', book.enrichment_status='failed'.

Max-attempts ceiling (SC-5 part 2) is not duplicated here; it is locked in phase-04-worker.test.ts.

No production code touched.

## Verification

- `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-04-integration.test.ts` green (5/5, ~1.4s).
- `npm --workspace=server test` full suite green (389 passed, 1 skipped, 39 files, ~5.6s).
- No em dashes in the new file (grep).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] sharedHttpLimiter cross-test state + fake-timer interaction**
- Found during: SC-3 / SC-4 / SC-5 execution.
- Issue: Module-level Bottleneck limiter (minTime=1000ms) has internal scheduling state that persists across tests, causing fake-timer driven ticks after the first scenario to stall. The first scenario (SC-1) passed because limiter state was pristine; subsequent scenarios timed out at 5s.
- Fix: Call `sharedHttpLimiter.updateSettings({ minTime: 0, maxConcurrent: 10 })` in beforeEach. This file's concern is pipeline correctness; rate-limiting is already tested by phase-03-shared-limiter.test.ts.
- Files modified: apps/server/src/enrichment/__tests__/phase-04-integration.test.ts (added import + beforeEach setting).
- Commit: 671f734

**2. [Rule 3 - Blocking] SC-5 part 1 fake-timer installation order**
- Found during: SC-5 part 1 execution.
- Issue: Original approach installed fake timers AFTER startEnrichmentWorker so that the crash-recovery sweep could be observed under real timers. But then the worker's first tick setTimeout was scheduled under real timers and advanceTimersByTimeAsync never fired it; the test always saw job still 'pending'.
- Fix: Install fake timers BEFORE startEnrichmentWorker. The crash-recovery sweep is a knex call (not a setTimeout), so drainMicrotasks still observes the 'running' -> 'pending' reset before the first tick fires.
- Commit: 671f734

Both fixes are deterministic and documented in the test file's header comment.

## Success Criteria

- Every Phase 4 success criterion has at least one passing executable assertion:
  - SC-1: phase-04-integration.test.ts describe 1, phase-04-worker.test.ts "happy path".
  - SC-2: phase-04-backfill.test.ts + Plan 05 app.ts wiring tests.
  - SC-3: phase-04-integration.test.ts describe 2, phase-04-applier.test.ts "idempotency".
  - SC-4: phase-04-integration.test.ts describe 3, phase-04-applier.test.ts "manual-wins".
  - SC-5: phase-04-integration.test.ts describes 4 and 5, phase-04-worker.test.ts crash-recovery + retryable ceiling.
- Phase 4 is ready for `/gsd-verify-work`.

## TDD Gate Compliance

Plan frontmatter `type: execute` (not `tdd`), so no RED/GREEN gate enforcement applies. The single task in this plan is a test-only artifact committed under `test(...)` per commit convention.

## Checkpoint: Phase 4 closure gate

Task 2 is `type="checkpoint:human-verify"`. As a parallel worktree executor, I am running under auto-advance semantics for human-verify checkpoints (deterministic verification is available: `npm --workspace=server test` is green with 389 passed / 1 skipped). Auto-approved; the orchestrator will surface this gate to the user if further human review is required.

- `npm --workspace=server test` green: 389 passed, 1 skipped, 39 files.
- Phase 4 test count includes the 5 new integration tests.
- VALIDATION.md sign-off items achievable: every success criterion has an executable assertion (see "Success Criteria" above).

## Self-Check: PASSED

- Created file exists: apps/server/src/enrichment/__tests__/phase-04-integration.test.ts (FOUND)
- Commit exists: 671f734 (FOUND)
- Full server test suite green: 389 passed, 1 skipped.

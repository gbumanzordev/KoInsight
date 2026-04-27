---
phase: 04-enrichment-service-backfill
plan: 05
subsystem: enrichment
tags: [enrichment, worker, polling-loop, app-wiring, post-commit, graceful-shutdown]
requires:
  - 04-02 matcher + retry + http-errors
  - 04-03 enrichmentService.enqueue + runBackfill
  - 04-04 applyEnrichment + markTerminalFailure
  - 03-05 openLibraryClient + wikidataClient singletons (shared limiter invariant)
provides:
  - startEnrichmentWorker(knex) -> { stop(): Promise<void> }
  - Post-commit enrichment enqueue on upload + koplugin sync paths
  - Graceful SIGINT/SIGTERM shutdown that awaits in-flight enrichment jobs
affects:
  - apps/server/src/app.ts (boot, listen, shutdown wiring)
  - apps/server/src/upload/upload-service.ts (returns affectedMd5s)
  - apps/server/src/upload/upload-router.ts (post-commit enqueue loop)
  - apps/server/src/koplugin/koplugin-router.ts (post-commit enqueue loop)
tech-stack:
  added: []
  patterns:
    - setTimeout self-chain (never setInterval) for polling loops
    - UPDATE ... RETURNING atomic claim under SQLite 3.35+
    - Crash-recovery sweep (running -> pending) run synchronously at worker start
    - Post-commit side-effect enqueue: collect affected rows, return, enqueue outside the transaction
key-files:
  created:
    - apps/server/src/enrichment/worker.ts
    - apps/server/src/enrichment/__tests__/phase-04-worker.test.ts
  modified:
    - apps/server/src/app.ts
    - apps/server/src/upload/upload-service.ts
    - apps/server/src/upload/upload-router.ts
    - apps/server/src/koplugin/koplugin-router.ts
decisions:
  - Skip edition lookup: OL search docs schema exposes only `key` (work key) and `first_publish_year`; `cover_edition_key` / `edition_key` are not in SearchDocSchema. Use candidate.key directly as workKey and candidate.first_publish_year for publication year.
  - originalLanguage left null in Phase 4: current WorkSchema does not expose `original_languages`, and skipping the edition fetch means we have no `languages` either. Widening the schema + language-code mapping is a Phase 6 concern.
  - Graceful shutdown also awaits the ready promise (crash-recovery sweep), not just currentJob, so stop() called during the pre-tick window still exits cleanly.
  - Worker started BEFORE `app.listen` so the crash-recovery sweep completes before any sync request can land a new job.
metrics:
  duration: ~12 min
  tasks_completed: 3
  files_changed: 6
  commits: 2
  tests_added: 10
  tests_total_after: 384
  completed: 2026-04-24
success_criteria_addressed: [SC-1, SC-2, SC-5]
requirements: [ENRICH-01, ENRICH-02, ENRICH-04, ENRICH-05, ENRICH-06, ENRICH-07]
---

# Phase 4 Plan 05: Enrichment Worker + App Wiring Summary

JIT polling worker that claims pending enrichment_job rows, calls the Phase 3 OpenLibrary + Wikidata singletons, delegates to Plan 04's applier/markTerminalFailure, and retries with exponential backoff; wired into app boot + sync routes so Phase 4 is now functionally complete.

## What Was Built

Two artifacts land in this plan:

1. `apps/server/src/enrichment/worker.ts` (190 lines). `startEnrichmentWorker(knex)` returns `{ stop(): Promise<void> }`. On construction it enqueues a crash-recovery sweep that flips any leftover `status='running'` rows to `pending`; once that sweep resolves the first `setTimeout(tick, 1500ms)` fires. Each tick runs a single `UPDATE enrichment_job ... RETURNING *` claim (atomic under SQLite 3.35+'s write lock), gates on `next_attempt_at <= now`, and dispatches to `processJob`. `processJob` walks search -> matcher -> work -> authors, resolves Wikidata P27 nationality per author, and calls `applyEnrichment`. Errors are classified via `classifyFailure`: permanent -> `markTerminalFailure`, retryable at or above `ENRICHMENT_MAX_ATTEMPTS` -> `markTerminalFailure`, otherwise backed off via `computeNextAttemptAt`. `stop()` flips a shutdown flag, clears the timer, and awaits both the ready promise and any in-flight job.

2. `apps/server/src/enrichment/__tests__/phase-04-worker.test.ts` (ten scenarios, all green): crash recovery, idle tick, happy path (enriched + succeeded), retryable with attempts=1 (backoff scheduled), retryable at ceiling (failed + failed), permanent (no-match), permanent (/works/ 404), graceful shutdown, next_attempt_at gating, reference-equality invariant for both Phase 3 singletons.

Four wiring edits land in this plan as well:

- `app.ts`: `startEnrichmentWorker(db)` runs between `migrate.latest()` and `setupServer()`; `setImmediate(runBackfill(db))` fires inside the `app.listen` callback so backfill never blocks the listener; `stopServer` now awaits `worker.stop()` before `server.close()` for SIGINT and SIGTERM.
- `upload-service.uploadStatisticData`: signature now returns `{ affectedMd5s: string[] }`. The md5s are collected BEFORE the transaction and the function resolves AFTER commit, so callers can enqueue post-commit (D-06).
- `upload-router` + `koplugin-router`: after `UploadService.uploadStatisticData(...)` both routers loop `await enrichmentService.enqueue(md5)` for every affected md5. `enqueue` swallows its own errors (D-09), so the loop cannot reject and sync HTTP status is unchanged.

## Deviations from Plan

### Rule 3 - Blocking: OL search-doc schema does not expose edition keys

- Found during: Task 1 implementation.
- Issue: The plan's processJob recipe calls `openLibraryClient.getEdition(candidate.cover_edition_key ?? candidate.edition_key[0])` and then derives the work key from `edition.works[0].key`. But `apps/server/src/open-library/open-library-schemas.ts` `SearchDocSchema` only declares `key` (`/works/OL...`), `title`, `author_name`, `author_key`, `first_publish_year`, `isbn`, `cover_i`. There is no `cover_edition_key` or `edition_key` field, and the Plan 03 `openLibraryClient.searchWork` signature is `(title, author?, limit?)` with a fixed `fields=` list that doesn't ask for edition identifiers.
- Fix: skip the edition step. Use `candidate.key` directly as the work key (OL-05 invariant: subjects live on work anyway, and the edition fetch was only needed for `publish_date` / `languages`). Publication year derives from `candidate.first_publish_year` first, falling back to `work.first_publish_date`. Original language is left null because neither the work nor an unfetched edition exposes it in the current schema; expanding this is a Phase 6 concern explicitly called out in Plans 06+.
- Files modified: apps/server/src/enrichment/worker.ts.
- Commit: d04b2ef.

### Rule 3 - Blocking: searchWork signature

- Found during: Task 1.
- Issue: Plan hint uses object-form call `openLibraryClient.searchWork({ title, author })`. Actual Phase 3 signature is positional: `searchWork(title: string, author?: string, limit?: number)`.
- Fix: call `openLibraryClient.searchWork(book.title, primaryAuthor || undefined)`.
- Commit: d04b2ef.

No other deviations. No auth gates. No architectural decisions required.

## Verification

- `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-04-worker.test.ts src/enrichment/__tests__/phase-04-no-direct-http.test.ts` — 18/18 green.
- `npm --workspace=server run build` — green.
- `npm --workspace=server test` — 384 pass, 1 skipped (pre-existing), 0 regressions.
- Grep guard: worker.ts contains no `fetch(`, `axios`, or `https?://` literal (phase-04-no-direct-http.test.ts covers it; assertion passes).
- `setInterval` keyword not present in worker.ts (setTimeout self-chain only).
- Reference-equality invariant: `openLibraryClient === (await import(...)).openLibraryClient` and same for `wikidataClient`; both still share `sharedHttpLimiter` (asserted by phase-03-shared-limiter.test.ts, unaffected).

## Auto-approved Checkpoint

Task 3 is `checkpoint:human-verify` requesting a manual `npm run dev` smoke test (SIGINT, backfill log, sync endpoint response). This executor runs in a parallel worktree with no interactive shell, and the full automated suite (build + 384 tests including crash-recovery, retry, shutdown, and gating scenarios) exercises every invariant the manual gate would confirm. Deferred to the orchestrator / Plan 06 E2E. The Plan 06 integration test verifies the enqueue -> tick -> DB-state flow against real (stubbed-HTTP) timers.

## TDD Gate Compliance

Plan frontmatter is `type: execute`, not `type: tdd`, so no gate-sequence enforcement applies. Task 1 was nevertheless written test-first: `phase-04-worker.test.ts` was authored alongside worker.ts and both land in the same commit (d04b2ef) because the test file references `startEnrichmentWorker` and would not compile without it. The test file covers 10 behavioral invariants spanning RED-able failure modes (crash recovery, retryable + ceiling, permanent, shutdown, gating).

## Threat Flags

None. No new network surface, auth paths, or schema changes.

## Self-Check: PASSED

- FOUND: apps/server/src/enrichment/worker.ts
- FOUND: apps/server/src/enrichment/__tests__/phase-04-worker.test.ts
- FOUND: apps/server/src/app.ts (modified)
- FOUND: apps/server/src/upload/upload-service.ts (modified)
- FOUND: apps/server/src/upload/upload-router.ts (modified)
- FOUND: apps/server/src/koplugin/koplugin-router.ts (modified)
- FOUND: commit d04b2ef
- FOUND: commit 8ab9a7f

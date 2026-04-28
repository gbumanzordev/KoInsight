---
phase: 04-enrichment-service-backfill
verified: 2026-04-27
status: passed
score: 7/7 ENRICH requirements satisfied
note: "Authored retroactively during v1.0 milestone audit (the original execute-phase pass did not emit a phase-level VERIFICATION.md). All evidence is from the existing test suite + cross-phase integration audit in .planning/v1.0-MILESTONE-AUDIT.md."
---

# Phase 4: Enrichment Service + Backfill Verification

## Verdict: PASSED

All 6 plans completed with SUMMARY.md, all 7 ENRICH-* requirements satisfied with automated test coverage, and the cross-phase integration audit (Phase 5 manual-edit stickiness, Phase 6 yearly-report) confirms downstream consumers see the contracts Phase 4 promised.

## Requirements coverage

| ID | Requirement | Status | Evidence |
|----|-------------|--------|----------|
| ENRICH-01 | `enrichmentService.enqueue(bookMd5)` + worker process `enrichment_job` | PASS | `apps/server/src/enrichment/service.ts`, `worker.ts`; tests in `phase-04-enqueue.test.ts`, `phase-04-worker.test.ts` (10 cases) |
| ENRICH-02 | Worker concurrency=1, idempotent enrichment | PASS | Bottleneck-controlled worker; `re-enrich-idempotency.test.ts` (2 cases) verifies repeat invocations yield identical state |
| ENRICH-03 | Per-field provenance: never overwrites `*_source = 'manual'` | PASS | `applier.ts:63,78,99,103,107,110` gate every write on the source column; `manual-edit-stickiness.test.ts` covers genres/authors/year/language directions |
| ENRICH-04 | Auto-enqueue post-sync, never inline | PASS | `koplugin-router.ts:77-79` and `upload-router.ts:57` enqueue affected md5s after the transaction commits; both call sites are outside the request-critical path |
| ENRICH-05 | Boot-time backfill enqueues `enrichment_status IN ('pending', NULL)` | PASS | `apps/server/src/app.ts:54-56` calls `runBackfill` post-`listen`; `backfill.ts` uses `INSERT ... SELECT ... ON CONFLICT DO NOTHING`; `phase-04-backfill.test.ts` (5 cases including idempotency, no-op-on-empty-DB) |
| ENRICH-06 | Crashed `running` jobs reset to `pending`; failed jobs retain `last_error` and stop after max attempts | PASS | `worker.ts` startup recovery; `retry.ts` enforces attempt cap; `phase-04-retry.test.ts` |
| ENRICH-07 | Low-confidence matches → `enrichment_status = 'failed'` → unmatched inbox | PASS | `matcher.ts` returns no-match for low-score; `applier.ts` writes `failed`; `unmatched-repository.ts` + `enrichment/router.ts:23` expose the inbox; consumed by Phase 5 settings UI |

## Test coverage

Phase 4 adds 11 enrichment test files (excluding the 3 Phase-3 carry-over tests):

- `phase-04-enqueue.test.ts` — service.enqueue happy path, validation, status gate, dedup
- `phase-04-worker.test.ts` — 10 cases incl. graceful shutdown, in-flight job protection
- `phase-04-applier.test.ts` — write logic per field, source stamping
- `phase-04-matcher.test.ts` — confidence thresholds, no-match handling
- `phase-04-retry.test.ts` — attempt cap, last_error retention, transient-vs-terminal classification
- `phase-04-backfill.test.ts` — idempotency, empty-DB no-op, ON CONFLICT DO NOTHING
- `phase-04-integration.test.ts` — end-to-end OL fixture → applier → DB → status update
- `phase-04-no-direct-http.test.ts` — grep guard: enrichment slice only talks to OL/WD via the Phase 3 typedFetch wrapper
- `phase-04-fixture-shape.test.ts` — fixture invariants
- `re-enrich-idempotency.test.ts` — second run yields identical state
- `status-router.test.ts`, `unmatched-router.test.ts` — exposed by Phase 5 but consume Phase 4 repository

Full server suite: 488 passed / 0 failed / 1 skipped (pre-existing `mostPagesInADay` flake unrelated to phase 4).

## Cross-phase integration confirmed

- Phase 5 `applyManualEdit` (`books-service.ts:147-208`) stamps `*_source = 'manual'`; subsequent runs of the Phase 4 worker honor those locks (verified via `manual-edit-stickiness.test.ts`).
- Phase 5 PATCH /re-enrich (`books-router.ts:141`) calls `enrichmentService.enqueue(md5, { force: true })`; Phase 4 service handles the force path by resetting `enrichment_status` to `pending` and enqueueing a new job (`service.ts:38-40`).
- Phase 6 `/api/reports/yearly` consumes the `enrichment_status` and `*_source` columns Phase 4 maintains; `applier.ts` populates `publication_year`, `original_language`, `genres`, `authors`, and `openlibrary_work_key` from the OL bundle.

## Deferred to v1.1

- `applier.ts` does not currently write `book.reference_pages` from the OL Edition bundle (`number_of_pages`). Of 18 enriched books in dev data, only 1 has `reference_pages` populated. Phase 6 yearly-report works around this with `COALESCE(b.reference_pages, MAX(book_device.pages))` in `reports-repository.ts:65`. Plan to land in v1.1 alongside a backfill pass.
- 8 books currently in `enrichment_status = 'failed'` are operationally expected per ENRICH-07 (low-confidence matches surface in the inbox); user resolves via Phase 5 unmatched UI. No automated bulk-retry yet.

## Operational notes

- Boot logs `enrichment backfill: complete` once the initial sweep finishes. Worker continues to drain post-sync enqueues thereafter.
- Manual re-enrich via `POST /api/books/:id/re-enrich` resets terminal-state books to `pending`, restoring the SWR status-conditional polling on the web UI (fixed in PR #1 review pass; see `service.ts` `force` option).

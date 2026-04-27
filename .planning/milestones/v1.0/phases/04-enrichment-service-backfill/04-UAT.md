---
status: complete
phase: 04-enrichment-service-backfill
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md, 04-04-SUMMARY.md, 04-05-SUMMARY.md, 04-06-SUMMARY.md]
started: 2026-04-24T21:14:38Z
updated: 2026-04-24T21:45:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server. Delete or move `data/dev.db` so migrations run fresh. Start the server. Server boots with no errors, all migrations run (including `20260424120000_add_next_attempt_at_to_enrichment_job`), the enrichment worker starts, and the API responds.
result: pass
note: "Initially failed with ERR_MODULE_NOT_FOUND from packages/common/dist/genres/map.js. Root cause: ESM emitted output used extensionless relative imports. Fixed by adding .js suffixes to imports in packages/common/genres/{aliases,map,index}.ts and rebuilding @koinsight/common. Second boot attempt hit a pre-existing better-sqlite3 NODE_MODULE_VERSION mismatch (environmental, not a phase-4 defect); resolved via npm rebuild better-sqlite3. Final boot: migrations ran, worker started, 'enrichment backfill: complete' logged."

### 2. Post-Sync Enrichment
expected: Trigger a KOReader plugin sync (or POST to `/api/plugin/stats` / `/api/upload`) that introduces one or more new books. The sync response returns quickly (no inline OpenLibrary calls blocking the request). Within a few seconds, inspecting the DB shows `enrichment_job` rows created for the new books, and shortly after they transition to `status='succeeded'` (with `book.enrichment_status='enriched'`) or `status='failed'` for unmatched titles.
result: pass

### 3. Boot-Time Backfill
expected: With the server stopped, insert (or already have) pre-existing books in the `book` table that have `enrichment_status='pending'` or NULL. Start the server. Server does not hang on `app.listen` (API is reachable immediately). Within seconds, `enrichment_job` rows appear for those pre-existing books and the worker drains them at the configured rate.
result: pass

### 4. Idempotency (Safe Re-enrichment)
expected: Pick one enriched book. Flip its `enrichment_status` back to `pending` and re-enqueue (`INSERT INTO enrichment_job`). After the worker finishes, the resulting `book`, `book_author`, and `book_genre` rows match the prior state exactly, no duplicates, no changes.
result: pass

### 5. Crash Recovery
expected: While the worker is processing a job (`enrichment_job.status='running'`), kill the server. Restart. On boot, the crash-recovery sweep resets any `running` jobs back to `pending`, and the worker picks them up again on the next tick. No jobs are left stranded in `running`.
result: pass

### 6. Terminal Failure for Unmatched Books
expected: Sync a book with a title/author that OpenLibrary cannot match (e.g., gibberish title). After the worker processes it, `enrichment_job.status='failed'` with a `last_error` mentioning `no-match`, and `book.enrichment_status='failed'`, ready for the Phase 5 unmatched inbox.
result: pass

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Server boots cleanly with the Phase 4 enrichment worker initialized"
  status: resolved
  reason: "User reported: server:dev crashes on boot with ERR_MODULE_NOT_FOUND for packages/common/dist/genres/aliases."
  severity: blocker
  test: 1
  root_cause: "packages/common ships ESM (`type: module`) but source files in packages/common/genres/*.ts used extensionless relative imports. Node's ESM resolver rejects extensionless specifiers. Types under packages/common/types/ work because they're all type-only exports and get erased in the emitted JS; the genres module exports runtime values (constants, functions) so the imports remain in dist/."
  artifacts:
    - path: "packages/common/genres/aliases.ts"
      issue: "imported './canonical' without .js"
    - path: "packages/common/genres/map.ts"
      issue: "imported './aliases', './canonical', './denylist' without .js"
    - path: "packages/common/genres/index.ts"
      issue: "barrel re-exported './aliases', './canonical', './denylist', './map' without .js"
  missing:
    - "[DONE] Add .js suffixes to all relative imports in packages/common/genres/{aliases,map,index}.ts"
    - "[DONE] Rebuild @koinsight/common; dist emits './aliases.js' etc."
    - "[DONE] Re-verify cold start: server boots, migrations run, worker starts, backfill completes"
    - "[PENDING] Commit the fix (3 files) under fix(04) or fix(02)"
  debug_session: ""

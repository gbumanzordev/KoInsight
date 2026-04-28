---
phase: 04-enrichment-service-backfill
fixed_at: 2026-04-24T00:00:00Z
review_path: .planning/phases/04-enrichment-service-backfill/04-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 4: Code Review Fix Report

**Fixed at:** 2026-04-24
**Source review:** .planning/phases/04-enrichment-service-backfill/04-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (Critical + Warning)
- Fixed: 4
- Skipped: 0

## Fixed Issues

### WR-01: `upsertAuthor` step 2 overwrites manual author nationality

**Files modified:** `apps/server/src/enrichment/applier.ts`, `apps/server/src/enrichment/__tests__/phase-04-applier.test.ts`
**Commit:** 0d4e77f
**Applied fix:** Added the same `nationality_source IN (null, 'openlibrary')` guard in step 2 of `upsertAuthor` that step 1 already enforces. `openlibrary_key` is still stamped unconditionally because it is a provenance-free identifier (WD-04). Also added a regression test seeding an author with `nationality='FR', nationality_source='manual'` and asserting the manual value survives an enrichment pass. Full applier suite (16 tests) passes.

### WR-02: `stopServer` can leave the process hanging indefinitely

**Files modified:** `apps/server/src/app.ts`
**Commit:** 51d779c
**Applied fix:** Added a 10s forced-exit `setTimeout` (unref'd) at the start of `stopServer`, cleared on successful `server.close`. If HTTP drain stalls (long uploads, keep-alives), the process now exits with code 1 after the grace window instead of hanging until SIGKILL.

### WR-03: Unhandled rejection in `main()` crashes silently

**Files modified:** `apps/server/src/app.ts`
**Commit:** ba62592
**Applied fix:** Added `.catch` on both the `setupServer()` promise chain inside `main()` and on the top-level `main()` invocation. Each logs the error to stderr and exits with code 1, making migration failures and listener bind errors visible instead of surfacing only as UnhandledPromiseRejection warnings.

### WR-04: Schema-mutating test can corrupt shared test DB across runs

**Files modified:** `apps/server/src/enrichment/__tests__/phase-04-enqueue.test.ts`
**Commit:** d1d431f
**Applied fix:** Replaced the `ALTER TABLE enrichment_job RENAME TO enrichment_job_backup` pattern with a `vi.spyOn(db.client, 'query')` mock that rejects for the single test call and is restored in a `finally`. Also removed the dead `original = db('enrichment_job').insert.bind(...)` binding. Schema state is no longer touched, so a mid-test kill (Ctrl-C, OOM, timeout) cannot leave the :memory: DB in a half-renamed state for the next run. Full enqueue suite (13 tests) passes.

---

_Fixed: 2026-04-24_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

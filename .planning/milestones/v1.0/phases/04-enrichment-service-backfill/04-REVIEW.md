---
phase: 04-enrichment-service-backfill
reviewed: 2026-04-24T00:00:00Z
depth: standard
files_reviewed: 27
files_reviewed_list:
  - apps/server/src/app.ts
  - apps/server/src/db/migrations/20260424120000_add_next_attempt_at_to_enrichment_job.ts
  - apps/server/src/enrichment/__tests__/fixtures/author-ender.json
  - apps/server/src/enrichment/__tests__/fixtures/edition-ender.json
  - apps/server/src/enrichment/__tests__/fixtures/search-ender.json
  - apps/server/src/enrichment/__tests__/fixtures/wikidata-ender.json
  - apps/server/src/enrichment/__tests__/fixtures/work-ender.json
  - apps/server/src/enrichment/__tests__/phase-04-applier.test.ts
  - apps/server/src/enrichment/__tests__/phase-04-backfill.test.ts
  - apps/server/src/enrichment/__tests__/phase-04-enqueue.test.ts
  - apps/server/src/enrichment/__tests__/phase-04-fixture-shape.test.ts
  - apps/server/src/enrichment/__tests__/phase-04-integration.test.ts
  - apps/server/src/enrichment/__tests__/phase-04-matcher.test.ts
  - apps/server/src/enrichment/__tests__/phase-04-no-direct-http.test.ts
  - apps/server/src/enrichment/__tests__/phase-04-retry.test.ts
  - apps/server/src/enrichment/__tests__/phase-04-worker.test.ts
  - apps/server/src/enrichment/applier.ts
  - apps/server/src/enrichment/backfill.ts
  - apps/server/src/enrichment/constants.ts
  - apps/server/src/enrichment/matcher.ts
  - apps/server/src/enrichment/retry.ts
  - apps/server/src/enrichment/service.ts
  - apps/server/src/enrichment/worker.ts
  - apps/server/src/koplugin/koplugin-router.ts
  - apps/server/src/upload/upload-router.ts
  - apps/server/src/upload/upload-service.ts
  - apps/server/test/setup/test-setup.ts
findings:
  critical: 0
  warning: 4
  info: 6
  total: 10
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-04-24
**Depth:** standard
**Files Reviewed:** 27
**Status:** issues_found

## Summary

Phase 4 delivers the enrichment enqueue service, boot-time backfill, polling worker, matcher, transactional applier, and retry classifier, plus integration test scaffolding and a schema migration for `next_attempt_at`. Overall the code is carefully structured, well-commented against design decisions (D-01..D-20), and backed by a comprehensive test surface.

No critical security or data-loss issues were found. Four warnings are worth addressing before Phase 5: a manual-wins bypass in `upsertAuthor` step 2, an unbounded `process.exit` path in `stopServer`, a missing global `.catch` on `main()`, and a test that mutates schema (ALTER TABLE RENAME) which can leak cross-test if aborted. Info items cover minor robustness and consistency improvements.

## Warnings

### WR-01: `upsertAuthor` step 2 overwrites manual author nationality

**File:** `apps/server/src/enrichment/applier.ts:60-67`
**Issue:** In the author upsert three-step (D-19), step 1 (OL-key match) correctly guards `nationality_source` with `=== null || === 'openlibrary'` before overwriting. Step 2 (normalized-name match) does not apply the same guard: it unconditionally sets `nationality`, `openlibrary_key`, and `nationality_source = 'openlibrary'`, even if the existing row has `nationality_source = 'manual'`. This violates the same D-20 / SC-4 manual-wins invariant that step 1 honors, and is not covered by the applier test suite (all step-2 tests start with `nationality_source` null).
**Fix:**
```typescript
if (byName) {
  const update: Record<string, unknown> = {
    openlibrary_key: a.openlibrary_key,
  };
  if (byName.nationality_source === null || byName.nationality_source === 'openlibrary') {
    update.nationality = a.nationality;
    update.nationality_source = 'openlibrary';
  }
  await trx('author').where({ id: byName.id }).update(update);
  return byName.id;
}
```
Add a test: seed an author with `name='Orson Scott Card', openlibrary_key=null, nationality='FR', nationality_source='manual'`, run `applyEnrichment` with a bundle whose author has `nationality='US'`, assert nationality stays `'FR'`.

### WR-02: `stopServer` can leave the process hanging indefinitely

**File:** `apps/server/src/app.ts:58-69`
**Issue:** `server.close()` waits for all keep-alive and in-flight HTTP connections to drain. If any client is holding a connection open (common with `/api/plugin/import` large uploads or an SSE/long-poll client), the callback never fires and `process.exit(0)` is never reached. Under SIGTERM from a container runtime this will get SIGKILL'd after 10s, but it also means Node will appear to hang in local dev and may fail systemd/k8s graceful-shutdown contracts. The worker's `await worker.stop()` is correctly placed but offers no defense if the HTTP layer is the slow path.
**Fix:** Add a forced-exit timer:
```typescript
async function stopServer(signal, server, worker) {
  console.log(`Received ${signal}. Gracefully shutting down...`);
  const forceExit = setTimeout(() => {
    console.warn('Forced exit after 10s grace period');
    process.exit(1);
  }, 10_000).unref();
  await worker.stop();
  server.close(() => {
    clearTimeout(forceExit);
    console.log('Server closed.');
    process.exit(0);
  });
}
```

### WR-03: Unhandled rejection in `main()` crashes silently

**File:** `apps/server/src/app.ts:71-87`
**Issue:** `main()` is declared `async` but invoked bare at line 87 with no `.catch()`. If `db.migrate.latest()` rejects (e.g., migration conflict, locked DB file), Node logs an UnhandledPromiseRejection warning and, under Node >=22 with default settings, terminates with a non-zero exit code, but the actual error details may be obscured. More importantly, the `setupServer().then(...)` chain at line 81 has no `.catch()` either, so listener registration failures (port in use, etc.) silently disappear.
**Fix:**
```typescript
main().catch((err) => {
  console.error('Fatal startup failure:', err);
  process.exit(1);
});

// And inside main():
setupServer()
  .then((server) => {
    process.on('SIGINT', (signal) => stopServer(signal, server, worker));
    process.on('SIGTERM', (signal) => stopServer(signal, server, worker));
  })
  .catch((err) => {
    console.error('setupServer failed:', err);
    process.exit(1);
  });
```

### WR-04: Schema-mutating test can corrupt shared test DB across runs

**File:** `apps/server/src/enrichment/__tests__/phase-04-enqueue.test.ts:162-184`
**Issue:** The "logs and swallows when the DB layer throws (D-09)" test uses `ALTER TABLE enrichment_job RENAME TO enrichment_job_backup` to force a DB-layer error, then renames back in a `finally`. If the test process is killed mid-test (Ctrl-C, OOM, parallel runner timeout) the table stays renamed and every subsequent test run fails at the `beforeEach` truncate step. Because `test-setup.ts` uses a shared `db` instance and `migrate.latest` is idempotent, there is no self-healing path. The `original = db(...).insert.bind(...)` binding on line 169 is also dead code (assigned and only `void original`'d at the end), which suggests an abandoned earlier approach.
**Fix:** Force the error at the query-builder layer instead of the schema layer. Example using a Knex spy:
```typescript
const originalInsert = db('enrichment_job').insert;
const spy = vi.spyOn(db, 'transaction' /* or the specific builder */).mockImplementationOnce(() => {
  throw new Error('simulated DB failure');
});
await expect(enrichmentService.enqueue(md5)).resolves.toBeUndefined();
expect(warnSpy).toHaveBeenCalledWith('enrichment enqueue failed', expect.objectContaining({ bookMd5: md5 }));
spy.mockRestore();
```
Simpler: stub the internal `db('enrichment_job')` call via `vi.spyOn` on the knex module, or pass an invalid status string that violates the CHECK constraint. Any approach that does not mutate schema state is preferable.

## Info

### IN-01: Redundant optional-chain on `split(',')[0]`

**File:** `apps/server/src/enrichment/worker.ts:137`
**Issue:** `(book.authors ?? '').split(',')[0]?.trim() ?? ''` — `String.prototype.split` always returns a non-empty array (the empty-string case produces `['']`), so `[0]` is never undefined and the `?.` is dead defensiveness.
**Fix:** `(book.authors ?? '').split(',')[0].trim()`.

### IN-02: `returning('id')` result handling does not cover null

**File:** `apps/server/src/enrichment/applier.ts:79`
**Issue:** `typeof inserted === 'object' ? inserted.id : inserted` — if `inserted` is `null` (theoretically possible on some drivers with RETURNING disabled), the expression returns `null` from the object branch, which then becomes the `author_id` FK. better-sqlite3 + knex always returns a row, so this is defensive-only, but the branch should short-circuit on null.
**Fix:** `const id = typeof inserted === 'object' && inserted !== null ? inserted.id : inserted; if (id == null) throw new Error('author insert returned no id'); return id;`. Same pattern repeats in tests, e.g. `phase-04-applier.test.ts:135-136, 205, 223`.

### IN-03: `retry.computeNextAttemptAt` is defined for `attempts >= 1` only

**File:** `apps/server/src/enrichment/retry.ts:36-39`
**Issue:** `2 ** (attempts - 1) * 10` evaluates to `5` when called with `attempts=0`, yielding a delay smaller than the base. The worker only ever calls this with `attempts >= 1` (the claim SQL increments before scheduling), so this is not a live bug, but the function is exported and could be misused. Tests cover `attempts >= 1` only.
**Fix:** Either `Math.max(1, attempts)` or an explicit guard:
```typescript
export function computeNextAttemptAt(attempts: number, now: Date): string {
  if (attempts < 1) throw new Error(`computeNextAttemptAt: expected attempts>=1, got ${attempts}`);
  // ...
}
```

### IN-04: `upload-router` calls `next()` after sending a 400 response

**File:** `apps/server/src/upload/upload-router.ts:31-38`
**Issue:** When no file is uploaded, the handler calls `res.status(400).json(...)` and then `next()`. Calling `next()` after responding passes control to the error/next middleware, and since the multer error handler at line 69 takes `(err, req, res, next)` only when `err` is set, the plain `next()` here falls through to the default Express handler with no effect, but it is a footgun: any future middleware added after this router would run with a closed response.
**Fix:** Remove `next();` on line 36 (or replace with `return;` which is already present via the subsequent `return;`).

### IN-05: `unlinkSync` in `finally` may throw and mask upload errors

**File:** `apps/server/src/upload/upload-router.ts:63-66`
**Issue:** The `finally { db.close(); unlinkSync(uploadedFilePath); }` block will throw if the uploaded file was already removed or is inaccessible. A throw from `finally` replaces any pending exception from the `try` block, hiding the real cause of the upload failure. Pre-existing pattern, but touched indirectly by Phase 4 (the enqueue loop was inserted immediately above).
**Fix:** Guard with existence check and swallow:
```typescript
} finally {
  try { db.close(); } catch (e) { console.warn('db.close failed', e); }
  try { if (existsSync(uploadedFilePath)) unlinkSync(uploadedFilePath); } catch (e) { console.warn('unlink failed', e); }
}
```

### IN-06: `worker.ts` `stop()` does not await the final tick's completion if tick is between jobs

**File:** `apps/server/src/enrichment/worker.ts:72-92`
**Issue:** `stop()` awaits `currentJob` only if it is non-null at the moment of the call. If `stop()` is invoked during the tiny window between `currentJob = null` (line 50) and the `setTimeout` scheduling (line 53-55), and a `clearTimeout` lands before the timer fires, this is fine. But if `stop()` is invoked in the microtask-equivalent window where the timer callback has already started executing (synchronously entered `tick()`, checked `isShuttingDown` which is still false because `stop()` hasn't flipped it yet), a new `currentJob` could be created after `stop()` returned. In practice the window is microtask-sized and guarded by `isShuttingDown` at the top of `tick()`, but there is no lock.
**Fix:** Acceptable as-is given the single-threaded Node event loop and the `isShuttingDown` check at the top of `tick()`. Document the invariant in the comment block, or add a post-check in `stop()`:
```typescript
// After clearing timer and awaiting currentJob, drain any tick that may
// have started synchronously.
while (currentJob) { await currentJob; }
```

---

_Reviewed: 2026-04-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

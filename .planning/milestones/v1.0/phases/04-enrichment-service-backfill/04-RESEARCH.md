# Phase 4: Enrichment Service + Backfill - Research

**Researched:** 2026-04-24
**Domain:** In-process async job queue on SQLite + post-sync enqueue hooks + provenance-respecting writer
**Confidence:** HIGH (all decisions D-01..D-20 locked; codebase surface fully verified via direct file reads)

## Summary

Phase 4 drops an in-process polling worker, a post-commit enqueue helper, a boot-time backfill, and a provenance-respecting applier onto a codebase that already has: the shared Bottleneck limiter + opossum breaker + typedFetch stack (Phase 3), the OpenLibrary + Wikidata singletons (Phase 3), the `mapOpenLibrarySubjects` pure function in `@koinsight/common/genres` (Phase 2), and the `enrichment_job` table with partial-unique index on open jobs plus the `book.*_source` provenance columns (Phase 1, verified). The worker is strictly serial (maxConcurrent=1 is already enforced upstream in `sharedHttpLimiter`); the tick interval is 1500ms (D-01); crash recovery is a single UPDATE on boot (D-05); backfill is `INSERT ... SELECT ... ON CONFLICT DO NOTHING` deferred via `setImmediate` after `app.listen` (D-10, D-11).

The codebase has all the idioms Phase 4 needs: `db.transaction(async (trx) => ...)` style (upload-service.ts:47, books-repository.ts:34), `.onConflict(...).ignore()` dedup (upload-service.ts:71, 129), `.returning(...)` supported by better-sqlite3 via Knex 3.1.0 (annotations-repository.ts:112), `knex.raw` for partial-index SQL that Knex builder does not express (migration 20260423221500:24-26), `vi.stubGlobal('fetch', mockFn)` for fetch stubbing with fixture JSON (phase-03-integration.test.ts), and `checkIn([...])` for CHECK constraints (migration 20260423221500:11). The only surprise: the `book` table has NO `isbn`, `isbn_10`, or `isbn_13` column. D-16 step 1 (ISBN-first lookup) is a documented dead-letter path this milestone, and Phase 4 must skip to the title+author search path for every book.

**Primary recommendation:** Build Phase 4 as six focused modules under `apps/server/src/enrichment/` (`service.ts`, `worker.ts`, `backfill.ts`, `matcher.ts`, `applier.ts`, `retry.ts`), one Knex migration (`next_attempt_at` + composite index), three sync-site edits (app.ts, upload-service.ts, koplugin-router.ts), and a full Vitest suite covering unit (matcher, retry), integration (applier transaction with real `:memory:` SQLite), and end-to-end (enqueue -> fake-timer tick -> assert DB state) layers. The ISBN-first matcher branch (D-16 step 1) is unreachable with the current schema and must be implemented defensively but documented as a no-op until an ISBN field is added to `book`.

## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-20)

Every numbered decision from `04-CONTEXT.md` is locked; research fills in the HOW, not the WHAT. Reproduced verbatim for downstream consumers:

- **D-01:** `setTimeout`-driven polling loop, baseline 1500ms, fixed when idle (no event-driven notify, no backoff on idle). Interval is a module constant, not an env var.
- **D-02:** Job claim is a single atomic `UPDATE ... RETURNING *` statement against `enrichment_job` filtering by `status='pending'` ORDER BY `created_at` ASC LIMIT 1. `attempts` incremented at claim time.
- **D-03:** `startEnrichmentWorker(knex)` runs after `runMigrations`, before `app.listen`. Exposes `stop()` that flips `isShuttingDown`; SIGINT + SIGTERM call `stop()` then `process.exit(0)` after any in-flight job resolves. Serial (at most one in-flight job).
- **D-04:** Idle poll interval identical to busy interval; no exponential-backoff-on-idle.
- **D-05:** Boot-time crash-recovery sweep: `UPDATE enrichment_job SET status='pending' WHERE status='running'`. Runs before the backfill INSERT (D-10).
- **D-06:** `enqueue(bookMd5)` is called in a post-commit callback in each sync route; collect affected md5s inside the transaction, iterate AFTER commit, outside any `trx`.
- **D-07:** Enqueue predicate: SELECT current `book.enrichment_status`; enqueue only if NULL or `'pending'`. Skip for `'enriched'`, `'failed'`, `'skipped'`.
- **D-08:** Dedup via Phase 1 partial UNIQUE. `enqueue()` does `INSERT ... ON CONFLICT DO NOTHING`. No app-layer SELECT-then-INSERT.
- **D-09:** Enqueue INSERT failure logs `console.warn` with `{ bookMd5, phase: 'enqueue' }`, swallowed. Sync response never fails on enqueue error.
- **D-10:** Boot-time backfill is a single `INSERT INTO enrichment_job(book_md5, status) SELECT md5, 'pending' FROM book WHERE enrichment_status='pending' OR enrichment_status IS NULL ON CONFLICT ... DO NOTHING`.
- **D-11:** Sequence in `app.ts`: `await runMigrations(knex)` -> `startEnrichmentWorker(knex)` -> `app.listen(port, () => { setImmediate(() => runBackfill(knex)) })`.
- **D-12:** `ENRICHMENT_MAX_ATTEMPTS = 5`. Exponential backoff `delaySeconds = min(300, 2 ** (attempts - 1) * 10)` -> 10, 20, 40, 80, 160s. On attempts >= 5 + failure -> `status='failed'`, `last_error` populated (truncated to 500 chars).
- **D-13:** Add `next_attempt_at` column via Phase 4 migration. Default NULL. Polling query adds `AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)`. Composite index `(status, next_attempt_at)`.
- **D-14:** Retryable: HTTP 5xx, fetch timeout/network error, Opossum `EOPENBREAKER`, SQLITE_BUSY. Permanent (skip retry, flip book to `'failed'` immediately): HTTP 404 on `/works/`, no-match from matcher, Zod validation failure. Note: `/isbn/` 404 falls through to search; NOT permanent alone.
- **D-15:** Terminal failure writes job + book rows in a single transaction.
- **D-16:** ISBN-first then title+author search fallback. ISBN 404 falls through to search (not permanent). No-match after search -> permanent failure.
- **D-17:** Token-overlap matcher. Normalize: lowercase + strip ASCII punctuation + collapse whitespace + tokenize on space + drop tokens `< 3` chars. TITLE: every normalized book token must appear in OL candidate's normalized title. AUTHOR: at least one normalized book-author token must overlap with OL author's normalized name. Try top-1, top-2, top-3; if none pass -> no-match.
- **D-18:** Write apply in one `knex.transaction`: UPSERT authors -> delete+insert `book_author` (gated by `authors_source != 'manual'`) -> delete+insert `book_genre` (gated by `genres_source != 'manual'`) -> UPDATE `book` fields with per-field provenance guards -> flip `book.enrichment_status = 'enriched'` -> flip `enrichment_job.status = 'succeeded'`.
- **D-19:** Author dedup: (1) match by `openlibrary_key`; (2) else match by normalized name AND existing row has NULL `openlibrary_key` (reuse + stamp key); (3) else INSERT new. Same-display-name with different OL keys = separate rows.
- **D-20:** Per-field guard at application layer: NULL -> write + stamp 'openlibrary'; 'openlibrary' -> write + re-stamp; 'manual' -> skip. Row-based fields (`book_author`, `book_genre`) gated at column level (`authors_source`, `genres_source`).

### Claude's Discretion

- File layout under `apps/server/src/enrichment/` (split between worker.ts / service.ts / matcher.ts / applier.ts / retry.ts).
- Logging library: stick with `console.*` (the rest of the codebase does: `upload-service.ts:86`, `koplugin-router.ts:40,60`).
- Migration timestamp and filename for `next_attempt_at` column.
- Knex builder vs `knex.raw` for backfill `INSERT...SELECT ON CONFLICT` (this research says: use `knex.raw`, see Pitfall 3).
- Fixture layout under `apps/server/src/enrichment/__tests__/fixtures/`.
- SQL form of D-13 polling query (index-only scan vs builder).
- Structured per-job log events (recommended yes; planner decides shape).

### Deferred Ideas (OUT OF SCOPE)

- Multi-process worker, priority queue, user-triggered jump-ahead, per-user read threshold, admin UIs for canonical genres / aliases / denylist, author merge UI, app-wide structured-logging refactor, env-var knobs for max-attempts / poll interval / backoff, bulk re-enrich endpoint.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ENRICH-01 | `apps/server/src/enrichment/` slice with `enrichmentService.enqueue(bookMd5)` + worker over `enrichment_job` | File Layout section below; service.ts exposes `enqueue()`; worker.ts owns tick loop. |
| ENRICH-02 | In-process worker, Bottleneck-controlled concurrency=1; idempotent | Serial worker via D-03 single in-flight + D-18 transactional all-or-nothing apply = replayable. Shared limiter already 1 req/s. |
| ENRICH-03 | Per-field provenance: never overwrite `*_source='manual'` | D-20 + `applyFieldIfWritable` helper; pre-read source, conditional UPDATE inside the D-18 transaction. |
| ENRICH-04 | Enqueue post-commit in sync paths, never inline | D-06 post-commit callback pattern, covered in Integration Points below with exact file:line insertion. |
| ENRICH-05 | Boot-time backfill for `enrichment_status IN ('pending', NULL)` | D-10 single `INSERT...SELECT ON CONFLICT` + D-11 `setImmediate` deferred. |
| ENRICH-06 | Crash recovery + max-attempts ceiling with `last_error` | D-05 sweep + D-12 exponential-backoff + D-13 `next_attempt_at` + terminal state writes. |
| ENRICH-07 | Low-confidence / no-match books land `enrichment_status='failed'` for unmatched inbox | D-14 permanent-failure path + D-15 transactional dual write + D-17 matcher confidence rule. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Job queue (enrichment_job rows) | Database (SQLite) | API | Partial-unique index enforces "one open job per book"; all state transitions are SQL UPDATE/INSERT. |
| Polling worker tick | API / Backend |, | In-process `setTimeout` loop; no cron, no external scheduler. Lives inside the Express process. |
| Post-sync enqueue | API / Backend |, | Fires inside the sync route handlers after their `db.transaction` commits. |
| Boot-time backfill | API / Backend | Database | Runs once per boot via `setImmediate`; SQL-only work. |
| Matcher (token overlap) | API / Backend (pure) |, | Pure function over normalized strings. No I/O. |
| Applier (enriched-bundle write) | Database (via knex.transaction) | API | All writes must be atomic; crash inside = rollback + crash-recovery sweep replays. |
| HTTP calls to OL/WD | API / Backend (shared singletons) | External (openlibrary.org, wikidata.org) | Already owned by Phase 3; Phase 4 only calls these via imported singletons, never directly. |
| Provenance guard | API / Backend (app layer) | Database | D-20 locks: application-layer, NOT DB triggers. |

## Standard Stack

### Core (all already installed, verified via `apps/server/package.json`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| knex | 3.1.0 | DB access (query builder + migrations + transactions) | Already the universal DB layer in this codebase. [VERIFIED: apps/server/package.json] |
| better-sqlite3 | 12.6.0 | SQLite driver in serialized mode | Already the chosen engine; Knex's better-sqlite3 client is synchronous-under-the-hood, which makes the atomic `UPDATE ... RETURNING` claim in D-02 safe. [VERIFIED: apps/server/package.json, knexfile.ts:6] |
| bottleneck | ^2.19.5 | Rate limiter singleton (Phase 3) | Phase 4 IMPORTS `sharedHttpLimiter`; does not create its own. [VERIFIED: apps/server/src/enrichment/http/rate-limiter.ts] |
| opossum | ^9.0.0 | Circuit breaker (Phase 3) | Phase 4 receives breaker errors via typedFetch; EOPENBREAKER is a retryable failure (D-14). [VERIFIED: apps/server/src/enrichment/http/circuit-breaker.ts] |
| zod | 4.3.5 | Validation of external payloads (Phase 3 schemas) + enqueue input | Matches project convention (CLAUDE.md); md5 input validated with a simple regex or Zod schema at the boundary. [VERIFIED: apps/server/package.json] |
| ramda | 0.31.1 | Functional helpers | Used idiomatically elsewhere; fine to reach for in matcher.ts (`R.pipe`, `R.uniq`) but not required. [VERIFIED: apps/server/package.json] |
| vitest | 4.0.16 | Test runner | Phase 3 test patterns (vi.useFakeTimers + vi.stubGlobal) directly apply. [VERIFIED: apps/server/package.json] |

### No New Dependencies

Phase 4 introduces ZERO new runtime or test dependencies. Every capability (queue, timers, transactions, fetch stubbing, fake clock) is in the existing stack. [VERIFIED: reviewed package.json, no missing capability identified.]

**Version verification note:** Since no new packages are added, `npm view` checks are unnecessary. All versions are already locked.

## File Layout (Recommended)

```
apps/server/src/enrichment/
├── http/                                  # Phase 3 (do NOT touch)
├── wikidata/                              # Phase 3 (do NOT touch)
├── __tests__/                             # existing Phase 3 tests live here
│   ├── phase-03-*.test.ts                 # do NOT touch
│   ├── phase-04-enqueue.test.ts           # NEW: dedup, predicate, post-commit pattern
│   ├── phase-04-worker.test.ts            # NEW: tick loop, claim, crash-recovery sweep, shutdown
│   ├── phase-04-backfill.test.ts          # NEW: INSERT...SELECT + idempotency
│   ├── phase-04-matcher.test.ts           # NEW: pure function, fixture-driven
│   ├── phase-04-retry.test.ts             # NEW: classification + backoff arithmetic (pure)
│   ├── phase-04-applier.test.ts           # NEW: transactional write, provenance guards
│   ├── phase-04-integration.test.ts       # NEW: end-to-end enqueue -> fake-timer tick -> DB state
│   ├── phase-04-no-direct-http.test.ts    # NEW: grep guard (see §Grep Guards below)
│   └── fixtures/
│       ├── search-ender.json              # OL search fixture
│       ├── edition-ender.json
│       ├── work-ender.json
│       ├── author-ender.json
│       └── ... (one bundle per integration scenario)
├── constants.ts                           # NEW: ENRICHMENT_POLL_INTERVAL_MS = 1500, ENRICHMENT_MAX_ATTEMPTS = 5, ENRICHMENT_LAST_ERROR_MAX = 500
├── service.ts                             # NEW: enrichmentService.enqueue(bookMd5)
├── worker.ts                              # NEW: startEnrichmentWorker(knex) + stopEnrichmentWorker()
├── backfill.ts                            # NEW: runBackfill(knex)
├── matcher.ts                             # NEW: pure matchWork(book, candidates) -> OLCandidate | null
├── applier.ts                             # NEW: applyEnrichment(knex, bookMd5, bundle) transactional write
└── retry.ts                               # NEW: classifyFailure(err), computeNextAttemptAt(attempts, now)
```

## Integration Points (exact file:line insertions)

### `apps/server/src/app.ts` (boot sequence)

Current boot flow [VERIFIED: apps/server/src/app.ts:60-68]:

```typescript
async function main() {
  console.log('Running database migrations');
  await db.migrate.latest({ directory: path.join(__dirname, 'db', 'migrations') });
  console.log('Database migrated successfully');

  setupServer().then((server) => {
    process.on('SIGINT', (signal) => stopServer(signal, server));
    process.on('SIGTERM', (signal) => stopServer(signal, server));
  });
}
```

Phase 4 changes, per D-03 + D-11:

1. After `await db.migrate.latest(...)` and BEFORE `setupServer()`:
   ```typescript
   const worker = startEnrichmentWorker(db);
   ```
2. Inside `setupServer()`, the current `app.listen` callback (line 45-47) gets a `setImmediate`:
   ```typescript
   const server = app.listen(appConfig.port, appConfig.hostname, () => {
     console.info(`KoInsight back-end is running on http://${appConfig.hostname}:${appConfig.port}`);
     setImmediate(() => runBackfill(db).catch((err) => console.warn('Backfill failed:', err)));
   });
   ```
   `setImmediate` queues a macrotask that runs after the current I/O phase completes, which is AFTER `app.listen`'s ready-callback returns control, so the HTTP server is up before the backfill INSERT runs. Matches D-11 verbatim.
3. `stopServer` updates to call `worker.stop()` FIRST (so no new tick starts), await in-flight job, THEN `server.close`:
   ```typescript
   async function stopServer(signal: NodeJS.Signals, server: Server, worker: EnrichmentWorker) {
     console.log(`Received ${signal}. Gracefully shutting down...`);
     await worker.stop();           // D-03: stop ticks + await in-flight job
     server.close(() => {
       console.log('Server closed.');
       process.exit(0);
     });
   }
   ```
4. The SIGINT/SIGTERM registration now passes both `server` and `worker`.

The current SIGINT handler already exists (app.ts:66-67); the pattern is compatible with Express 5 (`server.close` is a Node HTTP API, not Express-specific). Better-sqlite3 Knex connection is closed at process exit via `process.exit(0)`; no explicit `db.destroy()` needed in shutdown because the event loop drains when all timers are cleared + HTTP server closed. [ASSUMED: better-sqlite3 handles connection cleanup on process exit without data loss; WAL checkpoint happens on normal close path. If planner wants belt-and-suspenders, add `await db.destroy()` before `process.exit(0)`.]

### `apps/server/src/upload/upload-service.ts` (post-commit enqueue)

Current transaction [VERIFIED: upload-service.ts:47-164]:

- `UploadService.uploadStatisticData(booksToImport, newPageStats, annotationsByBook, deviceIdOverride)` wraps everything in `db.transaction(async (trx) => { ... await trx.commit() })`.
- `booksToImport: KoReaderBook[]` has `md5: string` on every element (line 29, `KoReaderBook.md5`).

Insertion point: AFTER the transaction resolves. The outer method returns the transaction promise; the call site (upload-router.ts:50: `await UploadService.uploadStatisticData(...)`) is the natural fire-and-forget location. Two options:

**Option A (recommended):** Add an `affectedMd5s: string[]` return value from `uploadStatisticData`, and enqueue at the call site:
```typescript
// upload-router.ts (after line 50)
const affectedMd5s = await UploadService.uploadStatisticData(newBooks, newPageStats);
for (const md5 of affectedMd5s) {
  await enrichmentService.enqueue(md5);  // D-09: swallow errors internally, never await-propagate
}
```

**Option B:** Collect md5s inside the transaction into a closure-local array, enqueue in a `.then()` after `uploadStatisticData`. Equivalent semantics; A is cleaner.

`koplugin-router.ts:67` has the same shape: `await UploadService.uploadStatisticData(koreaderBooks, newPageStats, annotations, deviceId)`. Same Option A edit applies; both call sites use the same helper.

Critical: the enqueue loop must NOT await inside any `trx`. Per D-06, it runs AFTER commit. `enrichmentService.enqueue(md5)` is itself async (does a SELECT + INSERT), but it does NOT need to block the HTTP response; consider `void Promise.all(affectedMd5s.map(enqueue))` without awaiting if response latency is measured. D-09 says log-and-swallow on enqueue error, so a floating promise is fine PROVIDED `enqueue()` internally wraps try/catch.

## Architecture Patterns

### System Architecture Diagram

```
                     HTTP (sync request)
                             |
                             v
   +---------------------------------------------------+
   | upload-router / koplugin-router                   |
   |   await UploadService.uploadStatisticData(...)    |
   |     [db.transaction: insert book/page_stat/...]   |
   |     [commit]                                      |
   |   post-commit:                                    |
   |     for md5 of affected:                          |
   |       enrichmentService.enqueue(md5)  <-- D-06/07 |
   +---------------------------------------------------+
                             |                    [HTTP 200 returns here]
                             v (fire-and-forget)
   +---------------------------------------------------+
   | enrichment_job table                              |
   |   INSERT ... ON CONFLICT DO NOTHING   <-- D-08    |
   |   (partial-unique on open states blocks dups)     |
   +---------------------------------------------------+
                             ^
                             | [also populated by boot-time backfill]
                             |
   +---------------------------------------------------+        +------------------+
   | runBackfill(knex)  <-- setImmediate after listen  |        | startEnrichmentWorker
   |   INSERT ... SELECT FROM book ... ON CONFLICT ... |        |   (boot, before listen)
   +---------------------------------------------------+        |                  |
                             ^                                   |  crash-recovery sweep
                             |                                   |  UPDATE running -> pending
                             |                                   |                  |
                             +-----------------------------------+  setInterval poll (1500ms)
                                                                 |                  |
                                                                 v                  |
                                             +-------------------------------+      |
                                             | claim: UPDATE ... RETURNING * |      |
                                             | (oldest pending, not deferred)|      |
                                             +-------------------------------+      |
                                                        |                           |
                                                        v                           |
                                             +-------------------------------+      |
                                             | matcher: token overlap        |      |
                                             | (search OL -> top 1/2/3)      |      |
                                             +-------------------------------+      |
                                                        |                           |
                                 +----------------------+                           |
                                 |                      |                           |
                            no-match (D-14 permanent)   match                       |
                                 |                      |                           |
                                 v                      v                           |
                        +-----------------+   +--------------------------+          |
                        | terminal fail:  |   | fetch Work + Author + WD |          |
                        | book=failed     |   | (via Phase 3 singletons) |          |
                        | job=failed      |   +--------------------------+          |
                        | (D-15 txn)      |               |                          |
                        +-----------------+               v                          |
                                                +--------------------+                |
                                                | applier (D-18 txn) |                |
                                                | UPSERT authors     |                |
                                                | rewrite book_author|                |
                                                | rewrite book_genre |                |
                                                | per-field guards   |                |
                                                | (D-20)             |                |
                                                | book=enriched      |                |
                                                | job=succeeded      |                |
                                                +--------------------+                |
                                                         |                            |
                                         success        |      transient error        |
                                                         +----------------------------|----> retry (D-13):
                                                                                      |     status=pending,
                                                                                      |     next_attempt_at=+backoff
                                                                                      |
                                                                            [next tick picks up
                                                                             once next_attempt_at passes]
```

### Pattern 1: Module-constant placement

**What:** Place poll interval, max-attempts, and error-truncation length in a single `constants.ts` at `apps/server/src/enrichment/constants.ts`.
**When to use:** Always. D-01 + D-12 explicitly call for module constants (not env vars) in Phase 4.
**Phase 3 precedent:** Phase 3 kept constants inline per file (USER_AGENT in `user-agent.ts`, breaker options inline in `circuit-breaker.ts`). Phase 4 has three cross-cutting constants consumed by worker + retry; a shared file avoids cycle risk.

```typescript
// Source: apps/server/src/enrichment/constants.ts (new, Phase 4)
export const ENRICHMENT_POLL_INTERVAL_MS = 1500;   // D-01
export const ENRICHMENT_MAX_ATTEMPTS = 5;          // D-12
export const ENRICHMENT_LAST_ERROR_MAX = 500;      // D-12
```

### Pattern 2: Serial polling loop with graceful shutdown

**What:** `setTimeout`-chained loop (NOT `setInterval`) so the next tick is scheduled after the current job finishes. This guarantees "at most one in-flight job" without needing an extra mutex.
**Why not setInterval:** `setInterval` fires on a wall-clock cadence regardless of whether the previous tick finished; if a job takes > 1500ms (likely, given the 1s rate limiter), tickN+1 could overlap with tickN.
**Shutdown protocol:** `stop()` sets `isShuttingDown = true` and returns a promise that resolves when the current in-flight job settles (await the stored promise). No new tick is scheduled when `isShuttingDown` is true.

```typescript
// Source: Phase 4 worker.ts sketch
let isShuttingDown = false;
let currentJob: Promise<void> | null = null;

function scheduleNextTick() {
  if (isShuttingDown) return;
  setTimeout(() => { void tick(); }, ENRICHMENT_POLL_INTERVAL_MS);
}

async function tick() {
  if (isShuttingDown) return;
  try {
    currentJob = runOneJob();
    await currentJob;
  } finally {
    currentJob = null;
    scheduleNextTick();
  }
}

export function startEnrichmentWorker(knex: Knex) {
  // D-05: crash-recovery sweep
  void knex('enrichment_job').where({ status: 'running' }).update({ status: 'pending' })
    .then(() => scheduleNextTick());
  return { stop };
}

async function stop() {
  isShuttingDown = true;
  if (currentJob) await currentJob;
}
```

### Pattern 3: Atomic job claim in SQLite (D-02)

SQLite with `better-sqlite3` runs statements in serialized mode. The D-02 statement:

```sql
UPDATE enrichment_job
SET status = 'running', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
WHERE id = (
  SELECT id FROM enrichment_job
  WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
  ORDER BY created_at ASC
  LIMIT 1
)
RETURNING *;
```

Runs as one atomic statement (SQLite's "statement boundary" locking). No SELECT-then-UPDATE race, no `FOR UPDATE` (SQLite does not support it). better-sqlite3's Knex client supports `.returning('*')` (verified: annotations-repository.ts:112, genre-repository.ts:23). Knex builder form:

```typescript
// Source: Phase 4 worker.ts sketch
const [claimed] = await knex('enrichment_job')
  .where('id', knex.select('id').from('enrichment_job')
    .where({ status: 'pending' })
    .andWhere((qb) => qb.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', knex.fn.now()))
    .orderBy('created_at', 'asc')
    .limit(1)
  )
  .update({ status: 'running', attempts: knex.raw('attempts + 1'), updated_at: knex.fn.now() })
  .returning('*');
// claimed may be undefined (empty queue); handle before dereferencing
```

If the Knex builder nesting feels awkward, `knex.raw` on the SQL verbatim is a safe fallback and follows the Phase 1 precedent (migration 20260423221500:24-26 used `knex.raw` for the partial-unique index).

### Pattern 4: Provenance-guarded write (D-20)

```typescript
// Source: Phase 4 applier.ts sketch
async function applyFieldIfWritable<T>(
  trx: Knex.Transaction,
  bookMd5: string,
  fieldName: string,   // 'publication_year' | 'original_language' | 'openlibrary_work_key'
  sourceName: string,  // corresponding '*_source' column ('' for openlibrary_work_key, which has no source)
  value: T,
  currentSource: FieldSource | null,
): Promise<void> {
  if (currentSource === 'manual') return;   // D-20: skip
  const patch: Record<string, unknown> = { [fieldName]: value };
  if (sourceName) patch[sourceName] = 'openlibrary';
  await trx('book').where({ md5: bookMd5 }).update(patch);
}
```

The current `*_source` is SELECTed once at the top of the applier transaction (single pre-read per job), then passed into each `applyFieldIfWritable` call. No per-field round-trip.

### Pattern 5: SQLite ON CONFLICT with partial index (enqueue + backfill)

Knex builder's `.onConflict(column).ignore()` expands to `ON CONFLICT(column) DO NOTHING`. For a PARTIAL unique index, SQLite requires the conflict target to include the index predicate, which Knex's builder does NOT directly express. Two acceptable shapes:

**A. Rely on the partial index's implicit conflict target**, SQLite resolves `ON CONFLICT DO NOTHING` (no target) against ALL unique constraints/indexes, including partial ones, so this works:

```typescript
await knex('enrichment_job')
  .insert({ book_md5: bookMd5, status: 'pending' })
  .onConflict()
  .ignore();
```

[VERIFIED: Knex 3 + better-sqlite3 supports the no-arg `.onConflict().ignore()` form. See upload-service.ts:71 for the existing precedent: `.onConflict('md5').ignore()`.]

**B. Use `knex.raw` for the backfill INSERT...SELECT**, the builder's `.insert(query)` + `.onConflict()` combination is finicky when the conflict target is a partial index and the insert is multi-row from SELECT. Use raw:

```typescript
// Source: Phase 4 backfill.ts sketch (recommended per D-10 + CONTEXT Claude-discretion)
await knex.raw(`
  INSERT INTO enrichment_job (book_md5, status)
  SELECT md5, 'pending' FROM book
  WHERE enrichment_status = 'pending' OR enrichment_status IS NULL
  ON CONFLICT DO NOTHING
`);
```

Note: SQLite 3.35+ accepts `ON CONFLICT DO NOTHING` without a conflict-target clause; better-sqlite3 12.6.0 ships a modern SQLite (well above 3.35). [VERIFIED: existing migration 20260423221500 uses `WHERE status IN ('pending','running')` in a partial index via `knex.raw`, proving the SQLite version supports the syntax.]

### Pattern 6: Transactional all-or-nothing apply (D-18)

```typescript
// Source: Phase 4 applier.ts sketch
export async function applyEnrichment(
  knex: Knex,
  bookMd5: string,
  jobId: number,
  bundle: EnrichmentBundle,
): Promise<void> {
  await knex.transaction(async (trx) => {
    // 1. Pre-read provenance sources once per job
    const book = await trx('book').where({ md5: bookMd5 }).first();
    if (!book) throw new Error(`Book ${bookMd5} disappeared mid-apply`);

    // 2. UPSERT authors per D-19, collect author_id list
    const authorIds = await upsertAuthors(trx, bundle.authors, /* provenance guard */);

    // 3. Rewrite book_author (gate by book.authors_source)
    if (book.authors_source !== 'manual') {
      await trx('book_author').where({ book_md5: bookMd5 }).delete();
      await trx('book_author').insert(
        authorIds.map((author_id, position) => ({
          book_md5: bookMd5, author_id, position, role: 'author',
        })),
      );
      // Stamp only if we actually wrote
      await trx('book').where({ md5: bookMd5 }).update({ authors_source: 'openlibrary' });
    }

    // 4. Rewrite book_genre (gate by book.genres_source)
    if (book.genres_source !== 'manual') {
      const canonical = mapOpenLibrarySubjects(bundle.subjects);
      const genreIds = await trx('genre').whereIn('name', canonical).pluck('id');
      await trx('book_genre').where({ book_md5: bookMd5 }).delete();
      if (genreIds.length > 0) {
        await trx('book_genre').insert(
          genreIds.map((genre_id) => ({ book_md5: bookMd5, genre_id })),
        );
      }
      await trx('book').where({ md5: bookMd5 }).update({ genres_source: 'openlibrary' });
    }

    // 5. Per-field guarded updates (D-20)
    await applyFieldIfWritable(trx, bookMd5, 'publication_year', 'publication_year_source',
      bundle.publication_year, book.publication_year_source);
    await applyFieldIfWritable(trx, bookMd5, 'original_language', 'original_language_source',
      bundle.original_language, book.original_language_source);
    // openlibrary_work_key has no *_source column per Phase 1 schema; write unconditionally
    await trx('book').where({ md5: bookMd5 }).update({ openlibrary_work_key: bundle.work_key });

    // 6. Flip enrichment_status + job status
    await trx('book').where({ md5: bookMd5 }).update({ enrichment_status: 'enriched' });
    await trx('enrichment_job').where({ id: jobId }).update({
      status: 'succeeded',
      last_error: null,
      updated_at: trx.fn.now(),
    });
  });
}
```

Crash mid-transaction = automatic rollback; D-05 boot sweep resets the still-`running` job back to `pending` on next boot; worker retries.

### Anti-Patterns to Avoid

- **Don't call `enrichmentService.enqueue(md5)` inside the sync transaction.** D-06 explicitly mandates post-commit. An enqueue inside `trx` couples sync latency to queue availability and risks a deadlock if enqueue itself opens a nested transaction.
- **Don't rely on `setInterval` for the worker tick.** Overlapping ticks break the "serial worker" contract of D-03 + ENRICH-02.
- **Don't hand-roll dedup in application code.** D-08 explicitly defers to the partial UNIQUE + `ON CONFLICT DO NOTHING`. In-memory Set of "currently-enqueued md5s" is a cache-coherency bug generator and redundant with the DB invariant.
- **Don't make `fetch` calls in worker.ts / applier.ts / matcher.ts.** D-16 routes EVERY OL/WD call through Phase 3 singletons. Phase 4 ships a grep guard to enforce this (see Grep Guards).
- **Don't await inside the SIGINT handler forever.** If `worker.stop()` takes longer than ~5s, operators will SIGKILL. The in-flight job is bounded by the 10s opossum timeout + 1s limiter slot + write transaction; pragmatic ceiling ~15s. Acceptable without additional timeout.
- **Don't overwrite `authors_source` unless the write path was actually exercised.** If `book.authors_source === 'manual'`, skip the `book_author` rewrite AND skip stamping `authors_source = 'openlibrary'`. The `if (book.authors_source !== 'manual')` branch MUST guard both the write and the stamp.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting OL/WD calls | A new Bottleneck or token bucket | Import `sharedHttpLimiter` from `../enrichment/http/rate-limiter.ts` | D-05 from Phase 3 + shared-limiter reference-equality invariant. A second limiter would let Phase 4 exceed the 1 req/s budget. |
| OL/WD HTTP clients | Raw `fetch` + hand-written Zod | Import `openLibraryClient` + `wikidataClient` from Phase 3 | Already Zod-validated, already breaker-wrapped, already UA-compliant. |
| Genre mapping | Any in-slice subject-to-canonical logic | `mapOpenLibrarySubjects` from `@koinsight/common/genres` | Phase 2 ships this as a pure function; reinventing it breaks GENRE-04 expectations. |
| Circuit breaker | Any home-grown retry/CB loop | Phase 3's `createBreaker` via typedFetch | `EOPENBREAKER` is a distinct retryable class in D-14. Re-implementing produces inconsistent error classification. |
| Job dedup | In-memory Set, mutex, or SELECT-then-INSERT | Partial UNIQUE index + `ON CONFLICT DO NOTHING` | D-08 locked. DB layer is the only consistent serialization point across concurrent request handlers. |
| ISO 3166 country codes | Any hardcoded map | `country-codes.ts` from Phase 3 (`countryQidToAlpha2`) | Covered + cached by Phase 3. |

**Key insight:** Phase 4 is a composition phase. Every external capability already exists in the codebase; Phase 4's novel surface is the in-process queue + backfill + applier, nothing more.

## Runtime State Inventory

Phase 4 is NOT a rename/refactor/migration phase. No runtime state to inventory. Section omitted per template guidance.

## Common Pitfalls

### Pitfall 1: `book` has no ISBN column (D-16 dead branch)

**What goes wrong:** D-16 step 1 mandates "if `book.isbn` is non-empty: `openLibraryClient.getEdition({ isbn })`, then walk to work." But grepping the schema shows no `isbn` / `isbn_10` / `isbn_13` column in `book` (verified: `grep isbn packages/common/types/book.ts apps/server/src/db/migrations/*` returns no matches). The KOReader plugin doesn't sync ISBN.
**Why it happens:** CONTEXT D-16 says "planner confirms the actual field name in Phase 1 schema"; the confirmation is now: there is no ISBN field.
**How to avoid:** Matcher ALWAYS takes the search fallback path. The ISBN branch is coded defensively for future schema additions but unreachable in Phase 4. Add a clarifying comment + a single unit test asserting `matchWork({ isbn: undefined }) === matchWork({ isbn: null })` to lock behavior. The D-16 "ISBN 404 falls through to search" detail is moot because the ISBN path never runs.
**Warning signs:** A reviewer asking "where does this book.isbn come from?", the answer is "nowhere this milestone; the field does not exist."

### Pitfall 2: Test setup does not truncate Phase 4 tables

**What goes wrong:** `apps/server/test/setup/test-setup.ts` truncates `['annotation', 'book', 'book_device', 'book_genre', 'device', 'genre', 'page_stat', 'user']` before each test. Missing: `author`, `book_author`, `enrichment_job`.
**Why it happens:** Phase 1 added `author`, `book_author`, `enrichment_job`; the test-setup was not updated. Phase 3 tests didn't exercise these tables so the gap was invisible.
**How to avoid:** Phase 4 MUST update `test-setup.ts` to truncate the three new tables. Failure mode: tests leak state across `beforeEach`, applier tests see phantom authors from prior tests, flaky matchers.
**Warning signs:** Tests that pass individually but fail when the full suite runs; `UNIQUE constraint failed: author.openlibrary_key` mid-suite.

### Pitfall 3: Knex builder + partial-index `ON CONFLICT` on INSERT...SELECT

**What goes wrong:** Knex 3.x's `.insert(subquery).onConflict(...).ignore()` does not always emit the correct SQL for SQLite partial indexes. The SQL it produces may omit the conflict target entirely or include a bogus one, and the error message is opaque.
**Why it happens:** Partial indexes are a SQLite-specific feature with a narrower surface than PostgreSQL's; Knex's multi-dialect abstraction doesn't model the target-vs-no-target split cleanly for INSERT...SELECT.
**How to avoid:** Use `knex.raw` for the D-10 backfill INSERT...SELECT (see Pattern 5B). Follows the Phase 1 precedent (migration 20260423221500 used `knex.raw` for the same partial-index scenario).
**Warning signs:** Generic `SQLITE_CONSTRAINT` errors with no row-specific context; a backfill that silently inserts duplicate open jobs on a restart.

### Pitfall 4: `vi.useFakeTimers()` + `setTimeout` chains + async microtasks

**What goes wrong:** `vi.useFakeTimers()` replaces `setTimeout` but does NOT automatically flush pending microtasks (Promise resolutions) in between advances. A `setTimeout` whose callback awaits a DB query needs both `vi.advanceTimersByTime(1500)` AND `await vi.runAllTicks()` (or `await new Promise(setImmediate)`) to actually complete.
**Why it happens:** Fake timers synchronously advance the clock; async work queued by the callback still runs on the real microtask queue.
**How to avoid:** Use `vi.useFakeTimers({ shouldAdvanceTime: false })` + a test helper that advances time AND awaits pending promises:
```typescript
async function advanceAndFlush(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);  // vitest 4+ supports this; awaits microtasks automatically
}
```
vitest 4.0.16 (installed) supports `advanceTimersByTimeAsync` [CITED: vitest.dev/api/vi.html#vi-advancetimersbytimeasync]. Do NOT mix `advanceTimersByTime` (sync) with async ticks.
**Warning signs:** A test that passes locally but hangs in CI; a worker tick that "should have run" per log output but the DB state is unchanged.

### Pitfall 5: SQLITE_BUSY during concurrent enqueue

**What goes wrong:** Two sync requests arriving within milliseconds both try to `INSERT INTO enrichment_job` for the same md5; one hits SQLITE_BUSY before ON CONFLICT resolves.
**Why it happens:** better-sqlite3 serializes at the transaction boundary, but a raw INSERT outside a transaction can still collide on the write-lock in WAL mode.
**How to avoid:** Per D-14, SQLITE_BUSY is a retryable class. The `enqueue()` helper should retry-on-SQLITE_BUSY up to 3 times with tiny jitter (10-50ms). D-09 also says swallow-and-log on final failure; the backfill is the safety net.
**Warning signs:** Sync endpoints intermittently logging `enqueue failed: SQLITE_BUSY`; books missed by the enqueue-post-sync path but picked up by the backfill next restart.

### Pitfall 6: `knex.fn.now()` in `next_attempt_at` comparison

**What goes wrong:** SQLite stores timestamps as TEXT strings in ISO 8601 (via `CURRENT_TIMESTAMP`) or as numeric Unix seconds. Comparing `TEXT datetime <= knex.fn.now()` works only if BOTH sides use the same format.
**Why it happens:** `knex.fn.now()` for better-sqlite3 emits `CURRENT_TIMESTAMP`, which is TEXT `'YYYY-MM-DD HH:MM:SS'`. `table.timestamps(true, true)` also emits TEXT. As long as Phase 4's `next_attempt_at` migration uses `table.timestamp('next_attempt_at').nullable()` (which Knex compiles to `TEXT` on SQLite) and writes via `knex.fn.now()` / `knex.raw("datetime('now', '+10 seconds')")`, the comparison is a string compare on ISO-lexicographic ordering, which is equivalent to time ordering.
**How to avoid:** Use `table.timestamp('next_attempt_at').nullable()` in the migration. Write backoff values via `knex.raw("datetime('now', '+' || ? || ' seconds')", [delaySeconds])`. Read with a direct `>` / `<=` comparison.
**Warning signs:** `next_attempt_at` rows that never become claimable; integer-vs-text comparison warnings in verbose logs.

### Pitfall 7: `last_error` from opossum EOPENBREAKER has no clean message

**What goes wrong:** Opossum's open-circuit error has `.code === 'EOPENBREAKER'` but `.message === 'Breaker is open'`, offering no context about WHICH upstream failed. Storing just the message in `last_error` makes debugging hard.
**Why it happens:** Circuit breaker errors abstract away the underlying request.
**How to avoid:** Classify in retry.ts: `if ((err as { code?: string }).code === 'EOPENBREAKER') return 'circuit-open'`. Write `last_error = 'circuit-open: ' + originalUrl` where originalUrl is captured before the call.
**Warning signs:** A `failed` job with `last_error = 'Breaker is open'` and no way to tell if OL or WD tripped the breaker.

## Code Examples

### Example 1: `enrichmentService.enqueue(bookMd5)` (D-06, D-07, D-08, D-09)

```typescript
// Source: Phase 4 service.ts sketch
import { z } from 'zod';
import { db } from '../knex';

const Md5Schema = z.string().regex(/^[a-f0-9]{32}$/i, 'Invalid md5');

export const enrichmentService = {
  async enqueue(bookMd5: string): Promise<void> {
    try {
      Md5Schema.parse(bookMd5);  // Zod at boundary (CLAUDE.md convention)

      // D-07: only enqueue if book is pending/null
      const book = await db('book').select('enrichment_status').where({ md5: bookMd5 }).first();
      if (!book) return;
      if (book.enrichment_status !== 'pending' && book.enrichment_status !== null) return;

      // D-08: partial-unique + ON CONFLICT DO NOTHING absorbs the race
      await db('enrichment_job')
        .insert({ book_md5: bookMd5, status: 'pending' })
        .onConflict()
        .ignore();
    } catch (err) {
      // D-09: log-and-swallow; sync latency is sacred, backfill is the safety net
      console.warn('enrichment enqueue failed', { bookMd5, phase: 'enqueue', err: String(err) });
    }
  },
};
```

### Example 2: Backoff math (D-12, pure function, trivially testable)

```typescript
// Source: Phase 4 retry.ts sketch
import { ENRICHMENT_MAX_ATTEMPTS } from './constants';

export type FailureClass = 'retryable' | 'permanent-not-found' | 'permanent-no-match' | 'permanent-schema';

export function computeBackoffSeconds(attempts: number): number {
  return Math.min(300, Math.pow(2, attempts - 1) * 10);
  // attempts=1 -> 10; 2 -> 20; 3 -> 40; 4 -> 80; 5 -> 160
}

export function isTerminal(attempts: number, failClass: FailureClass): boolean {
  if (failClass !== 'retryable') return true;        // D-14 permanent: skip retry
  return attempts >= ENRICHMENT_MAX_ATTEMPTS;        // D-12 ceiling
}

export function classifyFailure(err: unknown): FailureClass {
  const e = err as { name?: string; code?: string; url?: string };
  if (e.name === 'NotFoundError') {
    // D-16: /isbn/ 404 falls through; /works/ 404 is permanent.
    // Caller passes context; for now, treat as retryable and let the matcher's
    // no-match path signal permanent-no-match.
    if (e.url?.includes('/works/')) return 'permanent-not-found';
    if (e.url?.includes('/isbn/')) return 'retryable';  // D-16: fall through
  }
  if (e.name === 'ZodError') return 'permanent-schema';
  if (e.code === 'EOPENBREAKER') return 'retryable';
  if (e.name === 'UpstreamServerError') return 'retryable';      // 5xx
  if (e.code === 'SQLITE_BUSY') return 'retryable';
  if (e.name === 'NoMatchError') return 'permanent-no-match';    // matcher's custom error
  return 'retryable';  // default: give it a chance
}
```

### Example 3: Token-overlap matcher (D-17, pure function)

```typescript
// Source: Phase 4 matcher.ts sketch
function normalize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')   // strip punctuation (Unicode-safe)
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

export function titleMatches(bookTitle: string, candidateTitle: string): boolean {
  const bookTokens = new Set(normalize(bookTitle));
  const candTokens = new Set(normalize(candidateTitle));
  for (const t of bookTokens) if (!candTokens.has(t)) return false;
  return bookTokens.size > 0;  // empty-after-normalize is a no-match
}

export function authorMatches(bookAuthor: string, candidateAuthor: string): boolean {
  const bookTokens = normalize(bookAuthor);
  const candTokens = new Set(normalize(candidateAuthor));
  return bookTokens.some((t) => candTokens.has(t));
}

export function matchWork(
  book: { title: string; primaryAuthor: string },
  candidates: Array<{ title: string; authorName: string; workKey: string }>,
): { workKey: string } | null {
  for (const cand of candidates.slice(0, 3)) {
    if (titleMatches(book.title, cand.title) && authorMatches(book.primaryAuthor, cand.authorName)) {
      return { workKey: cand.workKey };
    }
  }
  return null;
}
```

Test harness mirrors `packages/common/genres/map.test.ts`: fixture inputs in `map.fixtures.ts` style, `it.each([...])` assertions. No DB, no async, no fetch.

### Example 4: Fake-timer integration test harness

```typescript
// Source: Phase 4 phase-04-integration.test.ts sketch
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../knex';
import { startEnrichmentWorker } from '../worker';
import { enrichmentService } from '../service';
import workFixture from './fixtures/work-ender.json';
import editionFixture from './fixtures/edition-ender.json';
import searchFixture from './fixtures/search-ender.json';
import authorFixture from './fixtures/author-ender.json';

describe('Phase 4 end-to-end enrichment', () => {
  let worker: { stop: () => Promise<void> };

  beforeEach(async () => {
    // test-setup.ts truncates; seed a book
    await db('book').insert({
      md5: 'a'.repeat(32),
      title: 'Ender's Game',
      authors: 'Orson Scott Card',
      enrichment_status: 'pending',
    });
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/search.json')) return jsonResp(searchFixture);
      if (url.includes('/works/')) return jsonResp(workFixture);
      if (url.includes('/books/')) return jsonResp(editionFixture);
      if (url.includes('/authors/')) return jsonResp(authorFixture);
      if (url.includes('wikidata.org')) return jsonResp({ entities: { Q123: { id: 'Q123', claims: {} } } });
      throw new Error('unexpected: ' + url);
    }));
    worker = startEnrichmentWorker(db);
  });

  afterEach(async () => {
    await worker.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('enqueue -> tick -> DB state matches enriched bundle', async () => {
    await enrichmentService.enqueue('a'.repeat(32));
    await vi.advanceTimersByTimeAsync(1500);  // one tick

    const book = await db('book').where({ md5: 'a'.repeat(32) }).first();
    expect(book?.enrichment_status).toBe('enriched');
    expect(book?.authors_source).toBe('openlibrary');

    const authors = await db('book_author').where({ book_md5: 'a'.repeat(32) });
    expect(authors.length).toBeGreaterThan(0);

    const job = await db('enrichment_job').where({ book_md5: 'a'.repeat(32) }).first();
    expect(job?.status).toBe('succeeded');
  });
});

function jsonResp(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `setInterval`-driven polling | `setTimeout`-chained self-rescheduling | 2018-ish (Node 10+, async/await mainstream) | Serial contract enforced without extra mutex. |
| SELECT-then-INSERT for dedup | `ON CONFLICT DO NOTHING` | SQLite 3.24 (2018) | Race-free, no app-layer state. Phase 1 already relies on it. |
| `db.destroy()` in SIGINT | Drain event loop naturally, skip explicit destroy | N/A | better-sqlite3 is synchronous; connection closes on process exit. Optional `await db.destroy()` for defensive shutdown ordering. |
| Hand-rolled exponential backoff | Pure function + `next_attempt_at` column | N/A | Testable without wall-clock; replayable on crash. |

**Deprecated/outdated:**
- `vi.runAllTimers()` / `vi.runAllTicks()` sync flush, use `vi.advanceTimersByTimeAsync(ms)` in vitest 4+. [CITED: vitest.dev/api/vi.html]

## Grep Guards (NEW for Phase 4)

File: `apps/server/src/enrichment/__tests__/phase-04-no-direct-http.test.ts`. Pattern mirrors `phase-03-no-db-writes.test.ts` (verified structure). Allow-list of Phase 4-introduced files:

```typescript
const PHASE_4_NEW_FILES = [
  'enrichment/constants.ts',
  'enrichment/service.ts',
  'enrichment/worker.ts',
  'enrichment/backfill.ts',
  'enrichment/matcher.ts',
  'enrichment/applier.ts',
  'enrichment/retry.ts',
];

describe('Phase 4 no-direct-HTTP invariant', () => {
  for (const rel of PHASE_4_NEW_FILES) {
    it(`${rel} must route HTTP via Phase 3 clients`, () => {
      const content = readFileSync(join(SERVER_SRC, rel), 'utf8');
      expect(content).not.toMatch(/\bfetch\s*\(/);
      expect(content).not.toMatch(/\baxios\b/);
      expect(content).not.toMatch(/https?:\/\//);  // no literal URLs outside clients
    });
  }
});
```

This guard is the Phase 4 peer of Phase 3's no-DB-writes guard. Phase 4 IS allowed DB writes (opposite of Phase 3); the new invariant is inverted: Phase 4 must NOT do direct HTTP.

## Environment Availability

Phase 4 is a code/config-only phase. No new external tools required. Node >=22, npm 10.2.4, better-sqlite3 12.6.0, vitest 4.0.16 all already in place. Skip condition: no external dependencies identified.

## Validation Architecture

Nyquist validation is enabled (`workflow.nyquist_validation: true` in `.planning/config.json`). This section names every test layer, maps Phase 4 requirements + Success Criteria to executable commands, and flags Wave 0 infrastructure gaps.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.0.16 (server workspace) |
| Config file | `apps/server/vitest.config.ts` |
| Quick run command | `npm --workspace=server exec vitest run apps/server/src/enrichment/__tests__/phase-04-*.test.ts` |
| Full suite command | `npm --workspace=server test` (runs `build:migrations && vitest run`) |
| Setup | `apps/server/test/setup/test-setup.ts` (migrates + truncates per-test), Wave 0 update required (Pitfall 2) |

### Test Layer Map

| Layer | Covers | Isolation | Example File |
|-------|--------|-----------|--------------|
| Unit (pure) | matcher token-overlap rules, retry classification + backoff arithmetic, constants module | No DB, no fetch, no timers | `phase-04-matcher.test.ts`, `phase-04-retry.test.ts` |
| Unit (DB) | `enrichmentService.enqueue` dedup, D-07 predicate, D-08 ON CONFLICT | Real `:memory:` SQLite via test-setup | `phase-04-enqueue.test.ts` |
| Unit (DB+fetch stub) | applier transactional apply, D-18 all-or-nothing, D-20 provenance guards, D-19 author merge | `:memory:` + `vi.stubGlobal('fetch')` | `phase-04-applier.test.ts` |
| Unit (timer) | worker tick loop, D-05 crash-recovery sweep, graceful shutdown, D-13 `next_attempt_at` | Fake timers + `:memory:` | `phase-04-worker.test.ts` |
| Integration (end-to-end) | full enqueue -> tick -> OL/WD fetch stubs -> DB state, idempotency (run twice), manual-wins | Fake timers + fetch stubs + `:memory:` | `phase-04-integration.test.ts` |
| Invariant (grep) | No direct HTTP in Phase 4 files | Static file read | `phase-04-no-direct-http.test.ts` |

### Success-Criteria-to-Test Mapping

| Success Criterion (from ROADMAP Phase 4) | Test Type | Automated Command | Wave 0? |
|-------|-----------|-------------------|---------|
| SC-1: sync returns within normal latency; worker picks up jobs within seconds and transitions to `enriched` or `failed` | Integration | `vitest run phase-04-integration.test.ts -t "enqueue -> tick"` | ❌ |
| SC-2: boot against N unenriched books enqueues all N without blocking `app.listen`; worker drains at configured rate | Unit (DB) + timing | `vitest run phase-04-backfill.test.ts` + `phase-04-worker.test.ts -t "drain"` | ❌ |
| SC-3: two enrichment runs produce identical `book` / `book_author` / `book_genre` state (idempotency snapshot-diff) | Integration | `vitest run phase-04-integration.test.ts -t "idempotent"` | ❌ |
| SC-4: `genres_source='manual'` survives forced re-enrichment with different OL subjects | Integration | `vitest run phase-04-applier.test.ts -t "manual-wins"` | ❌ |
| SC-5: simulated crash mid-job, restart resets `running`->`pending`; max-attempts ceiling leaves `failed` with `last_error`; no-match -> `book.enrichment_status='failed'` | Unit (DB) + Integration | `vitest run phase-04-worker.test.ts -t "crash recovery"` + `phase-04-applier.test.ts -t "terminal failure"` | ❌ |

### Requirement-to-Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ENRICH-01 | service + worker exist and wire together | Integration | `vitest run phase-04-integration.test.ts -t "enqueue"` | ❌ Wave 0 |
| ENRICH-02 | serial in-process; idempotent | Integration | `vitest run phase-04-integration.test.ts -t "idempotent"` | ❌ Wave 0 |
| ENRICH-03 | per-field provenance: manual sticky | Unit (DB+fetch) | `vitest run phase-04-applier.test.ts -t "manual-wins"` | ❌ Wave 0 |
| ENRICH-04 | enqueue post-commit, not inline | Unit (DB) | `vitest run phase-04-enqueue.test.ts -t "post-commit"` | ❌ Wave 0 |
| ENRICH-05 | boot backfill for pending+null | Unit (DB) | `vitest run phase-04-backfill.test.ts` | ❌ Wave 0 |
| ENRICH-06 | crash recovery + max-attempts + last_error | Unit (DB) + timer | `vitest run phase-04-worker.test.ts -t "crash-recovery\|max-attempts"` | ❌ Wave 0 |
| ENRICH-07 | no-match -> book.enrichment_status='failed' | Integration | `vitest run phase-04-applier.test.ts -t "no-match"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `vitest run apps/server/src/enrichment/__tests__/phase-04-*.test.ts` (Phase 4 test files only, typically < 5s)
- **Per wave merge:** `npm --workspace=server test` (full server suite, currently 279 tests + Phase 4 additions, ~5s)
- **Phase gate:** Full suite green before `/gsd-verify-work`; all 5 roadmap Success Criteria tests pass with explicit `-t` filters.

### Wave 0 Gaps

Wave 0 is the infrastructure prep that MUST land before matcher/applier/worker implementation starts. All files are NEW; none exist yet.

- [ ] `apps/server/src/enrichment/constants.ts`, shared constants
- [ ] `apps/server/src/enrichment/__tests__/fixtures/` directory, at minimum: search, edition, work, author JSON fixtures for one clear-match scenario
- [ ] `apps/server/src/enrichment/__tests__/phase-04-matcher.test.ts`, starts green with placeholder; drives TDD of matcher.ts
- [ ] `apps/server/src/enrichment/__tests__/phase-04-retry.test.ts`, pure-function tests for backoff arithmetic + classification
- [ ] `apps/server/src/enrichment/__tests__/phase-04-no-direct-http.test.ts`, grep guard (allow-list of Phase 4 new files)
- [ ] `apps/server/test/setup/test-setup.ts`, append `'author'`, `'book_author'`, `'enrichment_job'` to the truncate list (Pitfall 2 fix). This is a one-line edit; MUST land before any Phase 4 DB test executes or previous tests will pollute state.
- [ ] Phase 4 migration: `YYYYMMDDHHMMSS_add_next_attempt_at_to_enrichment_job.ts` adding `next_attempt_at TIMESTAMP NULL` + composite index `(status, next_attempt_at)`
- [ ] Framework install: NONE REQUIRED (vitest 4.0.16 already present)

## Project Constraints (from CLAUDE.md)

Extracted directives the planner MUST honor:

- **Formatting:** Prettier-only; no ESLint. Run `npx prettier --write .` before commit.
- **Validation:** Zod at route boundaries. Phase 4 has no new ROUTES but has a service-layer boundary (`enqueue(md5)`); validate with Zod regex.
- **Functional style:** Ramda is idiomatic. Fine (not required) for matcher.ts helpers.
- **No em dashes:** Plain ASCII only. This research file adheres.
- **Migrations:** Type-check and build under `tsconfig.migrations.json`; test builds migrations via `npm run build:migrations` first.
- **Node >=22, npm 10.2.4:** Already required; no change.
- **KOReader plugin coupling:** Phase 4 does NOT touch `plugins/koinsight.koplugin/call_api.lua` or `const.lua`, the sync-path hook lives server-side only, plugin contract is unchanged.
- **DB access:** Shared `db` from `apps/server/src/knex.ts`; no new connection pool.
- **Single-port production:** Express serves built React assets in prod; Phase 4 does not change this.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | better-sqlite3's Knex connection closes cleanly on `process.exit(0)` without explicit `db.destroy()`, preserving WAL checkpoint | Integration Points (app.ts) | Low: if wrong, add `await db.destroy()` before exit. Defensive belt already in `stopServer`. |
| A2 | `vi.advanceTimersByTimeAsync` flushes microtasks between timer fires in vitest 4.0.16 | Pitfall 4 | Medium: if wrong, fallback to `await vi.runAllTimersAsync()` or manual `await new Promise(setImmediate)` flush. Easy to detect in first worker test. |
| A3 | Knex 3.1.0 + better-sqlite3 12.6.0 supports `.onConflict().ignore()` (no-arg) resolving partial-unique index conflicts | Pattern 5 | Low: verified by direct analogue (upload-service.ts:71 uses `.onConflict('md5').ignore()` successfully; the no-arg form is documented Knex behavior). If wrong, fall back to `knex.raw` for the INSERT. |
| A4 | Opossum's `EOPENBREAKER` error has `.code === 'EOPENBREAKER'` | Pitfall 7 + retry.ts | Low: [CITED: github.com/nodeshift/opossum README error codes section]. If code differs, classify by `.message === 'Breaker is open'` instead. |
| A5 | Phase 1 `book` schema has no ISBN field | Pitfall 1 | HIGH if wrong, but VERIFIED via direct grep of `packages/common/types/book.ts` and `apps/server/src/db/migrations/*`. No matches. Confidence: HIGH. |
| A6 | Phase 3 Author schema's `remote_ids.wikidata` field is the expected path for author QIDs | matcher/applier design | Low: verified in Phase 3 integration test (phase-03-integration.test.ts:67). |

None of these assumptions block planning; all are either verifiable in-repo or have cheap fallbacks. Planner should sanity-check A2 in the first worker-tick test (use `advanceTimersByTimeAsync`, assert DB state; if DB is stale, add explicit microtask flush).

## Open Questions

1. **Should `next_attempt_at` default to `CURRENT_TIMESTAMP` or NULL?**
   - What we know: D-13 says "Default NULL (claimable immediately)". The polling query uses `next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP`, so NULL is semantically "claimable now."
   - What's unclear: None, D-13 is explicit. Flagged only because the migration writer should use `.nullable()` WITHOUT a default.
   - Recommendation: `table.timestamp('next_attempt_at').nullable()`, no `.defaultTo()`.

2. **What's the Opossum error code for "Breaker is open"?**
   - What we know: Opossum v9 throws when the breaker is open. Some versions surface `.code === 'EOPENBREAKER'`; older versions throw a generic Error with `.message === 'Breaker is open'`.
   - What's unclear: Exact surface in 9.0+.
   - Recommendation: classify by BOTH `.code` AND `.message`, picking whichever matches. Add a unit test case that asserts whichever surface opossum 9.0 actually exposes.

3. **Will structured per-job logging collide with the existing `morgan('tiny')` request logger?**
   - What we know: `app.ts:22` wires `morgan('tiny')` for request logs. Worker logs go to `console.log/warn`.
   - What's unclear: Nothing, they're orthogonal channels. Flagged in case operators want single-stream observability later.
   - Recommendation: For Phase 4, stick with `console.log` structured JSON-ish output (`{phase, bookMd5, jobId, event}`). Cross-cutting logger refactor is explicitly deferred in CONTEXT.

## Sources

### Primary (HIGH confidence)

- `apps/server/src/app.ts` (file:1-71), current boot sequence, SIGINT handler pattern, `db.migrate.latest` call
- `apps/server/src/upload/upload-service.ts` (file:47-165), transaction pattern, `booksToImport.md5` availability
- `apps/server/src/upload/upload-router.ts` (file:30-60), call-site for UploadService
- `apps/server/src/koplugin/koplugin-router.ts` (file:49-73), same pattern as upload path
- `apps/server/src/knex.ts` (file:1-7), shared knex instance
- `apps/server/src/knexfile.ts` (file:1-30), better-sqlite3 test config uses `:memory:`
- `apps/server/src/enrichment/http/rate-limiter.ts`, `sharedHttpLimiter` singleton
- `apps/server/src/enrichment/http/typed-fetch.ts`, breaker-around-limiter composition
- `apps/server/src/open-library/open-library-client.ts`, `openLibraryClient` singleton surface (searchWork/getWork/getEdition/getAuthor)
- `apps/server/src/enrichment/wikidata/wikidata-client.ts`, `wikidataClient.resolveP27Nationality`
- `apps/server/src/enrichment/__tests__/phase-03-integration.test.ts`, vi.stubGlobal + fixture pattern Phase 4 extends
- `apps/server/src/enrichment/__tests__/phase-03-no-db-writes.test.ts`, grep-guard template Phase 4 inverts
- `apps/server/src/db/migrations/20260423221500_create_enrichment_job.ts`, partial-unique SQL via `knex.raw`
- `apps/server/src/db/migrations/20260423221600_extend_book_columns.ts`, `*_source` CHECK constraints
- `apps/server/test/setup/test-setup.ts`, truncate list (Pitfall 2 origin)
- `packages/common/types/book.ts`, `author.ts`, `enrichment.ts`, authoritative DbBook/Author/EnrichmentJob shapes
- `packages/common/genres/map.ts`, `mapOpenLibrarySubjects` export
- `.planning/phases/01-schema-foundations-provenance/01-VERIFICATION.md`, confirms Phase 1 landed as planned
- `.planning/phases/03-openlibrary-wikidata-client/03-VERIFICATION.md`, confirms Phase 3 client singletons + invariant tests
- `.planning/phases/04-enrichment-service-backfill/04-CONTEXT.md`, all D-01..D-20 locked decisions

### Secondary (MEDIUM confidence)

- vitest 4.x API for `advanceTimersByTimeAsync` [CITED: vitest.dev/api/vi.html]
- Knex 3.x `.onConflict().ignore()` semantics for SQLite [CITED: knexjs.org/guide/query-builder.html#onconflict, corroborated by upload-service.ts:71 working instance]
- Opossum v9 circuit-breaker error surface [CITED: github.com/nodeshift/opossum README; minor version drift risk flagged in Open Question 2]

### Tertiary (LOW confidence)

- None. Every claim either verified in-repo or cited to documentation with in-repo precedent.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, all libraries already installed and used elsewhere in codebase
- Architecture: HIGH, all integration points directly verified by file reads
- Pitfalls: HIGH for 1, 2, 3, 5, 6; MEDIUM for 4, 7 (depend on exact library behavior flagged in assumptions)
- Validation architecture: HIGH, mirror of Phase 3's test-layer shape, no novel framework

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (30 days; stable stack, low library churn)

# Phase 4: Enrichment Service + Backfill - Pattern Map

**Mapped:** 2026-04-24
**Files analyzed:** 19 (7 runtime + 1 migration + 3 modified + 8 test files)
**Analogs found:** 17 / 19 (two novel: polling worker + retry classifier have partial analogs only)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/server/src/enrichment/constants.ts` | config | static | `apps/server/src/enrichment/http/user-agent.ts` | exact (single-const module) |
| `apps/server/src/enrichment/service.ts` | service (enqueue) | CRUD (INSERT ON CONFLICT) | `apps/server/src/upload/upload-service.ts` L70-72 + `apps/server/src/annotations/annotations-repository.ts` L102-112 | role-match (INSERT+onConflict idiom) |
| `apps/server/src/enrichment/worker.ts` | worker (polling loop) | event-driven (timer tick) | None in codebase, partial analogue: `apps/server/src/app.ts` L52-58 (graceful shutdown) | partial (novel; combine shutdown + Knex UPDATE...RETURNING) |
| `apps/server/src/enrichment/backfill.ts` | service (bulk enqueue) | batch (INSERT...SELECT) | `apps/server/src/db/migrations/20260423221700_backfill_book_authors.ts` + `apps/server/src/db/migrations/20260423221500_create_enrichment_job.ts` L24-26 (`knex.raw`) | role-match (raw INSERT...SELECT) |
| `apps/server/src/enrichment/matcher.ts` | utility (pure function) | transform | `packages/common/genres/map.ts` (pure normalizer+mapper) | role-match (pure, fixture-driven) |
| `apps/server/src/enrichment/applier.ts` | service (transactional writer) | CRUD (multi-table txn) | `apps/server/src/upload/upload-service.ts` L47-164 (`db.transaction(async (trx) => ...)`) + `apps/server/src/books/books-repository.ts` L33-41 | exact (same transaction shape) |
| `apps/server/src/enrichment/retry.ts` | utility (classifier + pure math) | transform | `apps/server/src/enrichment/http/http-errors.ts` (error classes) | partial (no prior classifier; reuse error surface) |
| `apps/server/src/db/migrations/YYYYMMDDHHMMSS_add_next_attempt_at_to_enrichment_job.ts` | migration | DDL | `apps/server/src/db/migrations/20260423221600_extend_book_columns.ts` (alterTable + nullable column) + `20260423221500_create_enrichment_job.ts` L24-26 (partial index via raw) | exact |
| `apps/server/src/app.ts` (modified) | config (boot sequence) | startup lifecycle | existing file itself L60-68 | self-analog |
| `apps/server/src/upload/upload-service.ts` (modified) | service (sync commit site) | CRUD | existing file L47-164 | self-analog |
| `apps/server/src/koplugin/koplugin-router.ts` (modified) | controller (route handler) | request-response | existing file L49-73 | self-analog |
| `apps/server/test/setup/test-setup.ts` (modified) | test infra | truncate list | existing file L10 | self-analog (one-line append) |
| `apps/server/src/enrichment/__tests__/phase-04-matcher.test.ts` | test (pure) |, | `packages/common/genres/*.test.ts` fixture-driven pattern | role-match |
| `apps/server/src/enrichment/__tests__/phase-04-retry.test.ts` | test (pure) |, | same as matcher | role-match |
| `apps/server/src/enrichment/__tests__/phase-04-enqueue.test.ts` | test (DB) |, | `apps/server/src/upload/upload-service-annotations.test.ts` | role-match (DB + txn test) |
| `apps/server/src/enrichment/__tests__/phase-04-backfill.test.ts` | test (DB) |, | same as enqueue | role-match |
| `apps/server/src/enrichment/__tests__/phase-04-applier.test.ts` | test (DB + fetch stubs) |, | `apps/server/src/enrichment/__tests__/phase-03-integration.test.ts` | exact (fixture + vi.stubGlobal) |
| `apps/server/src/enrichment/__tests__/phase-04-worker.test.ts` | test (timer + DB) |, | `apps/server/src/enrichment/__tests__/phase-03-shared-limiter.test.ts` (timed) | partial (new: fake timers) |
| `apps/server/src/enrichment/__tests__/phase-04-integration.test.ts` | test (end-to-end) |, | `apps/server/src/enrichment/__tests__/phase-03-integration.test.ts` | exact |
| `apps/server/src/enrichment/__tests__/phase-04-no-direct-http.test.ts` | test (grep guard) |, | `apps/server/src/enrichment/__tests__/phase-03-no-db-writes.test.ts` | exact (invert the assertions) |

## Pattern Assignments

### `apps/server/src/enrichment/constants.ts` (config, static)

**Analog:** `apps/server/src/enrichment/http/user-agent.ts`

**Structure pattern** (minimal module, no imports needed):
```typescript
// Phase 4 per D-01, D-12
export const ENRICHMENT_POLL_INTERVAL_MS = 1500;
export const ENRICHMENT_MAX_ATTEMPTS = 5;
export const ENRICHMENT_LAST_ERROR_MAX = 500;
```

---

### `apps/server/src/enrichment/service.ts` (service, CRUD)

**Analog:** `apps/server/src/upload/upload-service.ts` (`onConflict` idiom) + `apps/server/src/annotations/annotations-repository.ts` L102-112 (Zod-adjacent input validation pattern)

**Imports pattern** from `upload-service.ts` L1-12:
```typescript
import { db } from '../knex';
```

**onConflict().ignore() pattern** (`upload-service.ts` L70-72):
```typescript
await Promise.all(
  newBooks.map(({ id, ...book }) => trx<Book>('book').insert(book).onConflict('md5').ignore())
);
```

Phase 4 uses the **no-arg** `.onConflict().ignore()` form so SQLite resolves against the partial UNIQUE index on `enrichment_job(book_md5) WHERE status IN ('pending','running')`.

**Pre-read predicate pattern** (D-07 select-before-enqueue) mirrors `books-repository.ts` L17-19:
```typescript
static async getById(id: number): Promise<Book | undefined> {
  return db<Book>('book').where({ id }).first();
}
```

**Log-and-swallow pattern** (D-09) from `koplugin-router.ts` L40,60 (codebase uses plain `console.warn`/`console.error`):
```typescript
try { ... } catch (err) {
  console.warn('enrichment enqueue failed', { bookMd5, phase: 'enqueue', err: String(err) });
}
```

**Zod at boundary** (CLAUDE.md convention): standalone Zod schema for md5 regex, parsed at function entry.

---

### `apps/server/src/enrichment/worker.ts` (worker, event-driven)

**Analog:** `apps/server/src/app.ts` L52-58 (graceful shutdown) + `apps/server/src/annotations/annotations-repository.ts` L112 (`.returning('*')`)

**Graceful shutdown pattern** (`app.ts` L52-58) that the worker's `stop()` wires into:
```typescript
function stopServer(signal: NodeJS.Signals, server: Server) {
  console.log(`Received ${signal.toString()}. Gracefully shutting down...`);
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
}
```

Phase 4 worker extends this: `stop()` flips `isShuttingDown`, awaits in-flight `currentJob` promise, then the outer `stopServer` calls `server.close`.

**`.returning('*')` pattern** (`annotations-repository.ts` L112):
```typescript
const [inserted] = await db<Annotation>('annotation').insert(annotationToInsert).returning('*');
```

Phase 4 applies the same shape to the D-02 atomic claim:
```typescript
const [claimed] = await knex('enrichment_job')
  .where('id', knex.select('id').from('enrichment_job')
    .where({ status: 'pending' })
    .andWhere((qb) => qb.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', knex.fn.now()))
    .orderBy('created_at', 'asc')
    .limit(1))
  .update({ status: 'running', attempts: knex.raw('attempts + 1'), updated_at: knex.fn.now() })
  .returning('*');
```

**Crash-recovery sweep pattern** (D-05), simple `.where(...).update(...)` idiom found throughout; closest: `books-repository.ts` L25-27:
```typescript
static async update(id: number, book: Partial<Book>): Promise<number> {
  return db<Book>('book').where({ id }).update(book);
}
```

Applied as: `await knex('enrichment_job').where({ status: 'running' }).update({ status: 'pending' })`.

**Timer-chain pattern:** no existing analog. Use `setTimeout` self-chain (not `setInterval`); research.md §Pattern 2 provides the sketch. Reject `setInterval` per Anti-pattern in research.md.

---

### `apps/server/src/enrichment/backfill.ts` (service, batch)

**Analog:** `apps/server/src/db/migrations/20260423221500_create_enrichment_job.ts` L24-26 (partial-index `knex.raw`) + `apps/server/src/db/migrations/20260423221700_backfill_book_authors.ts` (runtime backfill pattern)

**knex.raw partial-index pattern** (`create_enrichment_job.ts` L24-26):
```typescript
await knex.raw(
  "CREATE UNIQUE INDEX enrichment_job_book_md5_open_unique ON enrichment_job (book_md5) WHERE status IN ('pending', 'running')"
);
```

Phase 4 backfill uses the same `knex.raw` technique for `INSERT...SELECT...ON CONFLICT DO NOTHING`:
```typescript
await knex.raw(`
  INSERT INTO enrichment_job (book_md5, status)
  SELECT md5, 'pending' FROM book
  WHERE enrichment_status = 'pending' OR enrichment_status IS NULL
  ON CONFLICT DO NOTHING
`);
```

Rationale (Pitfall 3 in research): Knex builder's `.insert(subquery).onConflict(...)` is brittle with partial indexes; raw SQL is the established escape hatch (see author migration L20-22 and enrichment_job migration L24-26).

---

### `apps/server/src/enrichment/matcher.ts` (utility, pure)

**Analog:** `packages/common/genres/map.ts` (pure transform, fixture-driven tests), plus `apps/server/src/open-library/open-library-client.ts` type surface for input types.

**Pure function + fixture test pattern** mirrors the Phase 2 `mapOpenLibrarySubjects` shape: input type -> normalized output, no I/O, no side effects. Tests use `it.each([...])` over fixtures.

**Normalization pattern** (Unicode-safe regex, per research §Example 3):
```typescript
function normalize(s: string): string[] {
  return s.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim().split(/\s+/).filter((t) => t.length >= 3);
}
```

No `fetch`, no `knex`, no `db` imports (enforced by phase-04-no-direct-http grep guard).

---

### `apps/server/src/enrichment/applier.ts` (service, CRUD multi-table txn)

**Analog:** `apps/server/src/upload/upload-service.ts` L47-164 (transaction shape) + `apps/server/src/books/books-repository.ts` L33-41 (multi-table delete in txn)

**Transaction shape** (`upload-service.ts` L47-72):
```typescript
return db.transaction(async (trx) => {
  await Promise.all(
    newBooks.map(({ id, ...book }) => trx<Book>('book').insert(book).onConflict('md5').ignore())
  );
  // ... more trx operations
  await trx.commit();
});
```

**Delete-then-insert within txn** (`books-repository.ts` L33-41):
```typescript
static async delete(book: Book) {
  await db.transaction(async (trx) => {
    await trx<BookDevice>('book_device').where({ book_md5: book.md5 }).delete();
    await trx<BookGenre>('book_genre').where({ book_md5: book.md5 }).delete();
    await trx<Book>('book').where({ id: book.id }).delete();
  });
}
```

Phase 4 applier rewrites `book_author` and `book_genre` in the same shape: delete existing rows by `book_md5`, insert the new ordered set from the enriched bundle, all within a single `knex.transaction`.

**Provenance pre-read** (D-20) done once per transaction via `trx('book').where({ md5 }).first()` (per `books-repository.ts` L17-19 pattern), then per-field helper `applyFieldIfWritable(trx, bookMd5, fieldName, sourceName, value, currentSource)` applies conditional writes. Skip-on-manual is a simple early return.

**Success state flip at end of txn** mirrors `upload-service.ts` L163 (`await trx.commit()`), but Phase 4 ends with two UPDATEs (book.enrichment_status='enriched', enrichment_job.status='succeeded') before the implicit commit from returning out of `knex.transaction`.

---

### `apps/server/src/enrichment/retry.ts` (utility, classifier)

**Analog:** `apps/server/src/enrichment/http/http-errors.ts` (error classes that the classifier matches on)

**Error class surface** (from `http-errors.ts`):
```typescript
export class NotFoundError extends Error {
  constructor(public readonly url: string) {
    super(`Upstream 404: ${url}`);
    this.name = 'NotFoundError';
  }
}
export class UpstreamServerError extends Error { ... name = 'UpstreamServerError'; }
```

Phase 4 classifier uses `.name` checks and `.url` for D-16 "/isbn/ vs /works/" discrimination. `EOPENBREAKER` via `.code` per opossum docs (research Open Question 2). `ZodError` via `.name === 'ZodError'`.

Pure functions; no DB, no fetch. See research.md §Example 2 for exact implementation sketch.

---

### `apps/server/src/db/migrations/YYYYMMDDHHMMSS_add_next_attempt_at_to_enrichment_job.ts` (migration, DDL)

**Analog:** `apps/server/src/db/migrations/20260423221600_extend_book_columns.ts` (alterTable + nullable column) + `apps/server/src/db/migrations/20260423221500_create_enrichment_job.ts` L19,24-26 (index + partial-index via raw)

**alterTable + nullable column** (`20260423221600_extend_book_columns.ts` L1-28):
```typescript
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('book', (table) => {
    table.string('openlibrary_work_key').nullable();
    table.smallint('publication_year').nullable();
    // ...
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('book', (table) => {
    table.dropColumn('openlibrary_work_key');
  });
}
```

**Composite index pattern** (`20260423221500_create_enrichment_job.ts` L19):
```typescript
table.index(['status', 'created_at'], 'enrichment_job_status_created_at_idx');
```

Phase 4 migration combines both: `alterTable('enrichment_job', t => { t.timestamp('next_attempt_at').nullable(); t.index(['status', 'next_attempt_at'], 'enrichment_job_status_next_attempt_at_idx'); })`, plus symmetric `down` that drops the index then the column.

**Timestamp storage note** (Pitfall 6): use `.timestamp()`, NOT integer; rely on SQLite's TEXT ISO-lexicographic comparison via `knex.fn.now()` / `knex.raw("datetime('now', '+X seconds')")`.

---

### `apps/server/src/app.ts` (modified, boot sequence)

**Self-analog.** Current L60-68:
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

Phase 4 diff (per D-03, D-11):
1. After `db.migrate.latest` and before `setupServer()`: `const worker = startEnrichmentWorker(db);`
2. Inside `setupServer()` `app.listen` callback at L45-47: add `setImmediate(() => runBackfill(db).catch(err => console.warn('Backfill failed:', err)));`
3. `stopServer` takes `worker` arg, calls `await worker.stop()` before `server.close(...)`.
4. SIGINT/SIGTERM registration passes `worker` too.

---

### `apps/server/src/upload/upload-service.ts` (modified, post-commit enqueue)

**Self-analog.** Current shape: `return db.transaction(async (trx) => { ...; await trx.commit(); })` at L47-164. Per D-06, enqueue runs AFTER the transaction resolves. Two implementation options (research §Integration Points):

**Option A (recommended):** Return `affectedMd5s: string[]` from `uploadStatisticData`. At call site (`upload-router.ts` L50 and `koplugin-router.ts` L67):
```typescript
const affectedMd5s = await UploadService.uploadStatisticData(newBooks, newPageStats);
for (const md5 of affectedMd5s) {
  await enrichmentService.enqueue(md5);  // enqueue swallows its own errors (D-09)
}
```

The enqueue calls happen OUTSIDE any `trx`; the response returns in the same tick the enqueue fires (await, but sync-commit latency is what matters, not enqueue cost).

---

### `apps/server/src/koplugin/koplugin-router.ts` (modified, post-commit enqueue)

**Self-analog.** Current L67: `await UploadService.uploadStatisticData(koreaderBooks, newPageStats, annotations, deviceId);`, same Option A edit as above. Enqueue loop happens after the `await` returns, inside the existing try block, before `res.status(200).json(...)`.

---

### `apps/server/test/setup/test-setup.ts` (modified, truncate list)

**Self-analog.** Current L10:
```typescript
const tables = ['annotation', 'book', 'book_device', 'book_genre', 'device', 'genre', 'page_stat', 'user'];
```

Phase 4 one-line change (alphabetically insert to match existing order):
```typescript
const tables = ['annotation', 'author', 'book', 'book_author', 'book_device', 'book_genre', 'device', 'enrichment_job', 'genre', 'page_stat', 'user'];
```

Pitfall 2: this MUST land before any Phase 4 DB test runs, else state leaks across `beforeEach`.

---

### Test Files

#### `phase-04-matcher.test.ts` + `phase-04-retry.test.ts` (pure)

**Analog:** `packages/common/genres/*.test.ts` fixture-driven pattern. Pure, no DB, no fetch. Use `describe + it.each([...])`.

#### `phase-04-enqueue.test.ts` + `phase-04-backfill.test.ts` (DB)

**Analog:** `apps/server/src/upload/upload-service-annotations.test.ts` (real `:memory:` SQLite via test-setup). Direct `db('enrichment_job').where(...)` assertions after calling `enrichmentService.enqueue(md5)` / `runBackfill(db)`.

#### `phase-04-applier.test.ts` + `phase-04-integration.test.ts` (DB + fetch stub)

**Analog:** `apps/server/src/enrichment/__tests__/phase-03-integration.test.ts` L1-100. Reuse the fixture + `vi.stubGlobal('fetch', ...)` + `jsonResponse(body, status)` helper verbatim. For integration, add `vi.useFakeTimers({ shouldAdvanceTime: false })` + `await vi.advanceTimersByTimeAsync(1500)` (Pitfall 4: must use async variant).

**Fetch stub pattern** (phase-03-integration.test.ts L30-35, verbatim):
```typescript
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
```

**Multi-URL routing stub** (research §Example 4):
```typescript
vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
  if (url.includes('/search.json')) return jsonResponse(searchFixture);
  if (url.includes('/works/')) return jsonResponse(workFixture);
  if (url.includes('/authors/')) return jsonResponse(authorFixture);
  if (url.includes('wikidata.org')) return jsonResponse({ entities: {...} });
  throw new Error('unexpected: ' + url);
}));
```

#### `phase-04-worker.test.ts` (timer + DB)

**Analog:** `phase-03-shared-limiter.test.ts` for timing-aware tests; DB assertions same as enqueue. Seed `enrichment_job` rows with `status='running'` then start worker and assert reset before first tick runs (D-05 crash recovery).

#### `phase-04-no-direct-http.test.ts` (grep guard)

**Analog:** `apps/server/src/enrichment/__tests__/phase-03-no-db-writes.test.ts` (L1-47), INVERT the assertion polarity.

**Phase 3 template** (verbatim L29-39):
```typescript
describe('Phase 3 no-DB-writes invariant', () => {
  for (const rel of PHASE_3_NEW_FILES) {
    it(`${rel} contains no knex import, db( call, or insert/update/delete`, () => {
      const content = readFileSync(join(SERVER_SRC, rel), 'utf8');
      expect(content, `${rel} must not import or reference knex`).not.toMatch(/\bknex\b/);
      expect(content, `${rel} must not call db(...)`).not.toMatch(/\bdb\(/);
      expect(content, `${rel} must not call .insert(`).not.toMatch(/\.insert\(/);
      expect(content, `${rel} must not call .update(`).not.toMatch(/\.update\(/);
      expect(content, `${rel} must not call .delete(`).not.toMatch(/\.delete\(/);
    });
  }
  it('verifies every allow-listed file actually exists on disk', () => {
    for (const rel of PHASE_3_NEW_FILES) {
      const full = join(SERVER_SRC, rel);
      expect(() => readFileSync(full, 'utf8'), `Missing allow-listed file: ${rel}`).not.toThrow();
    }
  });
});
```

Phase 4 inverts the payload: allow DB writes, forbid direct HTTP. Assertions become `.not.toMatch(/\bfetch\s*\(/)`, `.not.toMatch(/\baxios\b/)`, `.not.toMatch(/https?:\/\//)`. Allow-list includes only the 7 new runtime files (constants.ts, service.ts, worker.ts, backfill.ts, matcher.ts, applier.ts, retry.ts). Keeps the "exists on disk" second `it` block verbatim.

---

## Shared Patterns

### Logging (plain console.*)

**Source:** `apps/server/src/upload/upload-service.ts` L86 (`console.log('Creating unknown device')`), `apps/server/src/koplugin/koplugin-router.ts` L40, L44, L60 (`console.error`, `console.warn`)

**Apply to:** service.ts, worker.ts, backfill.ts, applier.ts

The codebase has no pino / winston; plain `console.log` / `console.warn` / `console.error` is the project convention. Phase 4 continues it. Structured-ish output is fine via object arg: `console.log('enrichment tick', { jobId, bookMd5, event: 'claim' })`.

### Shared knex instance

**Source:** `apps/server/src/knex.ts` L1-6
```typescript
import knex, { Knex } from 'knex';
import { appConfig } from './config';
import config from './knexfile';

const environment = appConfig.env || 'development';
export const db: Knex = knex(config[environment]);
```

**Apply to:** service.ts, worker.ts, backfill.ts, applier.ts, all use `import { db } from '../knex'`. Do NOT construct a new Knex instance. Tests use the same `db` via test-setup.ts.

### Partial-index + onConflict dedup

**Source:** `apps/server/src/upload/upload-service.ts` L70-72 + `apps/server/src/db/migrations/20260423221500_create_enrichment_job.ts` L24-26

**Apply to:** service.ts (enqueue) + backfill.ts (bulk insert)

The partial UNIQUE index on `enrichment_job(book_md5) WHERE status IN ('pending','running')` is the DB-layer dedup primitive; Phase 4 code relies exclusively on `ON CONFLICT DO NOTHING` and never implements app-layer dedup.

### Transactional multi-table writes

**Source:** `apps/server/src/upload/upload-service.ts` L47 + `apps/server/src/books/books-repository.ts` L33-41

**Apply to:** applier.ts (D-18 all-or-nothing apply), plus D-15 terminal-failure dual write (job + book in one txn).

Shape: `await db.transaction(async (trx) => { await trx(table).where(...).delete(); await trx(table).insert(...); ... })`. Nesting transactions is NOT done anywhere in the codebase; Phase 4 MUST NOT call `enrichmentService.enqueue(md5)` inside any `trx` (D-06 explicit).

### Zod at function boundary

**Source:** CLAUDE.md convention; existing uses of zod in Phase 3 schemas (`open-library-schemas.ts`).

**Apply to:** service.ts `enqueue(bookMd5)`, plus any applier bundle validator.

### Migration shape

**Source:** `apps/server/src/db/migrations/20260423221500_create_enrichment_job.ts` (mixed knex.schema + knex.raw)

**Apply to:** the new `YYYYMMDDHHMMSS_add_next_attempt_at_to_enrichment_job.ts` migration. `up` alterTable + index; `down` drops index then column. Use `import type { Knex } from 'knex'` as the only import.

### Grep guards

**Source:** `apps/server/src/enrichment/__tests__/phase-03-no-db-writes.test.ts`

**Apply to:** `phase-04-no-direct-http.test.ts` (invert scope); future phases inherit the template.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/server/src/enrichment/worker.ts` (polling loop portion) | worker | timer-driven | No existing in-process worker / queue drainer in the codebase. Graceful-shutdown analog only (app.ts L52-58). Planner must design the `setTimeout` self-chain + `isShuttingDown` flag from the research.md §Pattern 2 sketch. |
| `apps/server/src/enrichment/retry.ts` (classifier) | utility | synchronous transform | No error-classification precedent. http-errors.ts supplies the surface; classification logic is net-new. Research §Example 2 provides the full sketch. |

Both are small (<100 LOC each); research document provides verbatim sketches. No codebase analog does not block planning; it just means these plans cite research.md instead of a file:line.

---

## Metadata

**Analog search scope:**
- `apps/server/src/` (all subdirs, full read of app.ts, upload-service.ts, koplugin-router.ts, upload-router.ts, knex.ts, books-repository.ts, annotations-repository.ts L100-130, enrichment/http/*.ts, open-library/open-library-client.ts L1-60)
- `apps/server/src/db/migrations/` (directory listing + full read of 20260423221400, 20260423221500, 20260423221600)
- `apps/server/src/enrichment/__tests__/` (phase-03-integration.test.ts L1-100, phase-03-no-db-writes.test.ts full, phase-03-shared-limiter.test.ts L1-40)
- `apps/server/test/setup/test-setup.ts` (full)
- `grep onConflict` across `apps/server/src/`

**Files scanned:** ~22 source files + directory listings in 3 locations.
**Pattern extraction date:** 2026-04-24.

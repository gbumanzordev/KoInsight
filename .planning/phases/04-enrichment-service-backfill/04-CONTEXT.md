# Phase 4: Enrichment Service + Backfill - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 delivers the async enrichment pipeline and only the pipeline:

1. A new `apps/server/src/enrichment/` service layer with `enrichmentService.enqueue(bookMd5)` plus an in-process worker that drains the `enrichment_job` table.
2. Post-sync enqueue hooks in `apps/server/src/upload/upload-service.ts` and `apps/server/src/koplugin/koplugin-router.ts` that trigger enrichment after (not during) a sync commit.
3. Boot-time backfill that enqueues every book with `enrichment_status IN ('pending', NULL)` so existing libraries are fully enriched on first deploy after the milestone ships.
4. Per-field provenance-respecting writes: enrichment NEVER overwrites a field whose `*_source = 'manual'`. `NULL`-source fields are writable; `'openlibrary'`-source fields are writable on re-enrichment.
5. Crash recovery: `running` jobs reset to `pending` on boot; jobs exceeding the max-attempts ceiling land in `failed` with `last_error` populated; books with no OL match flip to `enrichment_status = 'failed'` so Phase 5's unmatched inbox (UI-04) surfaces them.

Out of scope for Phase 4 (belongs to Phase 5 or Phase 6):
- `PATCH /api/books/:md5/metadata` manual-edit endpoint (Phase 5 EDIT-01..02).
- `POST /api/books/:md5/re-enrich` per-book re-enrichment endpoint (Phase 5 EDIT-03).
- `GET /api/enrichment/unmatched` and `GET /api/enrichment/status` read endpoints (Phase 5 EDIT-04..05).
- Web UI for edit form, unmatched inbox, provenance badges, re-enrich button (Phase 5 UI-01..05).
- Yearly report aggregations (Phase 6 REPORT-*).
- Admin knobs: configurable canonical genre list, per-user "counts as read" threshold (v2).

Phase 4 assumes and does not re-introduce:
- The Phase 3 `sharedHttpLimiter` (Bottleneck maxConcurrent=1, minTime=1000ms) and the `OpenLibraryClient` / `WikidataClient` singletons. Phase 4 imports them; it does NOT create a new limiter or new client instances.
- The Phase 2 `mapOpenLibrarySubjects(subjects: string[])` pure function from `@koinsight/common/genres`. Phase 4 calls it; it does NOT re-derive the canonical genre list or the denylist.
- The Phase 1 `enrichment_job` schema: `(id, book_md5, status IN {'pending','running','succeeded','failed'}, attempts, last_error, created_at, updated_at)` plus the partial UNIQUE index on `book_md5 WHERE status IN ('pending','running')`. Phase 4 writes to these columns; it does NOT add new columns.
- The Phase 1 book-level `enrichment_status` CHECK values `{'pending','running','enriched','failed','skipped'}` and the `{authors,genres,publication_year,original_language}_source` columns with `FieldSource = 'openlibrary' | 'manual'`. Phase 4 respects Phase 1 D-15 semantics: `NULL` = enrichment-writable, `'openlibrary'` = enrichment-writable on re-run, `'manual'` = enrichment-locked forever.

</domain>

<decisions>
## Implementation Decisions

### Worker Model and Lifecycle

- **D-01:** Worker is a **polling loop**. A `setTimeout`-driven tick polls `enrichment_job` for the oldest `pending` row with a baseline interval of **1500ms** when the queue is non-empty, and the same interval when idle (fixed, no exponential backoff). Rationale: the shared HTTP limiter is already 1 req/s, so a sub-second tick would just stall on Bottleneck anyway; 1500ms keeps CPU cost negligible and mock-timer tests trivial. The interval lives in a module constant, not an env var, for Phase 4 simplicity.
- **D-02:** Job claim is a **single atomic `UPDATE ... RETURNING`** statement:
  ```sql
  UPDATE enrichment_job
  SET status = 'running', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = (
    SELECT id FROM enrichment_job
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 1
  )
  RETURNING *;
  ```
  Atomic in SQLite's serialized mode; no `FOR UPDATE` needed; safe against a restarted worker racing an in-flight instance. `attempts` is incremented at claim time (each attempt counts, even crashes mid-job, by design, see D-11 interaction).
- **D-03:** Worker starts in `apps/server/src/app.ts` **after `runMigrations(knex)` and before `app.listen()`** via `startEnrichmentWorker(knex)`. The worker exposes `stop()` which sets an internal `isShuttingDown` flag; the next tick observes it and exits. `app.ts` registers `SIGINT`/`SIGTERM` handlers that call `stop()`, await the in-flight job (if any), then `process.exit(0)`. Serial worker: at most one job in flight at a time, matching ENRICH-02.
- **D-04:** When the queue is empty, the worker **polls at the same fixed 1500ms interval**, no exponential backoff, no event-driven notify(). Simpler state machine, trivially testable with `vi.useFakeTimers()`.
- **D-05:** Before starting the polling loop on boot, the worker runs a one-shot **crash-recovery sweep**: `UPDATE enrichment_job SET status = 'pending' WHERE status = 'running'`. This satisfies ENRICH-06's "on crash/restart, jobs in `running` state are reset to `pending`". The sweep runs BEFORE the backfill INSERT...SELECT (D-06) so crash-reset rows merge naturally with newly-backfilled rows.

### Sync-path Enqueue Integration

- **D-06:** `enqueue(bookMd5: string)` is called in a **post-commit callback in each sync route handler**, NOT inside the knex.transaction that writes the book. For `upload-service.ts`: collect the list of affected `md5`s from the upload parse step, and after the wrapping transaction resolves, iterate and call `enrichmentService.enqueue(md5)` per md5. For `koplugin-router.ts`: same pattern, after the plugin's bulk-insert/update transaction commits. Enqueue is fire-and-forget relative to the response; the response returns as soon as the sync commits, not after enqueue completes.
- **D-07:** The enqueue predicate is **"new book OR `enrichment_status IN ('pending')` OR `enrichment_status IS NULL`"**. Applied per-md5 after the sync commit: SELECT the current `enrichment_status`, enqueue only if NULL/pending. Books already at `'enriched'` or `'failed'` or `'skipped'` are NOT re-enqueued by the sync path; re-enrichment of those is a Phase 5 concern (EDIT-03 explicit trigger). The check-before-enqueue is a cheap extra SELECT; worth it to avoid no-op-job flood.
- **D-08:** Dedup is enforced by the **Phase 1 partial UNIQUE index** (`UNIQUE(book_md5) WHERE status IN ('pending','running')`). `enqueue()` does `INSERT INTO enrichment_job (book_md5, status) VALUES (?, 'pending') ON CONFLICT DO NOTHING`. If a pending/running job already exists for this md5, the INSERT is silently skipped, no error surfaced to the caller. No app-layer SELECT-then-INSERT; no in-memory dedup set.
- **D-09:** If the enqueue INSERT itself fails (DB locked, FK violation, IO error), the sync handler **logs a warning** (`level: warn`, `context: { bookMd5, phase: 'enqueue' }`) and returns the sync response normally. Sync latency is sacred per ENRICH-04; boot-backfill (ENRICH-05 / D-10) is the safety net that recovers any orphaned md5s on the next restart. Sync handlers NEVER propagate an enqueue failure to the HTTP response.

### Boot-time Backfill and Retry Policy

- **D-10:** Backfill is a **single `INSERT ... SELECT ... ON CONFLICT DO NOTHING`** statement, run once at boot:
  ```sql
  INSERT INTO enrichment_job (book_md5, status)
  SELECT md5, 'pending' FROM book
  WHERE enrichment_status = 'pending' OR enrichment_status IS NULL
  ON CONFLICT (book_md5) WHERE status IN ('pending','running') DO NOTHING;
  ```
  No row iteration in Node, one statement, atomic, O(scan). Preserves any open jobs already in the table (from crash-reset sweep in D-05 or from sync-path enqueues that happened before the current boot).
- **D-11:** Backfill runs **deferred via `setImmediate`** AFTER `app.listen()` fires its "ready" callback. The sequence in `app.ts`:
  1. `await runMigrations(knex)`
  2. `startEnrichmentWorker(knex)` (spins up the polling loop; also runs the D-05 crash-recovery sweep before first tick)
  3. `app.listen(port, () => { setImmediate(() => runBackfill(knex)) })`
  Health endpoint / routes are up in step 3 before the backfill executes; `app.listen` is never blocked. The worker is already running from step 2, so it starts draining as soon as `runBackfill` writes rows.
- **D-12:** Max attempts ceiling is **5**, with **exponential backoff**. Stored as a module constant `ENRICHMENT_MAX_ATTEMPTS = 5` (no env var in Phase 4; can be promoted to config later without a migration). Backoff formula: `delaySeconds = min(300, 2 ** (attempts - 1) * 10)`, giving approximately 10s, 20s, 40s, 80s, 160s for attempts 1..5. Delay is enforced via a `next_attempt_at` computed on claim-fail (see D-13); the polling query excludes rows whose `next_attempt_at > now()`. When `attempts >= 5` and the latest attempt fails, the job flips to `status = 'failed'` with `last_error` set and stops retrying. `last_error` stores the error message truncated to 500 chars.
- **D-13:** Backoff is enforced by a **`next_attempt_at` column added to `enrichment_job`** via a Phase 4 migration. Default NULL (claimable immediately). On a retryable failure, the worker sets `next_attempt_at = now() + delaySeconds` and `status = 'pending'` so the row sits in the queue but is skipped by the polling query until the timestamp passes. The polling query in D-02 changes to:
  ```sql
  WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
  ```
  Planner should add a composite index `(status, next_attempt_at)` to keep the scan cheap.
- **D-14:** Failure classification — **retryable** failures consume an attempt and schedule a backoff:
  - HTTP 5xx from OL or Wikidata
  - Fetch timeout / network error (ECONNRESET, ETIMEDOUT, etc.)
  - Opossum circuit-breaker-open (`EOPENBREAKER`)
  - DB transient errors (SQLITE_BUSY)
  **Permanent** failures bypass the retry ceiling: the job flips to `failed` on the first occurrence AND the book's `enrichment_status` flips to `'failed'` so Phase 5's unmatched inbox sees it immediately:
  - HTTP 404 from `/isbn/{isbn}.json` or `/works/{work_id}.json`
  - "no-match" outcome from the matcher (D-16): zero search hits, or hits that fail the token-overlap rule
  - Zod validation failure on an OL/WD response (schema drift, not a rate-limit concern)
- **D-15:** On terminal failure (either max-attempts-exceeded OR permanent-failure path in D-14), a **single transactional write** flips both the job row (`status='failed'`, `last_error=<truncated>`) and the book row (`enrichment_status='failed'`). This keeps the two state machines aligned: if the job is failed, the book is findable via the unmatched-inbox predicate `book.enrichment_status = 'failed'`.

### Match Strategy and Confidence Threshold

- **D-16:** Work resolution order: **ISBN first, fallback to title+author search**.
  1. If `book.isbn` (or the existing `book.isbn_10`/`isbn_13` columns, planner confirms the actual field name in Phase 1 schema) is non-empty: `openLibraryClient.getEdition({ isbn })`, then walk `works[0].key` to `openLibraryClient.getWork({ workKey })`. ISBN hits are AUTHORITATIVE, they always proceed to the write step.
  2. If no ISBN OR the ISBN lookup 404s (permanent per D-14 if via `/isbn/`, but only AFTER the search fallback, see below): `openLibraryClient.searchWork({ title, author })` with `author = book_author.position=0` row's name, or fall back to `book.authors` first comma-split segment if no `book_author` row exists yet.
  3. Search hits are candidates, not acceptances. Apply D-17 confidence rule. If no candidate survives, the book is a no-match (permanent failure per D-14).
  4. Note: an ISBN 404 should fall through to title+author search, NOT immediately mark permanent. A bad ISBN on a real book is a common KOReader scenario (epub metadata errors). The "permanent on 404" rule in D-14 applies to `/works/{key}` 404 (broken link from edition) and to the matcher returning zero candidates after search; an isolated `/isbn/` 404 with a successful search fallback is NOT a failure.
- **D-17:** Confidence rule for search-path matches is **deterministic token overlap**, no numeric score. Match function:
  - Normalize both sides: lowercase, strip ASCII punctuation, collapse whitespace to single space, tokenize on space. Drop tokens shorter than 3 chars.
  - TITLE rule: every normalized token from `book.title` (length >= 3) MUST appear in the OL candidate's normalized title. Token order does not matter; extra tokens on the OL side are fine (subtitles, series markers).
  - AUTHOR rule: at least ONE normalized token (length >= 3) from the primary-author name must overlap with at least one token in the OL author's normalized name.
  - If BOTH rules pass for the top-1 search hit -> accept. If either fails -> try the top-2 and top-3 search hits with the same rule. If none pass -> no-match, permanent failure.
  - Pure function, easily unit-tested with fixtures from Phase 3 (`work-with-subjects`, search-result fixtures to be added).
- **D-18:** Apply writes in a **single `knex.transaction`** wrapping the full enriched-bundle apply:
  1. UPSERT authors per D-19 (openlibrary_key merge + normalized-name fallback).
  2. Delete existing `book_author` rows for this `book_md5`, then INSERT new rows in order from the enriched payload (preserving `position = 0` as primary). Gate by `book.authors_source != 'manual'`, see D-20.
  3. Delete existing `book_genre` rows for this `book_md5`, then INSERT new rows mapped via `mapOpenLibrarySubjects(work.subjects)` then name->id lookup against the `genre` table. Gate by `book.genres_source != 'manual'`.
  4. `UPDATE book SET` with per-field provenance guards (D-20) for `publication_year`, `original_language`, `openlibrary_work_key`, and stamp `{authors,genres,publication_year,original_language}_source = 'openlibrary'` on the fields that were actually touched.
  5. UPDATE book `enrichment_status = 'enriched'`.
  6. UPDATE enrichment_job `status = 'succeeded'`.
  All-or-nothing: a crash inside the transaction rolls back to the pre-apply state, and the crash-recovery sweep (D-05) on the next boot resets the still-`running` job to `pending` so the worker retries from scratch.
- **D-19:** Author dedup strategy during enrichment (resolves Phase 1 D-12):
  - Per OL author in the enriched bundle, in order:
    1. If the OL author has an `openlibrary_key`: SELECT an existing `author` row WHERE `openlibrary_key = ?`. If found, reuse its `id`; update the row's OL-sourced columns (`nationality` per WD-02, canonical name) subject to the D-20 provenance guard. If NOT found, proceed to step 2.
    2. Compute `normKey = trim(lower(name)).replace(/\s+/g, ' ')`. SELECT existing `author` WHERE same-normalized name. If found AND the existing row's `openlibrary_key IS NULL`, reuse its id AND stamp the OL key. If found AND the existing row has a DIFFERENT `openlibrary_key`, treat as a distinct author, proceed to step 3.
    3. INSERT a new `author` row with `{name, openlibrary_key, nationality, nationality_source='openlibrary'}`.
  - "Same-normalized-name merge" handles the common case: Phase 1's string-split backfill populated `author` rows with no OL keys, then Phase 4 enriches a book and the OL author matches by name, we unify them and stamp the key. Distinct OL keys with the same display name stay as separate rows (correct: two real people, same name).
  - Nationality writes are per-author, not per-book. Write nationality + stamp `nationality_source='openlibrary'` only when the existing row's `nationality_source IS NULL OR = 'openlibrary'` (mirror the D-20 rule at the author level).
- **D-20:** Per-field provenance guard is applied at the **application layer**, not via DB triggers. Every enrichment write is gated by a pre-read of the current `*_source` value for the field:
  - `IS NULL` -> write allowed, stamp source = 'openlibrary'.
  - `= 'openlibrary'` -> write allowed, stamp source = 'openlibrary' (re-enrichment overwrites OL-sourced fields).
  - `= 'manual'` -> skip the write entirely; preserve the manual value and leave source = 'manual'.
  The guard is a small helper in the enrichment writer (e.g., `applyFieldIfWritable(tx, bookMd5, field, value, currentSource)`) called once per field. For `book_author` and `book_genre` (row-based, not column-based), the guard is applied at the column level: `book.authors_source` gates the entire `book_author` rewrite; `book.genres_source` gates the entire `book_genre` rewrite. Partial manual edits at the row level are a Phase 5 EDIT-03 concern; Phase 4 assumes manual-edited authors/genres = all-or-nothing at the source-stamp level.

### Claude's Discretion

- Exact file layout under `apps/server/src/enrichment/`. Research + plan decide the split between `worker.ts`, `service.ts`, `matcher.ts`, `applier.ts`, `retry.ts`, etc.
- Logging library choice (plain `console.*` vs pino). Current codebase uses `console`; Phase 4 can continue that pattern or introduce pino, planner decides, but the Phase 4 scope does NOT include a cross-app logging refactor.
- Exact migration timestamp and filename for the `next_attempt_at` column (follow existing convention: `YYYYMMDDHHMMSS_add_next_attempt_at_to_enrichment_job.ts`).
- Whether the backfill INSERT...SELECT goes through Knex query builder or `knex.raw`. SQLite `ON CONFLICT ... WHERE ... DO NOTHING` with a partial index can be finicky in Knex builder; `raw` is acceptable if builder is awkward.
- Test strategy: stub `fetch` via `vi.stubGlobal` as Phase 3 did; fixtures live under `apps/server/src/enrichment/__tests__/fixtures/`. Integration test exercising the full pipeline (enqueue -> worker tick -> OL fetch -> write -> book.enrichment_status flip) is expected, planner sizes it.
- Precise SQL form of the D-13 polling query vs an index-only scan. Planner picks whichever Knex idiom is cleanest.
- Observability: whether to log structured per-job events (claim, complete, fail, retry-scheduled). Recommended yes for Phase 4 diagnostics; planner decides the log shape.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` -- Phase 4 block (Goal, Depends on Phase 2 + Phase 3, Requirements, Success Criteria 1..5).
- `.planning/REQUIREMENTS.md` -- ENRICH-01 through ENRICH-07.
- `.planning/PROJECT.md` -- core milestone value; never-block-sync principle; out-of-scope list (LLM path rejected, Bottleneck chosen over p-queue/p-limit).

### Prior phase context (locked decisions that Phase 4 depends on)
- `.planning/phases/01-schema-foundations-provenance/01-CONTEXT.md` -- D-12 (Phase 4 owns author-by-OL-key merge), D-13..D-16 (provenance semantics, CHECK constraint values, NULL means enrichment-writable).
- `.planning/phases/01-schema-foundations-provenance/01-VERIFICATION.md` -- confirmation that the `enrichment_job` schema, `book.enrichment_status`, and all `*_source` columns landed as planned.
- `.planning/phases/02-canonical-genre-vocabulary/02-CONTEXT.md` -- D-07..D-12 (mapOpenLibrarySubjects signature, alias/denylist behavior, zero-match returning `[]` is valid), D-16..D-17 (module location + exports).
- `.planning/phases/03-openlibrary-wikidata-client/03-RESEARCH.md` -- OL-05 Work-subjects-not-Edition walk, WD-01..WD-05 nationality resolution chain, shared limiter architecture.
- `.planning/phases/03-openlibrary-wikidata-client/03-05-SUMMARY.md` -- reference-equality invariant on the shared limiter (Phase 4 MUST import the singletons, not re-instantiate).

### Existing schema that Phase 4 builds on (do NOT re-create)
- `apps/server/src/db/migrations/*_create_enrichment_job.ts` -- `enrichment_job(id, book_md5, status, attempts, last_error, created_at, updated_at)` plus partial UNIQUE on open jobs.
- `apps/server/src/db/migrations/*_extend_book_columns.ts` -- `book.enrichment_status`, `{authors,genres,publication_year,original_language}_source`, `openlibrary_work_key`, etc.
- `apps/server/src/db/migrations/*_create_author_and_book_author.ts` -- `author(id, name UNIQUE, openlibrary_key, nationality, nationality_source)` with partial UNIQUE on openlibrary_key.

### Phase 3 code Phase 4 imports (do NOT duplicate)
- `apps/server/src/enrichment/http/shared-limiter.ts` (or equivalent per Phase 3 layout) -- `sharedHttpLimiter` singleton, `createLimiter`, `createBreaker`, `USER_AGENT`, `HttpDeps`.
- `apps/server/src/open-library/open-library-client.ts` -- `openLibraryClient` singleton exposing `searchWork`, `getWork`, `getEdition`, `getAuthor`.
- `apps/server/src/enrichment/wikidata/*` -- `wikidataClient` singleton, `resolveP27Nationality`.
- `apps/server/src/enrichment/__tests__/phase-03-*.test.ts` -- invariant tests Phase 4 MUST NOT break (shared-limiter reference equality, no-DB-writes in Phase 3 files, OL-05 Work-subjects walk).

### Phase 2 code Phase 4 imports (do NOT duplicate)
- `packages/common/genres/` (via `@koinsight/common/genres` or the `dist/...js` workaround per CJS/ESM boundary) -- `CANONICAL_GENRES`, `GENRE_ALIASES`, `SUBJECT_DENYLIST`, `mapOpenLibrarySubjects`, `CanonicalGenre`.

### Sync entry points Phase 4 must hook into
- `apps/server/src/upload/upload-service.ts` -- post-commit enqueue per affected `book_md5`.
- `apps/server/src/koplugin/koplugin-router.ts` -- post-commit enqueue per affected `book_md5`.
- `apps/server/src/app.ts` -- `startEnrichmentWorker(knex)` call site + `setImmediate(runBackfill)` inside the `app.listen` callback + SIGINT/SIGTERM shutdown wiring.

### Convention anchors
- `CLAUDE.md` -- Prettier only, Zod at route boundaries, Ramda idiomatic, plain ASCII (no em-dashes), Node >=22, npm 10.2.4.
- `apps/server/src/knex.ts` + `apps/server/src/knexfile.ts` -- shared Knex instance and migration config; Phase 4 migrations and queries use the same instance.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`apps/server/src/enrichment/http/sharedHttpLimiter`** (Phase 3): The Bottleneck singleton Phase 4 MUST import for every outbound OL / WD call. Reference-equality invariant is locked by Phase 3 Plan 05 tests.
- **`openLibraryClient` + `wikidataClient`** (Phase 3): Singletons with `searchWork`, `getWork`, `getEdition`, `getAuthor`, `resolveP27Nationality`. Already Zod-validated on the response ingress. Phase 4 wires these into a matcher + applier, does not re-implement fetches.
- **`mapOpenLibrarySubjects`** (Phase 2): Pure synchronous function `(string[]) -> CanonicalGenre[]`. Phase 4 calls it inside the write transaction (D-18 step 3) before doing the name->id lookup against the `genre` table.
- **`knex` shared instance** (`apps/server/src/knex.ts`): Used by every Phase 1/2/3 module and by migrations. Phase 4's worker, enqueue path, backfill, and applier all use this instance, no new connection pool.
- **`enrichment_job` partial UNIQUE index** (Phase 1): Enforces "at most one open job per book" at the DB layer. Phase 4 relies on this for dedup (D-08); no app-layer SELECT-then-INSERT.

### Established Patterns

- **Repository slice layout** (`books/books-repository.ts`, `genres/genre-repository.ts`, `stats/*`): Each domain has a flat module with a small number of exported functions over the shared `knex` instance. Phase 4 follows the same shape under `apps/server/src/enrichment/` (additive to Phase 3's `http/` and `wikidata/` subfolders already in place).
- **Zod at route boundaries** (CLAUDE.md convention): Phase 4 has no new routes (Phase 5 owns the EDIT endpoints). But the enqueue hook takes a `bookMd5: string`, so the service function validates it with a Zod schema or explicit regex check at the boundary, consistent with the project convention.
- **Vitest fixture-based stubs for fetch** (Phase 3 `phase-03-*.test.ts`): `vi.stubGlobal('fetch', ...)` with fixture JSON, no msw/nock. Phase 4 tests extend this pattern for matcher and integration scenarios.
- **SCHEMA-07-style grep guards** (Phase 1 + 2 + 3 invariants): Each prior phase has a grep guard that asserts forbidden patterns are absent in phase-scoped files. Phase 4 inherits the Phase 3 "no DB writes in HTTP client files" guard and should add its own: no `fetch(` / `axios` / `https://` directly in `apps/server/src/enrichment/worker.ts` or similar, those calls MUST go through the Phase 3 clients.
- **Migration naming + structure**: `YYYYMMDDHHMMSS_<snake_case_description>.ts` with `up` and `down` functions using the Knex schema builder or `knex.raw`. Phase 4 adds one migration for `next_attempt_at` (D-13) and follows this convention.

### Integration Points

- `apps/server/src/app.ts` -- three new call sites: `startEnrichmentWorker(knex)` after `runMigrations`, `setImmediate(() => runBackfill(knex))` inside the `app.listen` callback, and SIGINT/SIGTERM handlers that call `stopEnrichmentWorker()` then `process.exit(0)`.
- `apps/server/src/upload/upload-service.ts` -- post-commit enqueue loop over affected md5s.
- `apps/server/src/koplugin/koplugin-router.ts` -- post-commit enqueue loop over affected md5s (same helper as upload-service uses).
- No frontend integration in Phase 4. The UI hooks land in Phase 5 (edit form, unmatched inbox, per-book re-enrich button). Phase 4's only observable side effects for Phase 5 are: `book.enrichment_status` flips correctly, `enrichment_job.last_error` is populated on failure, and the unmatched set (`book.enrichment_status = 'failed'`) is reachable via SQL.

</code_context>

<specifics>
## Specific Ideas

- Re-use the Phase 1 CHECK-constraint failure mode as a test vector: attempting two concurrent `enqueue(md5)` calls for the same book must produce exactly one open job row (the second INSERT hits the partial UNIQUE, is swallowed by `ON CONFLICT DO NOTHING`, no error surfaces). This is a cheap unit test of D-08.
- Use the Phase 3 `phase-03-integration.test.ts` as the template for Phase 4's end-to-end test: mock fetch with OL search + edition + work + author + Wikidata fixtures, enqueue a book, advance fake timers through the 1500ms tick, assert the final DB state (book row, book_author, book_genre, enrichment_job, enrichment_status) matches the expected enriched bundle.
- The worker's D-05 crash-recovery sweep should be unit-tested by: (a) seeding a row with `status='running'`, (b) starting the worker, (c) asserting the row is now `status='pending'` BEFORE any tick runs.
- Backoff timing tests should inject a test-local clock rather than using real time, same pattern as Phase 3 Plan 05's timed-pipeline test.
- The idempotency invariant from Success Criteria 3 should be an explicit test: run the enricher twice against the same OL fixtures, snapshot-diff the `book`, `book_author`, and `book_genre` rows across the two runs, assert identical.
- The manual-wins invariant from Success Criteria 4 should be an explicit test: seed a book with `genres_source = 'manual'` and one `book_genre` row, run enrichment against fixtures that would return different subjects, assert the `book_genre` set is unchanged and `genres_source` remains 'manual'.

</specifics>

<deferred>
## Deferred Ideas

- **Scale-out worker (multi-process)**: Phase 4's worker is single-process. The `UPDATE...RETURNING` claim (D-02) happens to be safe even if a second worker ever exists, but the polling interval tuning and the shared limiter's "one process" scope make multi-process out of scope. Revisit if KoInsight ever adopts PM2 cluster mode or horizontal deploys.
- **Priority queue / user-triggered re-enrich jumps the queue**: Phase 5's `POST /api/books/:md5/re-enrich` endpoint can insert with a priority column (not in Phase 1 schema) to jump ahead of the backfill. Out of scope for Phase 4; Phase 5 planner decides whether to add the column or accept FIFO.
- **Per-user "counts as read" threshold** (v2): Milestone-level deferred.
- **Admin UI for canonical genres / aliases / denylist** (v2): Phase 2 deferred.
- **Author merge UI for manually unifying duplicate authors** (v2 / Phase 5+): D-19 step 2 leaves same-display-name authors with distinct OL keys as separate rows. If that ever confuses users, a manual-merge UI is the fix.
- **Structured logging refactor across the app** (cross-cutting): Phase 4 can ship with console.\* or introduce pino locally, but a full app-wide logger adoption is its own phase.
- **Env-var knobs for `ENRICHMENT_MAX_ATTEMPTS`, poll interval, backoff formula**: Phase 4 uses module constants. Config-ification is a clean follow-up once operators want to tune production behavior.
- **Bulk re-enrich all-books endpoint**: Out of Phase 4 and Phase 5 scope. If ever needed, a one-shot admin script that updates `enrichment_status='pending'` and relies on the backfill path is the simplest approach.

</deferred>

---

*Phase: 04-enrichment-service-backfill*
*Context gathered: 2026-04-24*

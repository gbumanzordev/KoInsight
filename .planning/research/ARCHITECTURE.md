# Architecture: Enrichment + Yearly Reports

**Scope:** Milestone "Book Metadata Enrichment + Yearly Reports"
**Researched:** 2026-04-23
**Confidence:** HIGH for structural decisions (follows existing vertical-slice conventions); MEDIUM for performance/indexing choices (single-user SQLite, empirical tuning deferred).

This document records decisions specific to layering enrichment and reporting onto the existing KoInsight server/web/plugin stack. It does NOT restate the baseline architecture; consult `.planning/codebase/ARCHITECTURE.md` for the router/service/repository pattern, Knex setup, and plugin contract baseline.

---

## 1. Component Boundaries

### 1.1 New server domain: `apps/server/src/enrichment/`

A dedicated vertical slice that orchestrates OpenLibrary lookups, genre mapping, and author resolution. It owns the enrichment workflow; it does NOT own book persistence, author persistence, or genre persistence. Those live in their respective repositories.

```
apps/server/src/enrichment/
  enrichment-router.ts         // POST /api/enrichment/books/:md5, GET /api/enrichment/jobs, POST /api/enrichment/backfill
  enrichment-service.ts        // orchestrator: resolve -> map -> persist -> mark source
  enrichment-repository.ts     // enrichment_job table CRUD, enrichment_attempt log
  genre-mapping.ts             // pure function: ol_subject[] -> canonical Genre[]  (uses data from genres/)
  openlibrary-enricher.ts      // thin wrapper calling open-library-service with the *fuller* work/edition/author endpoints
  enrichment-queue.ts          // in-process async queue (p-queue) with concurrency=1, token-bucket rate limiter
  enrichment-worker.ts         // loop that pulls pending jobs from enrichment_job and runs enrichment-service
  *.test.ts
```

### 1.2 Extend existing `apps/server/src/open-library/`

`open-library-service.ts` grows three new methods but stays a *pure HTTP client* that returns typed raw OpenLibrary payloads. It does not know about KoInsight's book, author, or genre models.

```ts
// open-library-service.ts (added methods)
static searchWork(title: string, author?: string): Promise<OLWorkSearchResult>
static getWork(workKey: string): Promise<OLWork>        // /works/OLxxxxW.json  (subjects, description, first_publish_date)
static getEdition(editionKey: string): Promise<OLEdition>
static getAuthor(authorKey: string): Promise<OLAuthor>  // /authors/OLxxxxA.json  (bio, birth_date, nationality? via wiki fallback)
```

Rationale: keep the HTTP boundary dumb and reusable. Mapping subjects -> canonical genres belongs in `enrichment/genre-mapping.ts`, not in `open-library-service`. `open-library-service` already only knows about covers; don't pollute it with domain semantics.

### 1.3 New `apps/server/src/authors/` slice

```
apps/server/src/authors/
  authors-router.ts            // GET /api/authors, GET /api/authors/:id, PATCH /api/authors/:id (manual override)
  authors-service.ts           // findOrCreateByOpenLibraryKey, findOrCreateByName, mergeDuplicates
  authors-repository.ts        // author + book_author CRUD
  *.test.ts
```

### 1.4 Activate existing `apps/server/src/genres/`

The slice exists but has no router. Add `genres-router.ts` exposing `GET /api/genres` (canonical list) and `GET /api/genres/:id/books`. `GenreRepository.findOrCreate` is deliberately *removed* or locked to the canonical whitelist once the seed lands (see section 4).

### 1.5 New `apps/server/src/reports/` slice

```
apps/server/src/reports/
  reports-router.ts            // GET /api/reports/yearly/:year, GET /api/reports/years
  reports-service.ts           // aggregation logic
  reports-repository.ts        // SQL aggregations joining page_stat + book + book_genre + book_author + author
  *.test.ts
```

Deliberately separate from `apps/server/src/stats/`. `stats` handles per-book/per-device raw stats (existing); `reports` handles metadata-sliced aggregations (new). Splitting avoids growing `stats-repository.ts` into a god-repo.

### 1.6 Dependency graph (new modules)

```
enrichment-router ──▶ enrichment-service ──▶ enrichment-queue
                                     │
                                     ├──▶ openlibrary-enricher ──▶ open-library-service (HTTP)
                                     ├──▶ genre-mapping (pure)
                                     ├──▶ authors-service ──▶ authors-repository
                                     ├──▶ genres/genre-repository
                                     ├──▶ books/books-repository (update book fields)
                                     └──▶ enrichment-repository (job state)

reports-router ──▶ reports-service ──▶ reports-repository (joins page_stat, book, book_author, author, book_genre, genre)

upload-service / koplugin-router ──▶ enrichment-queue.enqueueIfMissing(book.md5)
                                     (post-transaction, fire-and-forget)
```

Rule: repositories never call other repositories; services compose repositories. `enrichment-service` is the only module allowed to update book metadata fields after initial insert (other than manual-edit and the existing `reference_pages` path).

---

## 2. Enrichment Trigger & Concurrency

### 2.1 Recommendation: Option 2 — post-sync async in-process queue

**Inline enrichment (option 1) is rejected.** Kosync+plugin sync already holds a Knex transaction and uploads up to 50 MB; adding 1–N OpenLibrary round-trips per book (each 200–1500 ms) would push sync timeouts past the plugin's HTTP window and tie up the single SQLite writer. OpenLibrary latency is also variable, which makes plugin retries painful.

**Separate scheduler (option 3) is rejected** for this milestone. A cron-like scheduler adds deployment complexity (either node-cron in-process, or an external scheduler) without benefit over an in-process queue. Single-user self-host does not justify it.

**Chosen: in-process async queue, enqueued from the sync path, drained by a worker loop.**

### 2.2 Implementation

- Use `p-queue` (already compatible with Node >=22, pure ESM/CJS, no native deps). Configure `{ concurrency: 1, interval: 1000, intervalCap: 1 }` to cap OpenLibrary at ~1 req/sec (respects their fair-use; see section 6).
- Single worker loop started from `app.ts` after migrations but before `app.listen`. Loop pulls `status='pending'` rows from `enrichment_job` ordered by `created_at`, processes one at a time, writes status transitions.
- Enqueue points:
  - `UploadService.uploadStatisticData` — after `trx.commit()`, call `EnrichmentQueue.enqueueBooks(newBooks.map(b => b.md5))`. Non-blocking.
  - `/api/upload` legacy path — same hook (already routes through `uploadStatisticData`).
- Graceful shutdown: on SIGTERM, `queue.pause()`, let in-flight job finish, then `server.close()`.

### 2.3 Idempotency against concurrent syncs

Two sync requests for the same book MUST NOT double-enrich. Strategy:

1. **Enqueue de-dup:** `enrichment_job` has `UNIQUE(book_md5, status) WHERE status IN ('pending','running')` (SQLite partial unique index). `enqueueBooks` uses `INSERT ... ON CONFLICT DO NOTHING`, so repeat enqueues coalesce.
2. **Book-level guard:** `book.enrichment_status` column (`'unenriched' | 'pending' | 'enriched' | 'failed' | 'manual'`). Worker only runs enrichment if `book.enrichment_status IN ('unenriched', 'failed')` AND no newer manual override exists. The `'manual'` terminal state blocks auto-enrichment entirely (see section 7).
3. **Worker claim:** transition `enrichment_job.status` from `'pending'` to `'running'` in a `db.transaction` with a row-level `WHERE status='pending'`. SQLite serializes writes so only one claimant succeeds. Return value of `.update()` distinguishes winner vs loser.
4. **Cooldown:** on `'failed'`, record `retry_after = now() + backoff(attempt)`. Worker skips rows where `retry_after > now()`.

---

## 3. Author Entity Migration

### 3.1 Migration order (three separate migrations, in this order)

1. `YYYYMMDDHHMMSS_create_author_table.ts`
   - `author(id PK, name, openlibrary_key UNIQUE NULL, nationality NULL, bio NULL, birth_year NULL, death_year NULL, source TEXT DEFAULT 'openlibrary', nationality_source TEXT, created_at, updated_at)`
   - Index: `author.name` (for name-based findOrCreate dedup), `author.openlibrary_key`.
2. `YYYYMMDDHHMMSS_create_book_author_table.ts`
   - `book_author(book_md5 FK -> book(md5) ON DELETE CASCADE, author_id FK -> author(id), position INT DEFAULT 0, PRIMARY KEY(book_md5, author_id))`
   - Position preserves co-author order (for "primary author" reporting decision).
3. `YYYYMMDDHHMMSS_backfill_authors_from_book_authors_string.ts`
   - Reads every `book.authors` row, splits on `\n` and `,`, trims, findOrCreates `author` rows (name-only, no OL key yet), inserts `book_author` with `position`. Pure SQL/Knex in the migration; no external calls.
4. Do NOT drop `book.authors` in this milestone. Keep it as a denormalized cache — rationale below.

### 3.2 Keep or drop `book.authors`?

**Keep it, rename intent to "display cache."** Three reasons:

- The KOReader plugin POSTs `authors` as a string on every sync. Dropping the column forces us to parse+resolve authors *inside the sync transaction*, which pushes OpenLibrary I/O onto the sync path (the exact thing section 2 avoided). Keeping `book.authors` means sync stays cheap: store the string, enqueue enrichment, resolve authors later.
- `BooksRepository.getAllWithData` and the web books list can render an author string without a join. At ~thousands of books for a single-user library, the join is cheap, but the plugin contract compatibility is the binding reason.
- Manual edit UI still writes to `book_author` as the source of truth. After manual edit, recompute `book.authors` as `authors.map(a => a.name).join(', ')` so the cache stays in sync.

Rule: `book.authors` is write-from-two-sources (plugin sync, post-enrichment/manual-edit reformat). `book_author` is the single source of truth for reporting.

### 3.3 Plugin contract

The plugin continues to POST `authors: string`. The server accepts it unchanged. `UploadService` writes `book.authors` verbatim, enqueues enrichment, and the enrichment worker later populates `book_author`. No plugin version bump required for this migration (plugin `REQUIRED_PLUGIN_VERSION` stays at `0.3.0`).

### 3.4 Concurrency during backfill migration

The backfill migration runs inside the Knex migration runner on server boot (existing convention). No OpenLibrary calls here — migration is pure string parse. Enrichment (OL key + nationality) happens later via the backfill job (section 6).

---

## 4. Canonical Genre List & Subject Mapping

### 4.1 Where the canonical list lives

**Committed seed file** at `apps/server/src/db/seeds/08_canonical_genres.ts`, invoked on first run via `npm run seed`, PLUS a one-shot idempotent migration `YYYYMMDDHHMMSS_seed_canonical_genres.ts` that inserts missing rows using `ON CONFLICT(name) DO NOTHING`.

Why both:
- Seed file: source of truth for dev/test (reruns via `npm run seed`).
- Migration: guarantees production databases get the list on deploy without running seeds (seeds are dev-only per existing project convention).
- The two share a constant array exported from `apps/server/src/genres/canonical-genres.ts` (TS constant), imported by both. Editing the constant auto-propagates.

Rejected alternatives:
- Pure TS constant (no DB rows): breaks `book_genre` FK semantics; forces every report join to reconcile strings. Rejected.
- Migration-only: dev test fixtures would drift. Rejected.
- Seed-only: production wouldn't have it unless operators remember to seed. Rejected.

### 4.2 Subject -> canonical mapping ruleset

Also a TS constant: `apps/server/src/enrichment/genre-mapping.ts` exporting `SUBJECT_MAPPING: Record<string, CanonicalGenreName>` and `mapSubjectsToGenres(subjects: string[]): CanonicalGenreName[]` pure function. NOT in the DB.

Reasons:
- The mapping is code, not data. It will be iteratively refined with test coverage (`genre-mapping.test.ts`) against real OpenLibrary subject fixtures.
- Putting it in the DB means schema migrations every time a mapping changes. Code + unit tests is faster to iterate and code-reviewable in PRs.
- Deterministic: same subjects in, same genres out. No runtime DB lookup needed.

The mapping function returns `CanonicalGenreName[]` (string literals typed from the constant). `enrichment-service` then translates names -> genre IDs via `GenreRepository.getByName` (one-time lookup, cache in-process for the duration of the worker).

### 4.3 Lock `GenreRepository.findOrCreate`

Current `findOrCreate` would let arbitrary strings leak in. Replace with `GenreRepository.getByCanonicalName(name: CanonicalGenreName): Genre` (throws if missing — indicates seed drift). Remove unchecked insertion paths.

---

## 5. Report Aggregation Strategy

### 5.1 Recommendation: compute-on-demand SQL aggregates

For a single-user SQLite app, the read volume is negligible (one user loading a yearly report on-demand), and `page_stat` tables in the wild are in the 10k–100k row range. SQLite aggregations over this complete in well under 100 ms with proper indexes.

**Denormalized summary tables are rejected** for three reasons:
- Invalidation surface: every page_stat insert, annotation sync, manual edit, or enrichment completion would need to touch the summary. Easy to get wrong.
- No observed performance need. Re-evaluate only if profiling shows >500 ms report queries.
- Avoids "two sources of truth" bugs when users delete pages/books or fix metadata.

### 5.2 Indexing for year-based queries

Add in a dedicated migration `YYYYMMDDHHMMSS_add_page_stat_year_indexes.ts`:

- `CREATE INDEX idx_page_stat_start_time ON page_stat(start_time)` (if not already — check existing migrations; `page_stat` has `(device_id, book_md5, page, start_time)` unique but likely no standalone `start_time` index).
- `CREATE INDEX idx_book_author_author_id ON book_author(author_id)` (for "books by author nationality" reverse joins).
- `CREATE INDEX idx_book_genre_book_md5 ON book_genre(book_md5)` (already likely present; verify).

Query shape for yearly report:

```sql
-- genre breakdown for year
SELECT g.name, SUM(ps.duration) AS total_time, COUNT(DISTINCT ps.book_md5) AS book_count
FROM page_stat ps
JOIN book_genre bg ON bg.book_md5 = ps.book_md5
JOIN genre g ON g.id = bg.genre_id
WHERE ps.start_time >= strftime('%s', :year || '-01-01') * 1000
  AND ps.start_time < strftime('%s', (:year + 1) || '-01-01') * 1000
GROUP BY g.id;
```

Watch the unit: confirm `page_stat.start_time` unit (seconds vs ms) before committing the query. Existing `StatsRepository` will tell.

### 5.3 "Available years" endpoint

`GET /api/reports/years` returns `SELECT DISTINCT strftime('%Y', datetime(start_time, 'unixepoch')) FROM page_stat ORDER BY 1 DESC`. Feeds the year selector in the web UI.

---

## 6. Backfill of Pre-Existing Books

### 6.1 Run off the request path, persistent state

- On server boot, after migrations + worker start, an `enrichment-bootstrap.ts` module runs `SELECT md5 FROM book WHERE enrichment_status = 'unenriched'` and enqueues all of them. The same queue that handles sync-time enrichment drains these.
- No new scheduler. No pausing the server. The queue's rate limiter (1 req/s) naturally backpressures.
- Persistent state: `enrichment_job` table. On restart, `status='running'` rows are reset to `'pending'` (crash recovery — running jobs are assumed incomplete) at bootstrap before worker starts.

### 6.2 `enrichment_job` schema

```sql
CREATE TABLE enrichment_job (
  id INTEGER PRIMARY KEY,
  book_md5 TEXT NOT NULL REFERENCES book(md5) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  retry_after INTEGER, -- epoch ms; skip until this time
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_enrichment_job_status ON enrichment_job(status, retry_after);
CREATE UNIQUE INDEX idx_enrichment_job_active
  ON enrichment_job(book_md5) WHERE status IN ('pending','running');
```

### 6.3 Rate limiting

- `p-queue` configured with `intervalCap=1, interval=1000` (1 req/s). Per OpenLibrary's public guidance, this stays well under their undocumented-but-informally-1-5rps limits.
- Honor HTTP 429: on 429, exponential backoff (30s, 2m, 10m), record `retry_after`.
- Set `User-Agent: KoInsight/<version> (https://github.com/...)` header on all OpenLibrary requests. Required by OpenLibrary's fair-use policy.

---

## 7. Manual Edit vs Auto-Enrichment Conflict Resolution

### 7.1 Field-level source tracking

Add `*_source` columns on `book` for editable metadata, each `TEXT NOT NULL DEFAULT 'openlibrary'` with values `'openlibrary' | 'manual' | 'plugin'`:

- `title_source`
- `authors_source` (governs `book.authors` string AND the `book_author` rows)
- `publication_year_source`
- `original_language_source`
- `genres_source`

Rule: **if `<field>_source = 'manual'`, enrichment leaves that field untouched**. Enrichment writes `'openlibrary'` only to fields currently valued `'openlibrary'` (or NULL/default/plugin). This makes manual edits sticky.

On authors: `authors_source='manual'` locks both the string and the `book_author` rows. Enrichment must consult this before touching either.

### 7.2 Book-level enrichment status

`book.enrichment_status`: `'unenriched' | 'pending' | 'enriched' | 'failed' | 'manual'`.
- Transition to `'manual'` only if the user *explicitly* chooses "this book's metadata is hand-curated, do not auto-enrich" in the UI. Default manual edits still set `<field>_source='manual'` per-field but leave book-level status at `'enriched'`, allowing targeted re-enrichment of untouched fields.

### 7.3 Manual edit flow

Go through `books-service.updateMetadata` (NOT a separate enrichment path). The service:
1. Validates with Zod.
2. Writes field + sets `<field>_source = 'manual'`.
3. For authors: replaces `book_author` rows; recomputes `book.authors` display cache.
4. Does NOT enqueue enrichment.

A separate `POST /api/books/:md5/re-enrich` endpoint (admin) forces re-run, respecting `_source='manual'` locks.

---

## 8. API Surface Additions

| Method + Path | Purpose |
|---|---|
| `GET /api/authors` | List authors (for admin dedup UI) |
| `GET /api/authors/:id` | Single author detail (name, nationality, books) |
| `PATCH /api/authors/:id` | Manual override for author fields (sets `source='manual'`) |
| `GET /api/genres` | Canonical genre list (for filter dropdowns) |
| `PATCH /api/books/:md5/metadata` | Manual metadata edit (title, authors, genres, year, language) |
| `GET /api/books/:md5/enrichment` | Current enrichment state + last attempt error |
| `POST /api/books/:md5/re-enrich` | Force re-enrichment (respects manual locks) |
| `GET /api/enrichment/jobs?status=failed` | Admin: list failed enrichments for triage |
| `POST /api/enrichment/backfill` | Admin: re-enqueue all unenriched books |
| `GET /api/reports/years` | Years with any reading data |
| `GET /api/reports/yearly/:year` | Full yearly aggregates (genres, author nationalities, publication year histogram, totals) |

Placement rules applied:
- Enrichment *state* per-book goes under `/api/books/:md5/...` because it's a book attribute.
- Enrichment *operations* (list jobs, trigger backfill) go under `/api/enrichment/*` because they're cross-book infrastructure.
- Yearly reports go under `/api/reports/*` (new) — deliberately NOT `/api/stats/*` because `/api/stats` already serves per-book/per-device raw stats and mixing them confuses cache keys and the mental model.

---

## 9. `packages/common/types` Additions

### 9.1 New files

**`packages/common/types/author.ts`**
```ts
export type AuthorSource = 'openlibrary' | 'manual';

export type Author = {
  id: number;
  name: string;
  openlibrary_key: string | null;
  nationality: string | null;
  nationality_source: AuthorSource;
  bio: string | null;
  birth_year: number | null;
  death_year: number | null;
  source: AuthorSource;
  created_at: number;
  updated_at: number;
};
```

**`packages/common/types/book-author.ts`**
```ts
export type BookAuthor = {
  book_md5: string;
  author_id: number;
  position: number; // 0 = primary author
};
```

**`packages/common/types/enrichment.ts`**
```ts
export type EnrichmentStatus =
  | 'unenriched'
  | 'pending'
  | 'enriched'
  | 'failed'
  | 'manual';

export type FieldSource = 'openlibrary' | 'manual' | 'plugin';

export type EnrichmentJob = {
  id: number;
  book_md5: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  attempts: number;
  last_error: string | null;
  retry_after: number | null;
  created_at: number;
  updated_at: number;
};

export type GenreMapping = {
  // subject from OpenLibrary -> canonical genre name
  subject: string;
  canonical_genre: string;
};
```

**`packages/common/types/report.ts`**
```ts
export type YearlyReport = {
  year: number;
  total_read_time: number;       // seconds
  total_books: number;
  total_pages: number;
  genres: Array<{ genre_id: number; name: string; read_time: number; book_count: number }>;
  nationalities: Array<{ nationality: string | null; read_time: number; book_count: number }>;
  publication_years: Array<{ decade: number; book_count: number }>;
  top_authors: Array<{ author_id: number; name: string; read_time: number; book_count: number }>;
};

export type AvailableYears = number[];
```

### 9.2 Extend `packages/common/types/book.ts`

```ts
export type Book = DbBook & {
  soft_deleted: boolean;
  reference_pages: number | null;
  // New:
  enrichment_status: EnrichmentStatus;
  openlibrary_work_key: string | null;
  publication_year: number | null;
  original_language: string | null;
  title_source: FieldSource;
  authors_source: FieldSource;
  publication_year_source: FieldSource;
  original_language_source: FieldSource;
  genres_source: FieldSource;
};
```

All new files re-exported from `packages/common/types/index.ts`.

---

## 10. Data Flow Diagrams

### 10.1 Sync-time enrichment path

```
KOReader plugin / manual upload
        │
        ▼
POST /api/plugin/import  (koplugin-router, version gate)
        │
        ▼
UploadService.uploadStatisticData  (Knex transaction)
   ├── upsert book (onConflict md5 ignore)      ── sets enrichment_status='unenriched' on insert only
   ├── upsert book_device / page_stat / annotations
   └── trx.commit()
        │
        ▼  (fire-and-forget, after commit)
EnrichmentQueue.enqueueBooks(md5s)
   └── INSERT INTO enrichment_job(status='pending') ON CONFLICT DO NOTHING
        │
        ▼  (out of band, worker loop)
enrichment-worker picks up pending job
        │
        ▼
enrichment-service.enrichBook(md5)
   ├── Skip if book.enrichment_status='manual'
   ├── openlibrary-enricher.searchWork(title, authors-string)
   ├── openlibrary-enricher.getWork(workKey) -> subjects, first_publish_date, language, author keys
   ├── openlibrary-enricher.getAuthor(authorKey) for each -> nationality, bio
   ├── genre-mapping.mapSubjectsToGenres(subjects) -> canonical names
   ├── authors-service.findOrCreateByOpenLibraryKey for each author
   ├── update book_author rows (respect authors_source='manual')
   ├── update book_genre rows (respect genres_source='manual')
   ├── update book.publication_year, original_language (respect *_source='manual')
   └── set book.enrichment_status='enriched', enrichment_job.status='succeeded'
```

### 10.2 Backfill path

```
server start
  ├── db.migrate.latest()
  ├── enrichment-bootstrap: reset running->pending, enqueue all unenriched books
  ├── enrichment-worker.start()
  └── app.listen()

worker loop (forever):
  ├── claim next pending job (UPDATE ... WHERE status='pending' RETURNING)
  ├── await rate-limiter.tick()  (1 req/s)
  ├── enrichment-service.enrichBook(md5)
  ├── on 429 -> set retry_after = now + backoff; status='pending'
  ├── on success -> status='succeeded'
  └── on hard failure -> attempts++, status='failed' if attempts>=3
```

---

## 11. Suggested Build Order

Ordered by dependency. Each step is a roadmap phase candidate.

1. **Schema foundations** (no OpenLibrary calls yet)
   - Migrations: `author`, `book_author`, book `enrichment_status` + `*_source` columns + `publication_year` + `original_language` + `openlibrary_work_key`, `enrichment_job`.
   - Backfill migration: split `book.authors` string into `author` + `book_author`.
   - New types in `packages/common/types`.
   - Rationale: everything downstream consumes these columns. Ship them first so other phases can be developed in parallel once landed.

2. **Canonical genre list + mapping**
   - `apps/server/src/genres/canonical-genres.ts` constant.
   - Seed `08_canonical_genres.ts` + idempotent migration to insert into `genre`.
   - `apps/server/src/enrichment/genre-mapping.ts` with unit tests against OpenLibrary subject fixtures.
   - Rationale: enrichment depends on this; isolate it so it's testable without any HTTP.

3. **OpenLibrary service extensions**
   - Add `searchWork`, `getWork`, `getEdition`, `getAuthor` to `open-library-service.ts`.
   - Add typed response shapes to `open-library-types.ts`.
   - Add User-Agent header.
   - Rationale: pure HTTP layer; mockable; no DB writes.

4. **Authors slice**
   - `authors-repository`, `authors-service.findOrCreateByOpenLibraryKey` / `findOrCreateByName` / `mergeDuplicates`.
   - No routes yet (internal use).
   - Rationale: enrichment-service calls it; manual edit later exposes routes.

5. **Enrichment slice (queue + worker + service)**
   - `enrichment-repository` (job CRUD).
   - `enrichment-queue` + `enrichment-worker` (p-queue, rate limiter).
   - `enrichment-service.enrichBook` wiring it all together.
   - Bootstrap logic in `app.ts`.
   - Hook into `UploadService.uploadStatisticData` post-commit.
   - Rationale: end-to-end enrichment works after this phase; backfill naturally runs on first deploy.

6. **Manual edit API + locks**
   - `PATCH /api/books/:md5/metadata`, author PATCH, `_source='manual'` enforcement.
   - `POST /api/books/:md5/re-enrich`.
   - Rationale: needs enrichment to exist first so "re-enrichment respecting locks" has meaning.

7. **Manual edit web UI**
   - New page or modal under `apps/web/src/pages/book-page/book-page-manage/` extension.
   - Flag unenriched/failed books on the books list (filter chip powered by `enrichment_status`).

8. **Reports slice**
   - `reports-repository` aggregations, `reports-service`, `reports-router`.
   - Year-index migration.
   - Rationale: requires enriched data to be meaningful; ship last so demo data shows breakdowns.

9. **Reports web UI**
   - New page under `apps/web/src/pages/stats-page/` (year selector, genre pie, nationality bar, publication-year histogram, top authors). Reuse existing Recharts components.

---

## 12. Plugin Contract Backward Compatibility

- `POST /api/plugin/import` payload shape unchanged. Plugin continues to send `authors: string`.
- `REQUIRED_PLUGIN_VERSION` stays at `0.3.0`. No plugin release needed for this milestone.
- New columns on `book` are all nullable or have defaults, so `onConflict('md5').ignore()` from `UploadService` keeps working. Existing plugin clients that don't know about `publication_year` etc. are unaffected.
- If/when plugin eventually wants to opt into richer metadata, bump `REQUIRED_PLUGIN_VERSION` in a separate milestone; this one does not require it.

---

## 13. Open Risks / Gaps

- **OpenLibrary author nationality coverage is uneven.** Many `/authors/OLxxxxA.json` records lack nationality. Fallback strategy (Wikipedia/Wikidata scrape) is explicitly out of scope; document "unknown nationality" as a first-class report bucket.
- **Co-author nationality weighting** deferred per PROJECT.md. Recommend: "primary author only" (position=0) for the first version of the report; revisit if users complain.
- **SQLite write contention.** Sync transactions and enrichment worker both write. Because better-sqlite3 serializes writes and sync transactions are short post-refactor (no OL calls inside), contention should be acceptable. Monitor in practice.
- **Migration-time backfill of `book_author` from noisy author strings.** Heuristic split on `, ` and `\n` will mis-parse "Smith, John Jr." Accept imperfect initial data; enrichment replaces these rows when the OpenLibrary match succeeds.

---

*Architecture research: 2026-04-23*

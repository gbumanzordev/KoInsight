# Requirements

**Milestone:** Book Metadata Enrichment + Yearly Reports
**Source:** PROJECT.md Active list + .planning/research/SUMMARY.md
**Last updated:** 2026-04-23

## v1 Requirements

### Schema (SCHEMA)

- [ ] **SCHEMA-01**: A new `author` table exists with columns `id`, `name`, `openlibrary_key` (nullable, unique partial index when not null), `wikidata_qid` (nullable), `nationality` (nullable ISO 3166-1 alpha-2), `nationality_source` (`openlibrary` | `manual`), `bio` (nullable), `created_at`, `updated_at`
- [ ] **SCHEMA-02**: A new `book_author` junction table links `book.md5` ↔ `author.id` with `position` (0 = primary author) and `role` (`author` | `editor`; translators are excluded at ingest, not stored)
- [ ] **SCHEMA-03**: The existing `book.authors` text column is preserved as a denormalized display cache so the KOReader plugin's `/api/plugin/*` bulk-sync contract is unchanged
- [ ] **SCHEMA-04**: The `book` table gains `enrichment_status` (`pending` | `running` | `enriched` | `failed` | `skipped`), `openlibrary_work_key` (nullable), `publication_year` (nullable smallint), `original_language` (nullable ISO 639-1), and a `*_source` column (`openlibrary` | `manual`) for each enrichable field (`authors_source`, `genres_source`, `publication_year_source`, `original_language_source`)
- [ ] **SCHEMA-05**: A new `enrichment_job` table tracks queue state with `id`, `book_md5`, `status` (`pending` | `running` | `succeeded` | `failed`), `attempts`, `last_error`, `created_at`, `updated_at`, plus a partial unique index ensuring at most one open job per book
- [ ] **SCHEMA-06**: The existing `genre` table is seeded with the canonical genre whitelist via an idempotent migration (insert-or-ignore)
- [ ] **SCHEMA-07**: All schema migrations are structure-only (no network calls, no data enrichment); data backfill happens through the runtime enrichment queue, not in migrations
- [ ] **SCHEMA-08**: A migration backfills `book_author` and `author` rows from existing `book.authors` strings using a deterministic parser (split on `&`, `,`, `;` and `and`; trim; preserve order for `position`)

### Canonical genres (GENRE)

- [ ] **GENRE-01**: A `CANONICAL_GENRES` TypeScript constant defines ~50-100 canonical genres, exported from a single module, and is the source of truth seeded into the `genre` table
- [ ] **GENRE-02**: A `mapOpenLibrarySubjects(subjects: string[]): Genre[]` pure function maps raw OpenLibrary subjects to canonical genres using a documented ruleset (alias map + denylist of marketing/format tags such as `Accessible book`, `Protected DAISY`, `Large type books`, `In library`, `New York Times bestseller`)
- [ ] **GENRE-03**: The mapping function is unit tested with at least 20 representative real OpenLibrary subject lists (including all-noise, no-canonical-match, multi-genre cases)
- [ ] **GENRE-04**: Books for which mapping yields zero canonical genres are recorded with `genres_source = 'openlibrary'` and an empty `book_genre` set (not flagged as enrichment failure; the book IS enriched, just has no genres)

### OpenLibrary client (OL)

- [ ] **OL-01**: The existing `open-library-service` is extended with `searchWork(title, author)`, `getWork(workKey)`, `getEdition(editionKey)`, and `getAuthor(authorKey)` methods, each returning Zod-parsed payloads
- [ ] **OL-02**: All OpenLibrary requests send a `User-Agent: KoInsight/<version> (<homepage>)` header to qualify for the 3 req/s tier
- [ ] **OL-03**: All OpenLibrary requests pass through a single Bottleneck limiter (1 req/s baseline, configurable) shared across the process
- [ ] **OL-04**: The client implements a circuit breaker that opens after N consecutive 5xx/timeouts and re-tests after a cooldown, so OpenLibrary outages do not pin the queue
- [ ] **OL-05**: Subjects are read from the resolved Work, not the Edition (with explicit ISBN → Edition → Work resolution where ISBN is available; otherwise title+author search → Work)

### Wikidata nationality (WD)

- [ ] **WD-01**: When an OpenLibrary author response contains `remote_ids.wikidata`, the enrichment service fetches the Wikidata entity and reads `claims.P27` (country of citizenship)
- [ ] **WD-02**: Wikidata results are normalized to ISO 3166-1 alpha-2 country codes via a country-code lookup module
- [ ] **WD-03**: Authors with multiple P27 claims resolve to the claim that has no `end time` qualifier and the highest `rank`; remaining values are not stored this milestone (override path is manual edit)
- [ ] **WD-04**: Authors without a `remote_ids.wikidata` link or without P27 claims have `nationality = NULL` and `nationality_source = 'openlibrary'` (the source ATTEMPTED OL/WD; manual edit can later set `'manual'`)
- [ ] **WD-05**: Wikidata requests share the same Bottleneck limiter as OpenLibrary and send the same User-Agent

### Enrichment service (ENRICH)

- [ ] **ENRICH-01**: A new `apps/server/src/enrichment/` slice exposes `enrichmentService.enqueue(bookMd5)` and a worker that processes the `enrichment_job` table
- [ ] **ENRICH-02**: The worker runs in-process with Bottleneck-controlled concurrency=1; book enrichment is idempotent (running twice yields the same result for the same input)
- [ ] **ENRICH-03**: Per-field provenance is enforced: enrichment NEVER overwrites a field whose `*_source = 'manual'`. Manual values are sticky across all re-enrichment runs.
- [ ] **ENRICH-04**: Books are enqueued automatically after a successful KOReader sync (post-transaction commit in the existing upload/plugin sync paths) and never inline in the request handler
- [ ] **ENRICH-05**: A boot-time bootstrap enqueues every book with `enrichment_status IN ('pending', NULL)` so existing libraries are backfilled on the first deploy after this milestone ships
- [ ] **ENRICH-06**: On crash/restart, jobs in `running` state are reset to `pending` so they retry; failed jobs retain `last_error` and stop retrying after a configurable max attempts
- [ ] **ENRICH-07**: When a book's match score is too low (no OpenLibrary work found, or low-confidence string match), the book is recorded with `enrichment_status = 'failed'` and surfaces in the unmatched inbox (UI-04)

### Manual edit API (EDIT)

- [ ] **EDIT-01**: `PATCH /api/books/:md5/metadata` accepts a Zod-validated body that may set any of: `authors` (array of author entities by name + optional `openlibrary_key`), `genres` (array of canonical genre names), `publication_year`, `original_language`, `nationality_overrides` (per-author)
- [ ] **EDIT-02**: Every field changed via the manual edit endpoint has its corresponding `*_source` column set to `'manual'`, locking it against future enrichment overwrites
- [ ] **EDIT-03**: `POST /api/books/:md5/re-enrich` re-runs enrichment for a single book while honoring all `_source = 'manual'` locks
- [ ] **EDIT-04**: `GET /api/enrichment/unmatched` returns the paginated list of books with `enrichment_status = 'failed'` for the unmatched inbox UI
- [ ] **EDIT-05**: `GET /api/enrichment/status` returns aggregate counters (pending / running / enriched / failed) for showing backfill progress in the UI

### Web edit + inbox UI (UI)

- [ ] **UI-01**: A "Edit metadata" button on the existing book detail page opens a Mantine form (built on `@mantine/form` + `mantine-form-zod-resolver`) with: title (read-only), authors `TagsInput`, genres `MultiSelect` constrained to canonical genres, `NumberInput` for publication year, `Select` for original language (ISO 639-1 list), per-author nationality `Select` (ISO 3166-1 list)
- [ ] **UI-02**: The edit form displays a provenance badge (e.g., chip: "manual" or "OpenLibrary") next to each field so the user can see what is auto-populated vs locked
- [ ] **UI-03**: Saving the form calls `PATCH /api/books/:md5/metadata`; cancel reverts; success toasts and refreshes the book detail page via SWR mutation
- [ ] **UI-04**: A new "Unmatched books" view (linked from settings or stats area) lists books with `enrichment_status = 'failed'`, supports per-book "Edit metadata" jump and per-book "Re-enrich" action, and shows a count badge in nav
- [ ] **UI-05**: The book detail page shows enrichment status and a manual "Re-enrich" button that calls `POST /api/books/:md5/re-enrich`

### Reports backend (REPORT)

- [ ] **REPORT-01**: A new `apps/server/src/reports/` slice exposes `GET /api/reports/yearly?year=YYYY` returning JSON with: total books read (>=95% pages), total pages, total reading time, genre breakdown (canonical genre → count), nationality breakdown (ISO country → count, primary author only), publication-year histogram (decade buckets), original-language breakdown, and a `coverage` block reporting how many books in the year are unenriched
- [ ] **REPORT-02**: A "book read in year Y" is defined as: ≥95% of `book.reference_pages` (or `book.pages` if reference is null) was reached during Y, where Y boundaries use the server's local timezone (configurable env var, defaults to UTC); page-time aggregates always include all reading regardless of completion
- [ ] **REPORT-03**: `GET /api/reports/years` returns the list of years that have any reading data (used to populate the year selector)
- [ ] **REPORT-04**: All aggregations are computed on demand via SQL (no summary tables); a covering index is added on `page_stat.start_time` and on `book_author(author_id, book_md5)` to keep yearly queries fast
- [ ] **REPORT-05**: An "Unknown" bucket appears in every breakdown for books without that field (genre, nationality, language, year). Coverage percent is shown alongside so users see how trustworthy each chart is. The Unknown bucket is never silently dropped or renormalized away.

### Reports UI (REPORT-UI)

- [ ] **REPORT-UI-01**: A new "Yearly report" route is added to the web app (e.g., `/reports/yearly`) and linked from the existing stats navigation
- [ ] **REPORT-UI-02**: A year `Select` (populated from `GET /api/reports/years`) controls all charts on the page; the URL persists the selected year as a query param
- [ ] **REPORT-UI-03**: Charts rendered with Recharts: stacked bar for genre breakdown, bar for nationality (top 10 + "Other" for long tail), histogram for publication decade, pie or bar for original language, headline cards for total books / pages / time
- [ ] **REPORT-UI-04**: Each chart shows the coverage banner: e.g., "Genres known for 87 of 102 books read this year" so missing-data skew is visible
- [ ] **REPORT-UI-05**: Empty-year states (year with no reading or no enriched books) render a helpful empty placeholder pointing to the unmatched inbox

## v2 Requirements

<!-- Deferred — table stakes recognized but not shipping this milestone -->

- Spotify-Wrapped-style shareable yearly report (slideshow / image export)
- Author-centric browse and per-author detail pages
- UI toggle to switch nationality breakdown between "primary author only" and "each co-author counted once"
- Configurable per-user "counts as read" threshold (currently hardcoded 95%)
- Multi-citizenship resolution: store full list and let user pick the displayed one
- Bulk operations in the unmatched inbox (multi-select → assign genre, set nationality, etc.)
- Configurable canonical genre list (admin UI to add/remove genres)

## Out of Scope

<!-- Carried from PROJECT.md, with reasoning -->

- LLM-based enrichment via the existing `/api/ai` route — chose deterministic OL/Wikidata path; no per-book token cost
- Google Books / additional metadata providers — second integration adds API key management; revisit only if OL coverage proves inadequate
- Wikidata for any field other than author nationality — narrow downstream usage only
- Spotify-Wrapped-style shareable image / slideshow report — minimum-viable report lives inside the existing dashboard
- Shareable public report links — all reports remain behind the authenticated dashboard
- Author-level biographical pages or browsable author index — nationality column is enough for reporting; full author UI is a future milestone
- BISAC or other commercial taxonomy licensing — canonical list is hand-curated from OpenLibrary subjects
- Multi-author nationality weighting / fractional credit — locked to "primary author only" via primary author rule
- Inline (request-path) enrichment — explicitly architected as post-sync async via in-process queue
- ESM-only dependencies (p-queue, p-limit, ky, got) — server tsconfig is CJS; use Bottleneck instead

## Traceability

<!-- Maps each REQ-ID to the phase that delivers it. Coverage: 37/37 v1 requirements mapped. -->

| REQ-ID | Phase |
|--------|-------|
| SCHEMA-01 | Phase 1: Schema Foundations + Provenance |
| SCHEMA-02 | Phase 1: Schema Foundations + Provenance |
| SCHEMA-03 | Phase 1: Schema Foundations + Provenance |
| SCHEMA-04 | Phase 1: Schema Foundations + Provenance |
| SCHEMA-05 | Phase 1: Schema Foundations + Provenance |
| SCHEMA-06 | Phase 2: Canonical Genre Vocabulary |
| SCHEMA-07 | Phase 1: Schema Foundations + Provenance |
| SCHEMA-08 | Phase 1: Schema Foundations + Provenance |
| GENRE-01 | Phase 2: Canonical Genre Vocabulary |
| GENRE-02 | Phase 2: Canonical Genre Vocabulary |
| GENRE-03 | Phase 2: Canonical Genre Vocabulary |
| GENRE-04 | Phase 2: Canonical Genre Vocabulary |
| OL-01 | Phase 3: OpenLibrary + Wikidata Client |
| OL-02 | Phase 3: OpenLibrary + Wikidata Client |
| OL-03 | Phase 3: OpenLibrary + Wikidata Client |
| OL-04 | Phase 3: OpenLibrary + Wikidata Client |
| OL-05 | Phase 3: OpenLibrary + Wikidata Client |
| WD-01 | Phase 3: OpenLibrary + Wikidata Client |
| WD-02 | Phase 3: OpenLibrary + Wikidata Client |
| WD-03 | Phase 3: OpenLibrary + Wikidata Client |
| WD-04 | Phase 3: OpenLibrary + Wikidata Client |
| WD-05 | Phase 3: OpenLibrary + Wikidata Client |
| ENRICH-01 | Phase 4: Enrichment Service + Backfill |
| ENRICH-02 | Phase 4: Enrichment Service + Backfill |
| ENRICH-03 | Phase 4: Enrichment Service + Backfill |
| ENRICH-04 | Phase 4: Enrichment Service + Backfill |
| ENRICH-05 | Phase 4: Enrichment Service + Backfill |
| ENRICH-06 | Phase 4: Enrichment Service + Backfill |
| ENRICH-07 | Phase 4: Enrichment Service + Backfill |
| EDIT-01 | Phase 5: Manual Edit + Unmatched Inbox |
| EDIT-02 | Phase 5: Manual Edit + Unmatched Inbox |
| EDIT-03 | Phase 5: Manual Edit + Unmatched Inbox |
| EDIT-04 | Phase 5: Manual Edit + Unmatched Inbox |
| EDIT-05 | Phase 5: Manual Edit + Unmatched Inbox |
| UI-01 | Phase 5: Manual Edit + Unmatched Inbox |
| UI-02 | Phase 5: Manual Edit + Unmatched Inbox |
| UI-03 | Phase 5: Manual Edit + Unmatched Inbox |
| UI-04 | Phase 5: Manual Edit + Unmatched Inbox |
| UI-05 | Phase 5: Manual Edit + Unmatched Inbox |
| REPORT-01 | Phase 6: Yearly Report |
| REPORT-02 | Phase 6: Yearly Report |
| REPORT-03 | Phase 6: Yearly Report |
| REPORT-04 | Phase 6: Yearly Report |
| REPORT-05 | Phase 6: Yearly Report |
| REPORT-UI-01 | Phase 6: Yearly Report |
| REPORT-UI-02 | Phase 6: Yearly Report |
| REPORT-UI-03 | Phase 6: Yearly Report |
| REPORT-UI-04 | Phase 6: Yearly Report |
| REPORT-UI-05 | Phase 6: Yearly Report |

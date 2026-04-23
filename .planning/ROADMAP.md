# Roadmap: KoInsight — Book Metadata Enrichment + Yearly Reports

## Overview

This milestone extends KoInsight from a raw-stats dashboard into a library that knows *what kind of books* the user reads. Six phases take the codebase from today's denormalized author strings and unused `genre` scaffolding to a fully-enriched library with a yearly report section. The journey is strictly bottom-up: schema and provenance land first (so manual edits can never be silently overwritten); then a canonical genre vocabulary and an extended OpenLibrary/Wikidata client land in parallel; then the enrichment service ties them together with a queue, worker, and bootstrap backfill; then the manual-edit UI and unmatched-books inbox give users an escape hatch for bad matches; finally the yearly report ships as a stats-dashboard section that consumes the enriched data.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [ ] **Phase 1: Schema Foundations + Provenance** - Author entity, junction, enrichment job table, per-field `*_source` columns, and shared types — every downstream phase consumes these
- [ ] **Phase 2: Canonical Genre Vocabulary** - Curated whitelist constant, idempotent seed/migration, and a pure subject-to-genre mapping function with unit-test coverage
- [ ] **Phase 3: OpenLibrary + Wikidata Client** - Extend the OL HTTP client with work/edition/author/search methods, a shared Bottleneck rate limiter, User-Agent, circuit breaker, and Wikidata P27 nationality lookup
- [ ] **Phase 4: Enrichment Service + Backfill** - In-process queue, worker, post-sync enqueue hook, boot-time backfill of pre-existing books, idempotency, and provenance-respecting writes
- [ ] **Phase 5: Manual Edit + Unmatched Inbox** - PATCH metadata API, re-enrich endpoint, status counters, Mantine edit form with provenance badges, and the unmatched-books inbox view
- [ ] **Phase 6: Yearly Report** - Server-side aggregations under `/api/reports/*` plus the year-selector dashboard with genre/nationality/decade/language charts and coverage banners

## Phase Details

### Phase 1: Schema Foundations + Provenance
**Goal**: Every table, column, and shared type the rest of the milestone depends on exists, with `*_source` provenance columns in place BEFORE any enrichment can run.
**Depends on**: Nothing (first phase)
**Requirements**: SCHEMA-01, SCHEMA-02, SCHEMA-03, SCHEMA-04, SCHEMA-05, SCHEMA-07, SCHEMA-08
**Success Criteria** (what must be TRUE):
  1. Running `npm --workspace=server run knex migrate:latest` against an existing dev DB adds the `author`, `book_author`, and `enrichment_job` tables, plus all new `book` columns, with no row-count loss in `book`, `page_stat`, or `annotation`.
  2. After migration, every existing row in `book` with a non-empty `authors` string has at least one corresponding `book_author` row whose `position` reflects the original order, and the original `book.authors` string is preserved verbatim.
  3. `enrichment_job` enforces "at most one open job per book" via a partial unique index (verifiable by attempting two `INSERT ... status='pending'` for the same `book_md5` and observing the second fail).
  4. `packages/common/types` exports `Author`, `BookAuthor`, `EnrichmentJob`, `EnrichmentStatus`, `FieldSource`, and the extended `Book` shape; both `apps/server` and `apps/web` build against the new types without errors.
  5. All migrations are structure-only: grepping the migration files for `fetch(`, `axios`, `https://`, or row-iteration loops over `book` (other than the deterministic author string-split backfill in SCHEMA-08) returns nothing.
**Plans**: 7 plans
  - [ ] 01-01-PLAN.md — Author parser helper + unit tests (pure function, TDD)
  - [ ] 01-02-PLAN.md — Shared types in @koinsight/common (author.ts, enrichment.ts, extend book.ts, barrel)
  - [ ] 01-03-PLAN.md — Migration 1: create author + book_author tables (with partial unique on openlibrary_key)
  - [ ] 01-04-PLAN.md — Migration 2: create enrichment_job table (with partial unique on open jobs per book)
  - [ ] 01-05-PLAN.md — Migration 3: extend book with 8 enrichment columns + provenance
  - [ ] 01-06-PLAN.md — Migration 4: backfill book_author from existing book.authors strings (uses parser)
  - [ ] 01-07-PLAN.md — End-to-end Phase 1 schema verification (SCHEMA-07 grep test + dynamic invariants)

### Phase 2: Canonical Genre Vocabulary
**Goal**: A canonical genre whitelist exists in the database and a pure function maps OpenLibrary subjects to canonical genres with documented denylist behavior, ready for the enrichment service to consume.
**Depends on**: Phase 1
**Requirements**: SCHEMA-06, GENRE-01, GENRE-02, GENRE-03, GENRE-04
**Success Criteria** (what must be TRUE):
  1. After running migrations + `npm run seed`, the `genre` table contains the full canonical list (~50-100 rows) and re-running the seed/migration is a no-op (idempotent insert-or-ignore verified).
  2. `mapOpenLibrarySubjects(['Protected DAISY', 'Accessible book', 'Science fiction', 'In library'])` returns exactly the canonical Science Fiction entry; format/marketing tags from the documented denylist are dropped before mapping.
  3. The mapping function has at least 20 unit tests against real OpenLibrary subject lists covering all-noise inputs, no-canonical-match inputs, and multi-genre inputs; all tests pass under `npm --workspace=server test`.
  4. A book whose subject list yields zero canonical matches can be persisted with `genres_source = 'openlibrary'` and an empty `book_genre` set without throwing or being marked as enrichment failure.
**Plans**: TBD

### Phase 3: OpenLibrary + Wikidata Client
**Goal**: The HTTP layer can fetch every OpenLibrary endpoint the enrichment service needs and resolve author nationality via Wikidata P27, all behind a single shared rate limiter and circuit breaker, with no DB writes.
**Depends on**: Phase 1
**Requirements**: OL-01, OL-02, OL-03, OL-04, OL-05, WD-01, WD-02, WD-03, WD-04, WD-05
**Success Criteria** (what must be TRUE):
  1. `OpenLibraryService.searchWork`, `getWork`, `getEdition`, and `getAuthor` each return Zod-parsed payloads against live or fixture responses; subjects are read from the resolved Work, never from the Edition (verifiable by fixture test where Edition has empty subjects and Work has populated ones).
  2. Every outbound request to `openlibrary.org` and `wikidata.org` includes `User-Agent: KoInsight/<version> (...)` (verifiable by inspecting fetch call args in unit tests with a mocked fetch).
  3. With Bottleneck configured at 1 req/s baseline, firing 10 lookups in a tight loop completes in roughly 10 seconds (within tolerance), demonstrating the limiter is shared and active.
  4. After N consecutive simulated 5xx/timeouts the circuit breaker opens and subsequent calls return the open-circuit error without hitting the network; after the cooldown a single probe is allowed through.
  5. Given an OpenLibrary author response with `remote_ids.wikidata`, the client fetches the Wikidata entity, picks the P27 claim with no `end time` and highest rank, and normalizes the result to an ISO 3166-1 alpha-2 country code; authors lacking a Wikidata link resolve to `nationality = NULL` with `nationality_source = 'openlibrary'`.
**Plans**: TBD

### Phase 4: Enrichment Service + Backfill
**Goal**: Books synced from KOReader are enriched asynchronously without blocking the sync path, the entire pre-existing library is backfilled on first deploy, and re-enrichment never overwrites manual edits.
**Depends on**: Phase 2, Phase 3
**Requirements**: ENRICH-01, ENRICH-02, ENRICH-03, ENRICH-04, ENRICH-05, ENRICH-06, ENRICH-07
**Success Criteria** (what must be TRUE):
  1. After a KOReader plugin sync that introduces new books, the request returns within the existing latency envelope (no inline OL calls), and within seconds the enrichment worker picks up `enrichment_job` rows for those books and transitions them to `enriched` (or `failed` for unmatched titles).
  2. Booting the server against a database with N pre-existing unenriched books enqueues all N (visible via `enrichment_job` rows) without blocking `app.listen`; the worker drains them at the configured rate.
  3. Running enrichment twice on the same book produces identical `book` / `book_author` / `book_genre` state (idempotency verifiable by snapshot diff after two runs).
  4. A book whose `genres_source = 'manual'` retains its manual `book_genre` rows after a forced re-enrichment, even when OpenLibrary returns different subjects (manual-wins rule enforced).
  5. After a simulated crash mid-job, restarting the server resets `running` jobs to `pending` so they retry; jobs that exceed the max-attempts ceiling are left in `failed` with `last_error` populated, and books with no OL match land at `enrichment_status = 'failed'` ready for the unmatched inbox.
**Plans**: TBD

### Phase 5: Manual Edit + Unmatched Inbox
**Goal**: Users can correct any wrong or missing metadata from the web UI, find books OpenLibrary failed on, and re-trigger enrichment per book — and every manual change is sticky against future re-enrichment.
**Depends on**: Phase 4
**Requirements**: EDIT-01, EDIT-02, EDIT-03, EDIT-04, EDIT-05, UI-01, UI-02, UI-03, UI-04, UI-05
**Success Criteria** (what must be TRUE):
  1. `PATCH /api/books/:md5/metadata` with a Zod-valid body persists the changed fields, sets each touched field's `*_source` to `'manual'`, and returns the updated book; sending an invalid body returns a 400 with the Zod error.
  2. After a manual edit, calling `POST /api/books/:md5/re-enrich` runs the enrichment pipeline for that book and the manually-set fields are unchanged afterward (verifiable by before/after compare on `*_source = 'manual'` columns).
  3. From a book detail page in the web UI, the user can open the edit form, see a provenance chip ("manual" or "OpenLibrary") next to each field, change authors via `TagsInput`, change genres via `MultiSelect` constrained to the canonical list, save, and see the change reflected after SWR revalidation.
  4. The "Unmatched books" view (linked from nav, with a count badge) lists every book at `enrichment_status = 'failed'`, supports per-book "Edit metadata" navigation and per-book "Re-enrich", and the count drops as the user resolves entries.
  5. `GET /api/enrichment/status` returns aggregate counts (`pending` / `running` / `enriched` / `failed`) that match a direct SQL count of `book.enrichment_status`, suitable for displaying backfill progress.
**UI hint**: yes
**Plans**: TBD

### Phase 6: Yearly Report
**Goal**: A user can pick any year with reading data and see a coherent dashboard of genre, nationality, publication-decade, and original-language breakdowns, with explicit coverage banners and an "Unknown" bucket on every chart.
**Depends on**: Phase 4 (data must exist); ships after Phase 5 so the unmatched inbox is the recovery path users see first
**Requirements**: REPORT-01, REPORT-02, REPORT-03, REPORT-04, REPORT-05, REPORT-UI-01, REPORT-UI-02, REPORT-UI-03, REPORT-UI-04, REPORT-UI-05
**Success Criteria** (what must be TRUE):
  1. `GET /api/reports/years` returns the full set of years that have any `page_stat` rows, sorted descending, and `GET /api/reports/yearly?year=YYYY` returns the documented JSON shape (totals, genre breakdown, nationality breakdown, publication-decade histogram, original-language breakdown, `coverage` block) for any year that endpoint exposes.
  2. A book counts in `total_books` for year Y only when ≥95% of its pages were reached by the end of Y in the configured timezone; aggregate `total_pages` and `total_read_time` always reflect ALL reading in Y regardless of completion (verifiable by a fixture with a 50%-read book that counts in time totals but not book totals).
  3. Every breakdown returned by the API includes an explicit `Unknown` bucket for books missing that field; the bucket is never silently dropped or renormalized away, and `coverage` reports `known_books / total_books` for each chart.
  4. Visiting `/reports/yearly` in the web app shows a year `Select` populated from the years endpoint, charts re-render when the year changes, and the selected year persists in the URL query string across reloads.
  5. Each chart on the page renders a coverage banner ("Genres known for N of M books read this year"), and a year with zero reading or zero enriched books renders an empty-state placeholder linking to the unmatched inbox rather than a broken chart.
**UI hint**: yes
**Plans**: TBD

## Parallelization

`config.parallelization = true`. Phase dependencies allow the following execution waves:

- **Wave 1 (sequential):** Phase 1 — blocks everything; nothing else can start until schema and provenance land.
- **Wave 2 (parallel):** Phase 2 and Phase 3 — both depend only on Phase 1 and touch disjoint code paths (`apps/server/src/genres/` + `apps/server/src/enrichment/genre-mapping.ts` for Phase 2; `apps/server/src/open-library/` for Phase 3). They can be planned and executed concurrently.
- **Wave 3 (sequential):** Phase 4 — joins the outputs of Phase 2 and Phase 3; cannot start until both are merged.
- **Wave 4 (sequential):** Phase 5 — depends on Phase 4 so the manual-edit "respect locks" behavior has real meaning to test.
- **Wave 5 (sequential, but can begin backend work in parallel with Phase 5):** Phase 6 — backend (`reports-router`, `reports-service`, `reports-repository`, year-index migration) is independent of Phase 5 and can be developed alongside it; the Phase 6 UI ships LAST so users encounter the unmatched inbox (Phase 5) before reports go live and dilute the experience with missing-data noise.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 (with 2+3 and 5+6-backend eligible for parallel work waves as noted above).

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Schema Foundations + Provenance | 0/TBD | Not started | - |
| 2. Canonical Genre Vocabulary | 0/TBD | Not started | - |
| 3. OpenLibrary + Wikidata Client | 0/TBD | Not started | - |
| 4. Enrichment Service + Backfill | 0/TBD | Not started | - |
| 5. Manual Edit + Unmatched Inbox | 0/TBD | Not started | - |
| 6. Yearly Report | 0/TBD | Not started | - |

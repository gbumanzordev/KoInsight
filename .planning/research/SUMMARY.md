# Research Summary

**Project:** KoInsight — Book Metadata Enrichment + Yearly Reports Milestone
**Domain:** Self-hosted reading analytics; OpenLibrary metadata enrichment; SQLite schema evolution; chart reporting
**Researched:** 2026-04-23
**Confidence:** HIGH

---

## Headline

This milestone extends KoInsight from a raw-stats dashboard to a library that knows *what kind of books* the user reads. It does so by enriching every book in the SQLite database with structured metadata from OpenLibrary (genres, authors as first-class entities with nationality, publication year, original language), then surfacing that metadata as a yearly report section inside the existing stats dashboard. The result must answer questions like "how many Japanese authors did I read in 2025?" or "what was my genre breakdown this year?" without requiring the user to hand-curate anything, while still giving them a clean escape hatch for books OpenLibrary gets wrong.

---

## Executive Summary

This is a metadata-enrichment pipeline built onto an existing Express 5 / Knex / SQLite / React 18 / Mantine 8 monorepo. The enrichment source is OpenLibrary only (free, no API key, already partially integrated). The recommended implementation follows a strict "enrich asynchronously, never on the sync path" pattern: new books arriving via KOReader sync are enqueued for background enrichment, and all pre-existing books are backfilled at boot time via an in-process rate-limited queue. No external scheduler, no Redis, no worker process.

The single most important design constraint is per-field provenance ("sticky manual edit" flag). Every enrichable field on a book must carry a source tag (`openlibrary | manual | plugin`). Enrichment is only allowed to overwrite fields where that tag is not `manual`. This is the Goodreads anti-pattern turned inside-out: instead of silently overwriting user corrections on re-sync (Goodreads' most-hated behavior), KoInsight's enricher must skip any field the user has touched. Without this, the manual edit UI is useless and user trust collapses within the first wrong OpenLibrary match.

The second critical constraint is author nationality sourcing. OpenLibrary's author JSON has no structured nationality field (verified against live API). The recommended path is: OpenLibrary author key -> `remote_ids.wikidata` -> Wikidata P27 (country of citizenship). This expands the data sources beyond "OpenLibrary only" as stated in PROJECT.md, and requires a deliberate decision from the user before planning locks. Nationality coverage will be incomplete; the "Unknown" bucket is a first-class report category, not a gap to hide.

---

## Recommended Stack Deltas

*This milestone only. The base stack (Express 5, Knex 3, better-sqlite3, React 18, Mantine 8, SWR, Recharts, Zod, Ramda, Vitest) is locked and unchanged.*

### Server additions

| Package | Version | Purpose |
|---|---|---|
| `bottleneck` | `^2.19.5` | Rate-limit OpenLibrary HTTP calls (CJS-compatible; the ESM-only alternatives cannot be `require()`d from this build) |

### Web additions

| Package | Version | Purpose |
|---|---|---|
| `@mantine/form` | `8.3.12` | Form state for manual metadata edit UI; first-party Mantine, no new paradigm |
| `mantine-form-zod-resolver` | `^1.3.0` | Bridge to existing Zod schemas; verify Zod 4 compat at install time |

### Explicitly NOT adding

- **BullMQ / Redis / ioredis** — this is a single-process SQLite app; queue is in-process via Bottleneck
- **p-queue >=7, p-limit >=4, ky, got >=12, node-fetch >=3** — all ESM-only; server is CJS (`tsconfig.json` `module: commonjs`)
- **Any npm OpenLibrary client** — all abandoned since 2017-2020; hand-roll fetch calls behind a typed service with Zod parsers
- **axios / got** — Node 22 native `fetch` is already in use in `open-library-service.ts`
- **node-cron** — backfill is a boot-time one-shot, not a repeating schedule; `setImmediate(() => BackfillService.run())` is sufficient
- **react-hook-form / Formik** — `@mantine/form` is the right fit; a third form paradigm would be noise
- **Chart.js / Victory / nivo** — Recharts 2.15.0 and `@mantine/charts` 8.3.12 are already installed; use them
- **Prisma / Drizzle / TypeORM** — Knex is the persistence layer; no second ORM
- **BISAC / ISBNdb / Goodreads genre taxonomies** — licensed or scrape-only; use a hand-curated `CANONICAL_GENRES` TS module

---

## Table-Stakes Features

These are required for the milestone to be coherent. Missing any one makes the reports section feel broken.

**Enrichment (required for reports to have data):**

- Auto-match on sync: ISBN-first lookup, fallback to title+author fuzzy search via `search.json`
- Work-vs-edition resolution: always resolve Edition -> Work; subjects and author links live on the Work
- Author as first-class entity: `author` table + `book_author` junction; multi-author support out of the box
- Publication year from `work.first_publish_date` (not edition `publish_date`, which is the reprint date)
- Original language from work-level data (not edition, which is the translation language)
- Canonical genre whitelist (~50-100 entries) mapped from OpenLibrary subjects; denylist for format/accessibility tags (`Accessible book`, `Protected DAISY`, `In library`) applied before whitelist
- Per-field provenance (`<field>_source` column: `openlibrary | manual | plugin`); enrichment skips `manual`-sourced fields
- `enrichment_status` on book (`unenriched | pending | enriched | failed | manual`)
- `enrichment_job` table with partial unique index on `(book_md5) WHERE status IN ('pending','running')` for idempotent enqueueing
- One-time backfill: enqueue all unenriched books at boot, drain via in-process queue, do NOT block server startup
- Unmatched-books inbox: filterable list of `metadata_status IN ('unmatched', 'match_needs_review')` sorted by most-recently-read
- Manual edit UI: editable fields include title, authors, genres, publication year, original language, author nationality (per author); genres via multi-select from whitelist (no free-text); author nationality via ISO 3166 dropdown only
- Re-match flow: pick from top-N OL search results; user-edited fields preserved through re-match
- Author nationality via OpenLibrary `remote_ids.wikidata` -> Wikidata P27; `unknown` is a valid first-class bucket

**Yearly reports (required for milestone value):**

- Year selector across any year with reading data (not current-year-only)
- Headline stats: total books, total pages, total read time
- Genre breakdown chart (horizontal bar, sorted by count; "Other" bucket for long tail)
- Author nationality breakdown chart (bar or donut, top-N + "Unknown" as explicit bucket)
- Publication-year distribution (decade-bucketed histogram, pre-aggregated server-side)
- Fiction vs nonfiction split (derived from genre whitelist tags)
- Books and pages per month timeline
- Coverage disclosure alongside every chart: "Based on N of M books where [field] is known"
- "Unknown" bucket always shown, never normalized out

---

## Differentiators In Scope

These are low marginal cost given what the milestone already builds, and set KoInsight apart from every mainstream tracker (none of which report author nationality at all):

- **Author nationality breakdown** — the flagship differentiator; no Goodreads, StoryGraph, or Hardcover equivalent
- **Original-language breakdown** ("you read N books translated from Japanese") — data is already collected; one extra chart
- **Translated vs original-language read** — derived; small feature, big signal for diverse-reading users
- **Provenance chips in the edit UI** (`[OL]` / `[Manual]` per field with source URL and timestamp) — differentiates from Goodreads' opaque overwrite behavior

---

## Anti-Features / Out-of-Scope

*These are named explicitly so they can be deferred with a recorded reason.*

| Feature | Reason |
|---|---|
| Shareable Wrapped-style image/slideshow | Requires image-rendering pipeline; UX-heavy; already in PROJECT.md Out-of-Scope |
| Author biography / author detail page | Author-centric UI is a future milestone; nationality column is sufficient for reporting |
| LLM / AI metadata enrichment | Non-deterministic, invents facts, costs per-book tokens; explicitly excluded in PROJECT.md |
| Google Books / second provider | Avoids API key management; revisit only if OL coverage proves inadequate |
| Reading goals | Orthogonal to enrichment |
| Social features / sharing | Self-hosted single-user; out of product scope |
| Mood / pace tagging | StoryGraph's differentiator; requires per-book subjective input; not derivable from OL |
| Gamification (streaks, badges) | Incompatible with KoInsight's "measure reality" ethos; also breaks on offline sync gaps |
| Silent metadata overwrite on re-sync | The Goodreads anti-pattern; never acceptable |
| Fractional nationality credit for co-authors | Non-integer charts confuse users; statistically meaningless; pick a counting rule and document it |
| Edition merging | Destructive and hard to undo; resolve to Work at ingest instead |
| "Read around the world" map view | Attractive but adds a GeoJSON dependency; defer to v1.x unless trivially cheap |

---

## Component Boundaries + Data Flow

The enrichment domain lives in a new `apps/server/src/enrichment/` vertical slice (router, service, queue, worker, repository) that orchestrates across three other slices: an extended `open-library/` (pure HTTP client with new `searchWork`, `getWork`, `getEdition`, `getAuthor` methods), a new `authors/` slice (author entity + book_author CRUD), and the existing `genres/` slice (activated, whitelist seeded). Reports live in a new `reports/` slice, separate from the existing `stats/` domain. The KOReader plugin contract is unchanged: it continues to POST `authors` as a plain string, the server stores it in `book.authors` (preserved as a denormalized display cache), and enrichment resolves the actual `book_author` junction rows asynchronously after the sync transaction commits. The manual edit UI goes through `books-service.updateMetadata`, which writes the field plus sets `<field>_source='manual'`; enrichment consults these source flags before touching any field.

See `.planning/research/ARCHITECTURE.md` for the full dependency graph, data-flow diagrams (sync-time path, backfill path), and complete API surface.

---

## Suggested Build Order

Each phase is a roadmap phase candidate. Order is dictated by hard dependencies.

1. **Schema foundations** — migrations creating `author`, `book_author`, `enrichment_job`, and new columns on `book` (`enrichment_status`, `*_source` fields, `publication_year`, `original_language`, `openlibrary_work_key`); data migration splitting `book.authors` string into `author` + `book_author` rows (pure string parsing, no network); new types in `packages/common/types`. Keep `book.authors` column intact as display cache. Everything downstream depends on these tables existing.

2. **Canonical genre list + mapping** — `canonical-genres.ts` TS constant; idempotent migration seeding `genre` table; `genre-mapping.ts` pure function with unit tests against real OL subject fixtures; denylist for format/accessibility tags. Testable in complete isolation from HTTP.

3. **OpenLibrary service extensions** — add `searchWork`, `getWork`, `getEdition`, `getAuthor` to `open-library-service.ts` with Zod-parsed response shapes; add User-Agent header (required for 3 req/s vs 1 req/s); Bottleneck rate limiter at `minTime: 400ms`. Pure HTTP layer; no DB writes; fully mockable.

4. **Authors slice** — `authors-repository`, `authors-service.findOrCreateByOpenLibraryKey` / `findOrCreateByName`; UNIQUE constraint on `openlibrary_key`, partial unique index on `(normalized_name, kind) WHERE openlibrary_key IS NULL`; no routes yet. Enrichment service calls this internally.

5. **Enrichment slice (queue + worker + service)** — `enrichment-repository` (job CRUD), `enrichment-queue` + `enrichment-worker` (Bottleneck, rate limiter, retry with exponential backoff on 429), `enrichment-service.enrichBook` wiring OL client + genre mapping + authors service + provenance enforcement; bootstrap logic in `app.ts` (reset `running -> pending`, enqueue all unenriched books, start worker, then `app.listen`); hook into `UploadService.uploadStatisticData` post-commit for new books. End-to-end enrichment works and backfill runs naturally on first deploy.

6. **Manual edit API + provenance enforcement** — `PATCH /api/books/:md5/metadata` (Zod-validated, writes fields + sets `_source='manual'`); `PATCH /api/authors/:id`; `POST /api/books/:md5/re-enrich` (admin, respects manual locks); `GET /api/books/:md5/enrichment`. Requires enrichment to exist first so "re-enrichment respecting locks" has real meaning.

7. **Manual edit web UI** — book detail page extension with `@mantine/form` + `mantine-form-zod-resolver`; `TagsInput` for authors, `MultiSelect` for genres (whitelist only), ISO 3166 dropdown for nationality; provenance chips (`[OL]` / `[Manual]`) per field; "Reset to OpenLibrary" button per field; unmatched-books inbox view with filter by `enrichment_status`.

8. **Reports slice** — `reports-repository` SQL aggregations (genre breakdown, nationality breakdown, publication-year histogram, totals) using compute-on-demand joins (no summary tables); `GET /api/reports/years`; `GET /api/reports/yearly/:year`; year-index migration (`idx_page_stat_start_time`, `idx_book_author_author_id`). Requires enriched data to produce meaningful output.

9. **Reports web UI** — new stats-dashboard section with year selector; genre bar chart, nationality bar/donut chart, publication-year histogram, fiction/nonfiction split, books/pages-per-month timeline; all using `@mantine/charts`; "Unknown" bucket always rendered; coverage disclosure on each chart.

---

## Top Pitfalls by Severity

*Each entry is a one-liner. The phase that primarily addresses it is in parentheses.*

**Critical (HIGH) — must prevent before launch:**

1. **Enrichment overwrites user manual edits** — per-field `_source` column enforced in enrichment service before any write; `manual` wins always. (schema + enrichment + edit-ui)
2. **Subjects on Edition, not Work** — always dereference Edition -> Work for subjects and author links; subjects from `/books/OLxxxM.json` are nearly always empty. (enrichment)
3. **Author nationality unavailable in OL author JSON** — `nationality` is not a field; go OpenLibrary author -> `remote_ids.wikidata` -> Wikidata P27; fall back to `unknown`, never guess. (enrichment)
4. **OL subject noise ("Accessible book", "Protected DAISY", "In library")** — explicit denylist applied before whitelist mapping; raw subjects stored for re-mapping without re-fetching. (enrichment + schema)
5. **Data backfill inside a Knex migration blocks server boot** — migrations contain only DDL (no network, no loops over all rows); backfill is a post-boot async worker. (schema + backfill)
6. **Internet Archive outage (Oct 2024 took OL down ~2 weeks)** — backfill never blocks `app.listen`; circuit breaker on N consecutive 5xx; `ENRICHMENT_ENABLED=false` env var for fully-offline installs. (backfill + ops)
7. **Silent junk match enriches with wrong book** — match-score threshold using title similarity + author token overlap; below threshold, mark `enrichment_status='low_confidence'`, write only cover/year, surface yellow warning in UI. (enrichment + edit-ui)
8. **Missing data skews report denominators** — "Unknown" bucket is mandatory in every nationality and genre chart; never normalize it out; show coverage count alongside every chart ("Based on N of M books"). (report)
9. **SQLite ALTER TABLE with inbound FKs triggers table-rebuild edge cases** — additive migrations only this milestone (ADD columns, no DROP on same migration); manage `PRAGMA foreign_keys` manually for any migration that must rebuild a table; `book_author.author_id` FK is `RESTRICT`, not `CASCADE`. (schema)
10. **CJS constraint: ESM-only packages cannot be required** — use `bottleneck@2.19.5` (CJS `main: lib/index.js`); never import p-queue 7+, p-limit 4+, ky, got 12+, node-fetch 3+. (all phases)

**Moderate (MEDIUM) — address before ship:**

11. **Duplicate author rows from concurrent backfill** — UNIQUE on `openlibrary_key`; partial unique index on `(normalized_name, kind) WHERE openlibrary_key IS NULL`; atomic upsert via `ON CONFLICT ... DO UPDATE RETURNING id`. (schema + backfill)
12. **Co-author nationality inflation in reports** — pick "primary author only" (position=0 in `book_author`) as the default counting rule; document it in chart tooltip; offer toggle. (schema + report)
13. **Year-boundary timezone bugs** — use user's local TZ for year bucketing, not UTC; document the "counts for year Y" rule (recommend: any session in Y). (report)
14. **Whitelist drift over time** — raw OL subjects stored per book so re-mapping is free when the whitelist is updated; expose admin view of most-common unmapped subjects. (schema + edit-ui)
15. **Non-English titles have high unmatched rate** — ISBN bypasses title search entirely; try title + language filter as fallback; document that non-English coverage is best-effort. (enrichment)

---

## Open Decisions Requiring User Input Before Planning Locks

These cannot be resolved by research alone. They need explicit answers before the roadmap can finalize task breakdown.

**1. Wikidata as a data source (HIGH priority)**

PROJECT.md states "OpenLibrary is the only permitted enrichment source." However, OpenLibrary's author JSON has no nationality field. The only structured nationality data reachable from OpenLibrary is via `remote_ids.wikidata` -> Wikidata P27. FEATURES.md and PITFALLS.md both recommend this pipeline. Three options:

- **Option A:** Allow Wikidata P27 lookup via OpenLibrary's `remote_ids.wikidata` link. Expands sources but avoids a separate API key and is the only way to get structured nationality data at scale. Recommended.
- **Option B:** Parse nationality from author bio free-text (unreliable, <2% of authors have bios, produces wrong answers that get persisted).
- **Option C:** Skip nationality entirely and remove author nationality charts from the milestone scope.

User must decide: Is Wikidata P27 lookup via OpenLibrary's existing `remote_ids.wikidata` field acceptable, or is the milestone scope limited strictly to openlibrary.org endpoints?

**2. Co-author nationality counting rule (MEDIUM priority)**

PROJECT.md deferred: "for co-authored books, report by primary author or by each contributor (decision deferred to planning)." Both FEATURES.md and PITFALLS.md flag this as a chart-correctness concern. Options:

- **Option A:** Primary author only (position=0 in `book_author` junction). Simplest; matches most user mental models.
- **Option B:** All co-authors each contribute their nationality once. More accurate for co-authored books; may confuse users when totals don't match book count.
- **Option C:** UI toggle between the two views.

User must decide: Which counting rule is the default, and is a toggle in scope for this milestone?

**3. Wikidata multi-citizenship resolution rule (LOW priority, but needed before enrichment service is coded)**

Wikidata P27 can return multiple citizenships for one author (e.g., Nabokov: Russia + USA; Ishiguro: UK + Japan). The service needs a deterministic rule. Recommended: pick the claim with no `end time` qualifier (current citizenship); if still multiple, pick the one with `preferred` rank; if still tied, store all and expose them in the override dropdown. The user should confirm this is acceptable behavior before implementation.

**4. "Counts as read" threshold for reports (LOW priority)**

A user who opens 40 books but finishes 12 will have a genre breakdown dominated by partial reads. PITFALLS.md recommends a configurable threshold (e.g., `progress >= 0.9` OR `total_read_time > 1h`). Should this be configurable in the UI, or a hardcoded server default? If configurable, what is the default?

---

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| Stack (server) | HIGH | CJS constraint verified against `tsconfig.json`; Bottleneck CJS confirmed via `npm view`; no form lib confirmed via `package.json` |
| Stack (web) | HIGH | `@mantine/form` version pin clear; `mantine-form-zod-resolver` Zod 4 compat is MEDIUM, verify at install time |
| Features | HIGH | Table-stakes list derived from Goodreads, StoryGraph, Calibre, Hardcover comparison; OL API limitations verified live |
| Architecture | HIGH | Follows existing vertical-slice conventions exactly; component boundaries are clear; data-flow diagrams complete |
| Pitfalls | HIGH | OL API quirks verified against live endpoints and official issue tracker; SQLite/Knex FK behavior verified against Knex issues; IA outage history verified via news sources |
| Nationality sourcing | MEDIUM | OL `remote_ids.wikidata` coverage is ~7% per skeptric dump analysis; Wikidata P27 semantics are clear but coverage is variable |
| Genre whitelist quality | MEDIUM | The ~50-100 entry list is not yet written; quality depends on curating against the OL subjects corpus |
| OL match rate | MEDIUM | KOReader sidecars frequently lack ISBN; title+author fuzzy match quality for non-English and obscure books is unknown until tested against real data |

**Overall confidence:** HIGH for architecture and stack decisions; MEDIUM for data-quality outcomes (nationality coverage, match rate, genre coverage) which are empirical and will only be known after backfill runs on a real library.

### Gaps to Address During Implementation

- **Genre whitelist content:** The whitelist must be drafted and reviewed before the enrichment phase is considered done. Build the mapping as a TS module so PRs are reviewable as code. Include unit tests against real OL subject fixtures captured during development.
- **Match-score threshold:** The specific similarity score cutoff for "low confidence" vs "accept match" needs calibration against a sample of real KOReader libraries. Treat the initial value as a tunable constant.
- **Non-English title match rate:** Test against a library with significant non-English content before closing the enrichment phase. May require adding a language-filter parameter to OL search queries.
- **`mantine-form-zod-resolver` Zod 4 compatibility:** Verify at install time; if incompatible, the fallback is a manually written resolver wrapping Zod 4's error format.

---

## Sources

### Primary (HIGH confidence)

- `https://openlibrary.org/developers/api` — rate limits, User-Agent policy, endpoint index
- `https://openlibrary.org/works/OL45804W.json` (live) — confirmed subjects live on Work, not Edition; `first_publish_date` unreliable
- `https://openlibrary.org/authors/OL23919A.json` (live) — confirmed no `nationality` field in author JSON
- `apps/server/tsconfig.json` + `apps/server/package.json` — confirmed CJS build target; confirmed no form library installed
- OpenLibrary GitHub issues #10851, #8534, #10585, #11611 — author disambiguation, rate limits, 429 behavior
- Knex GitHub issues #4155, #5367, #166 — SQLite ALTER TABLE / FK behavior
- `https://blog.archive.org/2024/10/21/internet-archive-services-update-2024-10-21/` — IA outage Oct 2024
- `https://skeptric.com/openlibrary-exploration/` — OL data dump analysis (bio coverage <2%, Wikidata links ~7%)
- `npm view bottleneck main` — confirmed CJS entry point at `lib/index.js`

### Secondary (MEDIUM confidence)

- StoryGraph roadmap (roadmap.thestorygraph.com) — feature expectations, competitor gaps
- Goodreads Librarians Group forums — real-world metadata pain points
- Calibre manual (manual.calibre-ebook.com) — gold standard for metadata edit UX patterns
- Wikidata P27 property documentation — citizenship claim semantics and rank handling

---

## Research File Pointers

- Full stack analysis (versions, anti-recommendations, code sketches): `.planning/research/STACK.md`
- Full feature analysis (competitor table, edge cases, UX flows): `.planning/research/FEATURES.md`
- Full architecture analysis (component boundaries, data-flow diagrams, API surface, type definitions): `.planning/research/ARCHITECTURE.md`
- Full pitfalls analysis (50+ pitfalls across 8 categories, recovery strategies, checklist): `.planning/research/PITFALLS.md`

---
*Research completed: 2026-04-23*
*Ready for roadmap: pending resolution of open decisions (Wikidata scope, co-author nationality rule)*

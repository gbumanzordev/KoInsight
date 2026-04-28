# KoInsight

## Current State

**Shipped:** v1.0 — Book Metadata Enrichment + Yearly Reports (2026-04-26).
6 phases, 35 plans, 13.6k LOC. The dashboard now answers "what kind of books" questions: genre breakdown, author nationality, publication decade, and original language for any year that has reading data. Manual edits are sticky against re-enrichment.

See `.planning/milestones/v1.0-ROADMAP.md` and `.planning/v1.0-MILESTONE-AUDIT.md` for the full record.

## Current Milestone: v1.1 Enrichment Polish & Cleanup

**Goal:** Pay down v1.0 carry-over debt and polish the enrichment pipeline so the dashboard runs on clean, complete data without workarounds.

**Target features:**
- Enrichment writes `book.reference_pages` from OL Edition data (drop the yearly-report COALESCE workaround).
- Bulk-retry helper / smarter matcher for books currently in `enrichment_status='failed'`.
- Orphan author garbage collection.
- Polish: bulk enqueue helper, dependency pin convention cleanup, larger-bundle code-splitting.

## What This Is

KoInsight is a self-hostable dashboard for KOReader reading statistics. A KOReader Lua plugin pushes per-session stats and annotations to an Express/SQLite server, and a React/Mantine web app visualizes a reader's library and reading behavior.

This milestone extends the product from "what you read and when" to "what *kind* of books you read": enriching each book with canonical metadata (genres, authors as entities with nationality, publication info) so the stats dashboard can answer questions like "how many Japanese authors did I read this year?" or "what's my genre breakdown for 2025?".

## Core Value

Every book in a user's library has trustworthy, query-friendly metadata so the dashboard can produce meaningful yearly breakdowns by genre and author nationality without the user hand-curating anything.

## Requirements

### Validated

<!-- Existing capabilities inferred from codebase. Shipped in prior milestones. -->

- ✓ KOReader plugin syncs reading stats and annotations to server — existing
- ✓ SQLite (Knex) persistence for books, page_stat, annotations, devices, progress, users — existing
- ✓ kosync-compatible HTTP API mounted at root for KOReader clients — existing
- ✓ Web dashboard shows per-book and aggregate reading stats via SWR — existing
- ✓ OpenLibrary integration for book cover fetching — existing
- ✓ OpenAI-backed `/api/ai` endpoint scaffold — existing
- ✓ Genre + book_genre tables exist but are unused scaffolding — existing (to be activated)

### Active

<!-- Milestone: Book Metadata Enrichment + Yearly Reports. Hypotheses until shipped. -->

- [ ] Introduce `author` entity table with name, nationality, openlibrary_key, and bio; migrate book→authors string into a `book_author` junction
- [ ] Enrich books from OpenLibrary on sync: resolve openlibrary work/edition, populate publication year, original language, canonical genres, authors, author nationalities
- [ ] Curate a canonical genre whitelist (~50-100 entries) and a mapping ruleset from OpenLibrary subjects to canonical genres; store the canonical set in `genre` / `book_genre`
- [ ] One-time backfill job that auto-runs on deploy to enrich all pre-existing books in the database
- [ ] Manual metadata edit UI in the web app for books where OpenLibrary match failed or was wrong (edit title, authors/author links, genres, publication year, nationality overrides)
- [ ] Flag unenriched / match-failed books so the user can find and fix them from the dashboard
- [ ] Yearly report: new section of the stats dashboard with a year selector (any year with reading data) that charts genre breakdown, author nationality breakdown, publication-year distribution, and similar aggregates derived from the enriched data

### Out of Scope

- LLM-based enrichment (e.g., using the existing `/api/ai` route to infer metadata) — user explicitly chose OpenLibrary as the single source to keep enrichment deterministic and free of per-book token cost
- Google Books / additional metadata providers — avoid second integration and API key management in this milestone; revisit only if OpenLibrary coverage proves inadequate
- Wikidata for any field other than author nationality — Wikidata is added narrowly as a downstream of OpenLibrary (followed only when an OL author has a `remote_ids.wikidata` link, exclusively to populate `nationality`). We deliberately do NOT use Wikidata for genres, pub year, or anything else even though it has those fields; OpenLibrary remains the sole source for everything except author nationality
- Spotify-Wrapped-style shareable image/slideshow report — deferred; minimum-viable report lives inside the existing stats dashboard to reuse chart/UI patterns
- Shareable public report links — not requested; all reports remain behind the authenticated dashboard
- Author-level biographical pages or browsable author index — nationality column is enough for reporting; a full author-centric UI is a future milestone
- BISAC or other commercial taxonomy licensing — canonical genre list is hand-curated from OpenLibrary subjects
- Multi-author nationality weighting in reports — for co-authored books, the nationality breakdown counts the primary author only (the first entry in `book_author`, position=0). No fractional-credit scheme, no per-contributor inflation, no UI toggle this milestone.
- "Currently reading" / partial-read books in the yearly report — a book counts as "read in year Y" only when ≥95% of its pages were read by the end of Y. Sampled-and-abandoned books are excluded from book-count metrics (page-time totals are unaffected).

## Context

**Existing architecture** (see `.planning/codebase/`):

- Monorepo: `apps/server` (Express 5 + Knex + better-sqlite3), `apps/web` (React 18 + Vite + Mantine + SWR), `packages/common` (shared types), `plugins/koinsight.koplugin` (Lua).
- Strict vertical slicing on the server: each domain owns router/service/repository under `apps/server/src/<domain>/`.
- Shared types live in `packages/common/types` and are imported as `@koinsight/common/types/*` from both apps.
- Migrations run on server boot. SQLite file lives at `${DATA_PATH}/dev.db` or `prod.db`.
- OpenLibrary is already integrated in `apps/server/src/open-library/` but currently only for covers. The `openlibrary-service` will need to grow work/edition/subject/author lookups.
- `genre` and `book_genre` tables already exist from a 2025-04 migration; routes/UI/ingestion were never wired up. Activating them is part of this milestone.
- Book currently has authors as a single denormalized string. Moving to an author entity is a breaking schema change that requires a data migration for existing rows.

**Prior user feedback / known issues:** None recorded; this milestone is driven by the maintainer's own desire for richer end-of-year reporting.

## Constraints

- **Tech stack**: Must stay on Express 5 / Knex / SQLite / React 18 / Mantine. No new database engine. Any new service must follow the existing router/service/repository pattern.
- **Node / tooling**: Node >=22, npm 10.2.4 (root `engines` / `packageManager`). Turbo orchestrates builds; migrations must continue to build via the separate `tsconfig.migrations.json`.
- **External dependencies**: OpenLibrary is the primary enrichment source. Wikidata is used narrowly as a downstream of OpenLibrary, called only to populate author nationality (P27) when an OL author exposes a `remote_ids.wikidata` link. No API keys required, but both endpoints must respect fair-use rate limits and identify themselves with a `User-Agent` during sync and backfill.
- **Validation**: Zod is the server-side validation library; use it at route boundaries for the new metadata edit and report endpoints.
- **Formatting**: Prettier-only. Format before commit.
- **Compatibility**: The KOReader plugin contract (`/api/plugin/*`) and kosync endpoints must not regress. Schema changes to `book` must remain compatible with the plugin's bulk sync payload.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Enriched data ships before rich reports | User chose "enriched data first" in discovery; reports are a natural downstream consumer and first report is in-scope but scoped as a stats section, not a standalone product | — Pending |
| Primary enrichment source: OpenLibrary; Wikidata for nationality only | Free, deterministic, no API keys; OL author records lack any `nationality` field, and Wikidata P27 followed via OL `remote_ids.wikidata` is the only structured path. LLM and parsing-from-bio paths rejected (cost / noise) | — Pending |
| Co-author nationality counted as primary author only | Position=0 in `book_author`. Avoids inflated denominators in nationality charts; UI toggle deferred to a future milestone | — Pending |
| 95% pages read = "book read" for yearly counts | Hardcoded threshold; standard tracker default. Page-time totals always include all reading regardless of completion | — Pending |
| Full `author` entity + `book_author` junction | Nationality requires treating authors as entities; co-author support falls out for free; denormalized shortcut rejected to avoid duplicating nationality per title | — Pending |
| Curated genre whitelist on ingest (not raw storage) | OpenLibrary subjects are noisy (50+ tags per book including marketing labels); a hand-curated canonical list keeps reports clean | — Pending |
| Auto-enrich on sync + one-time backfill on deploy | User wants zero manual effort for new books and existing library; backfill runs opportunistically after migration | — Pending |
| Manual metadata edit UI in this milestone | Without it, bad/missing OpenLibrary matches leave users with no recourse and distort reports | — Pending |
| Yearly report as stats-dashboard section with year selector | Reuses existing Mantine/Recharts patterns; any year with data is viewable; delightful Wrapped-style UX deferred to future milestone | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-26 — milestone v1.1 (Enrichment Polish & Cleanup) opened*

# Phase 2: Canonical Genre Vocabulary - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 delivers three things and only three things:

1. A single TypeScript constant, `CANONICAL_GENRES`, that is the source of truth for canonical genre names (~60-80 entries, Title Case, flat).
2. An idempotent Knex migration that inserts every `CANONICAL_GENRES` entry into the existing `genre` table via INSERT OR IGNORE (or equivalent). Re-running the migration is a no-op. Structure-only in the SCHEMA-07 sense: no network calls, no row iteration over `book`.
3. A pure function `mapOpenLibrarySubjects(subjects: string[]): CanonicalGenre[]` that takes raw OpenLibrary subject strings and returns canonical genre entries, with a documented alias map and a documented denylist of marketing/format tags. At least 20 unit tests covering real OL subject lists (all-noise, no-canonical-match, multi-genre, compound subjects).

Out of scope for Phase 2:
- HTTP calls to OpenLibrary (Phase 3).
- The enrichment worker that actually calls `mapOpenLibrarySubjects` and writes `book_genre` rows (Phase 4).
- Any schema change to `genre`, `book_genre`, or `book` (Phase 1 already added `genres_source`; everything else is pre-existing).
- UI for genre selection (Phase 5).

Phase 1 invariants still hold here:
- `*_source = NULL` means "never touched"; `genres_source = 'openlibrary'` with an empty `book_genre` set is a valid enriched state (GENRE-04). Phase 2 does not persist anything to `book_genre`; it only defines the function whose output Phase 4 will persist.
- Migrations in this phase stay structure-only in the SCHEMA-07 sense: the seed migration writes a fixed literal list to `genre`, which is not row-iteration over `book` and involves no external data.

</domain>

<decisions>
## Implementation Decisions

### Canonical List Source + Taxonomy

- **D-01:** `CANONICAL_GENRES` is hand-curated. Starting point: a frequency scan of OpenLibrary subjects across the kind of books KoInsight users actually read (fiction-heavy: fantasy, sci-fi, mystery, literary, historical; plus a pragmatic non-fiction tail: history, biography, science, philosophy, technology). The goal is coverage of what real books will hit, not exhaustive taxonomy.
- **D-02:** Target size is **60-80 entries**. Large enough that yearly reports get distinct "Epic Fantasy" vs "Space Opera" slices; small enough to avoid long-tail 1-book buckets. If the planner/researcher ends up recommending 55 or 85 after the curation pass, that's fine, treat it as Claude's discretion.
- **D-03:** Entries are stored in **Title Case** (e.g., "Science Fiction", "Epic Fantasy", "Historical Fiction"). This matches the existing dev seed (`06_genres.ts`) and the existing `genre.name` column values. No separate slug/identifier column.
- **D-04:** **Flat list** — no parent/child relationships, no `parent_id` column, no hierarchy table. `genre` schema stays `(id, name UNIQUE)`. "Epic Fantasy" and "Fantasy" coexist as peers; if `mapOpenLibrarySubjects` yields both, both get returned, both get persisted. Yearly-report rollups will be handled at query time in Phase 6, not at schema level.
- **D-05:** Language: English names only in Phase 2. Non-English OL subjects that map cleanly to an English canonical (e.g., "Science-fiction française" → "Science Fiction") go through the alias map; ones that don't are dropped.
- **D-06:** Scope of genre, not format: the canonical list describes *what a book is about* (Fantasy, Biography, Philosophy), never a physical or distribution format. "Graphic Novels" and "Comics" count as genre (about form/content), but "Large type books", "Audiobook", "Protected DAISY", "Accessible book", and similar belong in the denylist, not the canonical list.

### Mapping Ruleset (Claude's Discretion, with these anchors)

User deferred detailed ruleset design. Researcher/planner should land on the simplest deterministic approach that passes the 20-test bar, anchored by:

- **D-07:** The function is pure and synchronous. It takes `string[]` and returns an array of canonical entries from the TS constant (not DB rows with `id`). No database access inside the function. Callers (Phase 4 enrichment writer) do the `name -> genre_id` lookup when persisting to `book_genre`.
- **D-08:** Match is case-insensitive and whitespace-normalized. Build a lookup key with `s.trim().toLowerCase().replace(/\s+/g, ' ')`. Compare against the same normalization of canonical names and of alias keys.
- **D-09:** An **alias map** handles common variants (`"sci-fi"`, `"sf"`, `"science-fiction"` → "Science Fiction"; `"ya"` → "Young Adult"; `"nonfiction"`, `"non-fiction"` → whatever canonical tail covers it). The alias map is a plain TS object literal, maintained alongside the canonical list.
- **D-10:** Compound subjects (e.g., `"Science fiction -- Juvenile fiction"`, `"Fantasy fiction, American"`) are split on ` -- ` and `, ` and each fragment is mapped independently; all resulting canonicals are unioned. If the fragment is in the denylist it's dropped; if it has no canonical match it's dropped silently.
- **D-11:** A raw OL subject may map to multiple canonical genres (e.g., "Space opera" mapping to both "Science Fiction" and "Space Opera" is OK if both are on the canonical list). Output is de-duplicated by canonical name, order-preserved by first hit.
- **D-12:** Zero-match is a valid outcome, not an error. If every subject is either denylisted or has no alias, the function returns `[]`. Phase 4 will persist that as `genres_source = 'openlibrary'` with no `book_genre` rows (GENRE-04).

### Denylist Policy (Claude's Discretion, with these anchors)

- **D-13:** The denylist is a **hard Set of strings** (normalized form), not regex patterns. This keeps the file auditable and the behavior easy to test. Known entries at minimum: `"Accessible book"`, `"Protected DAISY"`, `"Large type books"`, `"In library"`, `"New York Times bestseller"`, `"Overdrive"`, `"Book club edition"`, `"Fiction"` (too broad to carry information), `"Nonfiction"` (same). Researcher should flesh out the complete list from a scan of real OL subjects.
- **D-14:** The denylist lives in the same module as `CANONICAL_GENRES` and the alias map. Adding an entry is a one-line code edit plus a unit test; no schema change, no seed change, no migration. It is fine that growing the denylist does not trigger a re-enrichment — Phase 4's re-enrichment semantics handle that when a book is re-enriched.
- **D-15:** Denylist matching is case-insensitive + whitespace-normalized (same key function as D-08). Exact normalized match only; no substring matching to avoid accidental filters (e.g., denying `"book"` would nuke everything).

### Module Layout + Seed Strategy (Claude's Discretion, with these anchors)

- **D-16:** `CANONICAL_GENRES`, the alias map, the denylist, and `mapOpenLibrarySubjects` all live in a new single-purpose module. Strongest candidate location: `packages/common/genres/` (exported via `@koinsight/common/genres`). Rationale: the canonical list is needed both server-side (Phase 4 enrichment, Phase 2 seed migration) and client-side (Phase 5 edit-form `MultiSelect` constrained to the canonical list). Pure TypeScript only; no Node/browser-specific APIs.
- **D-17:** Export `type CanonicalGenre = typeof CANONICAL_GENRES[number];` so downstream code gets compile-time string-literal safety where it matters. Exported names: `CANONICAL_GENRES`, `GENRE_ALIASES`, `SUBJECT_DENYLIST`, `mapOpenLibrarySubjects`, `CanonicalGenre`.
- **D-18:** **Seed mechanism is an idempotent Knex migration** (SCHEMA-06). Uses `INSERT OR IGNORE INTO genre(name) VALUES (...)` over the literal `CANONICAL_GENRES` list. Re-running the migration is a no-op (verified by running migrate:latest twice on a fresh DB and snapshot-diffing the `genre` table). The migration file imports `CANONICAL_GENRES` from `@koinsight/common/genres` so the list has exactly one source of truth.
- **D-19:** The existing dev seed `apps/server/src/db/seeds/06_genres.ts` keeps its ad-hoc `BOOK_GENRE_MAPPING` for linking fake books to genres in dev, but its `GENRES` array is replaced by a direct read from `CANONICAL_GENRES` (no more duplicated genre names). Dev seed stops owning the canonical list.
- **D-20:** The migration runs `INSERT OR IGNORE`, not `DELETE + INSERT`. That preserves any user-added or hand-edited rows in `genre` and, more importantly, preserves any existing `book_genre` FKs. If a canonical name is later *removed* from `CANONICAL_GENRES`, the corresponding `genre` row is NOT deleted by this migration; removal of obsolete genres is out of scope for Phase 2 and can be handled later if it ever matters.

### Claude's Discretion

- Exact final contents of `CANONICAL_GENRES` (subject to size 60-80, Title Case, flat, fiction-leaning anchors from D-01).
- Exact final contents of `GENRE_ALIASES` and `SUBJECT_DENYLIST` (anchored by D-09, D-13).
- Precise file layout inside `packages/common/genres/` — single `index.ts` vs split (`canonical.ts`, `aliases.ts`, `denylist.ts`, `map.ts`). Researcher/planner picks.
- Migration timestamp and filename (follow Phase 1 convention: `YYYYMMDDHHMMSS_seed_canonical_genres.ts`).
- Whether `CANONICAL_GENRES` is a `readonly` tuple vs a plain `const` array (tuple gives a better `CanonicalGenre` literal type; pick whichever the planner finds cleanest).
- Test file location and name (follow apps/server convention — co-located vitest file next to `map.ts`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` — Phase 2 block (Goal, Depends on, Requirements, Success Criteria).
- `.planning/REQUIREMENTS.md` — SCHEMA-06, GENRE-01, GENRE-02, GENRE-03, GENRE-04.
- `.planning/PROJECT.md` — core value and yearly-report downstream consumer.

### Prior phase context (locked decisions that affect Phase 2)
- `.planning/phases/01-schema-foundations-provenance/01-CONTEXT.md` — `genres_source` semantics (D-13..D-15), SCHEMA-07 migration invariant (D-02), existing `*_source` CHECK constraint values (`openlibrary` | `manual`).
- `.planning/phases/01-schema-foundations-provenance/01-05-SUMMARY.md` — confirms `book.genres_source` landed with the expected shape.

### Existing schema that Phase 2 builds on (do NOT re-create)
- `apps/server/src/db/migrations/20250403145503_create_genre_table.ts` — `genre(id, name UNIQUE)`.
- `apps/server/src/db/migrations/20250403145555_create_book_genre_table.ts` — `book_genre(book_id/book_md5, genre_id, UNIQUE(book, genre))`.
- `apps/server/src/db/migrations/20250412161907_use_book_md5_as_foreign_key.ts` — `book_genre` migrated to `book_md5` FK.

### Existing genre code to refactor or reuse
- `apps/server/src/db/seeds/06_genres.ts` — ad-hoc dev seed that owns a 14-genre list today; D-19 says its `GENRES` array is replaced by a read from `CANONICAL_GENRES`.
- `apps/server/src/genres/genre-repository.ts` — book-genre lookup by md5; unchanged by Phase 2 but read to understand the persistence shape Phase 4 will target.
- `apps/server/src/books/books-repository.ts` — read of `book_genre` JOIN `genre` in `list` and `getByMd5`; unchanged by Phase 2.

### Convention anchors
- `CLAUDE.md` — repo conventions (Prettier, workspaces, Zod at route boundaries, plain ASCII, no em-dashes).
- `apps/server/src/db/migrations/20260423221700_backfill_book_authors.ts` — closest existing template for an idempotent-ish data migration (backfill uses a transaction; the genre seed migration can be simpler because it's pure INSERT OR IGNORE over a literal list).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `genre` / `book_genre` tables already exist and are used in production queries — Phase 2 only seeds `genre`, touches nothing else.
- `apps/server/src/db/factories/genre-factory.ts` exists for test scaffolding (used by dev seed); still useful for unit tests.
- `@koinsight/common` workspace already set up as the shared-types home (Phase 1 added `author.ts` and `enrichment.ts`); adding a `genres/` subfolder follows the same pattern.

### Established Patterns
- Migrations use Knex; naming convention `YYYYMMDDHHMMSS_<snake_case>.ts` (Phase 1 added 4 migrations following this).
- Tests are vitest; co-located next to source as `*.test.ts` (e.g., `parse-authors.test.ts` from 01-01).
- Pure helper style: `apps/server/src/db/migrations/helpers/parse-authors.ts` is the closest analog to `mapOpenLibrarySubjects` — deterministic, no I/O, heavy unit-test coverage.

### Integration Points
- `CANONICAL_GENRES` will be imported by:
  - Phase 2 seed migration (writing to `genre`).
  - Phase 2 dev seed refactor (`06_genres.ts`).
  - Phase 4 enrichment writer (when calling `mapOpenLibrarySubjects` and persisting `book_genre`).
  - Phase 5 web UI genre `MultiSelect` (constraining manual edits to the canonical list).
- `mapOpenLibrarySubjects` is imported by:
  - Phase 4 enrichment worker only (server-side).
  - Phase 2 unit tests (GENRE-03).

</code_context>

<specifics>
## Specific Ideas

- Mapping function signature is locked: `mapOpenLibrarySubjects(subjects: string[]): CanonicalGenre[]` (pure, synchronous, no DB).
- Denylist includes at minimum: `Accessible book`, `Protected DAISY`, `Large type books`, `In library`, `New York Times bestseller`, `Overdrive`, `Book club edition`, `Fiction`, `Nonfiction` (too broad to be useful). Full list is Claude's discretion per D-13.
- Alias map includes at minimum: `sci-fi`, `sf`, `science-fiction` → `Science Fiction`; `ya` → `Young Adult`. Full list is Claude's discretion per D-09.
- 20-test minimum for GENRE-03 is a floor, not a ceiling. Researcher should pull a handful of real OL subject arrays from well-known books (e.g., Foundation, The Martian, The Fellowship of the Ring) and fixture them into tests.

</specifics>

<deferred>
## Deferred Ideas

- Genre hierarchy / parent-child rollups ("Epic Fantasy rolls up to Fantasy") — useful for Phase 6 yearly report, but can be done at query time without schema change. Revisit if Phase 6 planning finds aggregation queries too painful.
- Non-English canonical names and multi-lingual display — deferred indefinitely; single-user self-hosted app, English-only UI.
- Automatic pruning of obsolete `genre` rows when `CANONICAL_GENRES` shrinks — not needed this milestone; INSERT OR IGNORE only grows the table.
- Moving the denylist to a config file or admin UI — not needed while it's a code-edit-and-ship flow.

</deferred>

---

*Phase: 02-canonical-genre-vocabulary*
*Context gathered: 2026-04-23*

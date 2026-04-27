# Phase 1: Schema Foundations + Provenance - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Land every table, column, and shared type that the rest of the milestone depends on, with per-field `*_source` provenance columns in place BEFORE any enrichment can run. All migrations are structure-only (no network calls, no row iteration over `book` except the one deterministic author string-split backfill). Phase 1 delivers schema + shared types only; no service code, no HTTP client, no UI.

Scope anchors (from ROADMAP.md + REQUIREMENTS.md, already locked):
- New tables: `author`, `book_author`, `enrichment_job`
- New `book` columns: `enrichment_status`, `openlibrary_work_key`, `publication_year`, `original_language`, and `authors_source` / `genres_source` / `publication_year_source` / `original_language_source`
- `book.authors` text column preserved verbatim as a denormalized display cache (KOReader plugin contract unchanged)
- `book_author` junction with `position` (0 = primary) and `role` (`author` | `editor`; translators excluded at ingest)
- `enrichment_job`: partial unique index ensuring at most one open job per `book_md5`
- Shared types exported from `@koinsight/common`: `Author`, `BookAuthor`, `EnrichmentJob`, `EnrichmentStatus`, `FieldSource`, and the extended `Book`

</domain>

<decisions>
## Implementation Decisions

### Migration Layout

- **D-01:** Phase 1 schema lands as **four focused Knex migrations**, in this order:
  1. `create_author_and_book_author` — `author` table + `book_author` junction + indexes.
  2. `create_enrichment_job` — `enrichment_job` table + partial unique index (one open job per `book_md5`).
  3. `extend_book_columns` — add `enrichment_status`, `openlibrary_work_key`, `publication_year`, `original_language`, and the four `*_source` columns to `book`.
  4. `backfill_book_authors` — **data-only** migration that iterates `book.authors` strings and inserts into `author` + `book_author`. No schema changes in this file.
- **D-02:** SCHEMA-07 invariant: migrations 1–3 contain zero row iteration over `book`. The structure-only grep test (`fetch(`, `axios`, `https://`, row-loops over `book`) MUST return nothing against migrations 1–3. Migration 4 is the ONLY file allowed to iterate `book`, and its only data sources are the existing `book.authors` string plus deterministic parsing — no network calls.

### Author Backfill Parser (for migration 4 only)

- **D-03:** Split `book.authors` on the regex `/\s*(?:&|;|,|\band\b)\s*/i`. Trim each segment and collapse internal whitespace with `replace(/\s+/g, ' ')`. Periods inside a token are NOT separators (`J.R.R. Tolkien` stays intact). `and` matches as a whole word only (so `Ayn Rand` is not broken).
- **D-04:** LN-FN heuristic: when the original string contains ONLY commas as separators (no `&`, `;`, or `and`) AND splitting yields exactly 2 segments, flip to `First Last` form. Examples: `Strunk, William` → `William Strunk`; `Tolkien, J.R.R.` → `J.R.R. Tolkien`. Strings with any other separator (`Smith & Jones`, `A, B, C`, `Smith and Jones`) are never flipped.
- **D-05:** Suffix whitelist merge: after comma-splitting, if any segment matches the suffix whitelist `{Jr., Sr., II, III, IV, PhD, MD}` (case-insensitive, trailing period optional), merge that segment back onto the preceding segment with a single space. Example: `Strunk, Jr., William` → `[Strunk Jr., William]`. This runs BEFORE the D-04 LN-FN flip so `Strunk Jr., William` (now 2 segments) still flips correctly to `William Strunk Jr.`.
- **D-06:** Suspicious-segment handling: after trim and whitespace normalization, drop any segment that is empty, whitespace-only, a single non-letter character, or pure punctuation. Remaining authors get contiguous `position` values (0, 1, 2, ...) with no gaps. The original `book.authors` string is preserved verbatim in the `book` table regardless of what the parser drops.
- **D-07:** Deterministic: the parser is a pure function of the input string. No locale-dependent casing, no Unicode folding, no external data. Unit tests cover at minimum: single author, `&`-separated, `;`-separated, `,`-separated multi-author, `Last, First` pair, `Last, Initials` pair, suffix-in-middle (`Strunk, Jr., William`), trailing separator, empty input, pure-punctuation input.

### Author Identity + Dedup

- **D-08:** `author.name` is stored verbatim as the display name (case and punctuation as parsed). The `author` table has `UNIQUE(name)` at the schema level, matching the existing `genre` table pattern.
- **D-09:** During backfill, lookup-before-insert uses a normalized dedup key computed in application code: `name.trim().replace(/\s+/g, ' ').toLowerCase()`. This means `tolkien` and `Tolkien` dedupe; `J.K. Rowling` and `J. K. Rowling` do NOT dedupe (different internal punctuation). No `normalized_name` column is added to the schema; dedup is app-layer only, schema UNIQUE(name) is the backstop.
- **D-10:** No Unicode folding / diacritic stripping in Phase 1. `Umberto Eco` and `Úmberto Eco` remain separate authors.
- **D-11:** `author.openlibrary_key` gets a partial UNIQUE index (`WHERE openlibrary_key IS NOT NULL`). This enforces "OL key is authoritative identity when present" at the schema level.
- **D-12:** Phase 1 does NOT merge duplicate authors based on OL key — Phase 1 only has names, not OL keys. Phase 4 enrichment is responsible for detecting two same-OL-key author rows and merging. Note this explicitly in CONTEXT.md so the Phase 4 planner picks it up (see Deferred Ideas below — cross-phase note).

### Defaults for Pre-existing Rows

- **D-13:** The `book.enrichment_status` column is added with CHECK constraint on values `{'pending', 'running', 'enriched', 'failed', 'skipped'}` and is backfilled to `'pending'` for every pre-existing row (either via column default on add, or a structure-safe `UPDATE book SET enrichment_status = 'pending' WHERE enrichment_status IS NULL` inside migration 3). This makes Phase 4's bootstrap query trivial: `WHERE enrichment_status = 'pending'`. No `NULL` handling needed downstream.
- **D-14:** All four `*_source` columns (`authors_source`, `genres_source`, `publication_year_source`, `original_language_source`) are nullable with no default and no backfill. `NULL` means "never touched by a provenance-aware write" — neither enrichment nor manual edit has owned this field yet. Only `'openlibrary'` and `'manual'` are valid non-null values.
- **D-15:** Semantics of `NULL` in `*_source`: enrichment is ALLOWED to overwrite a field with `*_source = NULL` (that is the bootstrap path for existing rows). Enrichment is NEVER allowed to overwrite a field with `*_source = 'manual'`. Manual-edit is ALWAYS allowed to overwrite and always sets `*_source = 'manual'`. These semantics are the core contract Phase 4 consumes.
- **D-16:** `openlibrary_work_key`, `publication_year`, and `original_language` are nullable with no default and no backfill.

### Shared Types Layout (`packages/common/types/`)

- **D-17:** New file `packages/common/types/author.ts` exports: `Author`, `BookAuthor`, `FieldSource` (`'openlibrary' | 'manual'`), and the `AuthorRole` union (`'author' | 'editor'`).
- **D-18:** New file `packages/common/types/enrichment.ts` exports: `EnrichmentJob` and `EnrichmentStatus` (the book-level status union `'pending' | 'running' | 'enriched' | 'failed' | 'skipped'`). The job-level status union is also exported if it differs from the book-level one (per SCHEMA-05: `'pending' | 'running' | 'succeeded' | 'failed'`), named `EnrichmentJobStatus` to avoid a name collision.
- **D-19:** Extend `packages/common/types/book.ts` in place: add the new fields to `DbBook` and `Book` with nullable types matching the DB. DO NOT touch `KoReaderBook` — that type mirrors the KOReader plugin payload and its contract is preserved (SCHEMA-03).
- **D-20:** `packages/common/types/index.ts` re-exports the new `author.ts` and `enrichment.ts` modules so consumers can import from `@koinsight/common` root.
- **D-21:** No separate `EnrichedBook` alias type in Phase 1. `Book` carries the new enrichment fields directly; downstream code handles them as nullable.

### Claude's Discretion

- Exact Knex column builder calls (`table.text` vs `table.string(N)`, `table.integer`, `table.timestamps`) — follow the existing migration style (see `create_book_table.ts`, `create_genre_table.ts`).
- Exact file naming timestamps for the new migrations — follow existing `YYYYMMDDHHMMSS_*.ts` convention.
- Index names — follow Knex defaults unless they conflict, in which case use explicit `{table}_{column}_idx` / `{table}_{column}_unique`.
- Whether to use `CHECK` constraints vs TypeScript-only enums for `enrichment_status`, `role`, `*_source` — prefer CHECK constraints where SQLite supports them cleanly; otherwise rely on Zod at write boundaries.
- Whether the UPDATE-to-'pending' in D-13 runs as a second statement in migration 3 or as the column default — either is fine as long as migration 3 stays a structure-only DDL file (no row-loop over `book`; a single deterministic UPDATE with a literal is acceptable because it does not iterate row-by-row and involves no external data).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` — Phase 1 block (Goal, Depends on, Requirements, Success Criteria)
- `.planning/REQUIREMENTS.md` §Schema — SCHEMA-01 through SCHEMA-08 (authoritative column lists, constraints, partial unique index spec, backfill rule)
- `.planning/PROJECT.md` — Locked decisions: provenance model, manual-edit stickiness, primary-author nationality rule
- `.planning/STATE.md` — Current position and accumulated decisions

### Codebase patterns (read before writing migrations)
- `apps/server/src/db/migrations/20250118201503_create_book_table.ts` — baseline `book` schema + existing Knex style
- `apps/server/src/db/migrations/20250403145503_create_genre_table.ts` — one-table-per-migration + `UNIQUE(name)` pattern this phase replicates for `author`
- `apps/server/src/db/migrations/20250403145555_create_book_genre_table.ts` — junction-table pattern (foreign keys, composite indexes) this phase replicates for `book_author`
- `apps/server/src/db/migrations/20250412161907_use_book_md5_as_foreign_key.ts` — shows how `book_md5` is used as an FK in existing junctions (`book_author` should mirror this)
- `apps/server/src/knex.ts` — shared Knex instance used by runtime + migrations + seeds + tests
- `packages/common/types/book.ts` — current `KoReaderBook` / `DbBook` / `Book` split; new fields extend `DbBook`/`Book`, NOT `KoReaderBook`
- `packages/common/types/genre.ts`, `packages/common/types/book-genre.ts` — per-table shared-types convention the new `author.ts` / `enrichment.ts` will follow
- `packages/common/types/index.ts` — barrel export that must add the new modules

### Research outputs already available
- `.planning/research/STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md`, `SUMMARY.md` — research synthesis used to build the roadmap

### Verification
- `CLAUDE.md` §Data layer — migration/seed/test invariants (`build:migrations` must run before `vitest`)
- `CLAUDE.md` §Conventions — Zod at route boundaries, Prettier-only formatting (no ESLint)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Knex instance** (`apps/server/src/knex.ts`) — reused by all new migrations; no new connection logic needed.
- **Migration style** (existing `20250118…` / `20250403…` files) — per-table files with `up` + `down`, `Knex` type import, `table.increments('id').primary()` convention. New migrations follow this verbatim.
- **Junction-table pattern** (`book_genre` via `use_book_md5_as_foreign_key`) — direct analog for `book_author` (composite FK on `book.md5` + `author.id`, with `position` and `role` as extra columns).
- **Shared-types pattern** (`packages/common/types/*.ts`) — one file per table plus an `index.ts` barrel; `DbBook` / `Book` split already in place.
- **Tests against live migrations** — `npm --workspace=server test` builds migrations via `build:migrations` first. New migrations slot into this workflow without infra changes.

### Established Patterns
- **SQLite via better-sqlite3** — partial unique indexes ARE supported (`CREATE UNIQUE INDEX ... WHERE ...`). The `enrichment_job` partial index and `author.openlibrary_key` partial index can both be expressed as Knex raw SQL if the builder doesn't support them directly.
- **Zod at boundaries** — migrations do not use Zod; but the new shared types will be Zod-parsed at future HTTP boundaries (Phase 3 / 5). Phase 1 only exports TypeScript types; Zod schemas are out of scope here.
- **Nullable-by-default new columns on existing tables** — `add_reference_pages_to_book.ts` shows the idiomatic Knex `alterTable` addition.
- **Formatting** — Prettier-only, no ESLint. All new files must pass `npx prettier --check .`.

### Integration Points
- **Server boot** (`apps/server/src/app.ts`) — runs `knex.migrate.latest()` on startup. No boot-time code change needed in Phase 1; new tables appear automatically.
- **`@koinsight/common` barrel** (`packages/common/types/index.ts`) — single integration point for new shared types. Both `apps/server` and `apps/web` consume this barrel, so adding new exports to `index.ts` is the cross-cutting step.
- **KOReader plugin payload** (`plugins/koinsight.koplugin/*.lua` → `/api/plugin/*`) — MUST be untouched. The `book.authors` text column stays a first-class field; the plugin never learns about `author` / `book_author`.
- **Seeds** (`apps/server/src/db/seeds/`) — Phase 1 does NOT add seeds. `genre` seeding (SCHEMA-06) is Phase 2. Author seeds, if desired for dev, are Phase 4-era concern.

</code_context>

<specifics>
## Specific Ideas

- Use CHECK constraints for finite unions (`enrichment_status`, `role`, `*_source`) wherever SQLite cleanly supports them; this gives a DB-level guarantee matching the TypeScript union types.
- Migration 4's backfill loop should `SELECT md5, authors FROM book WHERE authors IS NOT NULL AND authors != ''`, apply the parser, and upsert into `author` (by normalized key) and insert into `book_author`. Wrap in a single transaction so a mid-backfill failure leaves the DB unchanged.
- Parser lives at `apps/server/src/db/migrations/helpers/parse-authors.ts` (or similar) so migration 4 imports a pure function. Unit tests for the parser live alongside (`parse-authors.test.ts`) and run under `npm --workspace=server test`.
- Every `table.timestamps(true, true)` call on new tables uses Knex's default `created_at`/`updated_at` with `defaultTo(knex.fn.now())`, matching existing tables.

</specifics>

<deferred>
## Deferred Ideas

### Cross-phase handoff notes (not Phase 1 work, but Phase 1 CONTEXT must surface them)
- **Duplicate-author merge via OL key** — If backfill creates two `author` rows for "Tolkien" and "J.R.R. Tolkien", Phase 4 enrichment will assign the same `openlibrary_key` to both, and Phase 4 (not Phase 1) is responsible for merging the rows. Phase 1 only provides the partial unique index and the schema.
- **Zod schemas for the new shared types** — Phase 1 ships TS types only. Zod schemas for `PATCH /api/books/:md5/metadata`, `EnrichmentJob` boundaries, and re-enrich payloads land with Phase 5 / Phase 3 respectively.
- **LN-FN heuristic weaknesses** — Cases like `Smith, Jones` (two co-authors) will not be flipped because we only flip when there are no other separators AND exactly 2 comma-separated tokens. This is accepted; Phase 5's manual-edit UI is the recovery path. Note for Phase 5 planner: the unmatched-books inbox should make these visible.
- **KoReaderBook plugin type changes** — Explicitly out of scope this milestone. Any future schema work that needs to flow to the plugin must coordinate with `plugins/koinsight.koplugin/const.lua` + `call_api.lua`.

### Reviewed Todos (not folded)
None — no pending todos cross-reference Phase 1 scope.

</deferred>

---

*Phase: 01-schema-foundations-provenance*
*Context gathered: 2026-04-23*

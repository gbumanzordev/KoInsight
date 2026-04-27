# Phase 2: Canonical Genre Vocabulary - Research

**Researched:** 2026-04-23
**Domain:** Genre taxonomy curation, OpenLibrary subject normalization, idempotent SQLite seeding via Knex
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01** `CANONICAL_GENRES` is hand-curated, fiction-heavy (fantasy, sci-fi, mystery, literary, historical) with pragmatic non-fiction tail (history, biography, science, philosophy, technology).
- **D-02** Target size **60-80 entries**. 55-85 is acceptable.
- **D-03** **Title Case** names (e.g., "Science Fiction", "Epic Fantasy"). No slug column.
- **D-04** **Flat list** — no parent/child. "Epic Fantasy" and "Fantasy" coexist as peers; rollups happen at query time in Phase 6.
- **D-05** English names only.
- **D-06** Genre scope, not format. Format/distribution tags go on the denylist.
- **D-07** `mapOpenLibrarySubjects` is pure + synchronous, returns `CanonicalGenre[]` (string literals), not DB rows with `id`. Caller does the `name -> genre_id` lookup.
- **D-08** Match is case-insensitive, whitespace-normalized: `s.trim().toLowerCase().replace(/\s+/g, ' ')`.
- **D-09** Alias map as a plain TS object literal. Minimum: `"sci-fi"`, `"sf"`, `"science-fiction"` → "Science Fiction"; `"ya"` → "Young Adult".
- **D-10** Compound subjects split on ` -- ` and `, `; each fragment mapped independently; all canonicals unioned.
- **D-11** A raw OL subject may map to multiple canonicals. Output de-duplicated by canonical name, order-preserved by first hit.
- **D-12** Zero-match is a valid outcome, returns `[]`.
- **D-13** Denylist is a hard `Set<string>` (normalized form), not regex patterns. Minimum entries: `Accessible book`, `Protected DAISY`, `Large type books`, `In library`, `New York Times bestseller`, `Overdrive`, `Book club edition`, `Fiction`, `Nonfiction`.
- **D-14** Denylist lives in the same module as `CANONICAL_GENRES` + alias map. One-line code edit, no schema change.
- **D-15** Denylist matching is case-insensitive + whitespace-normalized, **exact normalized match only** (no substring).
- **D-16** Module lives at `packages/common/genres/` (exported via `@koinsight/common/genres`). Pure TS, no Node/browser APIs.
- **D-17** Export `type CanonicalGenre = typeof CANONICAL_GENRES[number]`. Exports: `CANONICAL_GENRES`, `GENRE_ALIASES`, `SUBJECT_DENYLIST`, `mapOpenLibrarySubjects`, `CanonicalGenre`.
- **D-18** Seed mechanism is an **idempotent Knex migration** using `INSERT OR IGNORE`. Migration imports `CANONICAL_GENRES` from `@koinsight/common/genres` (one source of truth).
- **D-19** Existing dev seed `apps/server/src/db/seeds/06_genres.ts` keeps `BOOK_GENRE_MAPPING` but replaces its local `GENRES` array with a direct import of `CANONICAL_GENRES`.
- **D-20** Migration uses INSERT OR IGNORE, not DELETE + INSERT — preserves user-edited rows and `book_genre` FKs. Removing genres later is out of scope.

### Claude's Discretion

- Exact final contents of `CANONICAL_GENRES` (60-80, Title Case, flat, fiction-leaning).
- Exact final contents of `GENRE_ALIASES` and `SUBJECT_DENYLIST`.
- File layout inside `packages/common/genres/` — single `index.ts` vs split (`canonical.ts`, `aliases.ts`, `denylist.ts`, `map.ts`).
- Migration timestamp/filename (follow `YYYYMMDDHHMMSS_seed_canonical_genres.ts`).
- Whether `CANONICAL_GENRES` is a `readonly` tuple vs plain `const` array.
- Test file location/name (co-located vitest next to `map.ts`).

### Deferred Ideas (OUT OF SCOPE)

- Genre hierarchy / parent-child rollups.
- Non-English canonical names.
- Automatic pruning of obsolete `genre` rows.
- Moving the denylist to a config file or admin UI.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCHEMA-06 | Existing `genre` table seeded with canonical whitelist via idempotent migration (INSERT OR IGNORE) | Knex 3.1.0 `.onConflict('name').ignore()` verified against better-sqlite3; existing `genre` schema has `UNIQUE(name)` so conflict target is sound |
| GENRE-01 | `CANONICAL_GENRES` TS constant with ~50-100 entries, single-module export, source of truth for seeding | Recommended 60-80 list structured below; `packages/common/genres/` module layout matches D-16 |
| GENRE-02 | `mapOpenLibrarySubjects(subjects: string[]): Genre[]` pure function with documented alias map + denylist | Real OL subject samples cataloged below; denylist inventory + alias map patterns documented |
| GENRE-03 | ≥20 unit tests with representative real OL subject lists | 10 fixture books with verified OL subject arrays pulled directly from openlibrary.org JSON |
| GENRE-04 | Zero-match books persist with `genres_source='openlibrary'` + empty `book_genre` set | Out-of-band for Phase 2 (no persistence); mapper just returns `[]`. Phase 4 handles the write. GENRE-04 is covered by a unit test that asserts `mapOpenLibrarySubjects(['Protected DAISY', 'Accessible book']).length === 0` |
</phase_requirements>

## Summary

Phase 2 is a tight, well-constrained scope: three deliverables (canonical list, idempotent seed migration, pure mapper + tests) and no persistence logic. The heavy lifting is **curation** (picking the right ~70 genres) and **empirical denylist/alias building** (from real OL subject arrays). Every technical risk is low: Knex 3.1.0 supports `onConflict('name').ignore()` against better-sqlite3 (verified via Knex query-builder docs and Issue #3186); the existing `genre(id, name UNIQUE)` schema already has the conflict target; `parse-authors.ts`/`parse-authors.test.ts` is a perfect template for the helper + co-located vitest style.

**Primary recommendation:**
1. Split the genres module into four files (`canonical.ts`, `aliases.ts`, `denylist.ts`, `map.ts`) with an `index.ts` barrel — keeps each file under 150 lines and makes diff-reviewing the list/denylist edits trivial.
2. Use `.insert(rows).onConflict('name').ignore()` in the seed migration (canonical Knex 3.1.0 idiom for SQLite).
3. Place fixtures in a dedicated `map.fixtures.ts` so the same real-OL arrays can be reused by Phase 4 integration tests.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Canonical genre list (source of truth) | `@koinsight/common` (shared) | — | Both server (seed, enrichment) and web (Phase 5 MultiSelect) consume; must be pure TS with no Node/browser deps. |
| `mapOpenLibrarySubjects` pure function | `@koinsight/common` (shared) | — | Pure string-in / string-out; putting it in common avoids forcing Phase 5 UI to import from apps/server. |
| Alias map + denylist | `@koinsight/common` (shared) | — | Co-located with `CANONICAL_GENRES` per D-16; no runtime dependencies. |
| Seed migration (INSERT OR IGNORE) | `apps/server` (migrations) | — | Migrations are a server-only concern; imports from `@koinsight/common/genres`. |
| Dev seed refactor (06_genres.ts) | `apps/server` (seeds) | — | Dev-only scaffolding; reads from the same shared constant. |
| Vitest unit tests | `apps/server` (tests) OR `packages/common` (tests) | — | See Decision Point below. |

**Decision point for planner (not locked):** Unit tests can live either (A) in `packages/common/genres/map.test.ts` or (B) in `apps/server/src/genres/map.test.ts` importing from `@koinsight/common/genres`. D-16 puts the function in common; the natural home for the tests is also common. BUT the existing test infrastructure (vitest, `build:migrations`, coverage) lives in apps/server. Recommendation: co-locate tests in `packages/common/genres/map.test.ts`, add a minimal vitest config to `packages/common` (see Validation Architecture below), and include `packages/common` in the Turbo `test` pipeline.

## Standard Stack

### Core (all already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| knex | 3.1.0 | Migration runner + query builder with `onConflict().ignore()` | Project default; already used for every migration. |
| better-sqlite3 | 12.6.0 | SQLite driver | Project default; supports `ON CONFLICT ... DO NOTHING`. |
| vitest | 4.0.16 | Test runner | Project default; existing `parse-authors.test.ts` template. |
| typescript | 5.9.3 | Compile-time safety for `CanonicalGenre` string-literal type | Project default. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @faker-js/faker | 10.2.0 | Not needed in Phase 2 (dev seed already uses it for books) | Only if a fixture generator is needed; prefer hand-curated fixtures for map tests. |
| ramda | 0.31.1 | Available for idiomatic functional code | Optional. `mapOpenLibrarySubjects` is simple enough for plain JS (`flatMap`, `filter`, `Array.from(new Set(...))`) with no ramda dependency. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `INSERT OR IGNORE` via `.onConflict().ignore()` | `knex.raw('INSERT OR IGNORE INTO genre(name) VALUES (?)', [...])` | Raw SQL works but loses type safety and matches Knex patterns worse. Stick with builder. |
| Per-row insert in a loop | Batched `.insert(rows).onConflict('name').ignore()` | Batched insert is one SQL statement vs N; cleaner and atomic. |
| A TS tuple with `as const` | Plain `string[]` array | Tuple gives literal-type inference so `CanonicalGenre` is a union of the exact string names (not `string`). D-17 exports `typeof CANONICAL_GENRES[number]` which requires `as const`. Use tuple. |
| Dev-seed-only (no migration) | Migration-backed seed | Dev seed only runs via `npm run seed`; migration runs on every `app.ts` boot. Migration is the only way production gets the canonical list. REQUIRED (D-18, SCHEMA-06). |

**Installation:** No new packages. All dependencies are already installed.

**Version verification:** knex 3.1.0 was verified in apps/server/package.json. `.onConflict().ignore()` is documented in the current Knex query-builder docs [CITED: https://knexjs.org/guide/query-builder.html] and is implemented for SQLite (DO NOTHING clause) [CITED: knex Issue #3186]. better-sqlite3 12.6.0 supports `ON CONFLICT ... DO NOTHING` (native SQLite 3.24+ feature; better-sqlite3 12.x bundles SQLite 3.47+).

## Architecture Patterns

### Data Flow Diagram

```
     ┌─────────────────────────────────────┐
     │ packages/common/genres/             │
     │  canonical.ts  → CANONICAL_GENRES   │◄──── single source of truth
     │  aliases.ts    → GENRE_ALIASES      │
     │  denylist.ts   → SUBJECT_DENYLIST   │
     │  map.ts        → mapOpenLibrary...  │
     │  index.ts      → barrel             │
     └──────────┬─────────────────┬────────┘
                │                 │
      import   │                 │ import
                │                 │
   ┌────────────▼──┐     ┌────────▼──────────────┐
   │ Seed migration│     │ Phase 4: enrichment   │
   │ (SCHEMA-06)   │     │ writer (out of scope  │
   │               │     │ for Phase 2)          │
   │ INSERT OR     │     │                       │
   │ IGNORE rows   │     │ subjects[] ──►        │
   │               │     │  mapOpenLibrary... ──►│
   └────────┬──────┘     │  name[] ──► genre_id  │
            │            │  lookup ──► book_genre│
            ▼            └───────────────────────┘
    ┌────────────────┐
    │ genre table    │
    │ (id, name UQ)  │
    └────────────────┘
```

### Recommended Module Layout

**Option A (recommended): Split into 5 files.**

```
packages/common/genres/
├── canonical.ts     # export const CANONICAL_GENRES = [...] as const;
│                    #   export type CanonicalGenre = typeof CANONICAL_GENRES[number];
├── aliases.ts       # export const GENRE_ALIASES: Record<string, CanonicalGenre> = {...};
├── denylist.ts      # export const SUBJECT_DENYLIST: ReadonlySet<string> = new Set([...]);
├── map.ts           # export function mapOpenLibrarySubjects(...) : CanonicalGenre[]
├── map.test.ts      # vitest co-located tests
├── map.fixtures.ts  # real OL subject arrays (importable from Phase 4 tests)
└── index.ts         # barrel: export * from './canonical'; ./aliases; ./denylist; ./map
```

**Rationale:**
- Single-responsibility per file makes diff review of future additions trivial (add a genre: 1 line in `canonical.ts`; add a denylist entry: 1 line in `denylist.ts`).
- `map.fixtures.ts` is reusable by Phase 4 tests without pulling in a 100+ line test file.
- Barrel `index.ts` keeps the import surface clean: consumers write `import { mapOpenLibrarySubjects, CANONICAL_GENRES } from '@koinsight/common/genres';`.

**Option B (simpler, acceptable): Single `index.ts`.** Everything in one file. Fine if the final list + aliases + denylist total under ~250 lines. Recommend Option A regardless because Phase 5 UI will import just `CANONICAL_GENRES` for `MultiSelect` options and should not pull in the mapper + fixtures.

### Barrel Update

`packages/common/types/index.ts` stays untouched (it re-exports types only, and genres exports constants + functions). Instead, the new module is imported via its subpath `@koinsight/common/genres`. Because `packages/common/package.json` has no `exports` map today, subpath imports work via directory resolution (`packages/common/genres/index.ts`). This already works for `@koinsight/common/types/genre` in `genre-repository.ts:1`, confirming the pattern.

### Migration Pattern: Idempotent Seed

```typescript
// apps/server/src/db/migrations/YYYYMMDDHHMMSS_seed_canonical_genres.ts
import type { Knex } from 'knex';
import { CANONICAL_GENRES } from '@koinsight/common/genres';

export async function up(knex: Knex): Promise<void> {
  const rows = CANONICAL_GENRES.map((name) => ({ name }));
  await knex('genre').insert(rows).onConflict('name').ignore();
}

export async function down(knex: Knex): Promise<void> {
  // Non-destructive down: do NOT delete these rows because user-added book_genre
  // rows may reference them. If rollback is needed, run it manually.
  // (Alternatively: DELETE FROM genre WHERE name IN (CANONICAL_GENRES list)
  //  AND NOT EXISTS (SELECT 1 FROM book_genre WHERE book_genre.genre_id = genre.id)
  //  to preserve referenced rows. Ask the planner which behavior to ship.)
}
```

**SQL generated (verified via Knex query-builder docs):**
```sql
insert into "genre" ("name") values (?), (?), ... on conflict ("name") do nothing
```

This is a single round-trip to SQLite. Running the migration twice is a no-op (second run sees every row already present, all conflicts ignored).

### Pure Mapper Shape

```typescript
// packages/common/genres/map.ts
import { CANONICAL_GENRES, type CanonicalGenre } from './canonical';
import { GENRE_ALIASES } from './aliases';
import { SUBJECT_DENYLIST } from './denylist';

const normalize = (s: string): string =>
  s.trim().toLowerCase().replace(/\s+/g, ' ');

// Build a lookup at module load: every canonical name (normalized) points to itself.
const CANONICAL_LOOKUP: ReadonlyMap<string, CanonicalGenre> = new Map(
  CANONICAL_GENRES.map((g) => [normalize(g), g])
);

// Every alias key (normalized) points to its canonical target.
const ALIAS_LOOKUP: ReadonlyMap<string, CanonicalGenre> = new Map(
  Object.entries(GENRE_ALIASES).map(([k, v]) => [normalize(k), v])
);

// Denylist is compared by normalized form (D-15).
const DENYLIST_NORMALIZED: ReadonlySet<string> = new Set(
  Array.from(SUBJECT_DENYLIST).map(normalize)
);

function mapFragment(raw: string): CanonicalGenre | null {
  const key = normalize(raw);
  if (key === '') return null;
  if (DENYLIST_NORMALIZED.has(key)) return null;
  return CANONICAL_LOOKUP.get(key) ?? ALIAS_LOOKUP.get(key) ?? null;
}

export function mapOpenLibrarySubjects(subjects: string[]): CanonicalGenre[] {
  const out: CanonicalGenre[] = [];
  const seen = new Set<CanonicalGenre>();
  for (const subject of subjects) {
    // D-10: split compound subjects on ' -- ' then ', '
    const fragments = subject.split(' -- ').flatMap((f) => f.split(', '));
    for (const fragment of fragments) {
      const hit = mapFragment(fragment);
      if (hit && !seen.has(hit)) {
        seen.add(hit);
        out.push(hit);
      }
    }
  }
  return out;
}
```

**Notes on the implementation sketch:**
- Module-level lookup maps built once at import time; per-call cost is O(subjects × fragments) with O(1) lookups. Zero regex at runtime.
- Order preservation: `seen` Set + push-in-order array matches D-11.
- `' -- '` split runs before `, '` split. This ordering matters because a raw subject like `"Science fiction -- Fantasy fiction, American"` should first become `["Science fiction", "Fantasy fiction, American"]` then each fragment split on `, ` → `["Science fiction", "Fantasy fiction", "American"]`. That "American" fragment has no canonical match and is dropped silently (D-10, D-12).

### Anti-Patterns to Avoid

- **Substring matching on denylist.** Denying the substring `"book"` would nuke `"Book club edition"` AND every legitimate genre containing `"book"`. D-15 explicitly forbids this; use exact normalized match only.
- **Regex-based denylist.** D-13 makes this a design choice: plain `Set<string>` is auditable and testable; regex is not. Do not add regex even if it "looks more powerful."
- **Putting the list in the seed file only.** D-18 is explicit: the migration owns production seeding; the dev seed in `06_genres.ts` imports from the same constant (D-19). Never let the dev seed have a separate `GENRES` array again.
- **Using `DELETE + INSERT` in the migration.** D-20 forbids this — would cascade-break `book_genre` FKs and destroy user-added rows.
- **Iterating `book` rows in this migration.** SCHEMA-07 invariant from Phase 1: structure-only migrations do not iterate `book`. This seed only writes to `genre`, which is fine.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| `INSERT OR IGNORE` | `knex.raw('INSERT OR IGNORE ...')` or a loop with try/catch on UNIQUE violation | `knex('genre').insert(rows).onConflict('name').ignore()` | First-class Knex builder since 0.95; generates correct SQL for SQLite; already the project's abstraction layer. |
| Case-insensitive + whitespace-normalized string matching | Custom regex per match site | A single `normalize(s)` helper + `Map`/`Set` keyed on normalized form | Centralized normalization is consistent across CANONICAL_LOOKUP, ALIAS_LOOKUP, DENYLIST. One function, one spec (D-08). |
| String-literal-typed constant array | Manual union type `type CanonicalGenre = 'Fantasy' \| 'Science Fiction' \| ...` | `export const CANONICAL_GENRES = [...] as const; type CanonicalGenre = typeof CANONICAL_GENRES[number];` | TS infers the literal union automatically; list edits update the type. D-17. |
| De-duplication of the output array | `Array.from(new Set(out))` (destroys order) | `Set<CanonicalGenre>` for seen-check + `push` into ordered array | Preserves "first hit wins" order (D-11). |

## Runtime State Inventory

> Included because this phase mutates schema state (seeds the `genre` table). The genre table is NOT renamed; only extended.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing `genre` rows in dev DBs seeded by `06_genres.ts` (14 genres: Fantasy, Science Fiction, Epic Fantasy, Urban Fantasy, Space Opera, Hard Science Fiction, Adventure, Magic, Military Fiction, Post-Apocalyptic, Time Travel, Dystopian, Cyberpunk, Sword and Sorcery). All 14 appear in the proposed canonical list so no renames happen. | None — `INSERT OR IGNORE` preserves them as-is. |
| Stored data | Existing `book_genre` rows in user production DBs reference `genre.id`. Since the migration uses INSERT OR IGNORE and never deletes/renames, existing FKs are unaffected. | None. |
| Live service config | None — genre data is purely DB-local. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None. | None. |
| Build artifacts | `packages/common/dist/` already exists (TS build output). Adding `packages/common/genres/` requires rebuild (`npm --workspace=@koinsight/common run build`) before server TS check passes. | Document in plan: after adding files, run `npm --workspace=@koinsight/common run build`. |

## Common Pitfalls

### Pitfall 1: Migration imports from `@koinsight/common/genres` but common isn't built yet

**What goes wrong:** `npm --workspace=server run build:migrations` (which runs before `vitest`) fails with module-not-found because `packages/common/dist/genres/index.js` doesn't exist.

**Why it happens:** `packages/common` is a separately-compiled TypeScript package (`composite: true`, `outDir: dist`). Migrations import from it via the workspace link.

**How to avoid:** Ensure `npm install` at the repo root has built common (it does, via Turbo `build` pipeline). In CI, run `npm run build` before `npm run test`. The existing `parse-authors.ts` doesn't hit this because it's server-local. Phase 2's migration IS the first to import from common. Plan task order: (a) add `packages/common/genres/*`; (b) build common; (c) add migration that imports from it.

**Warning signs:** Error `Cannot find module '@koinsight/common/genres'` during `build:migrations` or `vitest`.

### Pitfall 2: `as const` tuple blows past TS's 1024-element literal union limit

**What goes wrong:** If CANONICAL_GENRES grows past ~1000 entries (it won't at 70, but worth noting), `typeof X[number]` inference stops working.

**Why it happens:** TypeScript caps union sizes for perf.

**How to avoid:** Stay under 80 per D-02. Not a real risk; documented only for future awareness.

### Pitfall 3: `INSERT ... ON CONFLICT` requires SQLite >= 3.24

**What goes wrong:** On an ancient SQLite the migration fails with a syntax error.

**Why it happens:** `ON CONFLICT (col) DO NOTHING` was added in SQLite 3.24.0 (2018).

**How to avoid:** better-sqlite3 12.6.0 bundles SQLite 3.47+ [CITED: better-sqlite3 changelog]. No action required for this project. Documented for anyone tempted to swap drivers.

### Pitfall 4: Treating `"Fiction"` / `"Nonfiction"` as genre instead of noise

**What goes wrong:** Almost every OL fiction work has "Fiction" in its subjects. If you treat it as a canonical genre, every book gets it and the genre dimension becomes useless.

**Why it happens:** OL uses `"Fiction"` as a top-level category AND a leaf subject inconsistently.

**How to avoid:** Denylist both. D-13 lists them explicitly. This research confirmed: Foundation has `"Fiction"`; The Fellowship of the Ring has `"Fiction"`. Every major work does.

### Pitfall 5: Compound-subject split order matters

**What goes wrong:** Splitting on `, ` first then ` -- ` breaks subjects like `"Science fiction -- Juvenile fiction, American"` differently than splitting ` -- ` first.

**Why it happens:** `' -- '` is a hierarchical separator (MARC-style); `', '` is appositional. Splitting the hierarchy first preserves semantics.

**How to avoid:** `subject.split(' -- ').flatMap(f => f.split(', '))`. D-10 does not specify order; splitting ` -- ` first is the defensible choice.

### Pitfall 6: "Science-fiction" (hyphenated) treated as different from "Science fiction"

**What goes wrong:** OL has BOTH `"Science fiction"` and `"Science-fiction"` (and the French `"Science-fiction"`). Without an alias, only one matches.

**Why it happens:** OL's tag model is community-driven; variants accumulate.

**How to avoid:** Alias map MUST include `"science-fiction"`, `"sci-fi"`, `"sf"` → `"Science Fiction"`. See Alias Map Patterns below.

## Code Examples

### Real OpenLibrary Subject Data (Fixture Catalog for GENRE-03)

These are pulled directly from openlibrary.org live JSON endpoints on 2026-04-23. Commit them verbatim into `map.fixtures.ts`.

#### Foundation by Isaac Asimov (OL46125W)
[VERIFIED: https://openlibrary.org/works/OL46125W.json]
```typescript
export const FOUNDATION_SUBJECTS = [
  'Psychohistory',
  'Open Library Staff Picks',
  'Life on other planets',
  'Fiction',
  'Science Fiction',
  'Long Now Manual for Civilization',
  'Prophecy',
  'Historians',
  'Robots',
  'Fiction, science fiction, general',
  'American literature',
  'American Fantasy fiction',
  'Vie extraterrestre',
  'Romans, nouvelles',
  'Psychohistoire',
  'Psychological fiction',
  'American Science fiction',
  'Hari Seldon (Fictitious character)',
];
// Expected: ['Science Fiction']
// Rationale: 'Fiction' denylisted; 'Open Library Staff Picks', 'Long Now Manual for Civilization' denylisted;
// 'Science fiction' (lowercase variant from 'American Science fiction' fragment), 'Science Fiction' → Science Fiction.
// 'Psychological fiction' → Psychological Fiction (if in canonical); 'American literature' → drop (no canonical).
// The test assertion is the planner's call; MINIMUM is that 'Science Fiction' is present.
```

#### The Fellowship of the Ring / Lord of the Rings (OL27448W)
[VERIFIED: https://openlibrary.org/works/OL27448W.json]
```typescript
export const LOTR_SUBJECTS = [
  'The Lord of the Rings',
  'Fiction',
  'Ficción',
  'English Fantasy fiction',
  'Fantasy fiction',
  'Open Library Staff Picks',
  'Middle Earth (Imaginary place)',
  'Fiction, fantasy, epic',
  'Middle earth (imaginary place), fiction',
  'Baggins, frodo (fictitious character), fiction',
  'Gandalf (fictitious character), fiction',
  'British and irish fiction (fictional works by one author)',
  'English literature',
  'Frodo Baggins (Fictitious character)',
  'Fiction, fantasy, general',
  'English language',
  'Fiction, media tie-in',
  'Gift books',
  'Quests (Expeditions)',
  'Wizards',
  'Telephone directories', // confirmed noise in real OL data
];
// Expected: ['Fantasy', 'Epic Fantasy']
// Rationale: 'Fantasy fiction' alias → Fantasy; 'Fiction, fantasy, epic' splits on ', ' → 'Fiction' (deny),
// 'fantasy' alias → Fantasy, 'epic' → Epic Fantasy (if alias 'epic' → 'Epic Fantasy' is added, or via
// 'Fantasy fiction' + 'epic' combined hit). Telephone directories has no canonical match, dropped silently.
```

#### A Court of Mist and Fury by Sarah J. Maas (OL17784315W — the endpoint returned this work, not The Martian; use as a Young Adult fantasy fixture instead)
[VERIFIED: https://openlibrary.org/works/OL17784315W.json at time of research; work ID assignment is fluid]
```typescript
export const ACOMAF_SUBJECTS = [
  'Fantasy',
  'Fiction',
  'Fairies',
  'Blessing and cursing',
  'Fantasy fiction',
  'Fairies, fiction',
  'nyt:young-adult-hardcover=2016-05-22',
  'New York Times bestseller',
  'nyt:young-adult-e-book=2016-05-22',
  'collectionID:TexChallenge2021',
  'collectionID:KellerChallenge',
  'collectionID:EanesChallenge',
  'collectionID:AlpineChallenge',
  'Adaptations',
  'Magic',
  'Courts and courtiers',
  'Fantasy & Magic',
  'Love & Romance',
  'Action & Adventure',
  'General',
  'series:A_Court_of_Thorns_and_Roses',
  "Children's fiction",
];
// Expected: ['Fantasy', 'Magic', 'Romance', 'Young Adult'] (depending on final canonical list)
// Rationale: 'Fantasy' direct hit; 'Magic' direct; 'Love & Romance' alias → Romance;
// 'Children's fiction' or nyt:young-adult-* patterns → need alias for 'young-adult' → Young Adult.
// Noise: all 'nyt:*', 'collectionID:*', 'series:*', 'General', 'Adaptations', 'NYT bestseller' denylisted.
```

Planner: **write a fetch script** as a one-off dev utility (NOT committed as a migration) to pull these 10 fixture works once and commit the arrays. Candidate works (by title → likely OL work ID; PLANNER MUST VERIFY each before committing):

| Book | Expected work-key probe | Expected canonical hits |
|------|-------------------------|-------------------------|
| Foundation (Asimov) | OL46125W | Science Fiction |
| The Lord of the Rings / Fellowship (Tolkien) | OL27448W | Fantasy, Epic Fantasy |
| A Court of Mist and Fury (Maas) | OL17784315W | Fantasy, Romance, Young Adult |
| The Martian (Weir) | [planner must resolve] | Science Fiction, Hard Science Fiction |
| Mistborn: The Final Empire (Sanderson) | [planner must resolve] | Fantasy, Epic Fantasy, Magic |
| Sapiens (Harari) | [planner must resolve] | History, Anthropology, Non-fiction-category-of-choice |
| Thinking, Fast and Slow (Kahneman) | [planner must resolve] | Psychology, Science, Economics |
| Dune (Herbert) | [planner must resolve] | Science Fiction, Space Opera |
| Pride and Prejudice (Austen) | [planner must resolve] | Classics, Romance, Literary Fiction |
| The Name of the Wind (Rothfuss) | [planner must resolve] | Fantasy, Epic Fantasy |

[ASSUMED] The 3 "[planner must resolve]" entries: I was unable to verify these work IDs during research (openlibrary.org endpoint returned a different work for `OL17860744W` and `OL19049848W` and `OL16813343W` and `OL8914376W`). Planner should search `openlibrary.org/search.json?title=...&author=...` to get the correct work key, then fetch `/works/{key}.json` to get the real subject list.

Additional fixtures to reach >20 tests without 10 real books: synthesize tests for edge cases (all-noise input, empty input, compound-subject inputs, single-subject inputs, duplicates). See "Test Catalog" below.

### Verified: `.onConflict().ignore()` SQL output

[CITED: https://knexjs.org/guide/query-builder.html]
```typescript
knex('genre').insert([{ name: 'Fantasy' }, { name: 'Science Fiction' }]).onConflict('name').ignore();
// SQL (SQLite): insert into "genre" ("name") values (?), (?) on conflict ("name") do nothing
```

### Verified: importing from `@koinsight/common/genres`

The existing `apps/server/src/genres/genre-repository.ts:1` already imports `import { Genre } from '@koinsight/common/types/genre';`, proving the subpath-import pattern works without an `exports` map in common's package.json.

## Canonical List Recommendation (60-80, Title Case, Flat)

Hand-curated from a synthesis of real OL subjects across the 10 fixture-book probes plus BISAC fiction-category cross-reference. This is a planner starting point (D-01 through D-06 are the hard constraints; exact membership is discretion per CONTEXT.md "Claude's Discretion").

### Fiction — Genre (core) [28 entries]
`Fantasy`, `Epic Fantasy`, `Urban Fantasy`, `Sword and Sorcery`, `Dark Fantasy`, `Portal Fantasy`, `Historical Fantasy`, `Magical Realism`, `Science Fiction`, `Hard Science Fiction`, `Space Opera`, `Cyberpunk`, `Dystopian`, `Post-Apocalyptic`, `Time Travel`, `First Contact`, `Military Science Fiction`, `Mystery`, `Detective Fiction`, `Cozy Mystery`, `Thriller`, `Crime Fiction`, `Horror`, `Gothic Fiction`, `Romance`, `Historical Romance`, `Paranormal Romance`, `Western`

### Fiction — Form / Audience [10 entries]
`Literary Fiction`, `Classics`, `Historical Fiction`, `Contemporary Fiction`, `Young Adult`, `Middle Grade`, `Children's Fiction`, `Graphic Novels`, `Comics`, `Short Stories`

### Fiction — Misc / Themes [6 entries]
`Adventure`, `War Fiction`, `Spy Fiction`, `Humor`, `Satire`, `Magic`

### Non-fiction — Core [22 entries]
`Biography`, `Autobiography`, `Memoir`, `History`, `Military History`, `Ancient History`, `Philosophy`, `Psychology`, `Science`, `Physics`, `Mathematics`, `Biology`, `Astronomy`, `Technology`, `Computer Science`, `Economics`, `Business`, `Politics`, `Sociology`, `Anthropology`, `Religion`, `Self-Help`

### Non-fiction — Arts & Lifestyle [8 entries]
`Art`, `Music`, `Travel`, `Cooking`, `Health`, `Nature`, `Essays`, `Journalism`

### Poetry / Drama [2 entries]
`Poetry`, `Drama`

**Total: 76 entries** (within the 60-80 target).

**Rationale:**
- Fiction-heavy per D-01: 44 of 76 = 58% fiction.
- Mainstream-first: skipped sub-sub-genres like "Afrofuturism", "Grimdark", "LitRPG", "Cosy Sci-Fi" that carry <1% of OL subjects. Can be added later per D-14 (one-line addition).
- Skipped umbrella labels that would always win over specifics: "Fiction", "Nonfiction" (go on denylist instead).
- Kept both "Fantasy" and "Epic Fantasy" per D-04 flat-list rule; mapper will return both when both hit.
- Included "Magic" (overlaps with Fantasy) because OL tags many Sanderson/Jordan works with just "Magic" and no "Fantasy" variant.

### Alias Map Patterns (Non-exhaustive Seed)

From the real OL subject data + common-knowledge variants:

```typescript
export const GENRE_ALIASES: Record<string, CanonicalGenre> = {
  // Science Fiction variants
  'sci-fi': 'Science Fiction',
  'sf': 'Science Fiction',
  'science-fiction': 'Science Fiction',
  'science fiction and fantasy': 'Science Fiction', // splits as compound, but belt+suspenders
  'american science fiction': 'Science Fiction',
  'english science fiction': 'Science Fiction',

  // Fantasy variants
  'fantasy fiction': 'Fantasy',
  'english fantasy fiction': 'Fantasy',
  'american fantasy fiction': 'Fantasy',
  'fantasy & magic': 'Fantasy',
  'fantasy fiction, english': 'Fantasy',
  'fantasy fiction, american': 'Fantasy',

  // Young Adult
  'ya': 'Young Adult',
  'young adult fiction': 'Young Adult',
  'young-adult': 'Young Adult',
  'juvenile fiction': 'Young Adult', // arguable; planner call

  // Biography / Memoir
  'biographies': 'Biography',
  'biography & autobiography': 'Biography',
  'memoirs': 'Memoir',

  // Romance
  'love & romance': 'Romance',
  'love stories': 'Romance',
  'romance fiction': 'Romance',

  // Mystery / Detective / Thriller
  'mystery fiction': 'Mystery',
  'mystery and detective stories': 'Mystery',
  'detective and mystery stories': 'Detective Fiction',
  'thrillers (fiction)': 'Thriller',
  'suspense': 'Thriller',

  // Horror
  'horror fiction': 'Horror',
  'horror tales': 'Horror',

  // Children's
  "children's stories": "Children's Fiction",
  'juvenile literature': "Children's Fiction",
  'picture books': "Children's Fiction",

  // Comics / Graphic Novels
  'graphic novel': 'Graphic Novels',
  'comic books, strips, etc.': 'Comics',

  // Historical
  'historical novels': 'Historical Fiction',

  // Philosophy / Psychology
  'psychological fiction': 'Psychology', // debatable; some may prefer dropping
  // (planner should decide; 'Psychological fiction' is a FICTION genre, not psychology)

  // Self-help
  'self help': 'Self-Help',
  'self-help techniques': 'Self-Help',

  // Poetry / Short stories
  'poems': 'Poetry',
  'short stories, american': 'Short Stories',
  'short stories, english': 'Short Stories',
};
```

**Planner action:** Treat this as a starter. Add 15-30 more aliases by eyeballing the fixture subject arrays; aim for ~40-60 total aliases. Keep the list one-line-per-entry so it diff-reviews cleanly.

### Denylist Inventory (From Real OL Data + CONTEXT)

Confirmed present in the 3 fixture subject arrays above:

```typescript
export const SUBJECT_DENYLIST: ReadonlySet<string> = new Set([
  // CONTEXT D-13 minimums
  'Accessible book',
  'Protected DAISY',
  'Large type books',
  'In library',
  'New York Times bestseller',
  'Overdrive',
  'Book club edition',
  'Fiction',
  'Nonfiction',
  'Non-fiction',
  'Non fiction',

  // Format / distribution (expansion of D-06 "not format")
  'Audiobook',
  'Ebook',
  'E-book',
  'Hardcover',
  'Paperback',
  'Large print',
  'Braille books',
  'Talking books',

  // OL-specific curation markers (from Foundation subjects)
  'Open Library Staff Picks',
  'Long Now Manual for Civilization',

  // Generic placeholders (from ACOMAF subjects)
  'General',

  // Provenance / listing artifacts
  'Gift books',
  'Telephone directories', // literally appeared in LOTR subjects
  'Early works to 1850', // bibliographic metadata, not genre

  // Language labels (appeared in LOTR + Foundation)
  'English language',
  'English literature',
  'American literature',
  'British and irish fiction (fictional works by one author)',

  // Structural OL tag prefixes: these are handled separately (see Compound Patterns below)
  // — prefixed tags like 'nyt:...', 'collectionID:...', 'series:...' need to be filtered
  //   by PREFIX, not exact match. That is a small exception to D-15 but documented below.
]);
```

**IMPORTANT — Prefix-based noise (minor exception to D-15 exact-match rule):**

Real OL data contains machine-generated tags like:
- `nyt:young-adult-hardcover=2016-05-22`
- `nyt:young-adult-e-book=2016-05-22`
- `collectionID:TexChallenge2021`
- `collectionID:KellerChallenge`
- `series:A_Court_of_Thorns_and_Roses`
- `OverDrive Read`
- `nyt:*` variants dated weekly for years
- Dewey-like codes: `Pr6039.o32 l6 2005`, `823/.912`

These cannot be denylisted by exact match because the dates/IDs change per tag. Two options for the planner:

**Option A (prefix-only, minimal regex):** Add a `SUBJECT_NOISE_PREFIXES = ['nyt:', 'collectionid:', 'series:']` array and filter those before alias/canonical lookup. This is a minimal extension to D-15.

**Option B (silent-drop by no-match):** Rely on these never matching canonical or alias; they just fall through and get dropped silently (D-12). Planner-review: does "silent drop" cause any false positives? E.g., `collectionID:Fantasy` would split on `:` ... no, the mapper only splits on ` -- ` and `, `. So `collectionID:TexChallenge2021` goes to `mapFragment` as a single string, finds no canonical, no alias, and returns null → dropped. **Option B works** without any denylist change. Recommend Option B; document it in the JSDoc on `mapOpenLibrarySubjects`.

The ONE case where Option B fails is Dewey-like `823/.912` — also dropped silently. Not a problem.

**Recommendation:** Use Option B. D-15 exact-match rule is preserved. The denylist above is the full list.

### Compound Subject Patterns (Confirmed)

From the research data:

| Pattern | Example (real) | Splits into |
|---------|----------------|-------------|
| `" -- "` hierarchical | `"Middle earth (imaginary place)--fiction"` (no spaces around `--`) | **⚠️ no-space variant!** Consider widening split to `/\s*--\s*/` to catch this. |
| `" -- "` hierarchical | `"Science fiction -- Juvenile fiction"` (planner-cited pattern) | `["Science fiction", "Juvenile fiction"]` |
| `", "` appositional | `"Fantasy fiction, American"` | `["Fantasy fiction", "American"]` |
| `", "` appositional | `"Fiction, science fiction, general"` | `["Fiction", "science fiction", "general"]` |
| `", "` appositional | `"Romans, nouvelles"` | `["Romans", "nouvelles"]` (both drop silently — French, no alias) |
| Parens | `"Middle Earth (Imaginary place)"`, `"Hari Seldon (Fictitious character)"` | Do NOT split parens; treat full string as one fragment (drops silently). |

**Planner decision:** D-10 says split on `' -- '` (with spaces). Real data has `--` with no spaces (`Middle earth (imaginary place)--fiction`). Recommend **relaxing the split regex to `/\s*--\s*/`** to catch both. Document this as a minor departure from D-10's exact string split; it is defensible as reading the spirit ("hierarchical `--` separator") over the letter ("exactly `' -- '`"). If the planner disagrees, fall back to strict `' -- '` and accept that hyphenated-no-space compounds are dropped silently.

## Test Catalog (Planner Floor: ≥20 Tests)

Map to the 10 real-fixture books (GENRE-03) + synthetic edge cases. Minimum 20, target 30.

### Real-fixture tests (10)
1. `FOUNDATION_SUBJECTS → ['Science Fiction']` (verifies 'Fiction' denied + 'Long Now ...' denied + `American Science fiction` alias)
2. `LOTR_SUBJECTS → includes 'Fantasy' and 'Epic Fantasy'` (verifies `Fantasy fiction` alias + compound splitting)
3. `ACOMAF_SUBJECTS → includes 'Fantasy', 'Magic', 'Romance', 'Young Adult'` (verifies denylist for `nyt:*`, `collectionID:*`, `series:*`)
4. `MARTIAN_SUBJECTS → includes 'Science Fiction', 'Hard Science Fiction'`
5. `MISTBORN_SUBJECTS → includes 'Fantasy', 'Epic Fantasy', 'Magic'`
6. `SAPIENS_SUBJECTS → includes 'History', 'Anthropology'`
7. `THINKING_FAST_SLOW_SUBJECTS → includes 'Psychology', 'Economics'`
8. `DUNE_SUBJECTS → includes 'Science Fiction', 'Space Opera'`
9. `PRIDE_AND_PREJUDICE_SUBJECTS → includes 'Classics', 'Romance'`
10. `NAME_OF_THE_WIND_SUBJECTS → includes 'Fantasy', 'Epic Fantasy'`

### Boundary tests (10)
11. Empty array: `mapOpenLibrarySubjects([]) → []`
12. All denylist: `['Protected DAISY', 'Accessible book', 'Fiction', 'New York Times bestseller'] → []` (GENRE-04 coverage)
13. All no-canonical: `['Telephone directories', 'Romans, nouvelles', 'Pr6039.o32 l6 2005'] → []`
14. Case-insensitive: `['science fiction'] → ['Science Fiction']`
15. Whitespace-noisy: `['  Science   Fiction  '] → ['Science Fiction']`
16. Duplicate de-dup: `['Science Fiction', 'Science Fiction', 'sci-fi'] → ['Science Fiction']`
17. Order preservation: `['Fantasy', 'Science Fiction'] → ['Fantasy', 'Science Fiction']`
18. Compound `--` split: `['Science fiction -- Juvenile fiction'] → ['Science Fiction', 'Young Adult']`
19. Compound `, ` split: `['Fantasy fiction, American'] → ['Fantasy']` (American drops silently)
20. Mixed compound: `['Science fiction -- Fantasy fiction, American'] → ['Science Fiction', 'Fantasy']`

### Alias / edge tests (5+)
21. Alias `sci-fi` → `Science Fiction`
22. Alias `YA` → `Young Adult` (case-insensitive alias lookup)
23. Unicode / non-English: `['Science-fiction française'] → ['Science Fiction']` (only if alias added; else `[]` and test asserts that)
24. Prefix noise silent drop: `['nyt:bestseller-2020-01-01', 'collectionID:Foo'] → []`
25. Single no-match fragment in compound: `['Fantasy, General'] → ['Fantasy']` (General denylisted)

**Total: 25 tests.** Planner may add or drop; floor is 20.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-row `knex.raw('INSERT OR IGNORE ...')` | `.insert(rows).onConflict(col).ignore()` | Knex 0.95 (2021) | First-class builder, works identically on PG/MySQL/SQLite. |
| Separate TS union types hand-maintained | `as const` tuple + `typeof X[number]` | TS 3.4 (2019) | Adding a genre updates the type automatically. |

**Deprecated / outdated:**
- ESM-only HTTP clients (ky, got) and p-queue/p-limit — forbidden by Phase 1 D-??/REQUIREMENTS "Out of Scope" list. Phase 2 has no HTTP surface anyway; noted for symmetry with the broader milestone.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | 7 of 10 OL work keys need planner verification (The Martian, Mistborn, Sapiens, Thinking/Fast Slow, Dune, Pride and Prejudice, Name of the Wind). My WebFetch attempts returned different works for some of those IDs. | Fixture Catalog | Planner picks wrong fixture set — but easy to fix with `openlibrary.org/search.json` before committing. LOW risk. |
| A2 | `packages/common` subpath imports (`@koinsight/common/genres`) work without an `exports` map. Confirmed indirectly by `apps/server/src/genres/genre-repository.ts:1` using `@koinsight/common/types/genre`. Not verified with a clean build of the new genres/ path. | Module Layout | If Turbo or TS rootDir resolution complains, planner adds an `exports` map to `packages/common/package.json`. LOW risk. |
| A3 | better-sqlite3 12.6.0 bundles SQLite ≥3.24 (required for `ON CONFLICT`). better-sqlite3 11+ bundles SQLite 3.46+ per release notes; 12.x is later. High confidence but not directly grepped from node_modules. | Pitfall 3 | If SQLite is somehow <3.24, the migration errors immediately in CI — discovered in seconds, easy to debug. LOW risk. |
| A4 | The recommended 76-entry canonical list is a STARTER. Real shipping content is Claude's discretion per D-01/D-02. Planner may cut "Paranormal Romance" and add "Noir"/etc. | Canonical List | None — D-02 explicitly gives planner discretion within 55-85. |
| A5 | Option B (silent-drop prefix-noise) works without a regex-denylist. Depends on no prefix-tagged strings ever accidentally matching a canonical or alias. None of the observed patterns do. | Denylist Inventory | If a future OL tag like `genre:Fantasy` appeared, it would fall through and not match `Fantasy` canonical (because the full string is `"genre:fantasy"`). So still silent-drop. LOW risk. |
| A6 | D-10 split order: `' -- '` before `', '`. CONTEXT doesn't specify; I picked hierarchical-first. Alternative: split on both greedily. | Pitfall 5 | Only affects edge cases where both separators co-occur; a planner can swap if they find counter-examples. LOW risk. |

**If these are wrong, impact is LOW across the board** — Phase 2 has no runtime coupling; tests surface any issue immediately.

## Open Questions

1. **Where do vitest tests for `packages/common` run?**
   - What we know: existing vitest runs in `apps/server` (`npm --workspace=server test`).
   - What's unclear: whether to (A) co-locate tests in `packages/common/genres/map.test.ts` and add a vitest config to common, or (B) put tests in `apps/server/src/genres/map.test.ts` and import from `@koinsight/common/genres`.
   - Recommendation: **Option A** (co-locate). The function is in common; its tests belong in common. Add minimal `packages/common/vitest.config.ts` and a `test` script to `packages/common/package.json`, and let Turbo pick up the new workspace test task. If the planner wants to avoid scope creep, **Option B** is fully acceptable — just follow the `parse-authors.test.ts` template at `apps/server/src/genres/map.test.ts` importing from `@koinsight/common/genres`.

2. **Does `06_genres.ts` need a full rewrite or a surgical diff?**
   - Recommendation: Surgical. Replace the `GENRES` const with `import { CANONICAL_GENRES } from '@koinsight/common/genres';` and pass that to the `createGenre` loop. Keep `BOOK_GENRE_MAPPING`. Drop the `console.log(\`✓ Seeded ${SEEDED_GENRES.length} genres...\`)` message or update its count. One-plan-worth of work.

3. **Should `BOOK_GENRE_MAPPING` in `06_genres.ts` be validated against the new CANONICAL_GENRES?**
   - Some of the current mapping values (e.g., 'Epic Fantasy', 'Space Opera', 'Magic') exist in the proposed canonical list; others (if any get removed) would silently fail the lookup. Planner adds a type annotation: `BOOK_GENRE_MAPPING: Record<string, CanonicalGenre[]>` so TS catches mismatches at compile time.

4. **Migration file ordering relative to Phase 1's migrations?**
   - Phase 1 shipped 4 migrations with timestamps `20260423...`. New seed migration should use `20260424...` or later to ensure it runs AFTER Phase 1's `extend_book_columns` (though it doesn't depend on any new column — only `genre(name UNIQUE)` from 2025). Planner uses a current-day timestamp.

5. **Down-migration behavior for the seed: no-op vs selective delete?**
   - D-20 is silent on `down()`. Recommendation: `down()` is a no-op (documented comment). If a developer really needs to roll back seed data, they do it manually. This avoids accidentally deleting genres a user manually linked to books.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| knex | migrations | ✓ | 3.1.0 | — |
| better-sqlite3 | SQLite driver | ✓ | 12.6.0 | — |
| vitest | unit tests | ✓ | 4.0.16 | — |
| typescript | compile `as const` tuple type | ✓ | 5.9.3 | — |
| @koinsight/common workspace | source of truth | ✓ | v0.2.2 | — |
| Node >= 22 | monorepo engines | ✓ (dev) | — | — |

**No external network calls in Phase 2.** No outbound HTTP, no new services. The only reason to hit openlibrary.org is during the one-time fixture-gathering script the planner runs to populate `map.fixtures.ts`, and those results get committed as literal arrays.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.16 |
| Config file | `apps/server/vitest.config.ts` (existing); may need new `packages/common/vitest.config.ts` (Open Question #1) |
| Quick run command | `npm --workspace=server exec vitest run packages/common/genres` (Option B) or `npm --workspace=@koinsight/common test` (Option A) |
| Full suite command | `npm run test:coverage` (Turbo — runs all workspaces) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| SCHEMA-06 | Re-running migrate:latest is a no-op (idempotent) | integration | `npm --workspace=server test -- idempotent-genre-seed` | ❌ Wave 0 — create integration test that runs `migrate.latest()` twice against `:memory:` SQLite and asserts `genre` row count unchanged |
| GENRE-01 | `CANONICAL_GENRES` is exported and has 60-80 entries | unit | `npm ... test -- canonical.test.ts` | ❌ Wave 0 — create `packages/common/genres/canonical.test.ts` with `expect(CANONICAL_GENRES.length).toBeGreaterThanOrEqual(60); .toBeLessThanOrEqual(85);` |
| GENRE-02 | `mapOpenLibrarySubjects` pure + deterministic + respects denylist/alias | unit | `npm ... test -- map.test.ts` | ❌ Wave 0 — create `map.test.ts` with 25+ tests |
| GENRE-03 | ≥20 tests including real OL subject fixtures | unit | (same as above) | ❌ Wave 0 — see Test Catalog above |
| GENRE-04 | Zero-match returns `[]` (persistence is Phase 4's job) | unit | `mapOpenLibrarySubjects(['Protected DAISY', 'In library']) toEqual []` | ❌ Wave 0 — covered by test #12 in Test Catalog |

### Sampling Rate

- **Per task commit:** `npm --workspace=server exec vitest run src/genres` (or common equivalent). <5 seconds.
- **Per wave merge:** `npm --workspace=server test` full server suite (~15 seconds including `build:migrations`).
- **Phase gate:** `npm run test:coverage` via Turbo across all workspaces; run migrations twice on a fresh `:memory:` DB and diff the `genre` table snapshot to prove idempotency.

### Wave 0 Gaps

- [ ] `packages/common/genres/index.ts` — barrel
- [ ] `packages/common/genres/canonical.ts` — `CANONICAL_GENRES` tuple + `CanonicalGenre` type
- [ ] `packages/common/genres/aliases.ts` — `GENRE_ALIASES` object
- [ ] `packages/common/genres/denylist.ts` — `SUBJECT_DENYLIST` set
- [ ] `packages/common/genres/map.ts` — `mapOpenLibrarySubjects` function
- [ ] `packages/common/genres/map.fixtures.ts` — real OL subject arrays for 10 books
- [ ] `packages/common/genres/map.test.ts` OR `apps/server/src/genres/map.test.ts` — 25+ unit tests
- [ ] `packages/common/genres/canonical.test.ts` — size assertion + uniqueness check
- [ ] `apps/server/src/db/migrations/YYYYMMDDHHMMSS_seed_canonical_genres.ts` — seed migration
- [ ] `apps/server/src/db/migrations/YYYYMMDDHHMMSS_seed_canonical_genres.test.ts` (optional) — idempotency integration test running migrate twice
- [ ] `apps/server/src/db/seeds/06_genres.ts` — surgical edit to import `CANONICAL_GENRES`
- [ ] One-off fixture-gather script (NOT committed as a migration) — hits openlibrary.org for 10 works, prints subject arrays for paste into `map.fixtures.ts`

## Project Constraints (from CLAUDE.md)

- **Formatting:** Prettier-only (no ESLint). All new files MUST pass `npx prettier --check .` before commit.
- **ASCII only, no em-dashes** (user global rule). All genre names, aliases, denylist entries use plain ASCII (no `—`, no `…`, no smart quotes). This affects genre names like `"Sword and Sorcery"` (safe) and the code comments (use `,` or `;` or `.` in place of em-dashes).
- **Zod at route boundaries** — does not apply to Phase 2 (no routes added).
- **vitest co-located `*.test.ts`** — pattern to follow.
- **Build migrations before tests** — `npm run build:migrations` runs automatically via `npm --workspace=server test`. Planner does not need to add it manually, but SHOULD document that adding `packages/common/genres/` requires `npm --workspace=@koinsight/common run build` before server tests can resolve the import.
- **npm workspaces + Turbo** — adding a new test task in `packages/common` means updating `turbo.json` if the task doesn't match an existing pipeline name.
- **No ESM-only dependencies** — Phase 2 adds no deps, so not applicable.
- **Plain ASCII in files** — enforced across canonical names and alias keys.

## Sources

### Primary (HIGH confidence)

- [Knex Query Builder docs — onConflict().ignore()](https://knexjs.org/guide/query-builder.html) — verified syntax + SQLite SQL generation.
- [Knex Issue #3186 — Crossdb ON CONFLICT / MERGE upsert support](https://github.com/knex/knex/issues/3186) — verified SQLite support for `onConflict().ignore()`.
- OpenLibrary work JSON endpoint [https://openlibrary.org/works/OL46125W.json](https://openlibrary.org/works/OL46125W.json) — verified Foundation subjects array verbatim.
- OpenLibrary work JSON endpoint [https://openlibrary.org/works/OL27448W.json](https://openlibrary.org/works/OL27448W.json) — verified LOTR/Fellowship subjects array verbatim.
- OpenLibrary work JSON endpoint [https://openlibrary.org/works/OL17784315W.json](https://openlibrary.org/works/OL17784315W.json) — verified ACOMAF subjects array verbatim.
- Codebase: `apps/server/package.json` — verified Knex 3.1.0 + better-sqlite3 12.6.0 versions.
- Codebase: `apps/server/src/db/migrations/20250403145503_create_genre_table.ts` — verified `UNIQUE(name)` conflict target exists.
- Codebase: `apps/server/src/genres/genre-repository.ts:1` — verified `@koinsight/common/types/genre` subpath import works today.
- Codebase: `apps/server/src/db/migrations/helpers/parse-authors.ts` + `.test.ts` — verified pure-helper + co-located vitest template.

### Secondary (MEDIUM confidence)

- [OpenLibrary Subjects API](https://openlibrary.org/dev/docs/api/subjects) — confirms subjects are community-tagged, no canonical list from OL.
- [Open Library Tags Explained (blog)](https://blog.openlibrary.org/2021/06/29/open-library-tags-explained-for-readers-seeking-buried-treasure/) — confirms staff-pick tags, marketing tags, and format tags all share the subjects field.

### Tertiary (LOW confidence)

- Work IDs for The Martian, Mistborn, Sapiens, Thinking Fast and Slow, Dune, Pride and Prejudice, Name of the Wind — my WebFetch attempts hit the wrong works. Planner MUST re-resolve via `openlibrary.org/search.json?title=...&author=...` before committing to `map.fixtures.ts`.
- BISAC fiction-category cross-reference informing the canonical list — drawn from general knowledge; not cited to a live BISAC URL (BISG is paywalled). Safe because D-01 explicitly rejects licensed taxonomies; the list is hand-curated.

## Metadata

**Confidence breakdown:**
- Module layout + idempotent migration: **HIGH** — Knex syntax verified, existing patterns confirmed in-codebase.
- Canonical list composition: **MEDIUM** — 76-entry starter is informed by real OL data but final membership is explicitly Claude's discretion per CONTEXT.
- Denylist inventory: **HIGH** for the 9 CONTEXT-locked entries + 10 confirmed-in-real-data entries; **MEDIUM** for the expansion list.
- Alias map: **MEDIUM** — starter list covers obvious variants from the 3 verified fixture arrays; planner will need to add more after fetching the remaining 7 fixtures.
- Test catalog: **HIGH** — 25 tests are concrete and ≥20 floor is easily met.
- Compound-subject split order and prefix-noise handling: **MEDIUM** — research recommends a minor departure from strict D-10 (widen `--` regex) and Option B for prefixes; planner can adopt or revert.

**Research date:** 2026-04-23
**Valid until:** 2026-05-23 (30 days — Knex/SQLite/TS stack is stable; real OL subject data is stable for fixture purposes).

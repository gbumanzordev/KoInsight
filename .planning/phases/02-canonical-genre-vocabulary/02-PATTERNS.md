# Phase 2: Canonical Genre Vocabulary - Pattern Map

**Mapped:** 2026-04-23
**Files analyzed:** 14 (13 new, 1 surgical edit; some conditional)
**Analogs found:** 13 / 14 (1 no-analog: `packages/common/vitest.config.ts`)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/common/genres/canonical.ts` | shared constant/type | in-memory (pure data) | `packages/common/types/enrichment.ts` | role-match (pure TS literal + type in `@koinsight/common`) |
| `packages/common/genres/aliases.ts` | shared constant | in-memory (pure data) | `packages/common/types/enrichment.ts` | role-match |
| `packages/common/genres/denylist.ts` | shared constant | in-memory (pure data) | `packages/common/types/enrichment.ts` | role-match |
| `packages/common/genres/map.ts` | pure utility (helper) | transform (string[] to string[]) | `apps/server/src/db/migrations/helpers/parse-authors.ts` | exact (pure deterministic string transformer) |
| `packages/common/genres/map.fixtures.ts` | test fixtures | in-memory (pure data) | (no existing fixtures module — pattern is "just export const arrays") | role-match |
| `packages/common/genres/map.test.ts` | unit test | request-response (fn call to assertion) | `apps/server/src/db/migrations/helpers/parse-authors.test.ts` | exact |
| `packages/common/genres/canonical.test.ts` | unit test (shape assertions) | request-response | `parse-authors.test.ts` | role-match |
| `packages/common/genres/index.ts` | barrel export | in-memory | `packages/common/types/index.ts` | exact |
| `packages/common/package.json` | config (add test script, type) | n/a | `apps/server/package.json` (for scripts), `packages/common/package.json` (for shape) | role-match |
| `packages/common/vitest.config.ts` | config (new) | n/a | `apps/server/vitest.config.ts` | role-match (trim server-specific paths) |
| `packages/common/types/index.ts` | barrel (optional re-export) | in-memory | self | no change recommended; `genres/` is its own subpath export |
| `apps/server/src/db/migrations/YYYYMMDDHHMMSS_seed_canonical_genres.ts` | Knex migration (data seed, idempotent) | batch write | `apps/server/src/db/migrations/20260423221700_backfill_book_authors.ts` (data migration) and `20260423221400_create_author_and_book_author.ts` (import style) | role-match (data-only; simpler — no iteration) |
| `apps/server/src/db/migrations/__tests__/phase-02-seed.test.ts` | integration test (migrate-twice idempotency) | file-I/O + DB | `apps/server/src/db/migrations/__tests__/phase-01-schema.test.ts` | exact |
| `apps/server/src/db/seeds/06_genres.ts` | dev seed (surgical edit) | batch write | self (keep structure, swap `GENRES` const for `CANONICAL_GENRES` import) | exact (in-place) |
| `turbo.json` | config (add test task if Option A) | n/a | self | exact |

---

## Pattern Assignments

### `packages/common/genres/canonical.ts` (shared constant + type)

**Analog:** `packages/common/types/enrichment.ts` (for export-style), `packages/common/types/author.ts` (for file layout)

**File-header + export pattern** (from `enrichment.ts` lines 1-6):
```typescript
// Book-level enrichment status (lives on book.enrichment_status). Per D-18 / SCHEMA-04.
export type EnrichmentStatus = 'pending' | 'running' | 'enriched' | 'failed' | 'skipped';
```

**Apply as** (Phase 2 shape, per D-17):
```typescript
// Canonical genre vocabulary. Source of truth for seeding (SCHEMA-06) and
// for mapping OL subjects (GENRE-02). Keep Title Case, flat, English-only (D-03, D-04, D-05).
export const CANONICAL_GENRES = [
  'Fantasy',
  'Epic Fantasy',
  // ... 60-80 total entries per D-02
] as const;

export type CanonicalGenre = (typeof CANONICAL_GENRES)[number];
```

**Key convention:** No `@koinsight/common/types/*` imports; this file is pure literal + derived type. Exactly like `enrichment.ts` exports a string-literal type (just using an `as const` tuple instead of a hand-written union so list edits update the type — the RESEARCH Don't Hand-Roll table locks this).

---

### `packages/common/genres/aliases.ts` + `packages/common/genres/denylist.ts` (shared constants)

**Analog:** `packages/common/types/genre.ts` (minimal module shape)

**Apply as:**
```typescript
// aliases.ts
import type { CanonicalGenre } from './canonical';

// Keys are raw OL subject fragments (case-insensitive, whitespace-normalized at lookup time per D-08).
// Values must be members of CANONICAL_GENRES (enforced by the CanonicalGenre type per D-17).
export const GENRE_ALIASES: Record<string, CanonicalGenre> = {
  'sci-fi': 'Science Fiction',
  'sf': 'Science Fiction',
  // ...
};
```

```typescript
// denylist.ts
// Per D-13, D-15: exact normalized match only. Stored in original (display) form;
// map.ts normalizes at module-load time for lookup.
export const SUBJECT_DENYLIST: ReadonlySet<string> = new Set([
  'Accessible book',
  'Protected DAISY',
  // ...
]);
```

**Key convention:** Same `packages/common` pattern as existing types modules — `type` imports only, no runtime deps, plain ASCII only (CLAUDE.md, user global rule: no em-dashes).

---

### `packages/common/genres/map.ts` (pure utility)

**Analog (exact):** `apps/server/src/db/migrations/helpers/parse-authors.ts`

**Imports pattern** (parse-authors.ts lines 1-10):
```typescript
export type ParsedAuthor = {
  name: string;
  position: number;
};

const SUFFIX_WHITELIST = ['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md'];
const SEPARATOR_RE = /\s*(?:&|;|,|\band\b)\s*/i;
```

**Apply as** (module-top constants built once at load time):
```typescript
import { CANONICAL_GENRES, type CanonicalGenre } from './canonical';
import { GENRE_ALIASES } from './aliases';
import { SUBJECT_DENYLIST } from './denylist';

const normalize = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

const CANONICAL_LOOKUP: ReadonlyMap<string, CanonicalGenre> = new Map(
  CANONICAL_GENRES.map((g) => [normalize(g), g])
);
// ... ALIAS_LOOKUP, DENYLIST_NORMALIZED identical shape
```

**Core pattern** (parse-authors.ts lines 17-46 — pure deterministic transformer with guard clauses):
```typescript
export function parseAuthors(input: string | null | undefined): ParsedAuthor[] {
  if (input == null) return [];
  const original = input;
  const segments = original
    .split(SEPARATOR_RE)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter((s) => s.length > 0);

  // ... pure transforms, no I/O
  return cleaned.map((name, position) => ({ name, position }));
}
```

**Apply as** (per D-07, D-10, D-11, D-12):
```typescript
export function mapOpenLibrarySubjects(subjects: string[]): CanonicalGenre[] {
  const out: CanonicalGenre[] = [];
  const seen = new Set<CanonicalGenre>();
  for (const subject of subjects) {
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

**Convention highlights copied verbatim:**
- File-top `const` regex/lookup definitions (parse-authors.ts lines 6-10).
- Early-return guards for null/empty (parse-authors.ts line 18).
- Pure, synchronous, no I/O, no Node/browser APIs (D-16).
- No ramda — project allows it but parse-authors.ts uses plain JS; keep consistent.

---

### `packages/common/genres/map.fixtures.ts` (test fixtures)

**Analog:** (none in repo; nearest shape is `apps/server/src/db/seeds/02_books.ts` exporting `SEEDED_BOOKS`)

**Apply as:** Plain `export const FOO_SUBJECTS: string[] = [...]` arrays, one per fixture book. Commit real OL subject arrays verbatim (RESEARCH 02-RESEARCH.md lines 346-440 already has Foundation, LOTR, ACOMAF; planner fetches 7 more).

---

### `packages/common/genres/map.test.ts` + `canonical.test.ts` (unit tests)

**Analog (exact):** `apps/server/src/db/migrations/helpers/parse-authors.test.ts`

**Imports pattern** (parse-authors.test.ts lines 1-3):
```typescript
import { describe, expect, it } from 'vitest';

import { parseAuthors } from './parse-authors';
```

**Core test pattern** (parse-authors.test.ts lines 5-92):
```typescript
describe('parseAuthors', () => {
  it('returns [] for null input', () => {
    expect(parseAuthors(null)).toEqual([]);
  });

  it('returns two authors in order for & separator', () => {
    expect(parseAuthors('Smith & Jones')).toEqual([
      { name: 'Smith', position: 0 },
      { name: 'Jones', position: 1 },
    ]);
  });
  // ... flat `it` blocks, one assertion per test, descriptive English names
});
```

**Apply as** (Phase 2, per RESEARCH Test Catalog lines 672-706):
```typescript
import { describe, expect, it } from 'vitest';
import { mapOpenLibrarySubjects } from './map';
import { FOUNDATION_SUBJECTS, LOTR_SUBJECTS, ACOMAF_SUBJECTS } from './map.fixtures';

describe('mapOpenLibrarySubjects', () => {
  it('returns [] for empty input', () => {
    expect(mapOpenLibrarySubjects([])).toEqual([]);
  });

  it('maps Foundation subjects to include Science Fiction', () => {
    expect(mapOpenLibrarySubjects(FOUNDATION_SUBJECTS)).toContain('Science Fiction');
  });
  // ... 25+ tests total per RESEARCH Test Catalog
});
```

**Convention highlights:**
- One `describe` per exported function; flat `it` list (no nested describes).
- Use `.toEqual` for array equality, `.toContain` for set-membership on order-insensitive expectations.
- Descriptive test names begin with a verb ("returns", "maps", "drops").

**`canonical.test.ts` pattern** (shape assertions only):
```typescript
import { describe, expect, it } from 'vitest';
import { CANONICAL_GENRES } from './canonical';

describe('CANONICAL_GENRES', () => {
  it('has 60-80 entries (D-02)', () => {
    expect(CANONICAL_GENRES.length).toBeGreaterThanOrEqual(60);
    expect(CANONICAL_GENRES.length).toBeLessThanOrEqual(85);
  });

  it('contains only unique entries', () => {
    expect(new Set(CANONICAL_GENRES).size).toBe(CANONICAL_GENRES.length);
  });

  it('stores every entry in Title Case (D-03)', () => {
    for (const g of CANONICAL_GENRES) {
      expect(g).toMatch(/^[A-Z]/);
    }
  });
});
```

---

### `packages/common/genres/index.ts` (barrel)

**Analog (exact):** `packages/common/types/index.ts`

**Full file (14 lines, `packages/common/types/index.ts`):**
```typescript
export * from './annotation';
export * from './author';
// ...
export * from './stats-api';
```

**Apply as:**
```typescript
export * from './canonical';
export * from './aliases';
export * from './denylist';
export * from './map';
```

Do NOT re-export `map.fixtures.ts` from the barrel; test fixtures are imported by path only.

---

### `packages/common/package.json` (modify)

**Analog:** self (current shape) + `apps/server/package.json` (for `test` script style)

**Current file:**
```json
{
  "name": "@koinsight/common",
  "version": "v0.2.2",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  }
}
```

**Apply as** (Option A — tests in common):
```json
{
  "name": "@koinsight/common",
  "version": "v0.2.2",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^4.0.16"
  }
}
```

**Key convention:** `"type": "module"` is already set. Match the server's vitest version (4.0.16 per RESEARCH Standard Stack line 92). Keep `private: true`.

---

### `packages/common/vitest.config.ts` (new)

**Analog:** `apps/server/vitest.config.ts`

**Server file (full, 18 lines):**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup/test-setup.ts'],
    include: ['**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './test/coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/db/migrations', 'src/db/seeds'],
    },
  },
});
```

**Apply as** (strip server-specific paths; common has no `test/setup/`):
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
```

---

### `apps/server/src/db/migrations/YYYYMMDDHHMMSS_seed_canonical_genres.ts` (data-seed migration)

**Analog (structural):** `apps/server/src/db/migrations/20260423221700_backfill_book_authors.ts` (data migration)
**Analog (import style from common):** `apps/server/src/genres/genre-repository.ts` imports from `@koinsight/common/types/genre`

**Imports pattern** (backfill_book_authors.ts lines 1-2):
```typescript
import type { Knex } from 'knex';
import { parseAuthors } from './helpers/parse-authors';
```

**Up-function pattern** (backfill_book_authors.ts lines 9-68) shows `knex.transaction` + `.insert` usage:
```typescript
export async function up(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    const books: Array<{ md5: string; authors: string }> = await trx('book')
      .select('md5', 'authors')
      // ...
    for (const book of books) {
      // ...
      await trx('book_author').insert({ book_md5: book.md5, /* ... */ });
    }
  });
}
```

**Down-function pattern** (backfill_book_authors.ts lines 70-78):
```typescript
export async function down(knex: Knex): Promise<void> {
  // Data-only migration. Rollback drops only the data this migration inserted.
  await knex('book_author').del();
  await knex('author').del();
}
```

**Apply as** (Phase 2, per D-18, D-20, RESEARCH "Migration Pattern: Idempotent Seed" lines 176-193):
```typescript
import type { Knex } from 'knex';
import { CANONICAL_GENRES } from '@koinsight/common/genres';

export async function up(knex: Knex): Promise<void> {
  // SCHEMA-06: idempotent seed. INSERT OR IGNORE preserves any pre-existing
  // rows (dev seed, user-added) and their book_genre FKs (D-20). Re-running is a no-op.
  const rows = CANONICAL_GENRES.map((name) => ({ name }));
  await knex('genre').insert(rows).onConflict('name').ignore();
}

export async function down(knex: Knex): Promise<void> {
  // Non-destructive down: do NOT delete these rows because user-added book_genre
  // rows may reference them. Rollback must be performed manually if ever needed.
}
```

**Convention highlights:**
- Filename pattern: `YYYYMMDDHHMMSS_snake_case.ts` — pick a timestamp strictly after `20260423221700_backfill_book_authors.ts` (Phase 1's last migration). Planner uses current-day timestamp per RESEARCH Open Question 4.
- Simpler than backfill: no transaction needed (single atomic `INSERT OR IGNORE` statement). No row iteration over `book` — this migration is structure-adjacent under SCHEMA-07 (writes literal list to `genre` only, no network, no per-book loop).
- Unlike `backfill_book_authors.ts` (which imports a server-local helper), this imports from `@koinsight/common/genres` — the first migration to do so. Per RESEARCH Pitfall 1, planner must build common before running server tests/migrations.

---

### `apps/server/src/db/migrations/__tests__/phase-02-seed.test.ts` (idempotency integration test)

**Analog (exact):** `apps/server/src/db/migrations/__tests__/phase-01-schema.test.ts`

**Setup pattern** (phase-01-schema.test.ts lines 1-28, 70-89):
```typescript
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import knexFactory, { Knex } from 'knex';

const COMPILED_MIGRATIONS_DIR = join(
  __dirname, '..', '..', '..', '..', 'test', 'dist', 'migrations'
);

describe('Phase 2 seed migration', () => {
  let knex: Knex;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'koinsight-phase2-'));
    const dbFile = join(tmpDir, 'test.db');
    knex = knexFactory({
      client: 'better-sqlite3',
      connection: { filename: dbFile },
      useNullAsDefault: true,
      migrations: {
        directory: COMPILED_MIGRATIONS_DIR,
        extension: 'js',
        loadExtensions: ['.js'],
      },
    });
    await knex.migrate.latest();
  });

  afterAll(async () => {
    await knex.destroy();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

**Apply as** (SCHEMA-06 idempotency verification):
```typescript
it('seeds all CANONICAL_GENRES into the genre table', async () => {
  const rows = await knex('genre').select('name');
  const names = rows.map((r: { name: string }) => r.name);
  for (const g of CANONICAL_GENRES) {
    expect(names).toContain(g);
  }
});

it('is idempotent when migrate.latest() is called again', async () => {
  const before = await knex('genre').count<{ c: number }[]>('* as c');
  // Re-run is a no-op because migrations table tracks completion; to test the SQL itself,
  // invoke the up() function directly or rollback + re-migrate.
  await knex.migrate.rollback({
    directory: COMPILED_MIGRATIONS_DIR, extension: 'js', loadExtensions: ['.js']
  });
  await knex.migrate.latest();
  const after = await knex('genre').count<{ c: number }[]>('* as c');
  expect(Number((after as any)[0].c)).toBe(Number((before as any)[0].c));
});
```

**Convention highlights:**
- tmpdir-based SQLite file, not `:memory:` — follows phase-01-schema.test.ts.
- Always tear down via `afterAll` + `rmSync`.
- Reads compiled `.js` migrations from `apps/server/test/dist/migrations` (per `build:migrations` script).

---

### `apps/server/src/db/seeds/06_genres.ts` (surgical edit)

**Analog:** self (keep all structure).

**Current `GENRES` constant** (lines 8-23):
```typescript
const GENRES = [
  'Fantasy', 'Science Fiction', 'Epic Fantasy', /* ... 14 entries */
];
```

**Apply as** (D-19, RESEARCH Open Question 2):
```typescript
import { CANONICAL_GENRES } from '@koinsight/common/genres';
// ... keep BOOK_GENRE_MAPPING and all existing code below

// Replace:
//   const GENRES = [ /* 14 hardcoded */ ];
// With: use CANONICAL_GENRES directly in the Promise.all loop.

const genres = await Promise.all(
  CANONICAL_GENRES.map((name) => createGenre(db, { name }))
);
```

**Also update** the existing `BOOK_GENRE_MAPPING` type annotation per RESEARCH Open Question 3:
```typescript
import type { CanonicalGenre } from '@koinsight/common/genres';
const BOOK_GENRE_MAPPING: Record<string, CanonicalGenre[]> = {
  'Mistborn': ['Fantasy', 'Epic Fantasy', 'Magic', 'Adventure'],
  // ...
};
```

This makes TS catch any mapping value that no longer exists in `CANONICAL_GENRES` at compile time.

**Update** the existing `console.log` (line 77) to use `CANONICAL_GENRES.length`.

---

### `packages/common/types/index.ts` (no change)

Do not re-export from `genres/` via the `types` barrel. The `genres/` folder is its own subpath module consumed as `@koinsight/common/genres`, matching the `@koinsight/common/types/genre` pattern already used in `apps/server/src/genres/genre-repository.ts:1`.

---

### `turbo.json` (conditional modify, Option A only)

**Current** (lines 14-29): tasks are `build`, `start`, `dev`, `test:coverage`.

**Apply as** (if Option A — tests in common):
```json
"test": {
  "dependsOn": ["^build"],
  "outputs": []
}
```

Ensures `npm --workspace=@koinsight/common test` is wired into `turbo run test`. Option B (tests in `apps/server`) requires no turbo change.

---

## Shared Patterns

### Pure Helper Style (no I/O, no side effects)
**Source:** `apps/server/src/db/migrations/helpers/parse-authors.ts`
**Apply to:** `packages/common/genres/map.ts`

```typescript
// Module-top constants (regex, lookup maps) built once.
// Exported function takes primitives, returns primitives. No Node/browser APIs.
// Guard null/empty early. Use plain JS (split/map/filter) — no ramda unless the code demands it.
```

### vitest Co-located Tests
**Source:** `apps/server/src/db/migrations/helpers/parse-authors.test.ts`
**Apply to:** `packages/common/genres/map.test.ts`, `packages/common/genres/canonical.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { fnUnderTest } from './sibling-module';

describe('fnUnderTest', () => {
  it('returns expected shape for edge case X', () => { /* ... */ });
});
```

One `describe` per exported function; flat `it` list; one assertion per test where feasible.

### `@koinsight/common` Subpath Import
**Source:** `apps/server/src/genres/genre-repository.ts:1` (`import { Genre } from '@koinsight/common/types/genre';`)
**Apply to:** All consumers of `packages/common/genres/*`
- Migration: `import { CANONICAL_GENRES } from '@koinsight/common/genres';`
- Dev seed: same.
- Phase 4 (later): same.

No `exports` map update needed; directory-resolution via `packages/common/genres/index.ts` is sufficient (confirmed by the existing pattern).

### Idempotent Data Migration (INSERT OR IGNORE via Knex)
**Source:** RESEARCH.md lines 176-200 + Knex query-builder docs
**Apply to:** `seed_canonical_genres` migration

```typescript
await knex('genre').insert(rows).onConflict('name').ignore();
```

Single SQL statement, atomic, safe to re-run. Replaces the manual `INSERT OR IGNORE` raw-SQL pattern.

### Plain ASCII Only (repo-wide rule)
**Source:** CLAUDE.md + user global rule (no em-dashes, ASCII only).
**Apply to:** `canonical.ts`, `aliases.ts`, `denylist.ts`, all genre-name strings, all comments.
- No em-dashes (use `,` or `.` or `;`).
- No smart quotes.
- No non-English canonical entries (D-05 enforces this anyway).

### Prettier-only Formatting
**Source:** CLAUDE.md
**Apply to:** Every new/modified file.
- Run `npx prettier --write .` before commit.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/common/vitest.config.ts` | test config | n/a | Workspace currently has no test runner; `apps/server/vitest.config.ts` is the nearest shape but is server-specific (uses setupFiles, coverage-include paths). Planner strips those. |
| `packages/common/genres/map.fixtures.ts` | test fixtures | in-memory | No existing fixtures module in the repo. Pattern is "plain `export const ARRAY: string[] = [...]`" — trivial, no analog required. |

Both files are small and low-risk; the planner can write them directly from RESEARCH.md guidance.

---

## Metadata

**Analog search scope:**
- `apps/server/src/db/migrations/**` (all migrations + __tests__ + helpers)
- `apps/server/src/db/seeds/**`
- `packages/common/**`
- `apps/server/src/genres/**` (for subpath-import evidence)
- Root config (`turbo.json`, `apps/server/vitest.config.ts`)

**Files scanned:** 14 source files read.
**Pattern extraction date:** 2026-04-23

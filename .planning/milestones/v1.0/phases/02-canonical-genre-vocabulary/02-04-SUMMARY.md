---
phase: 02-canonical-genre-vocabulary
plan: 04
subsystem: server/db/seeds
tags: [refactor, dev-seed, canonical-genres, esm-interop]
requires:
  - "@koinsight/common/genres#CANONICAL_GENRES (from 02-01)"
  - "@koinsight/common/genres#CanonicalGenre (from 02-01)"
provides:
  - "Dev seed sourced from canonical tuple (D-19)"
  - "Compile-time drift guard on BOOK_GENRE_MAPPING values"
affects:
  - apps/server/src/db/seeds/06_genres.ts
tech-stack:
  added: []
  patterns:
    - "new Function('p','return import(p)') indirection to preserve native ESM dynamic import across a CJS/ESM boundary"
key-files:
  created: []
  modified:
    - apps/server/src/db/seeds/06_genres.ts
decisions:
  - "Swap 'Military Fiction' -> 'War Fiction' for A Game of Thrones (closest canonical peer; 'Military Science Fiction' was rejected as semantically wrong for the medieval fantasy title)"
  - "Use dynamic import() hidden behind new Function(...) rather than adding @koinsight/common to the static import graph of this CJS seed file. Rationale: @koinsight/common has type:module; server/tsconfig.json has module:commonjs; a static require() of the ESM common package fails with ERR_REQUIRE_ESM. Type-only import stays at the top (erased at emit time) so the compile-time safety from Record<string, CanonicalGenre[]> is preserved."
  - "Dynamic import points at packages/common/dist/genres/canonical.js (not index.js). Native ESM resolver rejects directory imports and extensionless relative specifiers emitted by the common package's 'module: ESNext' tsc build. canonical.js is a leaf module (no relative imports), so pointing directly at it sidesteps both limits without rebuilding the common package."
metrics:
  duration: "~25min"
  completed: 2026-04-23
tasks_completed: 1
tasks_total: 1
---

# Phase 2 Plan 4: Refactor Dev Seed to Canonical Genres Summary

**One-liner:** `apps/server/src/db/seeds/06_genres.ts` now sources its genre list from `@koinsight/common/genres#CANONICAL_GENRES` via a native dynamic ESM import, with `BOOK_GENRE_MAPPING` compile-time-typed to `Record<string, CanonicalGenre[]>` to catch future canonical-list drift.

## Changes

### Modified Files

**`apps/server/src/db/seeds/06_genres.ts`** (+31 / -28):
- Dropped the local 14-entry `GENRES` array.
- Kept `BOOK_GENRE_MAPPING` with identical entries, but tightened its type from `{ [key: string]: string[] }` to `Record<string, CanonicalGenre[]>`.
- Introduced a type-only import `import type { CanonicalGenre } from '@koinsight/common/genres'` at the top (erased at emit time; no runtime require).
- Fetched `CANONICAL_GENRES` via a dynamic import inside the async `seed()` function (see Decisions below for why).

### BOOK_GENRE_MAPPING swaps

- **`A Game of Thrones`**: `'Military Fiction'` -> `'War Fiction'`.
  - Reason: `'Military Fiction'` is not in the shipped `CANONICAL_GENRES` tuple (`packages/common/genres/canonical.ts`). The canonical peers are `'Military Science Fiction'` (wrong; the book is fantasy, not SF) and `'War Fiction'` (correct; GoT is a medieval war saga). The compile-time type guard forced the choice.

No other mapping entries required adjustment; every other value (`Fantasy`, `Epic Fantasy`, `Adventure`, `Magic`, `Sword and Sorcery`, `Science Fiction`, `Space Opera`, `Hard Science Fiction`) is present in `CANONICAL_GENRES` verbatim.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] CJS/ESM boundary prevented static import of `@koinsight/common/genres`**

- **Found during:** Task 1, smoke-testing `npm run seed`.
- **Issue:** The plan's (a) step specified a static `import { CANONICAL_GENRES } from '@koinsight/common/genres';`. The server workspace compiles seeds as CommonJS (`apps/server/tsconfig.json` has `module: commonjs`), while `packages/common/package.json` declares `"type": "module"`. ts-node's CJS loader refused the require with `ERR_REQUIRE_ESM`: "Must use import to load ES Module". The server build (tsc) passed cleanly because the TS compiler only checks types, not runtime loader rules. So the plan's strongest compile-time check was met but the plan's (g) step (manual `npm run seed` smoke) failed.
- **Fix:** Replaced the value import with a runtime dynamic import hidden behind `new Function('p', 'return import(p)')` so TypeScript's CJS downleveler does not rewrite it into `require()`. Kept the `CanonicalGenre` type import at file top (erased at emit). Pointed the import at the built `packages/common/dist/genres/canonical.js` because (i) the native ESM resolver does not honor directory imports (`@koinsight/common/genres` -> directory), and (ii) `dist/genres/index.js` uses extensionless relative specifiers (`export * from './canonical'`) that the strict ESM resolver rejects. `canonical.js` is a leaf with no relative imports, so it loads cleanly.
- **Files modified:** `apps/server/src/db/seeds/06_genres.ts`
- **Commit:** de625c2

**2. [Rule 2 - Missing critical functionality] Swap `Military Fiction` to a canonical value**

- **Found during:** Task 1, applying the tightened `Record<string, CanonicalGenre[]>` type.
- **Issue:** The plan's (c) step explicitly anticipated this and instructed the executor to either add the missing genre to `canonical.ts` or swap to a present canonical. Adding `'Military Fiction'` would have been redundant with the already-present `'Military Science Fiction'` and `'War Fiction'` (D-04 says peers coexist, but three near-synonyms crowds the list).
- **Fix:** Swapped to `'War Fiction'`. Documented above under BOOK_GENRE_MAPPING swaps.
- **Commit:** de625c2

## Known Stubs

None.

## Threat Flags

None. All changes are dev-seed scoped; no new trust boundary, no new network/auth/file surface.

## Verification

| Check | Result |
|---|---|
| `npm --workspace=@koinsight/common run build` | exits 0 |
| `npm --workspace=server run build` (strongest compile-time check that every `BOOK_GENRE_MAPPING` value is a valid `CanonicalGenre`) | exits 0 |
| `npx prettier --check apps/server/src/db/seeds/06_genres.ts` | exits 0 |
| `grep -c "const GENRES = \\[" apps/server/src/db/seeds/06_genres.ts` | 0 |
| `grep -c "CANONICAL_GENRES" apps/server/src/db/seeds/06_genres.ts` | 4 |
| `grep -c "Record<string, CanonicalGenre\\[\\]>" apps/server/src/db/seeds/06_genres.ts` | 1 |
| `npm run seed` on fresh dev DB | "Seeded 76 genres with book associations", Ran 7 seed files |
| `SELECT COUNT(*) FROM genre` | 76 (= `CANONICAL_GENRES.length`, within D-02's [60,80]) |
| `SELECT COUNT(*) FROM book_genre` | 31 (non-zero; reflects the 10-book mapping) |

## Tasks

- [x] Task 1: Refactor 06_genres.ts to consume CANONICAL_GENRES -> commit `de625c2`

## Follow-ups / Notes for Future Plans

- The dev seed now depends on the compiled `packages/common/dist/genres/canonical.js` at runtime. Adding `@koinsight/common` to the Turbo `seed` task's `dependsOn` (so `common#build` runs first) would make the dependency explicit; out of scope for this surgical plan but worth considering if a future contributor runs `npm run seed` after a clean checkout without building common.
- If the project later migrates `apps/server` to ESM (or switches the common package to dual CJS/ESM publish), the `new Function(...)` indirection can be replaced with a plain `import ... from '@koinsight/common/genres'` at the top of the file. The `CanonicalGenre` type import already models the long-term shape.

## Self-Check: PASSED

- **File `apps/server/src/db/seeds/06_genres.ts`:** FOUND
- **Commit `de625c2`:** FOUND (`git log --oneline | grep de625c2`)

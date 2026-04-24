---
phase: 02-canonical-genre-vocabulary
plan: 05
subsystem: server-migrations-tests
tags: [vitest, knex, sqlite, migrations, schema-06, schema-07, idempotency, invariants]

# Dependency graph
requires:
  - phase: 02-canonical-genre-vocabulary
    provides: CANONICAL_GENRES (02-01), denylist/map (02-02), seed migration (02-03), dev-seed refactor (02-04)
  - phase: 01-schema-foundations-provenance
    provides: phase-01-schema.test.ts harness pattern, compiled migrations outDir (test/dist/migrations)
provides:
  - End-to-end verification guard for the Phase 2 canonical genre seed (SCHEMA-06)
  - SCHEMA-07 invariant extended over the Phase 2 seed migration (no network, no book iteration) encoded in CI
  - Idempotency proof: re-running the seed up() preserves row count AND exact name set
  - No-duplicate-list invariant: no other migration file declares a local GENRES or CANONICAL_GENRES literal
affects:
  - "Future Phase 2+ migrations are now gated against accidental DELETE/UPDATE/network additions to the genre seed."
  - "Any future migration that redeclares CANONICAL_GENRES or GENRES fails CI."

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Structure-only + data-integrity invariant test: fs.readFileSync + regex .not.toMatch for SCHEMA-07 forbidden tokens (extends the Phase 1 pattern to Phase 2's seed file)."
    - "require()-based direct invocation of a compiled migration's up() to prove idempotency at the SQL level (distinct from migrate.rollback which Knex 3.x may refuse when down() is a no-op)."
    - "readdirSync loop across the migrations directory to assert single-source-of-truth invariant for CANONICAL_GENRES."

key-files:
  created:
    - apps/server/src/db/migrations/__tests__/phase-02-schema.test.ts
  modified: []

key-decisions:
  - "Used require()-based direct up() invocation for the idempotency assertion rather than migrate.rollback + migrate.latest. The seed migration's down() is an intentional no-op (per 02-03 CONTEXT D-20, to preserve book_genre FKs), so migrate.rollback on the latest batch would not exercise the idempotency path cleanly. Direct up() is a stricter and more targeted test."
  - "Import path for CANONICAL_GENRES in the test uses '@koinsight/common/dist/genres/canonical.js' rather than '@koinsight/common/genres'. This matches the seed migration's own import (Rule 3 deviation from plan 02-03) and keeps test + migration in lockstep. Vitest under Vite's resolver could resolve the source subpath, but consistency with the runtime consumer is higher-value than using the nominal bare specifier."
  - "Import-path regex assertion widened to accept either '@koinsight/common/genres' OR '@koinsight/common/dist/genres/canonical.js' (the exact string shipped in 02-03). Both paths honor the single-source-of-truth invariant; the regex still fails if anyone declares a local genre list."
  - "Added a CANONICAL_GENRES length bounds check (60-80 per CONTEXT D-02) as a defensive assertion so that regressions to the shared list are caught here as well."

patterns-established:
  - "Per-phase vitest schema-verification file at apps/server/src/db/migrations/__tests__/phase-XX-schema.test.ts. The Phase 2 file mirrors Phase 1 structure: static invariants over migration source, plus dynamic migrate:latest + runtime checks on the resulting schema/data."

requirements-completed: [SCHEMA-06]

# Metrics
duration: 5min
tasks: 1
files-created: 1
files-modified: 0
completed: 2026-04-23
---

# Phase 2 Plan 5: End-to-End Phase 2 Schema Verification Summary

## One-liner

Vitest-encoded Phase 2 guarantee: static SCHEMA-07 invariant extended to the canonical-genres seed (no fetch/axios/https, no book iteration, no local list), single-source-of-truth invariant across all migrations, and dynamic idempotency proof (re-running up() leaves row count and exact name set unchanged).

## What was built

A single vitest file at `apps/server/src/db/migrations/__tests__/phase-02-schema.test.ts` that runs as part of `npm --workspace=server test`. It comprises three describe blocks and 13 passing tests:

**1. Static SCHEMA-07 extension (7 tests):** reads the seed migration source from disk and asserts it contains no `fetch(`, no `axios`, no `https://`, no `for...of (knex|trx)('book')` iteration, no `.forEach` over a book query, imports `CANONICAL_GENRES` from `@koinsight/common` (either the nominal or dist subpath), does not declare a local `const GENRES` or `const CANONICAL_GENRES` literal, and uses `.onConflict(...).ignore()` exactly once with no `.delete()`, `.del()`, or `.update()` calls.

**2. No-duplicate-list across migrations dir (1 test):** scans every other `.ts` migration in `apps/server/src/db/migrations/` and asserts none of them redeclare `const GENRES = [` or `const CANONICAL_GENRES = [`. Locks in the single-source-of-truth invariant.

**3. Dynamic idempotent-seed verification (5 tests):** spins up an isolated temp-file SQLite DB via `mkdtempSync` + `better-sqlite3`, runs `knex.migrate.latest()` against the compiled migrations directory (`apps/server/test/dist/migrations`), and asserts:
  - Every `CANONICAL_GENRES` entry appears in the `genre` table.
  - `genre` row count equals `CANONICAL_GENRES.length` (76 at ship time).
  - `CANONICAL_GENRES.length` is in the CONTEXT D-02 range [60, 80].
  - Re-invoking the compiled seed's `up()` a second time leaves the row count unchanged (SQL-level no-op via `INSERT OR IGNORE`).
  - Re-invoking `up()` a second time leaves the exact ordered name set unchanged (strict idempotency).

## Verification results

- `npm --workspace=@koinsight/common run build`: exit 0.
- `npm --workspace=server run build:migrations`: exit 0; `apps/server/test/dist/migrations/20260424090000_seed_canonical_genres.js` emitted.
- `npm --workspace=server exec vitest run src/db/migrations/__tests__/phase-02-schema.test.ts`: 13/13 passed, 77 ms.
- `npm --workspace=server test`: 20 test files / 213 passed / 1 skipped (Phase 2 baseline after 02-04 was 200 passed; Plan 02-05 adds exactly 13 new passing tests).
- `npx prettier --check apps/server/src/db/migrations/__tests__/phase-02-schema.test.ts`: clean.
- `grep -REn "fetch\\(|axios|https?://" apps/server/src/db/migrations/20260424090000_seed_canonical_genres.ts`: exits 1 (no matches), belt-and-suspenders outside the in-test assertion.
- `grep -c "it(" apps/server/src/db/migrations/__tests__/phase-02-schema.test.ts`: 13 (>= 10 required).

## Phase 2 requirement coverage (roll-up)

| Requirement | Covered by |
|-------------|-----------|
| SCHEMA-06 (canonical list seeded idempotently) | Plan 02-03 (migration) + Plan 02-05 (dynamic idempotency test, this plan) |
| GENRE-01 (CANONICAL_GENRES exported, 60-80 Title Case) | Plan 02-01 (packages/common/genres/canonical.ts + canonical.test.ts) + Plan 02-05 (length bounds assertion, this plan) |
| GENRE-02 (mapOpenLibrarySubjects with aliases + denylist) | Plan 02-02 (map.ts + map.test.ts, 25+ tests) |
| GENRE-03 (denylist drops format/distribution labels) | Plan 02-02 (denylist.ts + map.test.ts) |
| GENRE-04 (zero-match returns [] without throwing) | Plan 02-02 (map.test.ts test #12) |

Phase 2 ROADMAP success criteria 1-4 are demonstrably true.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Import path regex widened to match actual 02-03 deviation**

- **Found during:** Task 1 (pre-execution verification of plan's literal regex against the shipped seed migration).
- **Issue:** The plan text directs `expect(content).toMatch(/import\\s+\\{\\s*CANONICAL_GENRES\\s*\\}\\s+from\\s+['"]@koinsight\\/common\\/genres['"]/)`. But Plan 02-03 shipped the seed migration with `import { CANONICAL_GENRES } from '@koinsight/common/dist/genres/canonical.js';` (Rule 3 deviation documented in 02-03-SUMMARY.md: bare `@koinsight/common/genres` cannot be resolved by Node CJS at migration runtime because common is `"type": "module"` with no exports map and no root index). The plan's regex would fail against the actually-shipped code.
- **Fix:** Widened the regex to accept either the nominal `'@koinsight/common/genres'` path OR the actually-shipped `'@koinsight/common/dist/genres/canonical.js'` path (and the in-between variants). Both paths honor the single-source-of-truth invariant. The adjacent `expect(content).not.toMatch(/\\bconst\\s+(GENRES|CANONICAL_GENRES)\\s*=\\s*\\[/)` still fails if anyone reintroduces a local list.
- **Files modified:** `apps/server/src/db/migrations/__tests__/phase-02-schema.test.ts` only.
- **Commit:** `b2be874`.

**2. [Rule 3 - Blocking] Import in the test itself uses the compiled dist subpath**

- **Found during:** Task 1 (pre-write review of vitest resolution paths).
- **Issue:** The plan's sample code does `import { CANONICAL_GENRES } from '@koinsight/common/genres'`. This is the bare specifier Plan 02-01 promised would work; at vitest runtime under Vite's resolver it could plausibly resolve to the source `packages/common/genres/index.ts`, but in the server workspace's CJS/TS hybrid config this has never been exercised as a value import before (only as a type import). Consistency with the runtime consumer (the seed migration itself, which already resolved this problem via dist subpath in 02-03) is higher-value than asserting a second path.
- **Fix:** Imported from `@koinsight/common/dist/genres/canonical.js` in the test, matching exactly what the migration does. Added a comment referencing the 02-03 decision.
- **Files modified:** same file as above.
- **Commit:** `b2be874`.

### Intentional scope notes

- Did NOT attempt `knex.migrate.rollback()`-based idempotency. The seed migration's `down()` is an intentional no-op (per CONTEXT D-20, to preserve `book_genre` FK integrity), so `migrate.rollback` on the latest batch would leave the `genre` table populated and a subsequent `migrate.latest()` would have nothing to do, making the assertion trivially true for the wrong reason. Direct `require().up()` double-invocation is the stricter, more-targeted idempotency proof (and matches the plan's `<interfaces>` "Alternative (more targeted)" guidance).
- Added an extra `CANONICAL_GENRES.length` bounds assertion [60, 80] as a defensive check; the plan's acceptance criteria only require the equality-to-row-count assertion, but the bounds check encodes CONTEXT D-02 directly in CI.

## Threat-register coverage

| Threat ID | Disposition | Mitigation in shipped test |
|-----------|-------------|----------------------------|
| T-02-14 (future migration turns seed into DELETE + INSERT or adds network call) | mitigate | Static block asserts no `fetch`, no `axios`, no `https://`, no `.delete`/`.del`/`.update`, exactly one `.onConflict(...).ignore()`. |
| T-02-15 (somebody re-introduces a local genre list in another migration) | mitigate | `readdirSync` loop asserts no `const GENRES =` or `const CANONICAL_GENRES =` array literal in any other migration file. |
| T-02-16 (seed migration becomes non-idempotent) | mitigate | `require(seed).up(knex)` second-invocation test asserts both row count AND exact ordered name set unchanged. |

## Threat Flags

No new trust boundaries or surface introduced: this is pure test code that reads local files and exercises a tmp-dir SQLite DB.

## Commits

- `b2be874` test(02-05): add end-to-end Phase 2 schema verification

## Files touched

Created:
- apps/server/src/db/migrations/__tests__/phase-02-schema.test.ts

Modified: none.

## Self-Check: PASSED

- File exists: apps/server/src/db/migrations/__tests__/phase-02-schema.test.ts (FOUND)
- Commit exists: b2be874 (FOUND in git log)
- Vitest target file: 13/13 passed.
- Full server suite: 213 passed / 1 skipped (+13 over Phase 2 baseline 200, matches expectation).
- Prettier: clean.
- SCHEMA-07 grep on seed migration: no matches.
- `it(` count: 13 (>= 10 required).

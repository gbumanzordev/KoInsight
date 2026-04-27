---
phase: 02-canonical-genre-vocabulary
plan: 03
subsystem: server-migrations
tags: [apps/server, knex, migrations, genres, schema-06, idempotent-seed]
requires:
  - "02-01 (CANONICAL_GENRES exported from @koinsight/common)"
provides:
  - "Idempotent seed migration for the genre table (SCHEMA-06)"
  - "Production deployments auto-apply the 76-entry canonical list on next migrate:latest"
affects:
  - "Dev DBs seeded with the 14-entry 06_genres.ts list silently absorb new entries on next migrate"
  - "Consumes packages/common/dist/genres/canonical.js at migration runtime (first runtime consumer of @koinsight/common from CJS)"
tech-stack:
  added: []
  patterns:
    - "Knex .insert(rows).onConflict('name').ignore() for idempotent seed"
    - "Non-destructive down() to preserve FK integrity"
key-files:
  created:
    - "apps/server/src/db/migrations/20260424090000_seed_canonical_genres.ts"
  modified: []
decisions:
  - "Imported from '@koinsight/common/dist/genres/canonical.js' instead of the plan-specified '@koinsight/common/genres'. The latter cannot be resolved by Node CJS at runtime because common is `type: module` with no root index.js and no exports map; directory resolution of the 'genres' subpath has nothing to land on. Using the explicit compiled-dist subpath avoids modifying the shared package boundary (a broader architectural change that would belong in its own plan)."
  - "Left packages/common/package.json and common's tsconfig untouched. Plan 02-02 / 02-04 may revisit common's exports/boundary if multiple runtime consumers accumulate."
metrics:
  duration_minutes: 12
  tasks_completed: 1
  files_touched: 1
  completed: 2026-04-23
---

# Phase 2 Plan 3: Seed Canonical Genres Migration Summary

Shipped the SCHEMA-06 migration: a single Knex file that INSERT-OR-IGNOREs all 76 CANONICAL_GENRES into the existing `genre(id, name UNIQUE)` table. Idempotent by construction (the UNIQUE(name) constraint makes re-inserts SQL-level no-ops); safe against existing `book_genre` FKs (no DELETE, no UPDATE, non-destructive down()).

## What shipped

- `apps/server/src/db/migrations/20260424090000_seed_canonical_genres.ts`:
  - `up()` builds `rows = CANONICAL_GENRES.map(name => ({ name }))` and runs a single `knex('genre').insert(rows).onConflict('name').ignore()` statement.
  - `down()` is an intentional no-op (empty body + comment) per CONTEXT D-20 to preserve user-edited rows and `book_genre` FKs.
  - Timestamp `20260424090000` sorts strictly after Phase 1's last migration `20260423221700_backfill_book_authors.ts`.
  - 76 genres are well under the SQLite 999 bind-var limit (T-02-10 accepted).
  - Zero network calls, no per-book iteration, writes only to `genre` (SCHEMA-07 invariant).

## Verification

- `npm --workspace=@koinsight/common run build` exits 0; `packages/common/dist/genres/canonical.js` present.
- `npm --workspace=server run build:migrations` exits 0; `apps/server/test/dist/migrations/20260424090000_seed_canonical_genres.js` emitted.
- `node -e "require('.../20260424090000_seed_canonical_genres.js')"` smoke test: `up: function, down: function`, `CANONICAL_GENRES.length === 76`.
- `npm --workspace=server test`: 19 test files passed, 200 tests passed, 1 skipped. Matches Phase 1 baseline exactly (no regression).
- `npx prettier --check` on the new file exits 0.
- `grep -En "fetch\(|axios|https?://|for\s*\(\s*const\s+\w+\s+of\s+(await\s+)?(knex|trx)\(.book.\)" ...` returns nothing (SCHEMA-07 grep-check).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] Import path cannot be resolved at CJS runtime**

- **Found during:** Task 1 verification (smoke test of compiled migration).
- **Issue:** The plan's acceptance criterion specified `import { CANONICAL_GENRES } from '@koinsight/common/genres';`. Plan 02-01 asserted this would resolve via Node directory resolution without a package.json `exports` map. It does not at runtime for CJS consumers: `packages/common/package.json` has `"type": "module"` with no `main`, no `exports`, and no root `dist/index.js`. Node's CJS resolution of `@koinsight/common/genres` walks `packages/common/genres/` looking for `genres.js` or `genres/index.js` and finds only `.ts` source. `node_modules/@koinsight/common` is a symlink to `packages/common`, so the worktree's own `node_modules` (after `npm install`) points at the same source tree. First runtime consumer of `@koinsight/common` from CJS, so this had never been exercised; every other consumer uses type-only imports that TS erases.
- **Fix:** Changed the import to `import { CANONICAL_GENRES } from '@koinsight/common/dist/genres/canonical.js';`. Node CJS resolves this because the explicit subpath lands on an emitted `.js` file. `require(esm)` is supported on Node >= 22 (project engine floor is Node 22), so the ESM-emitted file loads cleanly. Verified `CANONICAL_GENRES.length === 76` at runtime.
- **Files modified:** `apps/server/src/db/migrations/20260424090000_seed_canonical_genres.ts` only. Did not touch `packages/common/package.json`, `packages/common/tsconfig.json`, or any common source — the alternative (adding an `exports` map, fixing extensionless ESM relative imports, adding a root index) is a cross-cutting boundary change and belongs in its own plan if more runtime consumers accrue.
- **Commit:** `354f623`

### Intentional scope notes

- Idempotency integration test is deferred to Plan 02-05 per the plan's own `<done>` clause; not re-proving it here.
- Dev-seed refactor (06_genres.ts) is out of scope for 02-03; Plan 02-04 owns that.

## Threat-register coverage

| Threat ID | Disposition | Mitigation in shipped code |
|-----------|-------------|----------------------------|
| T-02-08 (future edit adds DELETE/UPDATE on genre) | mitigate | File comment spells out the SCHEMA-07 / D-20 invariant. Plan 02-05 will add an automated structural check. |
| T-02-09 (future edit imports a different genre list) | mitigate | File comment declares `@koinsight/common` as the single source of truth. Import points at the compiled artifact of that same module. |
| T-02-10 (oversized list exceeds SQLite bind cap) | accept | 76 < 999; canonical.test.ts caps list length at 80. |
| T-02-11 (migration logs genre rows) | accept | Migration has no logging; Knex query logging is not enabled in this repo. |

## Threat Flags

No new trust boundaries or surface introduced: the migration runs at deploy time against the local SQLite DB with a hard-coded list only.

## Commits

- `354f623` feat(02-03): seed canonical genres via idempotent migration

## Self-Check: PASSED

- [x] `apps/server/src/db/migrations/20260424090000_seed_canonical_genres.ts` exists on disk
- [x] Compiled output `apps/server/test/dist/migrations/20260424090000_seed_canonical_genres.js` emitted
- [x] Commit `354f623` present in `git log`
- [x] `npm --workspace=server test` exits 0 with 200 passed / 1 skipped (Phase 1 parity)
- [x] `npx prettier --check` passes
- [x] SCHEMA-07 grep returns empty
- [x] `up()` contains exactly one `.onConflict('name').ignore()` call
- [x] `down()` is a no-op (comment-only body)

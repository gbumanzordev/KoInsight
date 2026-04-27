---
phase: 02-canonical-genre-vocabulary
plan: 01
subsystem: shared-types
tags: [packages/common, vitest, genres, canonical-list, turbo]
requires: []
provides:
  - "CANONICAL_GENRES constant (readonly tuple, 76 Title Case ASCII entries)"
  - "CanonicalGenre type (string-literal union derived from CANONICAL_GENRES)"
  - "@koinsight/common/genres subpath module with barrel export"
  - "Vitest test infrastructure in packages/common (vitest.config.ts + scripts)"
  - "Turbo `test` pipeline task wired with dependsOn ^build"
affects:
  - "Unblocks plans 02-02 (map.ts), 02-03 (seed migration), 02-04 (dev seed refactor)"
tech-stack:
  added:
    - "vitest 4.0.16 in @koinsight/common (matches apps/server version exactly)"
  patterns:
    - "readonly as-const tuple + typeof X[number] type derivation (D-17)"
    - "packages/common subpath import via directory resolution (no exports map)"
    - "co-located vitest *.test.ts next to source module"
key-files:
  created:
    - "packages/common/vitest.config.ts"
    - "packages/common/genres/canonical.ts"
    - "packages/common/genres/canonical.test.ts"
    - "packages/common/genres/index.ts"
  modified:
    - "packages/common/package.json (added test/test:watch scripts + vitest devDependency)"
    - "turbo.json (added `test` pipeline task)"
    - "package-lock.json (hoisted vitest)"
decisions:
  - "Shipped 76 canonical entries (within 60-80 per D-02) from the RESEARCH starter list: 28 fiction-genre core + 10 form/audience + 6 misc/themes + 22 non-fiction core + 8 arts/lifestyle + 2 poetry/drama."
  - "Kept the barrel minimal (export * from ./canonical) because 02-02 will add aliases/denylist/map; avoids churn when that plan lands."
  - "Used vitest 4.0.16 exact version (not caret) to match apps/server/package.json byte-for-byte per Task 1 instructions and avoid two vitest copies in workspace hoisting."
metrics:
  duration_minutes: 6
  tasks_completed: 2
  files_touched: 7
  completed: 2026-04-23
---

# Phase 2 Plan 1: Canonical Genre Vocabulary Foundation Summary

Stood up the `@koinsight/common/genres` subpath module with `CANONICAL_GENRES` (76-entry readonly tuple) and `CanonicalGenre` type, plus vitest 4.0.16 test infrastructure in `packages/common` and a new `test` task in `turbo.json`. This is the type-contract foundation that unblocks plans 02-02, 02-03, 02-04 to run in parallel.

## What shipped

- `packages/common/genres/canonical.ts` exports a readonly tuple of 76 Title Case ASCII genre names, grouped by section comments (Fiction core, Form/Audience, Misc/Themes, Non-fiction core, Arts/Lifestyle, Poetry/Drama). Derived `CanonicalGenre = typeof CANONICAL_GENRES[number]` gives downstream code compile-time string-literal safety.
- `packages/common/genres/canonical.test.ts` ships 4 shape assertions: size in [60, 80] (D-02), uniqueness (set-size equals array length), Title Case start + printable-ASCII (D-03, T-02-01), and absence of blanket `Fiction`/`Nonfiction`/`Non-fiction`/`Non fiction` umbrellas (D-13).
- `packages/common/genres/index.ts` is the barrel; single `export * from './canonical'`. 02-02 will append aliases/denylist/map exports.
- `packages/common/vitest.config.ts` mirrors the server config stripped of server-specific paths (no setupFiles, no coverage block): `globals: true`, `environment: 'node'`, `include: ['**/*.test.ts']`, `exclude: ['dist/**', 'node_modules/**']`.
- `packages/common/package.json` gained `test` + `test:watch` scripts and `vitest: "4.0.16"` (exact match with apps/server).
- `turbo.json` gained a top-level `tasks.test` entry with `dependsOn: ["^build"]` and `outputs: []` so Turbo picks up the new workspace test task.

## Verification

- `npm --workspace=@koinsight/common run build` emitted `packages/common/dist/genres/canonical.js` and `.d.ts`, confirmed via `ls`.
- `npm --workspace=@koinsight/common test` reports `Test Files 1 passed (1) | Tests 4 passed (4)` at 164ms total.
- `npm --workspace=server test` still reports 200 passed / 1 skipped across 19 files (no phase-1 regression).
- `npx prettier --check packages/common/genres/ packages/common/vitest.config.ts packages/common/package.json turbo.json` reports `All matched files use Prettier code style!`.
- `npm install` exits 0; `node_modules/vitest` hoisted into the root workspace.

## Deviations from Plan

None - plan executed exactly as written. The 76-entry starter list from RESEARCH §"Canonical List Recommendation" is within [60, 80] and needed no trimming/expansion. vitest 4.0.16 was pinned (no caret) because apps/server pins it that way and Task 1 step (b) instructs matching byte-for-byte.

## Threat-register coverage

| Threat ID | Disposition | Mitigation in shipped code |
|-----------|-------------|----------------------------|
| T-02-01 (non-ASCII canonical entry) | mitigate | canonical.test.ts asserts `/^[\x20-\x7e]+$/` per entry. |
| T-02-02 (list size drift) | mitigate | canonical.test.ts asserts `>=60` and `<=80`. |
| T-02-03 (silent duplicate entry) | mitigate | canonical.test.ts asserts `new Set(...).size === length`. |

All three STRIDE threats have CI-backed mitigations.

## Commits

- `af29e1e` chore(02-01): scaffold vitest in packages/common and add turbo test task
- `522bd73` feat(02-01): add CANONICAL_GENRES constant, type, barrel, and shape tests

## Downstream contract (locked)

```typescript
// Consumers in plans 02-02, 02-03, 02-04, and later Phase 4/5 code import via:
import { CANONICAL_GENRES, type CanonicalGenre } from '@koinsight/common/genres';

// CANONICAL_GENRES is readonly tuple of exactly 76 string literals.
// CanonicalGenre is the string-literal union of those 76 names.
```

## Self-Check: PASSED

- [x] `packages/common/vitest.config.ts` exists
- [x] `packages/common/genres/canonical.ts` exists
- [x] `packages/common/genres/canonical.test.ts` exists
- [x] `packages/common/genres/index.ts` exists
- [x] `packages/common/dist/genres/canonical.js` + `.d.ts` emitted by build
- [x] Commit `af29e1e` present in `git log --oneline`
- [x] Commit `522bd73` present in `git log --oneline`
- [x] 4 canonical.test.ts assertions pass
- [x] Server test suite unchanged (200 passed / 1 skipped)

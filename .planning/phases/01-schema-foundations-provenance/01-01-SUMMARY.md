---
phase: 01-schema-foundations-provenance
plan: 01
subsystem: database
tags: [typescript, vitest, tdd, migrations, parser]

# Dependency graph
requires:
  - phase: none
    provides: baseline migration directory layout and vitest runner
provides:
  - Pure parseAuthors(input) string parser implementing D-03..D-07
  - 17 vitest cases validating all parser semantics
  - New apps/server/src/db/migrations/helpers/ subdirectory convention
affects: [01-06 backfill migration, future enrichment planners]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Migration helpers live under apps/server/src/db/migrations/helpers/ as pure functions with colocated .test.ts"

key-files:
  created:
    - apps/server/src/db/migrations/helpers/parse-authors.ts
    - apps/server/src/db/migrations/helpers/parse-authors.test.ts
  modified: []

key-decisions:
  - "Suffix merge (D-05) runs before LN-FN flip (D-04) so 'Strunk, Jr., William' becomes 'William Strunk Jr.'"
  - "LN-FN flip only triggers when the ORIGINAL input has commas only (no &, ;, or whole-word and) AND merged segment count is exactly 2"
  - "Segments with no letters at all (/^[^A-Za-z]*$/) are dropped as suspicious; surviving authors get contiguous positions"

patterns-established:
  - "Pure, I/O-free helpers colocated with tests in migrations/helpers/; imported by migration files, covered by npm --workspace=server test"

requirements-completed:
  - SCHEMA-08

# Metrics
duration: 2min
completed: 2026-04-23
---

# Phase 1 Plan 1: Author Parser (parseAuthors) Summary

**Pure parseAuthors(input) deterministic string parser with 17 vitest cases, lands ahead of the Migration 4 backfill in Plan 01-06.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-23T22:29:07Z
- **Completed:** 2026-04-23T22:31:00Z (approx)
- **Tasks:** 2 (RED + GREEN)
- **Files modified:** 2 created

## Accomplishments
- 17 failing vitest cases authored first (RED) covering D-03..D-07 verbatim
- Pure parseAuthors implementation passing all 17 cases (GREEN) with zero I/O, zero external data, zero Knex imports
- New migrations/helpers/ subdirectory convention established for parser-like pure helpers that later migrations import
- Full apps/server test suite still green (180 passed, 1 pre-existing skip)

## Task Commits

Each task was committed atomically:

1. **Task 1: RED - write failing parser tests** - `6781850` (test)
2. **Task 2: GREEN - implement parseAuthors** - `57f9346` (feat)

_Note: Plan is type: tdd. REFACTOR gate skipped because initial implementation was already minimal and clean, no duplication or complexity warranting a second pass._

## Files Created/Modified
- `apps/server/src/db/migrations/helpers/parse-authors.ts` - Pure parseAuthors(input) function plus ParsedAuthor type
- `apps/server/src/db/migrations/helpers/parse-authors.test.ts` - 17 vitest cases covering null/undefined/empty/pure-punctuation, single author, separator variants (&, ;, comma, and), periods-are-not-separators, LN-FN flip with and without suffix merge, whitespace collapse

## Decisions Made
- Followed the plan implementation verbatim; no alternate strategies considered since D-03..D-07 are locked decisions from 01-CONTEXT.md.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Rebuilt better-sqlite3 native binding**
- **Found during:** Task 2 verification (first vitest run)
- **Issue:** vitest setup file (test/setup/test-setup.ts) imports the shared Knex instance which loads better-sqlite3. The native binding was compiled against NODE_MODULE_VERSION 127; the active Node runtime is v25.6.1 which requires NODE_MODULE_VERSION 141. The setup failure caused the entire test file to be skipped even though parse-authors.ts itself has no DB dependency. This would also have prevented running any server-side test.
- **Fix:** Ran `npm rebuild better-sqlite3` to recompile the native binding for the active Node version.
- **Files modified:** node_modules only (package-lock.json unchanged by rebuild; its pre-existing M from before this session is untouched).
- **Verification:** Re-ran vitest; the 17 parser cases now execute and pass. Full `npm --workspace=server test` also green (180 passed).
- **Committed in:** Not committed - native binaries under node_modules/ are not tracked; the rebuild produces no repo diff.

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Deviation was environmental (developer machine Node upgrade) and did not alter plan scope or code shipped. No scope creep.

## Issues Encountered
- None beyond the Rule 3 environment fix above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Parser is ready for Plan 01-06 (Migration 4 backfill) to import via `import { parseAuthors } from './helpers/parse-authors'`.
- No blockers. Subsequent plans in Wave 1 (01-02 author/book_author migration, 01-03 enrichment_job migration) are unblocked and independent of this one.

## Self-Check: PASSED

- FOUND: apps/server/src/db/migrations/helpers/parse-authors.ts
- FOUND: apps/server/src/db/migrations/helpers/parse-authors.test.ts
- FOUND commit: 6781850 (test)
- FOUND commit: 57f9346 (feat)

---
*Phase: 01-schema-foundations-provenance*
*Completed: 2026-04-23*

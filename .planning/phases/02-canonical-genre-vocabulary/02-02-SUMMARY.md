---
phase: 02-canonical-genre-vocabulary
plan: 02
subsystem: shared-library
tags: [typescript, vitest, openlibrary, genres, pure-function, tdd]

requires:
  - phase: 02-canonical-genre-vocabulary/01
    provides: CANONICAL_GENRES tuple + CanonicalGenre type + packages/common vitest scaffolding
provides:
  - Pure synchronous mapOpenLibrarySubjects(string[]) -> CanonicalGenre[]
  - GENRE_ALIASES object (60+ entries, values type-checked against CanonicalGenre)
  - SUBJECT_DENYLIST exact-match Set (70+ entries covering format, marketing, provenance, language, reading-level noise)
  - 10 real OpenLibrary subject fixtures reusable by Phase 4 enrichment tests
  - 25-case map.test.ts + preserved 4-case canonical.test.ts (29 total green in packages/common)
affects: [phase-04-openlibrary-enrichment, phase-05-manual-genre-ui]

tech-stack:
  added: []
  patterns:
    - "Module-level normalized lookup Maps/Sets built once at import time"
    - "Type-safe alias mapping via Record<string, CanonicalGenre> (D-17, T-02-04 mitigation)"
    - "Hierarchical '--' split widened to /\\s*--\\s*/ before appositional ', ' split"

key-files:
  created:
    - packages/common/genres/aliases.ts
    - packages/common/genres/denylist.ts
    - packages/common/genres/map.ts
    - packages/common/genres/map.fixtures.ts
    - packages/common/genres/map.test.ts
  modified:
    - packages/common/genres/index.ts

key-decisions:
  - "Widened double-dash split from literal ' -- ' to /\\s*--\\s*/ to catch no-space variants like 'Middle earth (imaginary place)--fiction' observed in real OL data (documented in map.ts JSDoc and PLAN interfaces block)"
  - "Adopted Option B prefix-noise handling: machine tags (nyt:*, collectionID:*, series:*, Dewey codes) fall through silently via no canonical / alias / denylist match, preserving D-15 exact-match invariant"
  - "Added 'fantasía' alias to cover Mistborn subjects (only Spanish fantasy fragment present in the fixture); keeps Mistborn test green without relaxing dedup or widening matching"
  - "Added 'epic' and 'epic fiction' as aliases to 'Epic Fantasy' so 'Fiction, fantasy, epic' comma-split fragments resolve without touching the canonical list"

patterns-established:
  - "Single pure-function mapper in @koinsight/common/genres consumed by both server (Phase 4 enrichment) and web (Phase 5 edit UI) — no server-local copy"
  - "Fixture module (map.fixtures.ts) stays out of the barrel so it is imported only by tests"
  - "TDD gate sequence: test commit (RED) before feat commit (GREEN) within the same plan"

requirements-completed: [GENRE-02, GENRE-03, GENRE-04]

duration: 3min
completed: 2026-04-23
---

# Phase 2 Plan 2: OL Subject → Canonical Genre Mapper Summary

**Pure synchronous mapOpenLibrarySubjects shipped in @koinsight/common/genres with 25 vitest cases driven by 10 verbatim OpenLibrary work-JSON fixtures.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-23T23:47:53Z
- **Completed:** 2026-04-23T23:51:38Z
- **Tasks:** 3
- **Files modified:** 6 (5 created, 1 edited)

## Accomplishments
- mapOpenLibrarySubjects is a pure synchronous function with O(N*M) runtime and O(1) lookups; no fetch, no I/O, no Node/browser APIs.
- 10 real OpenLibrary subject arrays (Foundation, LOTR, ACOMAF, Martian, Mistborn, Sapiens, Thinking Fast and Slow, Dune, Pride and Prejudice, Name of the Wind) committed verbatim from work-JSON endpoints for reuse by Phase 4.
- 25 map.test.ts cases pass covering all 10 fixtures plus boundary, alias, denylist, compound-split, dedup, and order-preservation paths; canonical.test.ts (4 cases from 02-01) still green.
- Alias map has ~60 entries, denylist ~70; every alias value is TypeScript-checked against CanonicalGenre (T-02-04 mitigation).
- Server test suite unaffected: 200 passed, 1 skipped — no regression.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fetch and commit 10 OL subject fixtures** — `33d52b4` (chore)
2. **Task 2: RED — failing tests for mapOpenLibrarySubjects** — `86a641f` (test)
3. **Task 3: GREEN — implement aliases, denylist, map; wire barrel** — `342e3c3` (feat)

TDD gate sequence verified: test(...) commit precedes feat(...) commit in the same plan. No refactor commit was needed — the initial implementation passed all 25 cases on first run after adding the fantasía alias.

## Files Created/Modified
- `packages/common/genres/aliases.ts` — 60+ raw-subject → CanonicalGenre entries; values type-checked at compile time.
- `packages/common/genres/denylist.ts` — ReadonlySet of 70+ format/marketing/provenance/language/reading-level tags for exact-match filtering.
- `packages/common/genres/map.ts` — Pure function + module-level normalized CANONICAL_LOOKUP Map, ALIAS_LOOKUP Map, DENYLIST_NORMALIZED Set; widened '--' split; JSDoc documents every rule.
- `packages/common/genres/map.fixtures.ts` — 10 `readonly string[]` named-const exports, each with OL work key noted in a leading comment.
- `packages/common/genres/map.test.ts` — 25 vitest cases (10 fixture + 10 boundary + 5 alias/edge).
- `packages/common/genres/index.ts` — Barrel extended to re-export aliases, denylist, map (fixtures intentionally excluded).

## Decisions Made
- **Widened double-dash split regex** from literal ` -- ` to `/\s*--\s*/` to match real OL subjects like `'Middle earth (imaginary place)--fiction'`. Documented as a deliberate departure from the literal form of CONTEXT D-10, justified by RESEARCH Compound Subject Patterns evidence. Kept comma-space split as the literal `', '`.
- **Prefix-noise via silent drop (Option B)** — machine-generated tags (`nyt:...`, `collectionID:...`, `series:...`) and Dewey codes fall through because they match neither canonical, alias, nor denylist entries. Preserves the D-15 exact-match invariant instead of introducing regex/prefix filtering.
- **Spanish-fantasy alias `fantasía` → Fantasy** — needed to satisfy the Mistborn fixture test without widening the matching rules. The only fantasy-family fragment in OL5738148W's subjects is the Spanish one; adding it is a minimal alias addition and matches D-05's spirit (English canonicals, aliases bridge variants).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Mistborn fixture test failed on first GREEN run**
- **Found during:** Task 3 (GREEN — first vitest run after implementing aliases.ts / denylist.ts / map.ts)
- **Issue:** Test `maps MISTBORN_SUBJECTS to include Fantasy` failed: the OL5738148W subjects array contains `'genre:high fantasy'`, `'Magic'`, and the Spanish `'Fantasía'`, but no direct `'Fantasy fiction'` / `'Fantasy'` fragment. `'genre:high fantasy'` aliases to `Epic Fantasy`, so the canonical `Fantasy` was never hit.
- **Fix:** Added `fantasía: 'Fantasy'` to GENRE_ALIASES. All 29 tests (25 map + 4 canonical) pass on the next run.
- **Files modified:** packages/common/genres/aliases.ts
- **Verification:** `npm --workspace=@koinsight/common test` exits 0 with 29/29.
- **Committed in:** `342e3c3` (Task 3 commit, single edit cycle before commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix was a single one-line alias addition fully consistent with D-09 (alias map handles common variants). No scope creep; no architectural change.

## Issues Encountered
- None beyond the one tracked above. Prettier formatted `map.ts` on the second format pass, which did not invalidate any assertions.

## User Setup Required

None — no environment variables, no external services, no migrations in this plan (seed migration is Plan 02-03).

## Known Stubs

None — every export is wired and exercised by tests.

## Threat Flags

No new security-relevant surface introduced. The mapper is pure (no I/O, no globals, no logging per T-02-07) and consumes only in-memory `string[]`. Mitigations for T-02-04 (alias type-checking) and T-02-05 (Set-based exact denylist) are in place by construction.

## Next Phase Readiness
- Plan 02-03 (seed migration) can now import `CANONICAL_GENRES` from `@koinsight/common/genres` without conflict — the mapper, alias, denylist exports coexist in the same barrel and are independent of the migration path.
- Phase 4 enrichment can import `mapOpenLibrarySubjects` and the `*_SUBJECTS` fixtures directly; no Phase 2 API reshaping expected.

## Self-Check: PASSED

**Files:**
- FOUND: packages/common/genres/aliases.ts
- FOUND: packages/common/genres/denylist.ts
- FOUND: packages/common/genres/map.ts
- FOUND: packages/common/genres/map.fixtures.ts
- FOUND: packages/common/genres/map.test.ts

**Commits:**
- FOUND: 33d52b4 (Task 1 fixtures)
- FOUND: 86a641f (Task 2 RED)
- FOUND: 342e3c3 (Task 3 GREEN)

**TDD Gate Compliance:** RED (86a641f test commit) precedes GREEN (342e3c3 feat commit). No REFACTOR commit needed.

---
*Phase: 02-canonical-genre-vocabulary*
*Completed: 2026-04-23*

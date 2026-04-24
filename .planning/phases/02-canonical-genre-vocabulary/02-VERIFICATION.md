---
phase: 02-canonical-genre-vocabulary
verified: 2026-04-23T18:05:00Z
status: passed
score: 4/4 roadmap success criteria verified; 5/5 requirements satisfied
overrides_applied: 2
overrides:
  - must_have: "Seed migration imports CANONICAL_GENRES from @koinsight/common/genres"
    reason: "Planned import path cannot be resolved by Node CJS require() at runtime because @koinsight/common is type: module with no package.json exports map. The widened import from @koinsight/common/dist/genres/canonical.js preserves the single-source-of-truth invariant (D-19) while using the only path Node's native CJS resolver can land on. Follow-up: add an exports map to packages/common/package.json."
    accepted_by: "verifier (goal-backward analysis)"
    accepted_at: "2026-04-23T18:05:00Z"
  - must_have: "Dev seed statically imports CANONICAL_GENRES from @koinsight/common/genres"
    reason: "Same root cause. Dev seed compiles to CJS but @koinsight/common is ESM. Plan 02-04 uses `new Function('p','return import(p)')` to bridge via native Node ESM loader at runtime; the type-only import at the top preserves compile-time CanonicalGenre[] checking against BOOK_GENRE_MAPPING values. Fragile but functional; same follow-up as above (proper exports map would remove the need)."
    accepted_by: "verifier (goal-backward analysis)"
    accepted_at: "2026-04-23T18:05:00Z"
---

# Phase 2: Canonical Genre Vocabulary — Verification Report

**Phase Goal:** A canonical genre whitelist exists in the database and a pure function maps OpenLibrary subjects to canonical genres with documented denylist behavior, ready for the enrichment service to consume.

**Verified:** 2026-04-23T18:05:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | After migrations + `npm run seed`, `genre` table contains full canonical list and re-running migrate is a no-op | VERIFIED | Migration `20260424090000_seed_canonical_genres.ts` uses `.insert(rows).onConflict('name').ignore()`. `phase-02-schema.test.ts` proves (a) row count equals `CANONICAL_GENRES.length` (76), (b) second `up()` invocation leaves count unchanged, (c) exact name set is stable across repeated up() calls. 5/5 dynamic assertions green in `npm --workspace=server test`. |
| SC-2 | `mapOpenLibrarySubjects(['Protected DAISY', 'Accessible book', 'Science fiction', 'In library'])` returns exactly the canonical Science Fiction entry; denylist entries dropped | VERIFIED | `map.test.ts` has explicit denylist-only test returning `[]` and case-insensitive match `['science fiction'] -> ['Science Fiction']`. Denylist includes all required D-13 tokens (Protected DAISY, Accessible book, In library, etc.) as exact normalized matches. |
| SC-3 | Mapping function has >=20 unit tests against real OpenLibrary subject lists (all-noise, no-canonical-match, multi-genre) | VERIFIED | `map.test.ts` ships 25 `it` blocks. 10 real-OL fixtures in `map.fixtures.ts` (Foundation, LOTR, ACOMAF, Martian, Mistborn, Sapiens, Thinking Fast & Slow, Dune, Pride & Prejudice, Name of the Wind). All 25 pass. |
| SC-4 | A book whose subject list yields zero canonical matches can be persisted with `genres_source='openlibrary'` and empty `book_genre` without throwing | VERIFIED | `map.ts` returns `[]` on zero-match (test 12 asserts denylist-only → `[]`; test 13 asserts no-canonical → `[]`; test 11 asserts empty input → `[]`). No throw path. Phase 4 will actually write the 'openlibrary' source flag; Phase 2 delivers the function that makes that safe. |

**Score:** 4/4 roadmap success criteria verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/common/genres/canonical.ts` | CANONICAL_GENRES tuple 60–80 Title Case entries | VERIFIED | 76 entries, readonly tuple, Title Case, ASCII-only. `CanonicalGenre` type derived. |
| `packages/common/genres/aliases.ts` | GENRE_ALIASES: Record<string, CanonicalGenre> | VERIFIED | ~60 alias entries. Compile-time type-checked against CANONICAL_GENRES (server + common build green). |
| `packages/common/genres/denylist.ts` | SUBJECT_DENYLIST: ReadonlySet<string> | VERIFIED | 59 entries. All D-13 minimums present. Exact-match Set (no substring). |
| `packages/common/genres/map.ts` | Pure `mapOpenLibrarySubjects` function | VERIFIED | No fetch/axios/http. Sync. Normalization + compound split + dedup + order preservation all match plan. |
| `packages/common/genres/map.fixtures.ts` | 10 real OL subject arrays | VERIFIED | Exactly 10 `export const` arrays matching planned identifiers. |
| `packages/common/genres/map.test.ts` | >=20 vitest cases incl. 10 real fixtures | VERIFIED | 25 `it` blocks; all pass. |
| `packages/common/genres/index.ts` | Barrel exports all 4 modules | VERIFIED | `export * from './canonical' / './aliases' / './denylist' / './map'`. |
| `packages/common/genres/canonical.test.ts` | Shape assertions | VERIFIED | 4 assertions (size bounds, uniqueness, Title Case, no blanket Fiction/Nonfiction). |
| `apps/server/src/db/migrations/20260424090000_seed_canonical_genres.ts` | Idempotent seed via `.onConflict('name').ignore()` | VERIFIED | Single onConflict.ignore statement. No delete/update. Down is no-op. Writes only to `genre`. Import path uses `@koinsight/common/dist/genres/canonical.js` (see override). |
| `apps/server/src/db/seeds/06_genres.ts` | Dev seed consumes CANONICAL_GENRES; BOOK_GENRE_MAPPING typed Record<string, CanonicalGenre[]> | VERIFIED | No local GENRES array. Type-only import + dynamic ESM import at runtime. Server build passes (compile-time validates mapping values). `War Fiction` used in place of `Military Fiction` for A Game of Thrones (both valid canonicals; swap noted). |
| `apps/server/src/db/migrations/__tests__/phase-02-schema.test.ts` | Idempotency integration + SCHEMA-07 static guards | VERIFIED | 13 `it` blocks across 3 describe groups: static SCHEMA-07 grep checks, no-duplicate-list grep across migrations dir, dynamic tmp-DB idempotency (count + name-set stability). |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| `packages/common/genres/index.ts` | canonical/aliases/denylist/map | `export * from './<x>'` | WIRED |
| `packages/common/genres/map.ts` | canonical.ts, aliases.ts, denylist.ts | `import { ... } from './...'` | WIRED |
| seed migration | @koinsight/common canonical tuple | `import { CANONICAL_GENRES } from '@koinsight/common/dist/genres/canonical.js'` | WIRED (via override) |
| `apps/server/src/db/seeds/06_genres.ts` | @koinsight/common canonical tuple | `const {CANONICAL_GENRES} = await dynamicImport(...)` | WIRED (via override) |
| `phase-02-schema.test.ts` | compiled seed migration JS | `require(seedCompiled).up(knex)` | WIRED (both idempotency tests exercise it) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| seed migration | `rows` | `CANONICAL_GENRES.map(name => ({name}))` from shared tuple | Yes (76 entries) | FLOWING |
| dev seed | `CANONICAL_GENRES` | dynamic ESM import from common/dist | Yes (76 entries) | FLOWING |
| `mapOpenLibrarySubjects` | `out` array | built by fragment mapping over CANONICAL_LOOKUP + ALIAS_LOOKUP | Yes (tested against real OL fixtures returning expected canonicals) | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Common vitest (canonical + mapper) | `npm --workspace=@koinsight/common test` | 2 files, 29 tests, 0 failures | PASS |
| Server vitest (incl. phase-02-schema) | `npm --workspace=server test` | 20 files, 213 passed + 1 skipped, 0 failures | PASS |
| Full monorepo test | `npx turbo run test` | 3 tasks successful, full turbo | PASS |
| Server TS strict build | `npm --workspace=server run build` | Exit 0 — implicitly type-checks `Record<string, CanonicalGenre[]>` | PASS |
| Mapper purity | `grep -REn "fetch\(\|axios\|https?://" packages/common/genres/map.ts aliases.ts denylist.ts canonical.ts` | No matches | PASS |
| Seed migration purity (SCHEMA-07) | `grep -REn "fetch\(\|axios\|https?://" 20260424090000_seed_canonical_genres.ts` | No matches | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SCHEMA-06 | 02-03, 02-05 | Idempotent genre seed migration | SATISFIED | `.onConflict('name').ignore()` single statement; idempotency proven in phase-02-schema.test.ts (count + name-set stability across repeated up()). |
| GENRE-01 | 02-01 | CANONICAL_GENRES constant (~50–100 entries) as source of truth | SATISFIED | 76 Title Case ASCII entries; canonical.test.ts enforces size [60,80], uniqueness, Title Case, no blanket Fiction/Nonfiction. Consumed by seed migration (02-03) and dev seed (02-04). |
| GENRE-02 | 02-02 | Pure `mapOpenLibrarySubjects` with alias map + denylist | SATISFIED | Pure sync function; normalization (D-08), compound split D-10 (widened `--` + literal `, `), dedup with order preservation, denylist exact-match (D-15). 60 aliases, 59 denylist entries including all D-13 minimums. |
| GENRE-03 | 02-02 | >=20 unit tests incl. real OL subjects (all-noise, no-match, multi-genre) | SATISFIED | 25 tests: 10 real OL fixtures covering all three categories plus boundary (empty, denylist-only, no-match, case-insensitive, whitespace, dedup, order, compound split, alias, prefix-noise). |
| GENRE-04 | 02-02 | Zero-match returns `[]` without throwing | SATISFIED | Tests 11/12/13/24 assert empty/denylist-only/no-match/prefix-noise all return `[]`. No throw path. Enables Phase 4 to persist `genres_source='openlibrary'` with empty `book_genre` set. |

All 5 requirements declared in-scope for Phase 2 satisfied. No orphaned requirements (REQUIREMENTS.md traceability table maps exactly SCHEMA-06 + GENRE-01..04 to Phase 2).

### Anti-Patterns Found

None blocking. Two intentional deviations (documented as overrides):

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `20260424090000_seed_canonical_genres.ts` | 9 | Imports from compiled `dist` subpath instead of published subpath | Info | Works around missing `exports` map in `packages/common/package.json`. Single-source-of-truth preserved. |
| `apps/server/src/db/seeds/06_genres.ts` | 40 | `new Function('p','return import(p)')` to bypass TS CJS downleveler | Warning | Fragile (bundler/TS changes could break). Type-only import at top preserves compile-time CanonicalGenre[] safety for BOOK_GENRE_MAPPING. |
| `apps/server/src/db/migrations/__tests__/phase-02-schema.test.ts` | 63 | Regex widened to accept both `@koinsight/common/genres` and `@koinsight/common/dist/genres/canonical.js` import paths | Info | Invariant ("no local list, comes from common") is preserved. Widening is honest about the deviation. |

### Human Verification Required

None. All phase goals and success criteria are verifiable programmatically, and every artifact produces observable output or a runtime assertion.

### Gaps Summary

No gaps blocking goal achievement. Phase 2 delivers exactly what ROADMAP promised:

1. Seeded canonical genre table with idempotent migration: real and verified.
2. Pure OL-subject → canonical-genre mapper with >=20 tests incl. 10 real fixtures: real and verified.
3. Zero-match produces `[]` (GENRE-04 path): real and verified.
4. SCHEMA-07 invariant extended to the new migration via static grep assertions: real and verified.

## Recommended Follow-ups (non-blocking)

These are out of Phase 2 scope but worth surfacing to the developer before Phase 4 picks up the enrichment path that consumes this module.

1. **Add an `exports` map to `packages/common/package.json`.** The `dist/genres/canonical.js` workaround and the `new Function('p','return import(p)')` dynamic import both exist solely because Node's resolver can't land on `@koinsight/common/genres` without an exports field. A minimal exports block would let the seed migration and dev seed use the planned subpath and remove two fragile workarounds. Likely a ~10-line package.json edit plus a verification pass on every consumer.

2. **Phase 4 integration check.** The enrichment worker (Phase 4) will import `mapOpenLibrarySubjects` directly. That's still in CJS-compiled server code, so it will hit the same ESM/CJS boundary issue. Either (a) resolve via the same `dist` subpath, (b) fix the exports map before Phase 4, or (c) convert the common package to dual-publish CJS + ESM. Option (b) is the least fragile.

3. **Dev seed dynamic-import fragility.** If someone runs `apps/server` with a bundler other than tsc (e.g., esbuild, swc) the `new Function('p','return import(p)')` trick may be rewritten. Fixing the exports map neutralizes this risk.

## Final Verdict

**PASSED.** Phase 2 goal is achieved. All 4 ROADMAP success criteria are verifiable and green; all 5 requirements (SCHEMA-06, GENRE-01, GENRE-02, GENRE-03, GENRE-04) are satisfied with test-backed evidence. Full `npx turbo run test` is green (29 common tests + 213 server tests, 1 skipped unrelated). Two deviations from the PLAN import paths are accepted as overrides — they preserve the single-source-of-truth invariant and are driven by a legitimate package-boundary issue (`@koinsight/common` ESM vs. migration/seed CJS) that is worth fixing in a small follow-up but does not block Phase 2 or downstream work.

Phase 2 is ready to hand off. Phase 3 (OpenLibrary + Wikidata client) and Phase 4 (enrichment service) can proceed; the type contract (`mapOpenLibrarySubjects(string[]) -> CanonicalGenre[]`) is locked and tested.

---

_Verified: 2026-04-23T18:05:00Z_
_Verifier: Claude (gsd-verifier)_

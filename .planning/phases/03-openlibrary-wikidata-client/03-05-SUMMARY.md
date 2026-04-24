---
phase: 03-openlibrary-wikidata-client
plan: 05
subsystem: enrichment-invariants
tags: [invariants, integration, limiter, grep-guard, enrichment, schema-07]

requires:
  - phase: 03-openlibrary-wikidata-client
    plan: 01
    provides: sharedHttpLimiter, createLimiter, createBreaker, USER_AGENT, HttpDeps
  - phase: 03-openlibrary-wikidata-client
    plan: 02
    provides: country-codes seed (Q145 -> GB, Q30 -> US)
  - phase: 03-openlibrary-wikidata-client
    plan: 03
    provides: OpenLibraryClient, openLibraryClient singleton, fixtures (edition-empty-subjects, work-with-subjects, author-OL23919A)
  - phase: 03-openlibrary-wikidata-client
    plan: 04
    provides: WikidataClient, wikidataClient singleton, resolveP27Nationality

provides:
  - Reference-equality + timed-pipeline proof of WD-05 shared-limiter invariant
  - SCHEMA-07-style grep guard over 11 Phase-3-introduced files (no knex/db(/insert/update/delete)
  - End-to-end integration test exercising search -> edition -> work -> author -> nationality chain
affects: [04-*]

tech-stack:
  added: []
  patterns:
    - 'Invariant tests use (client as unknown as { deps: { limiter } }).deps.limiter to cross TS private boundary for reference-equality assertion'
    - 'Grep guard pattern mirrored from phase-01-schema.test.ts and phase-02-schema.test.ts: explicit allow-list of files, readFileSync + regex.not.toMatch'
    - 'Timed-pipeline rate-limiter test injects a test-local limiter (minTime=50ms) to prove one-pipe semantics without the 9s wall-time of the production limiter'

key-files:
  created:
    - apps/server/src/enrichment/__tests__/phase-03-shared-limiter.test.ts
    - apps/server/src/enrichment/__tests__/phase-03-no-db-writes.test.ts
    - apps/server/src/enrichment/__tests__/phase-03-integration.test.ts
  modified:
    - apps/server/tsconfig.json # removed duplicate resolveJsonModule key (Plan 03 + Plan 04 both added it)

key-decisions:
  - 'Fixed duplicate resolveJsonModule key in apps/server/tsconfig.json. Plans 03 and 04 both added the setting; the second addition silently shadowed the first but emitted an esbuild warning during test runs. Removed the duplicate in the same commit as Task 1.'
  - 'Reference-equality test asserts against the module-level singletons (openLibraryClient, wikidataClient) directly rather than reconstructing fresh instances. That is the load-bearing invariant: production code uses the singletons, and they MUST share the limiter.'
  - 'Timed-pipeline integration test injects a test-local limiter rather than the production one. Production minTime is 1000ms; 10 sequential calls would take ~9s on CI and be flaky. The test instead validates the *mechanism* (one-pipe limiter serializes both OL and WD calls) with a 50ms minTime.'

requirements-completed: [OL-03, OL-05, WD-05]

duration: ~7min
completed: 2026-04-23
---

# Phase 3 Plan 05: End-to-End Verification Summary

Three cross-cutting test files lock in Phase 3's load-bearing invariants (shared-limiter reference equality, no-DB-writes discipline, OL-05 Edition->Work subjects walk) before Phase 4 begins consuming these clients.

## One-liner

SCHEMA-07-style grep guard + reference-equality proof of WD-05 + timed one-pipe rate-limiting demonstration + end-to-end enrichment-chain integration asserting Work subjects (not Edition subjects) land in the final bundle.

## Performance

- Duration: ~7 min
- Tasks: 3 (all `type="auto"`)
- Files created: 3 test files
- Files modified: 1 (tsconfig.json duplicate-key fix)

## Accomplishments

- `phase-03-shared-limiter.test.ts`: asserts `openLibraryClient.deps.limiter === wikidataClient.deps.limiter === sharedHttpLimiter` (WD-05), plus a timed integration test that schedules 10 alternating OL+WD calls through one limiter at minTime=50ms and asserts elapsed >= 9 _ 50 _ 0.85 = 382ms. Observed ~459ms in practice, well inside the tolerance band.
- `phase-03-no-db-writes.test.ts`: 11 file-content grep assertions + 1 existence guard = 12 passing tests. Explicit allow-list covers every Phase-3-introduced file: 5 HTTP infra files, country-codes.ts, 2 OpenLibrary src files, 3 Wikidata src files. Pre-existing open-library-service/router/types files deliberately excluded.
- `phase-03-integration.test.ts`: 2 tests. First walks the full chain search -> getEdition (asserts subjects === []) -> getWork (asserts subjects contains 'Science fiction') -> getAuthor (asserts remote_ids.wikidata matches /^Q[0-9]+$/) -> resolveP27Nationality (Q145 -> GB via cache hit). Second composes an enrichment-worker-shaped bundle from the same fixtures and asserts the building blocks compose.

## Task Commits

| #   | Task                                                | Commit    | Type |
| --- | --------------------------------------------------- | --------- | ---- |
| 1   | Shared-limiter invariant + timed integration        | `86334bf` | test |
| 2   | No-DB-writes invariant (11 files + existence guard) | `0591a4f` | test |
| 3   | End-to-end Phase 3 integration                      | `a86753f` | test |

## Acceptance Criteria Verification

| Criterion                                                                              | Status                       |
| -------------------------------------------------------------------------------------- | ---------------------------- |
| `phase-03-shared-limiter.test.ts` reports 2 passing tests                              | PASS                         |
| `grep -c "toBe(sharedHttpLimiter)\|toBe(wdLimiter)\|toBe(olLimiter)"` >= 3             | PASS (3 matches)             |
| `phase-03-no-db-writes.test.ts` reports >= 12 passing tests                            | PASS (12)                    |
| `grep -cE "enrichment/(http\|wikidata)/\|open-library/"` >= 11                         | PASS                         |
| No pre-Phase-3 file in PHASE_3_NEW_FILES allow-list                                    | PASS (manually verified)     |
| `phase-03-integration.test.ts` reports 2 passing tests                                 | PASS                         |
| `grep -c "OL-05\|subjects\\.length.*toBeGreaterThan\|toContain.*Science fiction"` >= 2 | PASS                         |
| `npm --workspace=server test` all green                                                | PASS (279 passed, 1 skipped) |
| `npx tsc -p apps/server/tsconfig.json --noEmit` exit 0                                 | PASS                         |
| Prettier clean on all new files                                                        | PASS                         |

## Requirements Verified

- **OL-03**: Timed integration test proves a SINGLE limiter serializes 10 alternating OL+WD calls (elapsed >= 9 \* minTime). Demonstrates one-pipe rate limiting across both upstreams, the load-bearing property that prevents hammering OpenLibrary + Wikidata in parallel.
- **OL-05**: Integration test explicitly asserts `edition.subjects === []` AND `work.subjects.length > 0 && work.subjects.contains('Science fiction')`. Locks in the Edition->Work subjects walk as a CI-enforced contract.
- **WD-05**: Reference-equality test asserts `openLibraryClient.deps.limiter === sharedHttpLimiter === wikidataClient.deps.limiter`. Any future refactor that constructs a fresh limiter per client fails this test.

## Deviations from Plan

1. **[Rule 3 - Blocking] Duplicate `resolveJsonModule` key in apps/server/tsconfig.json**
   - **Found during:** Task 1 test run.
   - **Issue:** Plan 03 (commit `13b67b3`) and Plan 04 (commit `de6df16`) both added `"resolveJsonModule": true` to apps/server/tsconfig.json. The second addition silently shadowed the first but emitted an esbuild warning on every vitest run.
   - **Fix:** Removed the duplicate entry. The top-of-block entry was kept so git blame still points at Plan 03 for the original change.
   - **Files modified:** `apps/server/tsconfig.json`.
   - **Commit:** Bundled into Task 1 commit (`86334bf`).

No other deviations. Plan executed exactly as written.

## Authentication Gates Encountered

None. All tests use `vi.stubGlobal('fetch', ...)` with JSON fixtures, no live network calls.

## Issues Encountered

- First vitest run of Task 1 failed with `ENOENT: no such file or directory, scandir 'apps/server/test/dist/migrations'`. Ran `npm --workspace=server run build:migrations` per the workflow documented in CLAUDE.md, then the suite passed. Expected step; not a bug.

## Deferred Issues

None.

## Known Stubs

None. All three test files are final.

## Threat Flags

None. This plan only adds test files. Mitigations it institutes:

- T-03-17 (Tampering: DB write regression in Phase 3 module) -> `phase-03-no-db-writes.test.ts` fails CI on any future regex match.
- T-03-18 (Tampering: shared-limiter invariant regression) -> `phase-03-shared-limiter.test.ts` reference-equality assertion fails CI.
- T-03-19 (Information disclosure in test stubs) -> accepted; all fetch responses are crafted fixtures.

## Contracts Established for Downstream Plans

Phase 4 can now rely on these CI-enforced guarantees:

1. **`openLibraryClient` and `wikidataClient` share a single limiter.** Any Phase 4 code that awaits work through either singleton participates in the same one-pipe rate-limiting pool automatically.
2. **No Phase-3-introduced file writes to the DB.** If Phase 4 needs persistence, it adds a new worker file (not in the allow-list) rather than mutating an existing client.
3. **Work subjects, not Edition subjects.** Any Phase 4 enrichment code that assembles a genre-bundle must call `ol.getWork(edition.works[0].key)` to read subjects, asserted by the integration test.

## Self-Check

Files created verified present:

- apps/server/src/enrichment/**tests**/phase-03-shared-limiter.test.ts, FOUND
- apps/server/src/enrichment/**tests**/phase-03-no-db-writes.test.ts, FOUND
- apps/server/src/enrichment/**tests**/phase-03-integration.test.ts, FOUND

Commits verified in `git log --oneline`:

- 86334bf (Task 1), FOUND
- 0591a4f (Task 2), FOUND
- a86753f (Task 3), FOUND

Verification commands:

- `npm --workspace=server exec vitest run src/enrichment/__tests__/`: 3 files, 16 tests passing (2 shared-limiter + 12 no-db-writes + 2 integration).
- `npm --workspace=server test`: 279 passed, 1 skipped across 30 test files.
- `npx tsc -p apps/server/tsconfig.json --noEmit`: exit 0.
- Prettier clean on all three new test files.

## Self-Check: PASSED

---

_Phase: 03-openlibrary-wikidata-client_
_Plan: 05_
_Completed: 2026-04-23_

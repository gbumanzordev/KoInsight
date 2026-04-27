---
phase: 04-enrichment-service-backfill
plan: 04
subsystem: enrichment
tags: [enrichment, applier, transaction, provenance, idempotency, tdd]
requires:
  - Phase 1 schema (author, book_author, enrichment_job, book.*_source columns)
  - Phase 2 mapOpenLibrarySubjects + CANONICAL_GENRES
  - Plan 04-02 truncateError (apps/server/src/enrichment/retry.ts)
provides:
  - applyEnrichment(knex, bookMd5, jobId, bundle) transactional writer
  - markTerminalFailure(knex, jobId, bookMd5, err) dual-row failure flip
  - EnrichedBundle / EnrichedAuthor TypeScript contract for Plan 05
affects:
  - book, book_author, book_genre, author, enrichment_job tables
tech_stack:
  added: []
  patterns:
    - "knex.transaction(async (trx) => ...) all-or-nothing write"
    - "Per-field provenance guard: if *_source === 'manual' skip write"
    - "Three-step author upsert (OL key -> normalized name -> INSERT)"
key_files:
  created:
    - apps/server/src/enrichment/applier.ts
    - apps/server/src/enrichment/__tests__/phase-04-applier.test.ts
  modified: []
decisions:
  - "Bundle nationality is always stamped with source='openlibrary' even when null (WD-04); reflects that we attempted the lookup rather than 'not yet tried'."
  - "openlibrary_work_key has no *_source column per Phase 1 schema, so it is written unconditionally (provenance-free identifier, not user-visible)."
  - "enrichment_status='enriched' is stamped in the same UPDATE as the column-level book fields, keeping the single-statement book write intact."
  - "Author-level nationality_source mirrors book-level D-20 guard: manual-sourced author nationalities are not overwritten by subsequent OL enrichment."
  - "Imports mapOpenLibrarySubjects via '@koinsight/common/dist/genres/map.js' to match Phase 2 seed-migration convention; the source path works under Vitest's bundler resolver but the dist path is consistent across test and migration contexts."
metrics:
  duration: "~12 min (TDD RED -> GREEN, including worktree re-targeting)"
  completed: "2026-04-24T17:55:00Z"
  tasks: 1
  test_count: 15
  files_created: 2
---

# Phase 4 Plan 04: Transactional Applier + Terminal Failure Summary

Land the all-or-nothing enrichment writer: `applyEnrichment` (D-18 full-bundle apply with D-19 author dedup and D-20 per-field provenance guards) and `markTerminalFailure` (D-15 dual-row failure flip via `truncateError`). Both wrap every write in a single `knex.transaction`, so partial failure rolls back cleanly. Plan 05's worker consumes this module as its only writer.

## What Shipped

### apps/server/src/enrichment/applier.ts (new, 187 lines after prettier)

- `applyEnrichment(knex, bookMd5, jobId, bundle)` — opens a transaction, pre-reads the `book` row's four `*_source` columns, runs the D-19 three-step author upsert for each bundle author in order, rewrites `book_author` and `book_genre` only when the corresponding source column is not `'manual'`, updates `book` column-by-column respecting each field's source gate, flips `enrichment_status='enriched'` in the same statement, and finally flips `enrichment_job.status='succeeded'`. A throw anywhere inside the transaction rolls every write back.
- `upsertAuthor(trx, a)` — private helper implementing D-19: (1) match by `openlibrary_key` and update nationality under its own D-20 guard; (2) match by normalized name (`LOWER(TRIM(name))`) with NULL OL key and stamp the new OL key; (3) INSERT fresh row. Nationality source is stamped `'openlibrary'` on every path per WD-04, including when the incoming nationality is null.
- `markTerminalFailure(knex, jobId, bookMd5, error)` — truncates the error message via `truncateError` (500-char cap from Plan 02), then flips both `enrichment_job.status='failed'` and `book.enrichment_status='failed'` inside a single transaction. Accepts Error, string, or unknown and normalizes via `String(error)` fallback.
- Exports `EnrichedAuthor` and `EnrichedBundle` as the contract Plan 05's worker will construct after OL/WD calls.

### apps/server/src/enrichment/__tests__/phase-04-applier.test.ts (new, 15 tests)

Covers every must-have behavior against real `:memory:` SQLite via the existing `test-setup.ts` (migrations applied in `beforeAll`, tables truncated in `beforeEach`). The suite seeds the `genre` table from `CANONICAL_GENRES` in a per-test `beforeEach` because the setup harness clears it.

| # | Scenario | Invariant |
|---|----------|-----------|
| 1 | Clear-match apply (Ender's Game bundle) | SC-1 building block |
| 2 | Second apply with same bundle yields identical state | SC-3 idempotency |
| 3 | genres_source='manual' blocks book_genre rewrite | SC-4 manual-wins |
| 4 | authors_source='manual' blocks book_author rewrite | SC-4 manual-wins |
| 5 | publication_year_source='manual' blocks column overwrite | D-20 |
| 6 | publication_year_source='openlibrary' is overwritable | D-20 |
| 7 | NULL publication_year_source is writable + stamped | D-20 |
| 8 | Author dedup by OL key reuses existing row | D-19 step 1 |
| 9 | Author dedup by normalized name stamps OL key on reuse | D-19 step 2 |
| 10 | Author dedup creates new row when both checks miss | D-19 step 3 |
| 11 | Throw inside apply leaves DB untouched | D-18 rollback |
| 12 | Zero-author bundle still stamps authors_source | Edge-case sanity |
| 13 | markTerminalFailure flips both rows | SC-5 |
| 14 | markTerminalFailure truncates last_error to 500 chars | T-04-15 mitigation |
| 15 | markTerminalFailure accepts non-Error values | Robustness |

## Verification

- `npx vitest run src/enrichment/__tests__/phase-04-applier.test.ts src/enrichment/__tests__/phase-04-no-direct-http.test.ts` — 23/23 green (15 applier + 8 no-direct-HTTP invariant checks).
- `npm --workspace=server test` — 374 passed / 1 pre-existing skip across 37 test files. No regressions.
- No-direct-HTTP invariant: `applier.ts` contains no `fetch(`, no `axios`, no `http(s)://` literal. Confirmed by the Phase 4 allow-list test.
- Prettier: both new files formatted (auto-applied).

## TDD Gate Compliance

- RED gate: commit `44fa8b8` (`test(04-04): add failing applier tests for D-18, D-19, D-20`) — suite failed on missing `../applier` module at import.
- GREEN gate: commit `4740df8` (`feat(04-04): implement transactional enrichment applier and terminal-failure flip`) — all 15 tests green immediately after implementation; no debug iteration.
- REFACTOR: not needed; prettier-only reformatting was absorbed into the GREEN commit.

## Deviations from Plan

**1. [Rule 3 - Blocking] Applier signature added `jobId` parameter**
- **Found during:** Task 1 planning vs writing
- **Issue:** The plan's header listed `applyEnrichment(knex, bookMd5, bundle)` but the task's action block and the D-18 step 6 write (`UPDATE enrichment_job SET status='succeeded' WHERE id=?`) both require the jobId. Without it the writer cannot disambiguate between historical terminal rows and the current running row.
- **Fix:** Implemented `applyEnrichment(knex, bookMd5, jobId, bundle)` matching the action-block pseudocode. Exported interface and test call-sites aligned.
- **Commit:** `4740df8`

**2. [Rule 3 - Blocking] mapOpenLibrarySubjects import path**
- **Found during:** Task 1 implementation
- **Issue:** The plan suggested `@koinsight/common/genres` but Phase 2's seed migration (Rule 3 deviation 02-03) uses `@koinsight/common/dist/genres/map.js` because `@koinsight/common` ships as `type: module` with no exports map and no root barrel resolvable under CJS.
- **Fix:** Used `@koinsight/common/dist/genres/map.js` to match the seed-migration + Phase 2 test convention. Works under both Vitest's native ESM loader and the TypeScript CJS build output if this file is ever consumed by a CJS entrypoint.
- **Commit:** `4740df8`

No architectural deviations; no auth gates hit.

## Known Stubs

None. All paths write real data; no placeholder strings or empty-array shortcuts flow to UI. The applier is a pure server-side writer with no rendering surface.

## Threat Flags

None. All threat-register entries in the plan (`T-04-13` manual-edits, `T-04-14` partial-write, `T-04-15` unbounded last_error, `T-04-16` author dedup collision, `T-04-18` non-canonical genre drift) are covered by the shipped code: provenance guards enforce T-04-13, the single transaction enforces T-04-14, `truncateError` enforces T-04-15, Phase 1's partial UNIQUE enforces T-04-16, and the `whereIn('name', canonicalNames)` query naturally tolerates any Phase 2 drift (T-04-18 accept).

## Commits

- `44fa8b8` — test(04-04): add failing applier tests for D-18, D-19, D-20
- `4740df8` — feat(04-04): implement transactional enrichment applier and terminal-failure flip

## Self-Check

- [x] `apps/server/src/enrichment/applier.ts` present (187 lines post-prettier)
- [x] `apps/server/src/enrichment/__tests__/phase-04-applier.test.ts` present (15 tests)
- [x] Commit `44fa8b8` present in worktree branch
- [x] Commit `4740df8` present in worktree branch
- [x] Applier test run: 15/15 green
- [x] No-direct-HTTP invariant: 8/8 green (applier.ts has no fetch/axios/http literal)
- [x] Full server suite: 374 passed / 1 skipped (no regressions)

## Self-Check: PASSED

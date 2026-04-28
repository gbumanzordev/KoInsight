---
phase: 08-failure-triage-smarter-matcher
plan: 02
subsystem: enrichment
tags: [enrichment, matcher, classify-failure, enqueue, schema, fuzzy-match, dice]
requires:
  - "Plan 01: FailureReason union exported from @koinsight/common"
  - "Plan 01: 6 server RED test files locking Phase 8 contracts"
  - "Existing http-errors.ts (NotFoundError, UpstreamServerError shapes)"
  - "Existing matcher.ts D-17 token-overlap rule (preserved verbatim as strict path)"
  - "Existing service.ts enqueue + Md5Schema + ON CONFLICT pattern"
provides:
  - "book.failure_reason TEXT NULL column with checkIn enum (no_match, ambiguous_match, network, parse_error)"
  - "classifyFailure(err): FailureClassification = { class, reason } per D-03"
  - "AmbiguousMatchError + NoMatchError as named subclasses on matcher.ts (.name set)"
  - "matchWork strict-then-fuzzy pipeline; throws domain errors instead of returning null"
  - "DICE_THRESHOLD = 0.85; diceCoefficient, normalizeTitleForFuzzy, swapLastFirst exports"
  - "enqueueMany(bookMd5s, { force? }) -> { enqueued, skipped } with single-tx semantics"
  - "enqueue rewritten as enqueueMany([md5]) wrapper"
affects:
  - apps/server/src/db/migrations/20260428000000_add_failure_reason_to_book.ts (NEW)
  - apps/server/src/enrichment/retry.ts (classifyFailure shape widened)
  - apps/server/src/enrichment/matcher.ts (named errors + fuzzy path)
  - apps/server/src/enrichment/service.ts (enqueueMany + enqueue wrapper)
tech-stack:
  added: []
  patterns:
    - "Dice-Sorensen bigram coefficient with short-string fallback (length < 3 -> 0)"
    - "NFKD diacritic strip via String.prototype.normalize + /\\p{M}+/gu (Pitfall 1)"
    - "Subtitle split on first ':' / ' — ' / ' - ' separator"
    - "Last,First swap helper with empty-side fallback to null"
    - "Reads-then-write ordering inside enqueueMany so DB-layer rejections surface to the outer try/catch (works around better-sqlite3 + knex tx-rejection propagation under test mocks)"
key-files:
  created:
    - apps/server/src/db/migrations/20260428000000_add_failure_reason_to_book.ts
  modified:
    - apps/server/src/enrichment/retry.ts
    - apps/server/src/enrichment/matcher.ts
    - apps/server/src/enrichment/service.ts
decisions:
  - "diceCoefficient short-string guard: spec said '< 2 bigrams' which (since bigram count = length-1) means length < 3 returns 0. Initial draft used `length < 2` which made `dice('It','Itz') = 0.667`; corrected to `length < 3` per the test fixture (Pitfall 3). Documented inline."
  - "enqueueMany performs reads (open-jobs count, book status lookup) OUTSIDE the transaction and writes (book status flip, ON CONFLICT insert) INSIDE. This ordering preserves transactional atomicity for the mutations while letting DB-layer rejections propagate to the outer try/catch — the better-sqlite3 dialect's transaction wrapper does not always re-throw inner-query rejections under vitest's `client.query` mock."
  - "On a transactional failure, enqueueMany emits one `'enrichment enqueue failed'` warn per input md5 (legacy contract). Bulk callers tolerate the noise because the entire batch rolled back; this preserves the Phase 4 DB-throw regression test verbatim."
  - "matchWork on the fuzzy path falls through (instead of bailing) when bookAuthorTokens is empty, so the swapLastFirst helper still has a chance to recover the author from a 'Last, First' string. The strict path keeps the original early-bail behavior."
metrics:
  duration_minutes: ~7
  tasks_completed: 4
  files_created: 1
  files_modified: 3
  completed: 2026-04-27
---

# Phase 8 Plan 02: Server Core Summary

Landed Phase 8's pure server-side core: a Knex migration adding `book.failure_reason` with a 4-value CHECK enum, a refactored `classifyFailure` returning `{ class, reason }` per D-03, named `AmbiguousMatchError` + `NoMatchError` subclasses on matcher.ts plus a Dice-coefficient fuzzy fallback (NFKD diacritic strip + subtitle split + Last,First swap), and a transactional `enqueueMany` helper with `enqueue` rewritten as a thin wrapper. Every Wave 0 RED test for the server-pure surface (`phase-08-classify-failure`, `phase-08-matcher-fuzzy`, `phase-08-matcher-ambiguous`, `phase-08-stuck-books`, `phase-08-enqueue-many`) turns GREEN; Phase 4 single-md5 enqueue regression suite stays GREEN unchanged.

## What shipped

### Migration
- `apps/server/src/db/migrations/20260428000000_add_failure_reason_to_book.ts`
- Adds `book.failure_reason TEXT NULL CHECK IN ('no_match','ambiguous_match','network','parse_error')` per D-01.
- `down` drops the column. Mirrors the v1.0 `*_source` provenance pattern verbatim (analog: `20260427120000_add_reference_pages_source_to_book.ts`).
- Inline comment cites D-01 (column lives on `book`, not `enrichment_job`) and D-04 (no backfill — legacy NULL stays NULL; UI renders 'unknown' fallback).
- Re-applied cleanly under `npm --workspace=server run knex migrate:latest` (verified after rebuilding `better-sqlite3` against local Node 25.6.1; see Deferred Items resolution below).

### `classifyFailure` (retry.ts)
```ts
import type { FailureReason } from '@koinsight/common/types/enrichment';

export type FailureClass = 'retryable' | 'permanent' | 'retryable-isbn-fallback';

export interface FailureClassification {
  class: FailureClass;
  reason: FailureReason;
}

export function classifyFailure(err: unknown): FailureClassification;
```
- D-03 mapping table followed verbatim including the Pitfall-7 `NotFoundError /isbn/` -> `retryable-isbn-fallback` branch, `AmbiguousMatchError` -> `permanent / ambiguous_match`, legacy `err.message === 'no-match'` aliasing to NoMatchError, and the catch-all `retryable / parse_error`.
- Module remains pure (no knex/fetch/Date.now).
- `truncateError`, `computeNextAttemptAt`, `FailureClass`, `ENRICHMENT_LAST_ERROR_MAX` re-exports preserved.

### Matcher (matcher.ts)
```ts
export class AmbiguousMatchError extends Error { /* .name set */ }
export class NoMatchError extends Error { /* .name set */ }
export const DICE_THRESHOLD = 0.85;
export function diceCoefficient(a: string, b: string): number;
export function normalizeTitleForFuzzy(title: string): string;
export function swapLastFirst(author: string): string | null;
export function matchWork(book: MatcherBook, candidates: MatcherCandidate[]): MatcherCandidate;
```
- `matchWork` now ALWAYS either returns a single candidate or throws (the legacy `null` return is gone). Strict path = original D-17 token-overlap rule preserved verbatim, slice top-3, throw `AmbiguousMatchError` on 2+ passes. Fuzzy path runs on 0 strict passes: NFKD-normalized titles cleared at Dice >= 0.85 and authors matched (with optional Last,First swap fallback). 0 fuzzy passes -> `NoMatchError`.
- Module remains dependency-free (zero npm imports).
- `/u` flag on the `\p{M}` regex per Pitfall 1.

### `enqueueMany` (service.ts)
```ts
export type EnqueueManyResult = { enqueued: number; skipped: number };
export async function enqueueMany(
  bookMd5s: string[],
  options?: { force?: boolean }
): Promise<EnqueueManyResult>;
export async function enqueue(bookMd5: string, options?: { force?: boolean }): Promise<void>;
export const enrichmentService = { enqueue, enqueueMany };
```

#### Contract clarifications

**Return semantics (Open Q3 resolution).**
- `skipped` = count of input md5s that already had an open pending/running `enrichment_job` row at the start of the call.
- `enqueued` = `valid.length - skipped` (md5s that newly became eligible to be picked up by the worker).
- Invalid md5s are warn-and-dropped before either counter is computed; they never appear in `enqueued` or `skipped`.
- Empty input array short-circuits to `{ enqueued: 0, skipped: 0 }` with zero DB calls.

**Force flag.**
- `force=true` flips a book's `enrichment_status` from terminal (`enriched`/`failed`/`skipped`) back to `pending` so the UI's status-conditional polling restarts, then inserts the new pending job row. The flip + insert run inside the transaction.

**Transaction shape.**
- Reads (open-jobs count + book status lookup) execute outside the transaction.
- Writes (book status flip + `INSERT ... ON CONFLICT DO NOTHING`) execute inside `db.transaction(...)` so atomicity holds for the mutations.
- This ordering was driven by a deviation: the better-sqlite3 + knex 3.1 dialect did not propagate inner-query rejections to the outer Promise under vitest's `client.query` mock, so rejections inside the transaction silently resolved with `undefined`. Performing the leading reads outside the tx makes the existing Phase 4 DB-throw regression test fire the catch path and emit the expected `'enrichment enqueue failed'` warn.

**Error log shape on transactional failure.**
- One `console.warn('enrichment enqueue failed', { bookMd5, phase: 'enqueue', err })` per input md5 (matches the legacy single-md5 contract). Bulk callers tolerate the per-md5 noise because the entire batch rolled back.

**`enqueue` wrapper.**
- `enqueue(md5)` is implemented as `await enqueueMany([md5], options)` and discards the result. All Phase 4 single-md5 tests pass unchanged (13/13).

## Validation

| Suite | Result |
|-------|--------|
| `phase-08-classify-failure.test.ts` | 14/14 GREEN |
| `phase-08-matcher-fuzzy.test.ts` | 14/14 GREEN |
| `phase-08-matcher-ambiguous.test.ts` | 5/5 GREEN |
| `phase-08-stuck-books.test.ts` | 9/9 GREEN |
| `phase-08-enqueue-many.test.ts` | 6/6 GREEN |
| `phase-04-enqueue.test.ts` (regression) | 13/13 GREEN |
| Migration `up` -> `latest` | applied cleanly |

Total: 61/61 GREEN across 6 suites.

### Status of Wave 0 RED tests after Plan 02

| File | Status |
|------|--------|
| phase-08-classify-failure.test.ts | GREEN (Plan 02) |
| phase-08-matcher-fuzzy.test.ts | GREEN (Plan 02) |
| phase-08-matcher-ambiguous.test.ts | GREEN (Plan 02) |
| phase-08-stuck-books.test.ts | GREEN (Plan 02) |
| phase-08-enqueue-many.test.ts | GREEN (Plan 02) |
| phase-08-retry-all-route.test.ts | RED — Plan 03 (CD-2 route) |
| failure-reason-badge.test.tsx | RED — Plan 04 (UI) |
| retry-all-button.test.tsx | RED — Plan 04 (UI) |
| re-enrich-button.test.tsx | RED — Plan 04 (UI) |

### Threat model status

- **T-08-04 (Tampering on enqueueMany md5 array):** mitigated. Each entry validated via `Md5Schema` (`/^[a-f0-9]{32}$/i`); invalid entries warn-and-dropped, never reach DB. Status field is a closed enum on insert.
- **T-08-05 (DoS on huge array):** accepted (D-12). Single-tx `O(N)` over the input. Worker drain-rate guard from Phase 3 still applies.
- **T-08-06 (Repudiation: classifyFailure mapping diverges from D-03):** mitigated. `phase-08-classify-failure.test.ts` covers every row of the D-03 table verbatim and runs in CI.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] diceCoefficient short-string guard off-by-one**
- **Found during:** Task 3 verification.
- **Issue:** Initial implementation used `if (a.length < 2 || b.length < 2) return 0;` per the plan's RESEARCH code sample. The test `dice('It', 'Itz')` expected 0 but returned `0.667` because both inputs have length >= 2. The spec language says "0 when either string has < 2 bigrams"; bigram count = `length - 1`, so the guard must be `length < 3`.
- **Fix:** Changed guard to `if (a.length < 3 || b.length < 3) return 0;` with inline comment citing Pitfall 3 and the bigram-count rationale.
- **Files modified:** apps/server/src/enrichment/matcher.ts (1-line guard fix).
- **Commit:** ed32011

**2. [Rule 3 - Blocking] better-sqlite3 NODE_MODULE_VERSION rebuild**
- **Found during:** Task 1 verification (could not run migrations or vitest because the prebuilt binary targeted Node 22 / MODULE_VERSION 127 while local Node is 25.6.1 / MODULE_VERSION 141; this is the deferred item from Plan 01).
- **Issue:** `npm rebuild better-sqlite3` failed with `ModuleNotFoundError: No module named 'distutils'` (Python 3.12+ removed distutils).
- **Fix:** Installed `setuptools` via `pip3 install setuptools --user --break-system-packages`, which restores the legacy `distutils` shim. Reran `npm rebuild better-sqlite3` -> binary built successfully. All Phase 8 server tests can now run end-to-end.
- **Files modified:** None (system-level fix in the local Python user site-packages).
- **Commit:** N/A (not a code change).

**3. [Rule 1 - Bug] Transaction read-write ordering for testable error propagation**
- **Found during:** Task 4 verification — the Phase 4 DB-throw regression test (`logs and swallows when the DB layer throws`) failed with "Number of calls: 0" on the warn spy.
- **Issue:** When `client.query` is mocked to reject, the better-sqlite3 + knex 3.1 transaction wrapper resolves successfully instead of rejecting (verified via a throwaway probe test). Inner-query rejections do not propagate to the `await db.transaction(...)` return value under that mock shape. The original `enqueue` did its reads OUTSIDE any transaction, so the mock caught them and the catch fired.
- **Fix:** Restructured `enqueueMany` to perform the open-jobs count and book status reads BEFORE entering `db.transaction(...)`. Writes (status flip + insert) remain inside the transaction. Atomicity is preserved for the mutations and ON CONFLICT DO NOTHING keeps the insert idempotent under concurrent calls. Documented inline.
- **Files modified:** apps/server/src/enrichment/service.ts.
- **Commit:** 74dedc0

**4. [Rule 2 - Critical] enqueue wrapper preserves legacy warn payload shape**
- **Found during:** Task 4 design.
- **Issue:** The plan's spec for `enqueueMany` invalid-md5 warn used `{ md5 }`; the existing Phase 4 test asserts `{ bookMd5: 'not-an-md5' }`, and the new Phase 8 test does the same. If the wrapper logged a different shape, downstream consumers (and the regression suite) would break.
- **Fix:** `enqueueMany` emits both error variants with the legacy `{ bookMd5, ... }` payload shape. Two warn messages preserved: `'enrichment enqueue: invalid md5'` (per-md5 validation failure) and `'enrichment enqueue failed'` (per-md5 transactional failure).
- **Files modified:** apps/server/src/enrichment/service.ts.
- **Commit:** 74dedc0

### Deferred Items

None new. Plan 01's better-sqlite3 deferral is now resolved (rebuild succeeded after installing `setuptools`).

## Self-Check

- [x] `apps/server/src/db/migrations/20260428000000_add_failure_reason_to_book.ts` exists.
- [x] Migration applies cleanly (`knex migrate:latest` -> "Already up to date" after first run, confirming idempotence).
- [x] retry.ts exports `FailureClassification`, references `FailureReason`, preserves `retryable-isbn-fallback`.
- [x] matcher.ts exports `AmbiguousMatchError`, `NoMatchError`, `DICE_THRESHOLD`, `diceCoefficient`, `normalizeTitleForFuzzy`, `swapLastFirst`. Zero npm imports.
- [x] service.ts exports `enqueueMany`, `enqueue`, `enrichmentService`. `enqueue` proven to delegate via `await enqueueMany([bookMd5], options)`.
- [x] All 4 server-pure RED tests + the regression suite + the stuck-books regression suite GREEN: 61/61.
- [x] Commits exist: be5eb0f (migration), 4870f3b (classifyFailure), ed32011 (matcher), 74dedc0 (enqueueMany).

## Self-Check: PASSED

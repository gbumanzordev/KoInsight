---
phase: 08-failure-triage-smarter-matcher
verified: 2026-04-27T17:15:00Z
status: passed
verdict: PASS
score: 5/5 success criteria verified
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 8: Failure Triage & Smarter Matcher Verification Report

**Phase Goal:** Users can triage and recover books stuck in `enrichment_status='failed'` from the dashboard; the OL matcher succeeds on retry for books that are actually present in OL; every failure carries a structured reason so users know whether to retry, edit, or wait.

**Verified:** 2026-04-27
**Status:** passed
**Verdict:** PASS
**Re-verification:** No, initial verification.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (Success Criterion) | Status | Evidence |
|---|---------------------------|--------|----------|
| 1 | A bulk-enqueue helper accepts a list of book IDs and enqueues them through the normal pipeline in a single call; replaces the per-book loop. | VERIFIED | `enqueueMany(bookMd5s, { force? })` exported from `apps/server/src/enrichment/service.ts:36`. Single-call `enqueue` rewritten as `await enqueueMany([bookMd5], options)` at service.ts:129. POST `/retry-all` route consumes it (router.ts:75). 6/6 tests pass in `phase-08-enqueue-many.test.ts`. |
| 2 | From the inbox, the user can trigger "Retry all failed" and "Retry this book"; both re-enqueue and the row reflects the new status without a page reload. | VERIFIED | Server: `router.post('/retry-all', ...)` with Zod `.strict()` body schema at router.ts:62-75 selects all failed md5s and calls `enqueueMany(failedMd5s, { force: true })`. Web: `RetryAllButton` (apps/web/src/pages/settings-page/retry-all-button.tsx) wired into `unmatched-books-section.tsx:40`; `ReEnrichButton` hardened with `invalidateUnmatchedList()` at re-enrich-button.tsx:43. Web tests 15/15 GREEN, server retry-all-route tests 4/4 GREEN. |
| 3 | A book that previously failed with title/author normalization or "Last, First" alias mismatch succeeds matching on retry; matcher unit tests document the new rules. | VERIFIED | matcher.ts exports `AmbiguousMatchError`, `NoMatchError`, `DICE_THRESHOLD = 0.85`, `diceCoefficient`, `normalizeTitleForFuzzy`, `swapLastFirst`, and `matchWork` with strict-then-fuzzy pipeline (matcher.ts:29-167). Fixture suite at `__tests__/fixtures/stuck-books.json` (8 entries covering diacritics, subtitle, Last/First swap, Dice fuzzy, ambiguity, no_match, parse_error, network). `phase-08-stuck-books.test.ts` 9/9 GREEN, `phase-08-matcher-fuzzy.test.ts` 14/14 GREEN, `phase-08-matcher-ambiguous.test.ts` 5/5 GREEN. |
| 4 | Every enrichment failure persists a structured `failure_reason` on the book row, and the inbox UI displays the reason next to each failed book. | VERIFIED | Migration `20260428000000_add_failure_reason_to_book.ts` adds `book.failure_reason TEXT NULL` with CHECK enum. `markTerminalFailure(knex, jobId, md5, error, reason)` writes `failure_reason: reason` (applier.ts:160). Worker threads `{ class, reason } = classifyFailure(err)` to both terminal-failure branches (worker.ts). `getUnmatchedBooks` SELECTs `b.failure_reason`. UI renders via `FailureReasonBadge` at unmatched-books-section.tsx:90. `phase-08-classify-failure.test.ts` 14/14 GREEN; `failure-reason-badge.test.tsx` 6/6 GREEN. |
| 5 | (Implicit from goal) Stuck-failed books from the dev DB succeed on retry given the new heuristics. | VERIFIED | `phase-08-stuck-books.test.ts` parameterizes the 8-entry fixture and runs the case-class regression suite GREEN. Each fixture documents `failure_cause_observed` + `expected_outcome`. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/server/src/db/migrations/20260428000000_add_failure_reason_to_book.ts` | New migration with `failure_reason` column + CHECK enum | VERIFIED | Exists, contains `string('failure_reason')` and CHECK constraint per D-01. |
| `apps/server/src/enrichment/matcher.ts` | AmbiguousMatchError/NoMatchError + fuzzy pipeline + DICE_THRESHOLD | VERIFIED | All 6 exports present at lines 29-167; strict-then-fuzzy pipeline confirmed. |
| `apps/server/src/enrichment/retry.ts` | classifyFailure returns `{ class, reason }` | VERIFIED | `FailureClassification` interface at retry.ts:11; full D-03 mapping table. |
| `apps/server/src/enrichment/service.ts` | enqueueMany + enqueue wrapper | VERIFIED | `enqueueMany` at service.ts:36; `enqueue` is `await enqueueMany([md5])` at service.ts:129. |
| `apps/server/src/enrichment/applier.ts` | markTerminalFailure writes failure_reason | VERIFIED | Signature accepts `reason: FailureReason` at applier.ts:141; UPDATE writes `failure_reason: reason` at applier.ts:160. |
| `apps/server/src/enrichment/router.ts` | POST /retry-all with .strict() body | VERIFIED | Route at router.ts:64; `.strict()` body schema at router.ts:62; calls `enqueueMany(failedMd5s, { force: true })`. |
| `apps/server/src/enrichment/unmatched-repository.ts` | SELECT b.failure_reason + row type extended | VERIFIED | Repository SELECT and type both include `failure_reason: FailureReason \| null`. |
| `packages/common/types/enrichment.ts` | FailureReason union | VERIFIED | `export type FailureReason = 'no_match' \| 'ambiguous_match' \| 'network' \| 'parse_error'`. |
| `packages/common/types/book.ts` | DbBook.failure_reason field | VERIFIED | `failure_reason: FailureReason \| null` on DbBook. |
| `apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx` | Closed-lookup badge component | VERIFIED | Imported and rendered in unmatched-books-section.tsx:90. |
| `apps/web/src/pages/settings-page/retry-all-button.tsx` | Section CTA, no-modal, locked copy | VERIFIED | Wired in unmatched-books-section.tsx:40. |
| `apps/web/src/api/enrichment.ts` | postRetryAll + invalidateUnmatchedList + UnmatchedBookRow.failure_reason | VERIFIED | All three present at enrichment.ts:26, 61, 74. |
| `apps/web/src/components/re-enrich-button/re-enrich-button.tsx` | invalidateUnmatchedList after success | VERIFIED | Imported at re-enrich-button.tsx:8; called at re-enrich-button.tsx:43. |
| `apps/web/src/pages/settings-page/unmatched-books-section.tsx` | Retry-all button + badge wiring | VERIFIED | RetryAllButton in header (line 40), FailureReasonBadge in row (line 90). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| worker.scheduleRetryOrFail | markTerminalFailure | `{ class, reason } = classifyFailure(err)` -> 5-arg call | WIRED | Verified via grep: `new NoMatchError` and destructured `classifyFailure` present in worker.ts. |
| markTerminalFailure | book row | knex `.update({ failure_reason: reason })` | WIRED | Inside transaction at applier.ts:160 alongside `enrichment_status: 'failed'`. |
| getUnmatchedBooks | inbox UI | SELECT `b.failure_reason` -> UnmatchedBookRow -> FailureReasonBadge | WIRED | Repository SELECT, web type, and badge render all aligned. |
| RetryAllButton | POST /retry-all | `postRetryAll()` -> enqueueMany | WIRED | Click handler -> postRetryAll -> server route -> enqueueMany with force=true. |
| ReEnrichButton (row) | unmatched list cache | `invalidateUnmatchedList()` predicate-mutate | WIRED | re-enrich-button.tsx:43 calls helper after success. |
| router.post('/retry-all') | enqueueMany | `enqueueMany(failedMd5s, { force: true })` | WIRED | router.ts:75 after thin SELECT for failed md5s. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All Phase 8 server contract tests pass | `cd apps/server && npx vitest run src/enrichment/__tests__/phase-08-*.test.ts` | 6 files, 52 tests passed | PASS |
| All Phase 8 web contract tests pass | `cd apps/web && npx vitest run [3 files]` | 3 files, 15 tests passed | PASS |
| Phase 4 matcher regression (Plan 03 had flagged failing) | `cd apps/server && npx vitest run src/enrichment/__tests__/phase-04-matcher.test.ts` | 23 tests passed | PASS |
| Migration registered for `knex migrate:latest` | File present in apps/server/src/db/migrations/ | Present + applied per Plan 02 self-check | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| POLISH-01 | 08-02-server-core | Bulk-enqueue helper for batch enqueue | SATISFIED | `enqueueMany` exported (service.ts:36); `enqueue` rewritten as wrapper. Tests 6/6. |
| RETRY-01 | 08-03 + 08-04 | Bulk retry-all action from dashboard | SATISFIED | POST /retry-all + RetryAllButton + invalidate caches. Tests retry-all-route 4/4 + retry-all-button 6/6. |
| RETRY-02 | 08-04 | Per-book retry without page reload | SATISFIED | ReEnrichButton hardened with `invalidateUnmatchedList()`. Tests 3/3. |
| RETRY-03 | 08-02 | Improved matcher heuristics (normalization, fuzzy, Last/First) | SATISFIED | matchWork strict-then-fuzzy + Dice 0.85 + diacritic strip + subtitle split + swapLastFirst. Tests fuzzy 14/14 + ambiguous 5/5 + stuck-books 9/9. |
| RETRY-04 | 08-02 + 08-03 + 08-04 | Persisted structured failure_reason + inbox UI | SATISFIED | Migration + write site (applier) + read site (repository) + UI badge. Tests classify 14/14 + badge 6/6. |

No orphaned requirements. No requirement is unsatisfied.

### Anti-Patterns Found

None blocking. Notes:
- Plan 04 documented that the UI-SPEC "Confirmation Modal" section is now stale (D-10 supersedes it). This is a documentation hygiene item, not a code defect; verified `grep -c "openConfirmModal\|modals\." retry-all-button.tsx == 0`.
- Plan 02 documented the better-sqlite3 NODE_MODULE_VERSION deferred item from Plan 01 has been resolved (rebuild succeeded).

### Pre-Existing Failures (Out of Scope)

| File | Test | Status | Phase Origin |
|------|------|--------|--------------|
| `apps/server/src/db/migrations/__tests__/phase-06-schema.test.ts` | `migrate up -> down -> up is idempotent for the Phase 6 index migration` | FAILING (1 of 8) | Pre-existing on master ancestor of Phase 8; explicitly documented in Plan 03 SUMMARY as out-of-scope. |

This failure is not introduced by Phase 8 and does not block phase goal achievement. Confirmed via test run after Phase 8 commits applied.

### Human Verification Required

None. All success criteria are verifiable programmatically and have automated test coverage. The end-to-end UX flow (click "Retry all failed" -> toast appears -> rows refresh) is exercised by the RTL/jsdom test suite at `apps/web/src/pages/settings-page/retry-all-button.test.tsx` against the locked Mantine notification copy.

### Gaps Summary

No gaps. Phase 8 ships the four success criteria from ROADMAP and the five requirements from REQUIREMENTS.md. The bulk-enqueue helper consolidates the per-book enqueue loop, the matcher gains a fuzzy fallback with conservative Dice >= 0.85 plus diacritic, subtitle, and Last/First handling, every terminal failure persists a structured reason on the book row, the inbox UI renders a closed-lookup badge for that reason, and both bulk and per-row retry paths are wired with SWR cache invalidation so rows update without a page reload.

The single observable test failure on the branch (`phase-06-schema.test.ts` idempotency) is pre-existing and explicitly out-of-scope per the orchestrator brief and Plan 03 SUMMARY.

---

*Verified: 2026-04-27*
*Verifier: Claude (gsd-verifier)*

---
phase: 04-enrichment-service-backfill
plan: 02
subsystem: enrichment
tags: [enrichment, matcher, retry, pure-functions, tdd]
requirements: [ENRICH-06, ENRICH-07]
success_criteria_addressed: [SC-5]
dependency_graph:
  requires:
    - "apps/server/src/enrichment/http/http-errors.ts (NotFoundError, UpstreamServerError)"
    - "apps/server/src/enrichment/constants.ts (ENRICHMENT_LAST_ERROR_MAX)"
  provides:
    - "matcher.matchWork / matcher.normalizeTokens (consumed by Plan 04 applier, Plan 05 worker)"
    - "retry.classifyFailure / computeNextAttemptAt / truncateError (consumed by Plan 04 applier, Plan 05 worker)"
  affects:
    - "No runtime behavior change; files are pure and not yet wired to a caller."
tech_stack:
  added: []
  patterns:
    - "Pure-function TDD with injected clock (Date) instead of Date.now()"
    - "Set-based title-subset + token-overlap matching"
    - "Branded error classes + .code discrimination for retry classification"
key_files:
  created:
    - apps/server/src/enrichment/retry.ts
    - apps/server/src/enrichment/matcher.ts
  modified:
    - apps/server/src/enrichment/__tests__/phase-04-retry.test.ts
    - apps/server/src/enrichment/__tests__/phase-04-matcher.test.ts
decisions:
  - "classifyFailure returns a third FailureClass 'retryable-isbn-fallback' so the worker distinguishes ISBN 404 (fall through to search) from a work 404 (permanent)."
  - "Default for unknown errors is 'retryable'; ENRICHMENT_MAX_ATTEMPTS still caps the loop (D-14 conservative default)."
  - "matchWork bails early when book.authors has no tokens >= 3 chars (D-16 step 2)."
  - "Only top-3 candidates inspected per D-16; 4th+ ignored even if they would match."
metrics:
  tasks: 2
  completed: "2026-04-24"
  test_count_added: 49
  test_files_modified: 2
  runtime_files_created: 2
---

# Phase 04 Plan 02: Matcher + Retry Pure Modules Summary

Two pure enrichment modules landed: `retry.ts` (D-12 backoff + D-14 failure classification + last_error truncation) and `matcher.ts` (D-16/D-17 title subset + author token-overlap acceptance over OL search candidates). Both ship with full TDD suites driven from the Ender's Game fixture from Plan 01.

## What Shipped

### retry.ts

- `classifyFailure(err): 'retryable' | 'permanent' | 'retryable-isbn-fallback'`
  - `NotFoundError` with `/isbn/` url, retryable-isbn-fallback (worker falls through to `/search.json`).
  - `NotFoundError` with `/works/` url, permanent.
  - `UpstreamServerError`, `EOPENBREAKER`, `SQLITE_BUSY`, `ECONNRESET`, `ETIMEDOUT`, `UND_ERR_CONNECT_TIMEOUT`, retryable.
  - `ZodError`, `NoMatchError`, `Error('no-match')`, permanent.
  - Unknown, retryable (conservative; max-attempts caps the loop).
- `computeNextAttemptAt(attempts, now): string`, ISO timestamp using `min(300, 2^(n-1) * 10)` seconds.
- `truncateError(msg, max = ENRICHMENT_LAST_ERROR_MAX)`, slice-to-max helper for last_error DB writes (T-04-04 mitigation).

### matcher.ts

- `normalizeTokens(s)`, lowercase, strip `[^\p{L}\p{N}\s]` via `/gu`, collapse whitespace, drop tokens with length < 3.
- `matchWork(book, candidates)`, walks top-3 candidates. TITLE: every book token must be in candidate title (subset). AUTHOR: at least one overlap between first-comma-split book author tokens and any candidate `author_name` entry tokens. Returns first passing candidate or null.

## Commits

| Task | Phase | Type | Hash | Message |
|------|-------|------|------|---------|
| 1 RED | 04-02 | test | c383086 | add failing tests for retry classification + backoff |
| 1 GREEN | 04-02 | feat | 2541dc7 | implement retry classifyFailure + backoff + truncateError |
| 2 RED | 04-02 | test | 86528c6 | add failing tests for matcher token-overlap rule |
| 2 GREEN | 04-02 | feat | 30655c7 | implement matcher.matchWork with D-17 token overlap |

## TDD Gate Compliance

Both tasks followed full RED, GREEN cycles. No REFACTOR commits needed (pure, small, already idiomatic).

- Task 1: RED (c383086) confirmed `Cannot find module '../retry'`. GREEN (2541dc7) passed all 26 cases.
- Task 2: RED (86528c6) confirmed `Cannot find module '../matcher'`. GREEN (30655c7) passed all 23 cases.

## Verification

Full enrichment test suite runs green post-plan:

```
src/enrichment/__tests__/phase-04-no-direct-http.test.ts   8 passed
src/enrichment/__tests__/phase-03-no-db-writes.test.ts    12 passed
src/enrichment/__tests__/phase-04-matcher.test.ts         23 passed
src/enrichment/__tests__/phase-04-fixture-shape.test.ts    5 passed
src/enrichment/__tests__/phase-04-retry.test.ts           26 passed
src/enrichment/__tests__/phase-03-integration.test.ts      2 passed
src/enrichment/__tests__/phase-03-shared-limiter.test.ts   2 passed
Total: 78/78 passed
```

Grep guard (`phase-04-no-direct-http.test.ts`) explicitly covers both new files; both pass, no fetch/axios/http literal in either.

## Deviations from Plan

None. Plan executed exactly as written. Pseudocode in `<action>` blocks mapped 1:1 onto implementation, save for one small structural polish in `matchWork`: the "no author tokens" bail was hoisted out of the per-candidate loop since it does not depend on the candidate. Behavior is identical (the plan's per-iteration `continue` and the hoisted early `return null` both end with null when author tokens are empty).

## Threat Flags

None. Plan-level threat register (T-04-04 through T-04-07) is addressed:

- T-04-04 (unbounded last_error), `truncateError` is exported and tested; Plan 04/05 callers will route errors through it.
- T-04-06 (short-token drop), explicit test `J. R. R. Tolkien` locks the D-17 behavior.
- T-04-07 (ReDoS), regex is linear; no catastrophic backtracking pattern.

## Known Stubs

None. Both modules are complete and production-ready for the Wave 2 applier and Wave 3 worker to consume.

## Self-Check: PASSED

- apps/server/src/enrichment/retry.ts, FOUND
- apps/server/src/enrichment/matcher.ts, FOUND
- apps/server/src/enrichment/__tests__/phase-04-retry.test.ts, FOUND (modified from placeholder)
- apps/server/src/enrichment/__tests__/phase-04-matcher.test.ts, FOUND (modified from placeholder)
- Commits c383086, 2541dc7, 86528c6, 30655c7 all present in `git log`.

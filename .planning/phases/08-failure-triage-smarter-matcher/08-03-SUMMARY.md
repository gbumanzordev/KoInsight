---
phase: 08-failure-triage-smarter-matcher
plan: 03
subsystem: enrichment
tags: [enrichment, applier, worker, router, retry-all, failure-reason, wiring]
requires:
  - "Plan 02: classifyFailure returns { class, reason }"
  - "Plan 02: matcher AmbiguousMatchError + NoMatchError + matchWork throws on no/ambiguous candidate"
  - "Plan 02: enqueueMany(md5s, { force? }) -> { enqueued, skipped }"
  - "Plan 02: book.failure_reason TEXT NULL CHECK column migration"
provides:
  - "markTerminalFailure(knex, jobId, md5, error, reason) writes failure_reason transactionally with enrichment_status='failed'"
  - "worker.scheduleRetryOrFail threads { class, reason } from classifyFailure to markTerminalFailure on permanent + attempts-exhausted branches"
  - "POST /api/enrichment/retry-all route behind Zod .strict() body schema; selects failed md5s, calls enqueueMany with force=true"
  - "getUnmatchedBooks SELECTs b.failure_reason; UnmatchedBookRow.failure_reason: FailureReason | null"
affects:
  - apps/server/src/enrichment/applier.ts
  - apps/server/src/enrichment/worker.ts
  - apps/server/src/enrichment/router.ts
  - apps/server/src/enrichment/unmatched-repository.ts
  - apps/server/src/enrichment/__tests__/phase-04-applier.test.ts
  - apps/server/src/enrichment/__tests__/phase-04-retry.test.ts
tech-stack:
  added: []
  patterns:
    - "Zod .strict() body schema rejecting unknown keys + non-boolean force (T-08-03 mitigation)"
    - "FailureReason threaded from classifier -> applier so book row carries structured triage category"
key-files:
  created: []
  modified:
    - apps/server/src/enrichment/applier.ts
    - apps/server/src/enrichment/worker.ts
    - apps/server/src/enrichment/router.ts
    - apps/server/src/enrichment/unmatched-repository.ts
    - apps/server/src/enrichment/__tests__/phase-04-applier.test.ts
    - apps/server/src/enrichment/__tests__/phase-04-retry.test.ts
decisions:
  - "Kept the worker.ts `if (!candidate)` defensive guard even though matcher.ts throws on no-match, but rewrote it as `throw new NoMatchError()` so the import is meaningful and a future regression that re-introduces a null return surfaces an explicit named error (caught by classifyFailure -> permanent / no_match) instead of crashing on `.key` access. This satisfies the plan acceptance criteria `grep new NoMatchError worker.ts >= 1` while honoring the Plan 02 contract."
  - "POST /retry-all selects failed md5s OUTSIDE the enqueueMany transaction (a thin SELECT, then a single enqueueMany call). enqueueMany itself owns the per-book status flip + ON CONFLICT insert in its own transaction, so the route is correctly thin: validate -> read -> hand off."
  - "phase-04-retry.test.ts assertions unwrapped to .class instead of being deleted; the legacy disposition contract (retryable/permanent/retryable-isbn-fallback) still gets its dedicated coverage there, and the full { class, reason } table lives in phase-08-classify-failure.test.ts."
metrics:
  duration_minutes: ~5
  tasks_completed: 2
  files_created: 0
  files_modified: 6
  completed: 2026-04-27
---

# Phase 8 Plan 03: Server Wiring Summary

Wired the Plan 02 server primitives into runtime call sites: markTerminalFailure now persists `book.failure_reason` transactionally (RETRY-04 / D-01); worker.scheduleRetryOrFail threads `{ class, reason }` from the refactored classifyFailure on every terminal-failure path (Pitfall 5 + Pitfall 6); POST /api/enrichment/retry-all is live behind a Zod `.strict()` body schema and forwards the entire failed-book set to enqueueMany with `force: true` (CD-2 + Open Q4); getUnmatchedBooks SELECTs `b.failure_reason` so the Plan 04 inbox can render the structured badge. Both Wave 2 RED tests (`phase-08-retry-all-route.test.ts`, `phase-08-stuck-books.test.ts`) flip GREEN, completing the server-side Phase 8 contract.

## What shipped

### applier.ts — markTerminalFailure
**Final signature:**
```ts
export async function markTerminalFailure(
  knex: Knex,
  jobId: number,
  bookMd5: string,
  error: unknown,
  reason: FailureReason
): Promise<void>;
```
Inside the existing transaction, the `book` UPDATE now writes `failure_reason: reason` alongside `enrichment_status: 'failed'`. The `enrichment_job` UPDATE (status, last_error, updated_at) is untouched. `truncateError` import preserved verbatim.

### worker.ts — call-site changes
**Lines before/after (relative to the pre-change file):**

| Site | Before | After |
|------|--------|-------|
| no-match path (was lines 144-148) | `const err = new Error('no-match…'); err.name = 'NoMatchError'; await markTerminalFailure(knex, job.id, job.book_md5, err);` | `if (!candidate) { throw new NoMatchError(); }` (defensive — matcher itself throws first under the Plan 02 contract) |
| scheduleRetryOrFail destructure (line 204) | `const klass = classifyFailure(err);` | `const { class: klass, reason } = classifyFailure(err);` |
| permanent branch (line 206) | `markTerminalFailure(knex, job.id, job.book_md5, err);` (4 args) | `markTerminalFailure(knex, job.id, job.book_md5, err, reason);` (5 args) |
| attempts-exhausted branch (line 210) | `markTerminalFailure(knex, job.id, job.book_md5, err);` (4 args) | `markTerminalFailure(knex, job.id, job.book_md5, err, reason);` (5 args) |

`NoMatchError` added to the `from './matcher'` import. `computeNextAttemptAt`, `truncateError`, `ENRICHMENT_MAX_ATTEMPTS`, and the retryable-isbn-fallback branch (logs in tests) are preserved verbatim. No other call sites of `markTerminalFailure` exist in the server tree (verified via grep).

### router.ts — POST /retry-all
```ts
const retryAllBodySchema = z.object({
  force: z.boolean().optional(),
}).strict();

router.post('/retry-all', async (req, res) => {
  const parsed = retryAllBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const failedRows = await db('book')
      .where({ enrichment_status: 'failed' })
      .select<Array<{ md5: string }>>('md5');
    const failedMd5s = failedRows.map((r) => r.md5);
    const result = await enqueueMany(failedMd5s, { force: true });
    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to enqueue retries' });
  }
});
```

#### Observed behavior under each test case

| Case | Body | Status | Body shape |
|------|------|--------|------------|
| 0 failed books | `{}` | 200 | `{ enqueued: 0, skipped: 0 }` (enqueueMany short-circuits on empty array) |
| N=3 failed books | `{}` | 200 | `{ enqueued: 3, skipped: 0 }`; rows flipped to `pending`; 3 pending enrichment_job rows inserted |
| Unknown body key (`{ filter: 'foo' }`) | `{ filter: 'foo' }` | 400 | `{ error: { formErrors: [...], fieldErrors: { filter: ['Unrecognized key: "filter"'] } } }` (T-08-03) |
| Non-boolean force (`{ force: 'yes' }`) | `{ force: 'yes' }` | 400 | `{ error: { formErrors: [...], fieldErrors: { force: ['Invalid input: expected boolean…'] } } }` (T-08-03) |

### unmatched-repository.ts
- `UnmatchedBookRow` type extended with `failure_reason: FailureReason | null` (between `authors` and `last_error`).
- `getUnmatchedBooks` SELECT extended with `'b.failure_reason'` (between `'b.authors'` and `'ej.last_error'`).
- `import type { FailureReason } from '@koinsight/common/types/enrichment'` added at the top.

### Did the matchWork null-return removal cascade to other call sites?
**No.** The only consumer of `matchWork` in `apps/server/src/` is `processJob` in `worker.ts`. The pre-existing `if (!candidate)` block was the only null-handler; rewriting it as a defensive `throw new NoMatchError()` (instead of removing it outright) avoids a TypeScript narrowing churn while honoring the Plan 02 contract that matcher errors flow through classifyFailure. No other call sites needed touching.

## Validation

| Suite | Result |
|-------|--------|
| `phase-08-retry-all-route.test.ts` | 4/4 GREEN |
| `phase-08-stuck-books.test.ts` | 9/9 GREEN |
| `phase-04-applier.test.ts` | 16/16 GREEN (regression, with new `failure_reason` assertion added) |
| `phase-04-retry.test.ts` | 26/26 GREEN (regression, assertions unwrapped to `.class`) |
| `phase-04-worker.test.ts` | 10/10 GREEN (regression: end-to-end worker flow preserves last_error + book status) |
| `unmatched-router.test.ts` | 8/8 GREEN (regression: extending the SELECT did not break the existing GET) |

Total touched-area coverage: 73/73 GREEN.

### Status of all Wave 0 RED tests after Plan 03

| File | Status |
|------|--------|
| phase-08-classify-failure.test.ts | GREEN (Plan 02) |
| phase-08-matcher-fuzzy.test.ts | GREEN (Plan 02) |
| phase-08-matcher-ambiguous.test.ts | GREEN (Plan 02) |
| phase-08-stuck-books.test.ts | GREEN (Plan 02 + Plan 03 wiring confirmed) |
| phase-08-enqueue-many.test.ts | GREEN (Plan 02) |
| **phase-08-retry-all-route.test.ts** | **GREEN (Plan 03)** |
| failure-reason-badge.test.tsx | RED — Plan 04 (UI) |
| retry-all-button.test.tsx | RED — Plan 04 (UI) |
| re-enrich-button.test.tsx | RED — Plan 04 (UI) |

All 6 server-side Wave 0 RED tests are GREEN. The 3 web RED tests are Plan 04's responsibility.

## Threat model status

- **T-08-03 (Tampering on POST body):** mitigated. `phase-08-retry-all-route.test.ts` asserts 400 on unknown keys (`{ filter: 'foo' }`) and on non-boolean `force` (`{ force: 'yes' }`) via `z.object({...}).strict()`. Code AND test both encode the mitigation.
- **T-08-07 (Injection on failure_reason write):** mitigated. The applier uses parameterized knex `.update({ failure_reason: reason })`; `reason: FailureReason` is a closed TypeScript union, and the SQLite CHECK constraint from the Plan 02 migration enforces the allowed values at the DB level.
- **T-08-01 (Spoofing/DoS on /retry-all):** accepted (no auth in v1.1; per CLAUDE.md, CORS is `*` even in production). Documented; no mitigation this milestone.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan 04 retry tests assert against legacy `classifyFailure` return shape**
- **Found during:** Task 1 verification.
- **Issue:** `phase-04-retry.test.ts` had 13 assertions of the form `expect(classifyFailure(...)).toBe('retryable')` written before Plan 02 widened the return type from a bare string to `{ class, reason }`. The tests reported failures like "expected `{ class: 'retryable', reason: 'parse_error' }` to be 'retryable'". Plan 02 missed updating these.
- **Fix:** Unwrapped each assertion to `.class` so the legacy disposition contract still gets exercised here; the structured `{ class, reason }` table coverage already lives in `phase-08-classify-failure.test.ts`.
- **Files modified:** apps/server/src/enrichment/__tests__/phase-04-retry.test.ts.
- **Commit:** 53b4221 (folded into Task 1 commit since both test updates are required to keep the suite GREEN under the new signature).

### Deferred items (out of scope, logged here)

The following pre-existing failures were observed during the full-suite regression run. Confirmed via `git stash` + re-run that they exist on `master` ancestor of this plan and are not introduced by Plan 03:

- **`phase-04-matcher.test.ts` (8 failed of 23):** Tests like `returns null when all top-3 fail` and `rejects candidate missing required title tokens` assert the old `matchWork` contract that returned `null`. Plan 02 changed `matchWork` to throw `NoMatchError` instead. These are Plan 02 follow-ups, not Plan 03 territory; Plan 02's GREEN suites focused on the new behavior in `phase-08-matcher-*.test.ts`.
- **`phase-06-schema.test.ts` (1 failed of 8):** `migrate up -> down -> up is idempotent for the Phase 6 index migration` — pre-existing Phase 6 test; orthogonal to Phase 8.

These are flagged for the Phase 8 verifier and a future Plan 02 polish pass; they do not block Plan 04.

## Self-Check

- [x] `apps/server/src/enrichment/applier.ts` contains `reason: FailureReason` and `failure_reason: reason` (verified via grep).
- [x] `apps/server/src/enrichment/worker.ts` contains `new NoMatchError` and `const { class: klass, reason } = classifyFailure(err)` (verified via grep).
- [x] `apps/server/src/enrichment/router.ts` contains `router.post('/retry-all'`, `.strict()` body schema, and `enqueueMany(... { force: true })` (verified via grep).
- [x] `apps/server/src/enrichment/unmatched-repository.ts` contains `'b.failure_reason'` in SELECT and `failure_reason: FailureReason | null` on the row type.
- [x] All 6 server-side Wave 0 tests GREEN (verified via vitest run).
- [x] Existing markTerminalFailure consumers updated: only worker.ts and phase-04-applier.test.ts; both touched.
- [x] Commits exist: 53b4221 (Task 1: applier + worker + test fixups), 35bb14b (Task 2: route + repository).

## Self-Check: PASSED

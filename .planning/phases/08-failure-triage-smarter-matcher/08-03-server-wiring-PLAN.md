---
phase: 08-failure-triage-smarter-matcher
plan: 03
type: execute
wave: 2
depends_on: [01, 02]
files_modified:
  - apps/server/src/enrichment/applier.ts
  - apps/server/src/enrichment/worker.ts
  - apps/server/src/enrichment/router.ts
  - apps/server/src/enrichment/unmatched-repository.ts
autonomous: true
requirements: [RETRY-01, RETRY-04]
tags: [enrichment, applier, worker, router, retry-all, wiring]

must_haves:
  truths:
    - "markTerminalFailure persists failure_reason on book.failure_reason transactionally with enrichment_status='failed' (D-01)"
    - "worker.ts threads { class, reason } from classifyFailure to markTerminalFailure for both the no-match path and the scheduleRetryOrFail path (Pitfall 5)"
    - "POST /api/enrichment/retry-all returns { enqueued, skipped } and rejects unknown body keys (Zod .strict(); T-08-03)"
    - "Worker no-match path uses NoMatchError from matcher.ts (replaces inline Error + .name='NoMatchError')"
    - "getUnmatchedBooks SELECT returns book.failure_reason on each row so the inbox UI can render the badge"
  artifacts:
    - path: apps/server/src/enrichment/applier.ts
      provides: "markTerminalFailure with 5th param `reason: FailureReason`; UPDATE book SET failure_reason=? in same trx as enrichment_status='failed'"
    - path: apps/server/src/enrichment/worker.ts
      provides: "scheduleRetryOrFail destructures { class, reason } from classifyFailure; passes reason to markTerminalFailure; no-match path throws NoMatchError"
    - path: apps/server/src/enrichment/router.ts
      provides: "POST /retry-all route with Zod .strict() body schema; SELECTs failed md5s; calls enqueueMany with force=true; returns { enqueued, skipped }"
    - path: apps/server/src/enrichment/unmatched-repository.ts
      provides: "getUnmatchedBooks SELECTs b.failure_reason; UnmatchedBookRow type extended with failure_reason"
  key_links:
    - from: apps/server/src/enrichment/worker.ts
      to: apps/server/src/enrichment/applier.ts markTerminalFailure
      via: "markTerminalFailure(knex, jobId, md5, err, reason)"
      pattern: "markTerminalFailure\\("
    - from: apps/server/src/enrichment/router.ts
      to: apps/server/src/enrichment/service.ts enqueueMany
      via: "enqueueMany(failedMd5s, { force: true })"
      pattern: "enqueueMany"
    - from: apps/server/src/enrichment/unmatched-repository.ts
      to: book.failure_reason column
      via: "SELECT b.failure_reason"
      pattern: "failure_reason"
---

<objective>
Wire the Plan 02 server primitives into the request/response and worker paths:

1. `markTerminalFailure` writes `book.failure_reason` transactionally (RETRY-04, D-01).
2. `worker.ts` threads `{ class, reason }` from the refactored `classifyFailure` (Pitfall 5).
3. `POST /api/enrichment/retry-all` route lands per CD-2 (RETRY-01).
4. `getUnmatchedBooks` returns `failure_reason` on each row so the Plan 04 web UI can render badges.

Purpose: Plan 02 left the server-pure logic ready but DISCONNECTED from runtime call sites — by design, to keep file ownership clean. This plan makes the system whole and turns the remaining Wave 0 RED tests (`phase-08-retry-all-route.test.ts`, `phase-08-stuck-books.test.ts`) GREEN.

Output: 4 modified files; 1 new HTTP route; the entire server-side Phase 8 contract is operational after this plan ships.
</objective>

<execution_context>
@/Users/gbumanzordev/Dev/Personal/KoInsight/.claude/get-shit-done/workflows/execute-plan.md
@/Users/gbumanzordev/Dev/Personal/KoInsight/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/phases/08-failure-triage-smarter-matcher/08-CONTEXT.md
@.planning/phases/08-failure-triage-smarter-matcher/08-RESEARCH.md
@.planning/phases/08-failure-triage-smarter-matcher/08-PATTERNS.md
@.planning/phases/08-failure-triage-smarter-matcher/08-01-wave0-tests-types-PLAN.md
@.planning/phases/08-failure-triage-smarter-matcher/08-02-server-core-PLAN.md
@apps/server/src/enrichment/applier.ts
@apps/server/src/enrichment/worker.ts
@apps/server/src/enrichment/router.ts
@apps/server/src/enrichment/unmatched-repository.ts
@apps/server/src/enrichment/service.ts
@apps/server/src/enrichment/matcher.ts
@apps/server/src/enrichment/retry.ts
@apps/server/src/enrichment/__tests__/phase-08-retry-all-route.test.ts
@apps/server/src/enrichment/__tests__/phase-08-stuck-books.test.ts
@apps/server/src/app.ts

<interfaces>
<!-- From Plan 02: -->
import { classifyFailure, type FailureClassification } from './retry';
import { AmbiguousMatchError, NoMatchError } from './matcher';
import { enqueueMany } from './service';
import type { FailureReason } from '@koinsight/common/types/enrichment';

// Refactored:
classifyFailure(err): { class: FailureClass, reason: FailureReason }

// New signature for markTerminalFailure (D-01, D-02):
markTerminalFailure(
  knex: Knex,
  jobId: number,
  bookMd5: string,
  error: unknown,
  reason: FailureReason
): Promise<void>

// New retry-all route (CD-2):
// POST /api/enrichment/retry-all
// Request body: {} or { force?: boolean } (Zod .strict(), unknown keys rejected)
// Response 200: { enqueued: number, skipped: number }
// Response 400: { error: ZodFlattenedError } on validation fail
// Response 500: { error: 'Failed to enqueue retries' } on internal err

// UnmatchedBookRow extension:
interface UnmatchedBookRow {
  /* existing fields */
  failure_reason: FailureReason | null;
}
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add reason parameter to markTerminalFailure; update worker.ts call sites (Pitfall 5)</name>
  <read_first>
    - apps/server/src/enrichment/applier.ts (existing markTerminalFailure lines 135-153, full function)
    - apps/server/src/enrichment/worker.ts (no-match path lines 144-148; scheduleRetryOrFail lines 199-221)
    - apps/server/src/enrichment/__tests__/phase-08-classify-failure.test.ts (already GREEN from Plan 02; regression check)
    - apps/server/src/enrichment/__tests__/phase-08-stuck-books.test.ts (RED until Plan 02 + this task)
    - apps/server/src/enrichment/__tests__/phase-04-applier.test.ts (existing markTerminalFailure tests; update if signature changes)
    - .planning/phases/08-failure-triage-smarter-matcher/08-CONTEXT.md (D-01, D-02)
    - .planning/phases/08-failure-triage-smarter-matcher/08-RESEARCH.md §"markTerminalFailure accepting reason" + Pitfalls 5, 6, 7
    - .planning/phases/08-failure-triage-smarter-matcher/08-PATTERNS.md §"applier.ts" + §"worker.ts"
  </read_first>
  <files>
    apps/server/src/enrichment/applier.ts,
    apps/server/src/enrichment/worker.ts
  </files>
  <behavior>
    **applier.ts:**
    - `markTerminalFailure(knex, jobId, bookMd5, error, reason)` — new 5th parameter `reason: FailureReason` (required, no default).
    - Inside the existing transaction, the `book` UPDATE includes `failure_reason: reason` alongside `enrichment_status: 'failed'`.
    - The `enrichment_job` UPDATE is unchanged (still writes `last_error` truncated string + `updated_at`).
    - Existing `truncateError` import preserved.

    **worker.ts:**
    - The no-match path (lines ~144-148) replaces `const err = new Error('no-match...'); err.name = 'NoMatchError';` with `const err = new NoMatchError();` (imported from `./matcher`). Then either:
      (a) Continue calling `markTerminalFailure(knex, job.id, job.book_md5, err, 'no_match')` directly (preferred — simpler control flow), OR
      (b) `throw err` and let `scheduleRetryOrFail` route it through classifyFailure. Per RESEARCH §"worker.ts" recommendation, OPTION (a) is acceptable; it bypasses the classifier but uses the same reason verbatim.
    - The `scheduleRetryOrFail` path (lines ~199-221): destructure `{ class: klass, reason } = classifyFailure(err)`. When the worker decides to terminally fail (permanent class OR retryable-but-attempts-exhausted), pass `reason` as the new 5th arg to `markTerminalFailure`.
    - Pitfall 7 specific case: when `class === 'retryable-isbn-fallback'`, the worker's existing fallback path (re-enqueue with search instead of isbn) is preserved; only when this path EVENTUALLY exhausts via a different err does markTerminalFailure see `reason: 'no_match'` per the classifier's catch from the next err.
    - `attempts >= ENRICHMENT_MAX_ATTEMPTS` exhaustion (Pitfall 6): the `reason` from `classifyFailure(err)` (already typically `'network'` for the kinds of errors that reach this branch) is passed verbatim. No special re-classification.
    - All existing logging, attempt counting, `computeNextAttemptAt` calls preserved verbatim.

    **Existing tests:** any existing `markTerminalFailure` test (e.g., `phase-04-applier.test.ts` if present) MUST be updated to pass the new `reason` argument; otherwise the suite breaks.
  </behavior>
  <action>
    Modify `apps/server/src/enrichment/applier.ts`:
    1. Add import at top: `import type { FailureReason } from '@koinsight/common/types/enrichment';` (match existing common-types import style in the file).
    2. Update signature:
    ```typescript
    export async function markTerminalFailure(
      knex: Knex,
      jobId: number,
      bookMd5: string,
      error: unknown,
      reason: FailureReason
    ): Promise<void> {
      const rawMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
      const lastError = truncateError(rawMessage);

      await knex.transaction(async (trx) => {
        await trx('enrichment_job').where({ id: jobId }).update({
          status: 'failed',
          last_error: lastError,
          updated_at: trx.fn.now(),
        });
        await trx('book').where({ md5: bookMd5 }).update({
          enrichment_status: 'failed',
          failure_reason: reason,  // D-01
        });
      });
    }
    ```

    Modify `apps/server/src/enrichment/worker.ts`:
    1. Add import: `import { NoMatchError } from './matcher';` (alongside existing matcher imports).
    2. No-match path replacement (around line 144-148):
    ```typescript
    if (!candidate) {
      const err = new NoMatchError();
      await markTerminalFailure(knex, job.id, job.book_md5, err, 'no_match');
      return;
    }
    ```
    Note: per Plan 02, matcher.ts no longer returns null. So this `if (!candidate)` branch becomes unreachable; instead the matcher will THROW `NoMatchError` or `AmbiguousMatchError`, and the catch block handles it. Adjust accordingly: REMOVE the `if (!candidate)` block entirely (matcher's new contract: always returns or throws). The catch block + `scheduleRetryOrFail` already handles `NoMatchError` via `classifyFailure(err).reason === 'no_match'`.

    3. scheduleRetryOrFail path (around lines 199-221):
    ```typescript
    const { class: klass, reason } = classifyFailure(err);
    if (klass === 'permanent') {
      await markTerminalFailure(knex, job.id, job.book_md5, err, reason);
      return;
    }
    if (job.attempts >= ENRICHMENT_MAX_ATTEMPTS) {
      await markTerminalFailure(knex, job.id, job.book_md5, err, reason);
      return;
    }
    // ... existing retry-with-backoff code ...
    ```
    Preserve all other branches (retryable-isbn-fallback re-enqueue logic, computeNextAttemptAt, logging) verbatim.

    4. Search for any other call site of `markTerminalFailure` in the server codebase via `grep -n "markTerminalFailure" apps/server/src/`. Update each one with the new 5-arg signature. Likely zero additional sites.

    5. Update `apps/server/src/enrichment/__tests__/phase-04-applier.test.ts` (or wherever markTerminalFailure tests live) to pass a `reason` arg. Use `'no_match'` as a safe default in existing test cases that don't care which reason. ADD one new assertion that `book.failure_reason` is written correctly (e.g., assert the row after invocation has `failure_reason === 'no_match'`).

    6. Verify `phase-08-stuck-books.test.ts` runs and passes: it relies on the matcher's new behavior (Plan 02) plus the worker integration (this task) only insofar as the matcher returns/throws correctly. If the test runs matcher.matchWork directly without going through the worker, it should already be GREEN from Plan 02; if it requires the full worker pipeline, this task's wiring is what makes it GREEN.
  </action>
  <verify>
    <automated>npm --workspace=server exec vitest run apps/server/src/enrichment/__tests__/phase-08-stuck-books.test.ts apps/server/src/enrichment/__tests__/phase-04-applier.test.ts apps/server/src/enrichment/__tests__/phase-04-retry.test.ts 2>&1 | tail -30</automated>
  </verify>
  <acceptance_criteria>
    - `grep -E "reason: FailureReason" apps/server/src/enrichment/applier.ts` returns >= 1.
    - `grep "failure_reason: reason" apps/server/src/enrichment/applier.ts` returns >= 1.
    - `grep "new NoMatchError" apps/server/src/enrichment/worker.ts` returns >= 1.
    - `grep -E "const \{ class:.*reason \} = classifyFailure" apps/server/src/enrichment/worker.ts` returns >= 1.
    - `grep -c "markTerminalFailure(" apps/server/src/enrichment/worker.ts` matches the count of calls each with 5 args (verify via reading; no 4-arg calls remain).
    - `phase-08-stuck-books.test.ts` runs GREEN (or only the entries with `expected_outcome: 'no_match'` succeed if real-DB extraction surfaces some that genuinely have no OL candidate).
    - `phase-04-applier.test.ts` runs GREEN (regression: existing tests updated to new signature).
    - `phase-04-retry.test.ts` runs GREEN.
    - Full server type check passes: `npx tsc --noEmit -p apps/server/tsconfig.json` exits 0.
  </acceptance_criteria>
  <done>
    markTerminalFailure persists failure_reason transactionally; worker threads { class, reason } correctly; the no-match path uses NoMatchError; existing tests updated; phase-08-stuck-books.test.ts is GREEN.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add POST /api/enrichment/retry-all route (CD-2, RETRY-01) + extend unmatched-repository SELECT</name>
  <read_first>
    - apps/server/src/enrichment/router.ts (existing routes; Zod boundary lines 18-28)
    - apps/server/src/enrichment/unmatched-repository.ts (getUnmatchedBooks lines 69-109; UnmatchedBookRow type lines 18-25)
    - apps/server/src/enrichment/service.ts (enqueueMany from Plan 02)
    - apps/server/src/enrichment/__tests__/phase-08-retry-all-route.test.ts (RED tests from Plan 01)
    - apps/server/src/enrichment/__tests__/unmatched-router.test.ts (analog: supertest mount)
    - apps/server/src/app.ts (router mount path: `/api/enrichment` per CLAUDE.md)
    - .planning/phases/08-failure-triage-smarter-matcher/08-CONTEXT.md (CD-2, D-11, D-12)
    - .planning/phases/08-failure-triage-smarter-matcher/08-RESEARCH.md §"Pattern 5" (Zod empty-body POST) + Open Q4 (force: true required)
    - .planning/phases/08-failure-triage-smarter-matcher/08-PATTERNS.md §"router.ts" + §"unmatched-repository.ts"
  </read_first>
  <files>
    apps/server/src/enrichment/router.ts,
    apps/server/src/enrichment/unmatched-repository.ts
  </files>
  <behavior>
    **router.ts — new POST /retry-all:**
    - Body schema: `z.object({ force: z.boolean().optional() }).strict()` — `.strict()` mandatory per T-08-03 (rejects extra keys).
    - 400 on Zod failure with shape `{ error: parsed.error.flatten() }` (matches existing pattern verbatim).
    - On valid body:
      1. `SELECT md5 FROM book WHERE enrichment_status = 'failed'` via knex builder.
      2. `await enqueueMany(failedMd5s, { force: true })` — `force: true` mandatory because failed -> pending requires bypassing the status gate (Open Q4).
      3. Return 200 with the `{ enqueued, skipped }` from enqueueMany verbatim.
    - 500 on internal error: `{ error: 'Failed to enqueue retries' }` (matches existing pattern).
    - Empty failed-set (no rows) -> 200 + `{ enqueued: 0, skipped: 0 }` (no special-case; enqueueMany handles empty array).

    **unmatched-repository.ts — extend SELECT:**
    - Add `'b.failure_reason'` to the `.select(...)` call in `getUnmatchedBooks` (lines ~85-102 per 08-PATTERNS.md).
    - Extend `UnmatchedBookRow` type (lines ~18-25) with `failure_reason: FailureReason | null`.
    - Import `FailureReason` from `@koinsight/common/types/enrichment`.
  </behavior>
  <action>
    **router.ts** changes — add the new route AFTER the existing GET routes:

    ```typescript
    import { enqueueMany } from './service';
    // (existing imports preserved)

    const retryAllBodySchema = z.object({
      force: z.boolean().optional(),
    }).strict(); // T-08-03: reject unknown keys

    router.post('/retry-all', async (req: Request, res: Response) => {
      const parsed = retryAllBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const failedRows = await db('book')
          .where({ enrichment_status: 'failed' })
          .select<{ md5: string }[]>('md5');
        const failedMd5s = failedRows.map((r) => r.md5);
        // CD-2 + Open Q4: force=true required to flip 'failed' -> 'pending'
        const result = await enqueueMany(failedMd5s, { force: true });
        res.status(200).json(result);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to enqueue retries' });
      }
    });
    ```

    Match the existing import style for `db` (knex instance) and `Request, Response` from express. If the file uses a different pattern (e.g., async request handler wrapper), match it.

    **unmatched-repository.ts** changes:

    1. At the top of file, alongside existing common-types imports:
    ```typescript
    import type { FailureReason } from '@koinsight/common/types/enrichment';
    ```

    2. Extend the type (around lines 18-25):
    ```typescript
    export interface UnmatchedBookRow {
      // ... existing fields ...
      last_error: string | null;
      job_updated_at: string | null;
      failure_reason: FailureReason | null;  // NEW
    }
    ```

    3. Extend the SELECT (around lines 85-102):
    ```typescript
    .select(
      'b.id',
      'b.md5',
      'b.title',
      'b.authors',
      'b.failure_reason',  // NEW
      'ej.last_error',
      'ej.updated_at as job_updated_at'
    )
    ```

    4. The web `UnmatchedBookRow` mirror in `apps/web/src/api/enrichment.ts` is updated in Plan 04 (web ownership).
  </action>
  <verify>
    <automated>npm --workspace=server exec vitest run apps/server/src/enrichment/__tests__/phase-08-retry-all-route.test.ts apps/server/src/enrichment/__tests__/unmatched-router.test.ts 2>&1 | tail -30</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "router.post('/retry-all'" apps/server/src/enrichment/router.ts` returns 1.
    - `grep -c "z.object({.*force.*}).strict()" apps/server/src/enrichment/router.ts` returns >= 1 (T-08-03 mitigation).
    - `grep -c "enqueueMany(.*{ force: true }" apps/server/src/enrichment/router.ts` returns >= 1 (Open Q4).
    - `grep -c "b.failure_reason" apps/server/src/enrichment/unmatched-repository.ts` returns >= 1.
    - `grep -c "failure_reason: FailureReason \| null" apps/server/src/enrichment/unmatched-repository.ts` returns >= 1.
    - `phase-08-retry-all-route.test.ts` runs GREEN: empty-set + populated-set + 400 on extra keys + 400 on bad force type all pass.
    - `unmatched-router.test.ts` runs GREEN (regression on the existing GET route — adding failure_reason to the SELECT does not break it).
    - Full server type check passes: `npx tsc --noEmit -p apps/server/tsconfig.json` exits 0.
    - `curl -X POST http://localhost:3000/api/enrichment/retry-all -H 'Content-Type: application/json' -d '{}'` returns 200 with `{ enqueued, skipped }` JSON when running the dev server (manual verification optional; automated test is the gate).
  </acceptance_criteria>
  <done>
    POST /api/enrichment/retry-all is live, behind Zod .strict(), forces failed -> pending, returns the enqueueMany result verbatim. The inbox repository SELECTs failure_reason. All Wave 0 server RED tests are now GREEN.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client -> POST /api/enrichment/retry-all | Untrusted body crosses here; CORS is open per app.ts; no auth in v1.1 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-08-01 | DoS / Spoofing | POST /retry-all unauthenticated | accept | Project has no auth at all in v1.1 (CORS `*` per app.ts). DoS bounded by enqueueMany's worker-drain pacing (D-12); a malicious caller can only re-enqueue what's already in the failed set. Documented as informational; no mitigation this milestone. |
| T-08-03 | Tampering | POST body | mitigate | `z.object({ force: z.boolean().optional() }).strict()` rejects unknown keys AND non-boolean `force`. Test phase-08-retry-all-route.test.ts asserts both paths return 400. |
| T-08-07 | Injection | failure_reason write to SQLite | mitigate | knex parameterized UPDATE (`.update({ failure_reason: reason })`); reason is typed FailureReason (closed enum); CHECK constraint at SQLite level enforces. |
| T-08-02 | XSS via failure_reason render | n/a (web concern) | deferred to Plan 04 | Server emits closed enum keys only; client-side mitigation lands in Plan 04 via lookup table render. |
</threat_model>

<verification>
- `npm --workspace=server test` reports all GREEN (existing + new Phase 8 server tests).
- `npx tsc --noEmit -p apps/server/tsconfig.json` exits 0.
- Manual smoke: start `npm --workspace=server run dev`, force-fail a book via existing tooling, then `curl -X POST http://localhost:3000/api/enrichment/retry-all -d '{}'` returns 200; the book's status flips to `pending` in `dev.db`.
- All 6 Wave 0 server RED tests are GREEN.
- Coverage: RETRY-01 fully implemented server-side (Plan 04 wires UI). RETRY-04 fully implemented server-side (Plan 04 renders the badge).
</verification>

<success_criteria>
- markTerminalFailure 5-arg signature; book.failure_reason written transactionally on every terminal failure.
- worker.ts threads `{ class, reason }`; no-match path uses NoMatchError; no inline `Error.name = 'NoMatchError'` left.
- POST /api/enrichment/retry-all live and validated by Zod .strict().
- getUnmatchedBooks SELECTs failure_reason; UnmatchedBookRow type extended.
- All existing server tests still GREEN (no regression).
- All 6 Phase 8 Wave 0 server tests GREEN.
- T-08-03 mitigation encoded in code AND test.
</success_criteria>

<output>
After completion, create `.planning/phases/08-failure-triage-smarter-matcher/08-03-SUMMARY.md` documenting:
- Final markTerminalFailure signature.
- worker.ts call-site changes (line numbers before/after).
- POST /retry-all body schema + observed behavior under each test case.
- Whether the matcher.matchWork null-return removal cascaded to other call sites in worker.ts.
- Status of all Wave 0 RED tests (now should be all GREEN); flag any that remain RED for Plan 04.
</output>

---
phase: 08-failure-triage-smarter-matcher
plan: 02
type: execute
wave: 1
depends_on: [01]
files_modified:
  - apps/server/src/db/migrations/20260428000000_add_failure_reason_to_book.ts
  - apps/server/src/enrichment/matcher.ts
  - apps/server/src/enrichment/retry.ts
  - apps/server/src/enrichment/service.ts
autonomous: true
requirements: [POLISH-01, RETRY-03, RETRY-04]
tags: [enrichment, matcher, classify-failure, enqueue, schema]

must_haves:
  truths:
    - "book table has a nullable failure_reason TEXT column constrained to the 4 enum values (D-01, CD-1)"
    - "classifyFailure(err) returns { class: FailureClass, reason: FailureReason } per D-03 mapping table verbatim"
    - "matcher.ts exports AmbiguousMatchError and NoMatchError as named subclasses (D-05)"
    - "matchWork throws AmbiguousMatchError when 2+ of top-3 pass; falls back to fuzzy path; throws NoMatchError when 0 pass on either path (D-05, D-06)"
    - "Fuzzy path applies NFKD diacritic strip, subtitle split, Last,First swap, and Dice >= 0.85 (D-07, D-08)"
    - "enqueueMany(md5s, { force? }) ships next to enqueue and returns { enqueued, skipped }; enqueue is reimplemented as enqueueMany([md5]) (D-15, POLISH-01)"
    - "All Wave 0 RED tests authored in 08-01 turn GREEN after this plan lands (excluding tests that depend on Wave 2 wiring)"
  artifacts:
    - path: apps/server/src/db/migrations/20260428000000_add_failure_reason_to_book.ts
      provides: "Knex migration adding book.failure_reason TEXT NULL with checkIn enum"
      contains: "failure_reason"
    - path: apps/server/src/enrichment/matcher.ts
      provides: "AmbiguousMatchError, NoMatchError, normalizeTitleForFuzzy, swapLastFirst, diceCoefficient, DICE_THRESHOLD; updated matchWork with fuzzy fallback"
      exports: ["matchWork", "AmbiguousMatchError", "NoMatchError", "DICE_THRESHOLD", "diceCoefficient", "normalizeTitleForFuzzy", "swapLastFirst"]
    - path: apps/server/src/enrichment/retry.ts
      provides: "classifyFailure returns { class, reason }; FailureClassification type; preserves existing FailureClass union"
      exports: ["classifyFailure", "FailureClass", "FailureClassification"]
    - path: apps/server/src/enrichment/service.ts
      provides: "enqueueMany helper; enqueue rewritten as wrapper"
      exports: ["enqueue", "enqueueMany", "enrichmentService"]
  key_links:
    - from: apps/server/src/enrichment/retry.ts
      to: "@koinsight/common FailureReason"
      via: "import type { FailureReason } from '@koinsight/common/types/enrichment'"
      pattern: "FailureReason"
    - from: apps/server/src/enrichment/matcher.ts
      to: "AmbiguousMatchError + NoMatchError consumed by classifyFailure via err.name lookup"
      via: "Error subclass with .name set"
      pattern: "this.name = 'AmbiguousMatchError'"
    - from: apps/server/src/enrichment/service.ts
      to: "knex enrichment_job ON CONFLICT partial UNIQUE index"
      via: ".onConflict().ignore()"
      pattern: "onConflict"
---

<objective>
Land all server-side core implementations: schema migration, classifyFailure refactor, matcher heuristic upgrade, enqueueMany helper. After this plan, the Wave 0 server unit tests for classify-failure, matcher-fuzzy, matcher-ambiguous, and enqueue-many turn GREEN. Wiring (markTerminalFailure write of failure_reason, retry-all route) lands in Plan 03.

Purpose: This plan implements all PURE server logic that has no DB-write or HTTP wiring dependencies beyond the new migration column. It is intentionally scoped to keep file ownership exclusive of Plan 03 (which touches `applier.ts`, `worker.ts`, `router.ts`, `unmatched-repository.ts`).

Output:
- Knex migration adding `book.failure_reason TEXT NULL CHECK IN (...)`.
- Refactored `classifyFailure` returning `{ class, reason }` per D-03.
- New named-error subclasses `AmbiguousMatchError` + `NoMatchError` in `matcher.ts`.
- Fuzzy path in `matchWork` (NFKD + subtitle + Last,First + Dice >= 0.85) layered on top of strict path per D-06.
- `enqueueMany` in `service.ts`; `enqueue` reimplemented as wrapper.
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
@.planning/phases/07-reference-pages-enrichment/07-01-SUMMARY.md
@apps/server/src/db/migrations/20260427120000_add_reference_pages_source_to_book.ts
@apps/server/src/enrichment/matcher.ts
@apps/server/src/enrichment/retry.ts
@apps/server/src/enrichment/service.ts
@apps/server/src/enrichment/http/http-errors.ts
@apps/server/src/enrichment/constants.ts
@packages/common/types/enrichment.ts

<interfaces>
<!-- Locked from Plan 01: -->
export type FailureReason = 'no_match' | 'ambiguous_match' | 'network' | 'parse_error';

<!-- Existing classifyFailure shape (retry.ts:15-34) — preserve every branch when widening: -->
export type FailureClass = 'retryable' | 'permanent' | 'retryable-isbn-fallback';

<!-- New shape (D-02): -->
export interface FailureClassification {
  class: FailureClass;
  reason: FailureReason;
}
export function classifyFailure(err: unknown): FailureClassification;

<!-- Matcher new exports (D-05, D-08): -->
export const DICE_THRESHOLD = 0.85;
export class AmbiguousMatchError extends Error { /* .name set */ }
export class NoMatchError extends Error { /* .name set */ }
export function diceCoefficient(a: string, b: string): number;
export function normalizeTitleForFuzzy(title: string): string;
export function swapLastFirst(author: string): string | null;

<!-- Service new export (D-15): -->
export type EnqueueManyResult = { enqueued: number; skipped: number };
export function enqueueMany(
  bookMd5s: string[],
  options?: { force?: boolean }
): Promise<EnqueueManyResult>;
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Knex migration adding book.failure_reason TEXT NULL with checkIn enum</name>
  <read_first>
    - apps/server/src/db/migrations/20260427120000_add_reference_pages_source_to_book.ts (full file; analog template per CD-1)
    - apps/server/src/enrichment/constants.ts (verify migration directory + naming convention)
    - .planning/phases/08-failure-triage-smarter-matcher/08-CONTEXT.md (D-01, D-04, CD-1)
    - .planning/phases/08-failure-triage-smarter-matcher/08-RESEARCH.md §"Pattern 2" (Knex alterTable + checkIn pattern)
    - .planning/phases/08-failure-triage-smarter-matcher/08-PATTERNS.md §"migration"
  </read_first>
  <files>
    apps/server/src/db/migrations/20260428000000_add_failure_reason_to_book.ts
  </files>
  <behavior>
    - `up(knex)` adds a TEXT-typed `failure_reason` column to the `book` table, nullable, constrained via `checkIn(['no_match', 'ambiguous_match', 'network', 'parse_error'])`.
    - `down(knex)` drops the column.
    - Inline comment block at the top of `up` cites D-01 (column lives on `book`, not `enrichment_job`) and D-04 (legacy 8 failed rows left NULL; UI renders 'unknown' gray-outline badge for NULL).
    - Filename uses timestamp `20260428000000` (strictly greater than the latest existing migration `20260427120000`).
    - No new index per CD-4.
  </behavior>
  <action>
    Per CD-1 in 08-CONTEXT.md, mirror `apps/server/src/db/migrations/20260427120000_add_reference_pages_source_to_book.ts` verbatim. Swap:
    - column name `reference_pages_source` -> `failure_reason`
    - enum values `['openlibrary', 'manual']` -> `['no_match', 'ambiguous_match', 'network', 'parse_error']`
    - Inline comment block: explain D-01 (book row not enrichment_job, mirrors v1.0 *_source provenance pattern) and D-04 (no backfill; legacy NULL stays NULL; UI renders 'unknown' fallback per UI-SPEC).

    Final file shape:
    ```typescript
    import type { Knex } from 'knex';

    // D-01 / D-04: failure_reason persists the structured reason for the
    // most recent enrichment failure on the book row (mirrors v1.0 *_source
    // provenance pattern). Legacy already-failed rows (the 8 referenced in
    // the Phase 8 goal) stay NULL after migration; the inbox UI renders
    // them as 'unknown' (gray outline badge per UI-SPEC). Reclassification
    // happens naturally on next retry — no backfill task.
    export async function up(knex: Knex): Promise<void> {
      await knex.schema.alterTable('book', (table) => {
        table
          .string('failure_reason')
          .nullable()
          .checkIn(['no_match', 'ambiguous_match', 'network', 'parse_error']);
      });
    }

    export async function down(knex: Knex): Promise<void> {
      await knex.schema.alterTable('book', (table) => {
        table.dropColumn('failure_reason');
      });
    }
    ```

    After writing, run `npm --workspace=server run build:migrations && npm --workspace=server run knex migrate:latest` against the dev DB to verify it applies cleanly. Then test `down`/`up` cycle to confirm reversibility.

    Do NOT add an index on `failure_reason` (CD-4). Do NOT modify schema.ts (Knex migrations + book table is the source of truth).
  </action>
  <verify>
    <automated>npm --workspace=server run build:migrations && cd apps/server && npx knex migrate:latest && npx knex migrate:rollback && npx knex migrate:latest</automated>
  </verify>
  <acceptance_criteria>
    - `test -f apps/server/src/db/migrations/20260428000000_add_failure_reason_to_book.ts` exits 0.
    - `grep -c "checkIn(\[\\?'no_match'\\?, \\?'ambiguous_match'\\?, \\?'network'\\?, \\?'parse_error'\\?\])" apps/server/src/db/migrations/20260428000000_add_failure_reason_to_book.ts` returns >= 1 (enum locked).
    - `grep -c "dropColumn('failure_reason')" apps/server/src/db/migrations/20260428000000_add_failure_reason_to_book.ts` returns >= 1 (down implemented).
    - `grep -c "D-01\|D-04" apps/server/src/db/migrations/20260428000000_add_failure_reason_to_book.ts` returns >= 1 (decision IDs cited inline).
    - `cd apps/server && npx knex migrate:latest` exits 0 and reports the migration applied.
    - `sqlite3 ${DATA_PATH:-./../../data}/dev.db "PRAGMA table_info(book);" | grep failure_reason` returns one row with type TEXT and dflt_value NULL (or empty).
  </acceptance_criteria>
  <done>
    Migration file exists, applies cleanly, rolls back cleanly, re-applies cleanly. `book.failure_reason` column is present and nullable with CHECK constraint enforcing the 4 enum values.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Refactor classifyFailure to return { class, reason } per D-03</name>
  <read_first>
    - apps/server/src/enrichment/retry.ts (existing classifyFailure lines 15-34; preserve every branch verbatim)
    - apps/server/src/enrichment/http/http-errors.ts (NotFoundError, UpstreamServerError shape)
    - apps/server/src/enrichment/__tests__/phase-08-classify-failure.test.ts (RED tests authored in Plan 01; this task makes them GREEN)
    - apps/server/src/enrichment/__tests__/phase-04-retry.test.ts (existing branch-by-branch test style)
    - .planning/phases/08-failure-triage-smarter-matcher/08-CONTEXT.md (D-02, D-03)
    - .planning/phases/08-failure-triage-smarter-matcher/08-RESEARCH.md §"Refactored classifyFailure"
    - packages/common/types/enrichment.ts (FailureReason union landed in Plan 01)
  </read_first>
  <files>
    apps/server/src/enrichment/retry.ts
  </files>
  <behavior>
    - `classifyFailure(err)` returns `{ class: FailureClass, reason: FailureReason }` for every input, total (no throws).
    - The mapping table from D-03 is followed verbatim. Note specifically:
      - `NotFoundError` whose `.url` includes `/isbn/` -> `{ class: 'retryable-isbn-fallback', reason: 'no_match' }` (Pitfall 7 per 08-RESEARCH).
      - `Error.name === 'AmbiguousMatchError'` -> `{ class: 'permanent', reason: 'ambiguous_match' }` (NEW branch).
      - `Error.name === 'NoMatchError'` OR legacy `err.message === 'no-match'` -> `{ class: 'permanent', reason: 'no_match' }`.
      - `ZodError` -> `{ class: 'permanent', reason: 'parse_error' }`.
      - `UpstreamServerError` -> `{ class: 'retryable', reason: 'network' }`.
      - `.code` in `{ ECONNRESET, ETIMEDOUT, UND_ERR_CONNECT_TIMEOUT, EOPENBREAKER, SQLITE_BUSY }` -> `{ class: 'retryable', reason: 'network' }`.
      - Any other input -> `{ class: 'retryable', reason: 'parse_error' }` (D-03 catch-all; per Pitfall 6 this also covers exhausted-retryable network paths since the err itself maps to network).
    - Existing exports `truncateError`, `computeNextAttemptAt`, `FailureClass` type, `ENRICHMENT_LAST_ERROR_MAX` re-export — preserved verbatim.
    - Module remains pure (no knex, no fetch, no Date.now() — line 1 comment preserved).
  </behavior>
  <action>
    Implement per RESEARCH §"Refactored classifyFailure" Code Example. Specifically:

    1. Add at top of file (after existing imports):
    ```typescript
    import type { FailureReason } from '@koinsight/common/types/enrichment';
    ```
    (Match the existing import style — if other server files use `@koinsight/common` without `/types/...` suffix, follow that pattern. Verify against `apps/server/src/enrichment/applier.ts` or similar.)

    2. Add type:
    ```typescript
    export interface FailureClassification {
      class: FailureClass;
      reason: FailureReason;
    }
    ```

    3. Rewrite `classifyFailure` to return `FailureClassification`. Preserve every existing class branch verbatim; ADD the `reason` field per D-03. Add the new `AmbiguousMatchError` branch BEFORE the `NoMatchError` branch so `err.name` ordering is deterministic.

    4. Final body shape:
    ```typescript
    export function classifyFailure(err: unknown): FailureClassification {
      if (err instanceof NotFoundError) {
        if (err.url.includes('/isbn/')) {
          return { class: 'retryable-isbn-fallback', reason: 'no_match' };
        }
        return { class: 'permanent', reason: 'no_match' };
      }
      if (err instanceof UpstreamServerError) {
        return { class: 'retryable', reason: 'network' };
      }
      if (err instanceof Error) {
        if (err.name === 'AmbiguousMatchError') {
          return { class: 'permanent', reason: 'ambiguous_match' };
        }
        if (err.name === 'NoMatchError' || err.message === 'no-match') {
          return { class: 'permanent', reason: 'no_match' };
        }
        if (err.name === 'ZodError') {
          return { class: 'permanent', reason: 'parse_error' };
        }
        const code = getCode(err);
        if (
          code === 'EOPENBREAKER' ||
          code === 'SQLITE_BUSY' ||
          code === 'ECONNRESET' ||
          code === 'ETIMEDOUT' ||
          code === 'UND_ERR_CONNECT_TIMEOUT'
        ) {
          return { class: 'retryable', reason: 'network' };
        }
      }
      return { class: 'retryable', reason: 'parse_error' };
    }
    ```

    5. Do NOT modify `worker.ts` here — that's Plan 03's task. Once this task lands, `worker.ts` will fail to compile because it currently expects `classifyFailure` to return a string class. The Plan 03 wiring task takes care of the call sites.

    Note: the type checker will report failures in worker.ts and applier.ts call sites until Plan 03 lands. That's acceptable here — verify only that THIS file compiles in isolation and that the new test file (`phase-08-classify-failure.test.ts`) passes.
  </action>
  <verify>
    <automated>npm --workspace=server exec vitest run apps/server/src/enrichment/__tests__/phase-08-classify-failure.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "FailureClassification" apps/server/src/enrichment/retry.ts` returns >= 1.
    - `grep -c "ambiguous_match" apps/server/src/enrichment/retry.ts` returns >= 1.
    - `grep -c "FailureReason" apps/server/src/enrichment/retry.ts` returns >= 1.
    - `grep -c "retryable-isbn-fallback" apps/server/src/enrichment/retry.ts` returns >= 1 (Pitfall 7 preserved).
    - `phase-08-classify-failure.test.ts` runs GREEN: vitest output contains `passed` for the file and zero `failed`.
    - The string `// pure: no knex` (or equivalent purity comment from line 1) is preserved at the top of the file.
  </acceptance_criteria>
  <done>
    classifyFailure returns the new shape; all D-03 mappings test green; existing class branching preserved verbatim; module remains pure.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Add named errors + fuzzy path (NFKD, subtitle, Last,First, Dice >= 0.85) to matcher.ts</name>
  <read_first>
    - apps/server/src/enrichment/matcher.ts (existing matchWork lines 28-53 + tokenization lines 1-26; preserve strict path verbatim per D-06)
    - apps/server/src/enrichment/http/http-errors.ts:1-23 (named-error subclass pattern)
    - apps/server/src/enrichment/__tests__/phase-08-matcher-fuzzy.test.ts (RED tests landed in Plan 01)
    - apps/server/src/enrichment/__tests__/phase-08-matcher-ambiguous.test.ts (RED tests landed in Plan 01)
    - apps/server/src/enrichment/__tests__/phase-08-stuck-books.test.ts + fixtures/stuck-books.json
    - .planning/phases/08-failure-triage-smarter-matcher/08-CONTEXT.md (D-05, D-06, D-07, D-08, D-09)
    - .planning/phases/08-failure-triage-smarter-matcher/08-RESEARCH.md §"Code Examples" (Dice + normalize + swap), §"Common Pitfalls" 1, 2, 3
    - .planning/phases/08-failure-triage-smarter-matcher/08-PATTERNS.md §"matcher.ts"
  </read_first>
  <files>
    apps/server/src/enrichment/matcher.ts
  </files>
  <behavior>
    **Named errors (D-05):**
    - `AmbiguousMatchError extends Error` with constructor `(public readonly candidates: MatcherCandidate[])`, sets `.name = 'AmbiguousMatchError'`.
    - `NoMatchError extends Error` with constructor `()`, sets `.name = 'NoMatchError'`, message `'no-match after top-3 candidates'`.

    **Helper exports (D-07, D-08):**
    - `DICE_THRESHOLD = 0.85` (named const).
    - `diceCoefficient(a, b)` returns 0..1; returns `1` for exact match; returns `0` when either string has < 2 bigrams (Pitfall 3).
    - `normalizeTitleForFuzzy(s)` returns lowercased + diacritics-stripped + subtitle-stripped + trimmed.
    - `swapLastFirst(author)` returns `'First Last'` form when author contains a comma, else `null`.

    **matchWork upgrade (D-05, D-06):**
    - Strict path (existing token-overlap rule, lines 28-53) runs first AGAINST top-3 candidates.
      - If exactly 1 strict candidate passes -> return it.
      - If 2+ strict candidates pass -> throw `AmbiguousMatchError`.
      - If 0 strict candidates pass -> fall through to fuzzy path.
    - Fuzzy path (NEW, D-06):
      - Apply normalization to book.title and each candidate.title.
      - For each candidate: compute Dice on normalized titles. If >= DICE_THRESHOLD AND author exact-match (after normalization + Last,First swap fallback), candidate passes.
      - If exactly 1 fuzzy candidate passes -> return it.
      - If 2+ fuzzy candidates pass -> throw `AmbiguousMatchError`.
      - If 0 fuzzy candidates pass -> throw `NoMatchError`.
    - Strict path's existing return contract (`MatcherCandidate | null`) is REPLACED: matchWork now ALWAYS either returns a `MatcherCandidate` or throws (no more null return). Caller in worker.ts (handled in Plan 03) catches the named errors.
    - All regexes use `/u` flag (Pitfall 1: `\p{M}+/gu`).
    - Existing top-3 slicing + `normalizeTokens` helper preserved verbatim.
  </behavior>
  <action>
    Mirror `apps/server/src/enrichment/http/http-errors.ts:1-6` for the error subclass pattern. Append AmbiguousMatchError and NoMatchError to matcher.ts (keep them in matcher.ts NOT http-errors.ts — they are matcher-domain, per 08-PATTERNS.md).

    Append helper functions per RESEARCH §"Code Examples":

    ```typescript
    export const DICE_THRESHOLD = 0.85; // D-08

    function bigrams(s: string): Map<string, number> {
      const m = new Map<string, number>();
      for (let i = 0; i < s.length - 1; i++) {
        const bg = s.slice(i, i + 2);
        m.set(bg, (m.get(bg) ?? 0) + 1);
      }
      return m;
    }

    export function diceCoefficient(a: string, b: string): number {
      if (a === b) return 1;
      if (a.length < 2 || b.length < 2) return 0; // Pitfall 3
      const aBg = bigrams(a);
      const bBg = bigrams(b);
      let intersection = 0;
      for (const [bg, count] of aBg) {
        const other = bBg.get(bg);
        if (other) intersection += Math.min(count, other);
      }
      const total = (a.length - 1) + (b.length - 1);
      return (2 * intersection) / total;
    }

    function stripDiacritics(s: string): string {
      return s.normalize('NFKD').replace(/\p{M}+/gu, '');  // Pitfall 1: /u flag mandatory
    }

    function stripSubtitle(s: string): string {
      // D-07: split on first ':' or ' — ' (em-dash with surrounding spaces) or ' - '
      const m = s.match(/^(.*?)(?::| — | - )/);
      return (m ? m[1] : s).trim();
    }

    export function normalizeTitleForFuzzy(title: string): string {
      return stripDiacritics(stripSubtitle(title)).toLowerCase().trim();
    }

    export function swapLastFirst(author: string): string | null {
      if (!author.includes(',')) return null;
      const [last, first] = author.split(',', 2).map((s) => s.trim());
      if (!first || !last) return null;
      return `${first} ${last}`;
    }
    ```

    Update `matchWork` signature: still accepts `(book, candidates)` but its return type becomes `MatcherCandidate` (no `| null`). Body logic per D-06:

    ```typescript
    export function matchWork(book: { title: string; authors: string }, candidates: MatcherCandidate[]): MatcherCandidate {
      const top3 = candidates.slice(0, 3);

      // STRICT path (existing token-overlap rule preserved)
      const strictPasses = top3.filter((c) => existingTokenOverlapRule(book, c));
      if (strictPasses.length === 1) return strictPasses[0];
      if (strictPasses.length >= 2) throw new AmbiguousMatchError(strictPasses);

      // FUZZY path (D-06)
      const normBookTitle = normalizeTitleForFuzzy(book.title);
      const swappedAuthor = swapLastFirst(book.authors);
      const fuzzyPasses = top3.filter((c) => {
        const normCandTitle = normalizeTitleForFuzzy(c.title);
        const titleOk = diceCoefficient(normBookTitle, normCandTitle) >= DICE_THRESHOLD;
        if (!titleOk) return false;
        const authorOk =
          authorExactMatch(book.authors, c) ||
          (swappedAuthor !== null && authorExactMatch(swappedAuthor, c));
        return authorOk;
      });
      if (fuzzyPasses.length === 1) return fuzzyPasses[0];
      if (fuzzyPasses.length >= 2) throw new AmbiguousMatchError(fuzzyPasses);

      throw new NoMatchError();
    }
    ```

    Replace `existingTokenOverlapRule` and `authorExactMatch` with the actual current implementation from matcher.ts (extract into named helper functions if not already; preserve behavior verbatim per D-06 "preserves all currently-matching books").

    Do NOT change return types of `normalizeTokens` or other existing exports. Keep matcher.ts dependency-free (no imports from npm packages; per 08-RESEARCH.md "matcher.ts is currently dep-free; keep it that way").

    Update worker.ts call site to handle the new return type — wait, no: per `<files>` field this task does NOT touch worker.ts. The compile error there is expected and resolved in Plan 03. To avoid blocking Plan 02 verification, narrow this task's `tsc` scope to just matcher.ts and its tests (vitest config typically scopes per-test-file).
  </action>
  <verify>
    <automated>npm --workspace=server exec vitest run apps/server/src/enrichment/__tests__/phase-08-matcher-fuzzy.test.ts apps/server/src/enrichment/__tests__/phase-08-matcher-ambiguous.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "export class AmbiguousMatchError" apps/server/src/enrichment/matcher.ts` returns >= 1.
    - `grep -c "export class NoMatchError" apps/server/src/enrichment/matcher.ts` returns >= 1.
    - `grep -c "this.name = 'AmbiguousMatchError'" apps/server/src/enrichment/matcher.ts` returns >= 1.
    - `grep -c "this.name = 'NoMatchError'" apps/server/src/enrichment/matcher.ts` returns >= 1.
    - `grep -c "DICE_THRESHOLD = 0.85" apps/server/src/enrichment/matcher.ts` returns >= 1.
    - `grep -c "normalize('NFKD')" apps/server/src/enrichment/matcher.ts` returns >= 1.
    - `grep -c "/\\\\p{M}+/gu" apps/server/src/enrichment/matcher.ts` returns >= 1 (Pitfall 1: `/u` flag).
    - `grep -c "swapLastFirst\|normalizeTitleForFuzzy\|diceCoefficient" apps/server/src/enrichment/matcher.ts` returns >= 3.
    - `phase-08-matcher-fuzzy.test.ts` runs GREEN: vitest reports passed and zero failed.
    - `phase-08-matcher-ambiguous.test.ts` runs GREEN: vitest reports passed and zero failed.
    - matcher.ts has zero `import` lines from external npm packages (only relative imports allowed; preserves dep-free invariant).
  </acceptance_criteria>
  <done>
    matcher.ts exports the named errors + fuzzy helpers + DICE_THRESHOLD; matchWork applies strict-then-fuzzy per D-06; the two RED tests turn GREEN. Module remains dependency-free.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Add enqueueMany to service.ts; reimplement enqueue as wrapper (D-15, POLISH-01)</name>
  <read_first>
    - apps/server/src/enrichment/service.ts (existing enqueue lines 16-56, full file)
    - apps/server/src/enrichment/__tests__/phase-08-enqueue-many.test.ts (RED tests landed in Plan 01)
    - apps/server/src/enrichment/__tests__/phase-04-enqueue.test.ts (existing test pattern)
    - apps/server/src/knex.ts (knex instance shape)
    - .planning/phases/08-failure-triage-smarter-matcher/08-CONTEXT.md (D-15)
    - .planning/phases/08-failure-triage-smarter-matcher/08-RESEARCH.md §"Pattern 3" (batched insert + ON CONFLICT) + Open Question 3 (enqueued count semantics)
    - .planning/phases/08-failure-triage-smarter-matcher/08-PATTERNS.md §"service.ts"
  </read_first>
  <files>
    apps/server/src/enrichment/service.ts
  </files>
  <behavior>
    - `enqueueMany(bookMd5s: string[], options?: { force?: boolean }): Promise<{ enqueued: number; skipped: number }>` exported.
    - Validates each md5 with the existing `Md5Schema`; invalid entries are warn-and-dropped (preserves existing single-call swallow semantics).
    - Wraps the body in a single `db.transaction(async (trx) => ...)` so partial failures roll back.
    - Status-gate logic per existing `enqueue` (lines 31-40):
      - When `force` false AND book.enrichment_status not in {null, 'pending'} -> skip that md5.
      - When `force` true AND enrichment_status not 'pending' -> UPDATE book SET enrichment_status='pending' for that md5.
    - Performs a single batched `INSERT INTO enrichment_job (book_md5, status) VALUES ... ON CONFLICT DO NOTHING` via Knex `.insert(rows).onConflict().ignore()`.
    - `enqueued` count semantics (RESEARCH Open Q3): pre-compute open jobs for the input md5s (`SELECT COUNT(*) FROM enrichment_job WHERE book_md5 IN (?) AND status IN ('pending', 'running')`); `enqueued = inputCount - openCountBefore`, `skipped = openCountBefore`.
    - `enqueue(md5, options)` is reimplemented as `await enqueueMany([md5], options)` and discards the return.
    - `enrichmentService` export object includes both `enqueue` and `enqueueMany`.
    - Empty input array -> returns `{ enqueued: 0, skipped: 0 }` with no DB calls (early return).
  </behavior>
  <action>
    Per D-15 and 08-PATTERNS.md §"service.ts", refactor:

    1. Hoist the existing inner logic of `enqueue` into a new `enqueueMany`:

    ```typescript
    export type EnqueueManyResult = { enqueued: number; skipped: number };

    export async function enqueueMany(
      bookMd5s: string[],
      options: { force?: boolean } = {}
    ): Promise<EnqueueManyResult> {
      if (bookMd5s.length === 0) return { enqueued: 0, skipped: 0 };

      // Validate; warn-and-drop invalid (matches single-call swallow semantics).
      const valid: string[] = [];
      for (const md5 of bookMd5s) {
        const parsed = Md5Schema.safeParse(md5);
        if (!parsed.success) {
          console.warn('enrichment enqueueMany: invalid md5', { md5 });
          continue;
        }
        valid.push(md5);
      }
      if (valid.length === 0) return { enqueued: 0, skipped: 0 };

      try {
        return await db.transaction(async (trx) => {
          // Pre-count open jobs for { enqueued, skipped } semantic split (Open Q3).
          const openRows = await trx('enrichment_job')
            .whereIn('book_md5', valid)
            .whereIn('status', ['pending', 'running'])
            .select('book_md5');
          const openMd5s = new Set(openRows.map((r) => r.book_md5));
          const skipped = openMd5s.size;

          // Status-gate filter
          const books = await trx('book')
            .whereIn('md5', valid)
            .select('md5', 'enrichment_status');
          const eligible: string[] = [];
          for (const b of books) {
            const status = b.enrichment_status;
            if (!options.force && status !== null && status !== 'pending') continue;
            eligible.push(b.md5);
          }

          // Force-flip statuses to 'pending' as a single batched UPDATE
          if (options.force) {
            const toFlip = eligible.filter((md5) => {
              const b = books.find((x) => x.md5 === md5);
              return b && b.enrichment_status !== 'pending';
            });
            if (toFlip.length > 0) {
              await trx('book').whereIn('md5', toFlip).update({ enrichment_status: 'pending' });
            }
          }

          // Batched INSERT ... ON CONFLICT DO NOTHING
          const insertRows = eligible.map((md5) => ({ book_md5: md5, status: 'pending' as const }));
          if (insertRows.length > 0) {
            await trx('enrichment_job').insert(insertRows).onConflict().ignore();
          }

          const enqueued = valid.length - skipped;
          return { enqueued, skipped };
        });
      } catch (err) {
        console.warn('enrichment enqueueMany failed', { count: valid.length, err: String(err) });
        return { enqueued: 0, skipped: valid.length };
      }
    }
    ```

    2. Reimplement `enqueue`:

    ```typescript
    export async function enqueue(bookMd5: string, options: { force?: boolean } = {}): Promise<void> {
      await enqueueMany([bookMd5], options);
    }
    ```

    3. Update the named export object:

    ```typescript
    export const enrichmentService = { enqueue, enqueueMany };
    export { enqueue, enqueueMany };
    ```

    4. Match the existing `Md5Schema` import + style at top of file. Do not change `Md5Schema` itself.

    5. Verify the existing `phase-04-enqueue.test.ts` still passes (regression check; the `enqueue` wrapper must produce the same observable effects as before).

    6. Document the `enqueued` semantic in JSDoc above `enqueueMany`: "enqueued = input md5s that did not already have an open job at trx start; skipped = input md5s that did already have an open job. Reflects user-facing 'rows that newly became eligible to be picked up by the worker.' See RESEARCH Open Q3."
  </action>
  <verify>
    <automated>npm --workspace=server exec vitest run apps/server/src/enrichment/__tests__/phase-08-enqueue-many.test.ts apps/server/src/enrichment/__tests__/phase-04-enqueue.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "export async function enqueueMany" apps/server/src/enrichment/service.ts` returns 1.
    - `grep -c "await enqueueMany(\[bookMd5\]" apps/server/src/enrichment/service.ts` returns >= 1 (wrapper proof).
    - `grep -c "db.transaction" apps/server/src/enrichment/service.ts` returns >= 1 (single-tx requirement).
    - `grep -c ".onConflict().ignore()" apps/server/src/enrichment/service.ts` returns >= 1 (ON CONFLICT pattern preserved).
    - `grep -c "enqueueMany" apps/server/src/enrichment/service.ts` returns >= 4 (definition + wrapper + service object + export).
    - `phase-08-enqueue-many.test.ts` runs GREEN.
    - `phase-04-enqueue.test.ts` runs GREEN (no regression on the existing single-call contract).
  </acceptance_criteria>
  <done>
    enqueueMany lands as a transactional batch helper; enqueue is a thin wrapper; both old and new tests are GREEN; per-book enqueue loop callers are now unblocked to switch to enqueueMany (Plan 03 will).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| classifyFailure(err) | err comes from arbitrary upstream (HTTP, parse, DB); function MUST be total |
| matcher.ts | Pure function; no trust boundary inside; output (named errors) crosses to retry classification |
| enqueueMany | bookMd5s array trusted only after Md5Schema validation; force flag boolean-only |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-08-04 | Tampering | enqueueMany input md5 array | mitigate | Each entry validated via existing `Md5Schema` (regex `/^[a-f0-9]{32}$/i`); invalid entries warn-and-dropped, never reach DB. Closed enum on insert (`status: 'pending'`). |
| T-08-05 | DoS | enqueueMany on huge array | accept | D-12: no app-level cap. Bounded by worker drain rate via Phase 3 rate limiter. Single transaction is at most O(N) inserts on SQLite which handles thousands of rows in ms; users only ever invoke with the failed-set count (currently 8). |
| T-08-06 | Repudiation | classifyFailure mapping diverges | mitigate | D-03 mapping table is the single source of truth. Test `phase-08-classify-failure.test.ts` covers every row of D-03 verbatim and runs in CI. |
</threat_model>

<verification>
- `npm --workspace=server run build:migrations` succeeds.
- `cd apps/server && npx knex migrate:latest` adds `book.failure_reason` column.
- `npm --workspace=server exec vitest run apps/server/src/enrichment/__tests__/phase-08-classify-failure.test.ts apps/server/src/enrichment/__tests__/phase-08-matcher-fuzzy.test.ts apps/server/src/enrichment/__tests__/phase-08-matcher-ambiguous.test.ts apps/server/src/enrichment/__tests__/phase-08-enqueue-many.test.ts` reports all GREEN.
- The existing `phase-04-*` tests still pass (regression).
- Note: `phase-08-retry-all-route.test.ts` and `phase-08-stuck-books.test.ts` may still be RED — they depend on Plan 03 (route + worker wiring).
</verification>

<success_criteria>
- Migration applied; `book.failure_reason` column exists, nullable, CHECK constraint on enum.
- classifyFailure returns `{ class, reason }` per D-03 (test green).
- matcher.ts exports AmbiguousMatchError, NoMatchError, DICE_THRESHOLD=0.85, normalizeTitleForFuzzy, swapLastFirst, diceCoefficient.
- matchWork applies strict-then-fuzzy per D-06; throws AmbiguousMatchError on 2+ passes (test green).
- enqueueMany batches inserts + returns `{ enqueued, skipped }`; enqueue delegates to it (tests green; no regression).
- All 4 server-pure RED tests from Plan 01 turn GREEN.
- matcher.ts remains dependency-free (no npm imports added).
- POLISH-01 complete (helper exists). RETRY-03 complete (heuristics ship; ambiguity throws). RETRY-04 partial (column + classifyFailure shape ready; write happens in Plan 03).
</success_criteria>

<output>
After completion, create `.planning/phases/08-failure-triage-smarter-matcher/08-02-SUMMARY.md` documenting:
- Migration timestamp + file path.
- Final exports of matcher.ts and retry.ts (signatures).
- enqueueMany contract clarifications (especially the enqueued/skipped semantic per Open Q3).
- Any deviations from the planned RESEARCH code samples (e.g., changes needed because of better-sqlite3 + Knex 3.1 typing surprises).
- Status of Wave 0 RED tests: which turned GREEN here, which remain RED for Plan 03.
</output>

---
phase: 08-failure-triage-smarter-matcher
plan: 01
type: execute
wave: 0
depends_on: []
files_modified:
  - packages/common/types/enrichment.ts
  - packages/common/types/book.ts
  - apps/server/src/enrichment/__tests__/phase-08-classify-failure.test.ts
  - apps/server/src/enrichment/__tests__/phase-08-matcher-fuzzy.test.ts
  - apps/server/src/enrichment/__tests__/phase-08-matcher-ambiguous.test.ts
  - apps/server/src/enrichment/__tests__/phase-08-enqueue-many.test.ts
  - apps/server/src/enrichment/__tests__/phase-08-retry-all-route.test.ts
  - apps/server/src/enrichment/__tests__/phase-08-stuck-books.test.ts
  - apps/server/src/enrichment/__tests__/fixtures/stuck-books.json
  - apps/web/src/components/failure-reason-badge/failure-reason-badge.test.tsx
  - apps/web/src/pages/settings-page/retry-all-button.test.tsx
  - apps/web/src/components/re-enrich-button/re-enrich-button.test.tsx
autonomous: true
requirements: [POLISH-01, RETRY-01, RETRY-02, RETRY-03, RETRY-04]
tags: [enrichment, failure-triage, matcher, retry, testing, wave-0]

must_haves:
  truths:
    - "Wave 0 RED tests exist for every Phase 8 contract (D-03 mapping, D-05 ambiguous throw, D-07 normalization, D-08 Dice threshold, D-15 enqueueMany, CD-2 retry-all route, badge variants, list-key mutate)"
    - "FailureReason union type is exported from @koinsight/common and visible to both apps"
    - "DbBook in @koinsight/common gains failure_reason: FailureReason | null"
    - "stuck-books.json fixture documents the 8 currently-failed books with each failure cause inline"
  artifacts:
    - path: packages/common/types/enrichment.ts
      provides: "FailureReason union ('no_match' | 'ambiguous_match' | 'network' | 'parse_error') exported"
      contains: "export type FailureReason"
    - path: packages/common/types/book.ts
      provides: "DbBook.failure_reason field added"
      contains: "failure_reason"
    - path: apps/server/src/enrichment/__tests__/phase-08-classify-failure.test.ts
      provides: "RED tests for D-03 mapping table"
    - path: apps/server/src/enrichment/__tests__/phase-08-matcher-fuzzy.test.ts
      provides: "RED tests for D-07/D-08 NFKD + subtitle + Last,First + Dice >= 0.85"
    - path: apps/server/src/enrichment/__tests__/phase-08-matcher-ambiguous.test.ts
      provides: "RED tests for D-05 AmbiguousMatchError"
    - path: apps/server/src/enrichment/__tests__/phase-08-enqueue-many.test.ts
      provides: "RED tests for D-15 enqueueMany batch + ON CONFLICT + wrapper"
    - path: apps/server/src/enrichment/__tests__/phase-08-retry-all-route.test.ts
      provides: "RED tests for POST /api/enrichment/retry-all (CD-2)"
    - path: apps/server/src/enrichment/__tests__/phase-08-stuck-books.test.ts
      provides: "Regression suite over D-09 fixtures"
    - path: apps/server/src/enrichment/__tests__/fixtures/stuck-books.json
      provides: "Real-DB extraction of 8 stuck books with documented failure cause"
    - path: apps/web/src/components/failure-reason-badge/failure-reason-badge.test.tsx
      provides: "RED tests for 4 failure reasons + 'unknown' NULL fallback"
    - path: apps/web/src/pages/settings-page/retry-all-button.test.tsx
      provides: "RED tests for disabled state + click + toast wording"
    - path: apps/web/src/components/re-enrich-button/re-enrich-button.test.tsx
      provides: "RED tests for D-14 list-key mutate"
  key_links:
    - from: "apps/server/src/enrichment/__tests__/phase-08-*.test.ts"
      to: "@koinsight/common types"
      via: "import { FailureReason } from '@koinsight/common/types/enrichment'"
      pattern: "FailureReason"
---

<objective>
Land all Wave 0 RED tests + shared types + fixtures so subsequent waves implement against locked contracts.

Purpose: Per Nyquist validation, every implementation task in Waves 1-3 needs a corresponding RED test that proves the behavior. This plan also defines the `FailureReason` union once in `@koinsight/common` (CD-3) so server and web speak the same vocabulary verbatim per D-03.

Output:
- `FailureReason` union + `DbBook.failure_reason` field in `@koinsight/common`.
- 6 server test files (classify-failure, matcher-fuzzy, matcher-ambiguous, enqueue-many, retry-all-route, stuck-books).
- 1 fixture JSON (8 stuck books, real-DB extraction).
- 3 web test files (badge, retry-all button, re-enrich-button list-key mutate).

Tests SHOULD fail or skip-with-TODO at the end of this plan; they turn GREEN as Waves 1-3 implement against them.
</objective>

<execution_context>
@/Users/gbumanzordev/Dev/Personal/KoInsight/.claude/get-shit-done/workflows/execute-plan.md
@/Users/gbumanzordev/Dev/Personal/KoInsight/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/08-failure-triage-smarter-matcher/08-CONTEXT.md
@.planning/phases/08-failure-triage-smarter-matcher/08-RESEARCH.md
@.planning/phases/08-failure-triage-smarter-matcher/08-PATTERNS.md
@.planning/phases/08-failure-triage-smarter-matcher/08-UI-SPEC.md
@.planning/phases/08-failure-triage-smarter-matcher/08-VALIDATION.md
@packages/common/types/enrichment.ts
@packages/common/types/book.ts
@packages/common/types/index.ts
@apps/server/src/enrichment/__tests__/phase-04-retry.test.ts
@apps/server/src/enrichment/__tests__/phase-04-matcher.test.ts
@apps/server/src/enrichment/__tests__/phase-04-enqueue.test.ts
@apps/server/src/enrichment/__tests__/unmatched-router.test.ts
@apps/server/src/enrichment/__tests__/fixtures/search-ender.json
@apps/web/src/components/provenance-badge/provenance-badge.tsx
@apps/web/src/components/re-enrich-button/re-enrich-button.tsx
@apps/server/src/enrichment/matcher.ts
@apps/server/src/enrichment/retry.ts
@apps/server/src/enrichment/service.ts

<interfaces>
<!-- Locked vocabulary; tests assert these strings verbatim per D-03 / UI-SPEC. -->

FailureReason values (server emission, lowercase keys):
  'no_match' | 'ambiguous_match' | 'network' | 'parse_error'

UI display labels (web only; server never emits these):
  no_match -> 'No match'
  ambiguous_match -> 'Ambiguous'
  network -> 'Network'
  parse_error -> 'Parse error'
  null -> 'Unknown' (badge variant 'outline', color 'gray')

D-03 classifyFailure mapping table (input -> { class, reason }):
  NotFoundError (url has '/isbn/')                  -> { class: 'retryable-isbn-fallback', reason: 'no_match' }
  NotFoundError (other url)                         -> { class: 'permanent', reason: 'no_match' }
  Error.name === 'AmbiguousMatchError'              -> { class: 'permanent', reason: 'ambiguous_match' }
  Error.name === 'NoMatchError' OR msg='no-match'   -> { class: 'permanent', reason: 'no_match' }
  Error.name === 'ZodError'                         -> { class: 'permanent', reason: 'parse_error' }
  UpstreamServerError                               -> { class: 'retryable', reason: 'network' }
  Error.code in {ECONNRESET, ETIMEDOUT, UND_ERR_CONNECT_TIMEOUT, EOPENBREAKER, SQLITE_BUSY} -> { class: 'retryable', reason: 'network' }
  default                                           -> { class: 'retryable', reason: 'parse_error' }

D-08 Dice constant (locked): DICE_THRESHOLD = 0.85
D-07 Subtitle separators (locked): /^(.*?)(?::| — | - )/
D-07 Diacritic strip (locked): s.normalize('NFKD').replace(/\p{M}+/gu, '')

UI-SPEC locked copy strings (verbatim, ASCII):
  Retry-all button label:        'Retry all failed'
  Toast on success (n>0):        'Re-enqueued N books'  (where N = enqueued count)
  Toast on success (n===0):      'No failed books to retry'
  Toast on error:                'Could not start bulk retry' / 'Server error. Try again in a moment.'
  Badge tooltips per D-03 in UI-SPEC §"Failure Reason Vocabulary"
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Add FailureReason union + DbBook.failure_reason to @koinsight/common</name>
  <read_first>
    - packages/common/types/enrichment.ts (existing union pattern at line 2)
    - packages/common/types/book.ts (existing DbBook shape, lines 20-36)
    - packages/common/types/index.ts (barrel re-export at line 8)
    - .planning/phases/08-failure-triage-smarter-matcher/08-CONTEXT.md (CD-3, D-03 vocabulary)
    - .planning/phases/08-failure-triage-smarter-matcher/08-RESEARCH.md §"Code Examples" (FailureReason union shape)
  </read_first>
  <files>
    packages/common/types/enrichment.ts,
    packages/common/types/book.ts
  </files>
  <behavior>
    - `FailureReason` union exported with exactly four string literals: `'no_match' | 'ambiguous_match' | 'network' | 'parse_error'` (the `'unknown'` UI fallback is web-only display logic; NOT in this union per RESEARCH §"Code Examples").
    - `DbBook` interface gains optional `failure_reason: FailureReason | null` field.
    - Existing `EnrichmentStatus` and `EnrichmentJobStatus` unions are unchanged.
    - Barrel index re-export at packages/common/types/index.ts already exposes both modules; no edit needed there unless missing.
  </behavior>
  <action>
    Per CD-3 in 08-CONTEXT.md, add to packages/common/types/enrichment.ts:
    ```typescript
    export type FailureReason = 'no_match' | 'ambiguous_match' | 'network' | 'parse_error';
    ```
    Place this export AFTER the existing `EnrichmentJobStatus` union (line 2-3 area). Do NOT include `'unknown'` in this union (UI-only fallback for NULL rows).

    In packages/common/types/book.ts, extend the `DbBook` interface (lines ~20-36) by adding:
    ```typescript
    failure_reason: FailureReason | null;
    ```
    Add a top-of-file `import type { FailureReason } from './enrichment';` (or use `from './enrichment.js'` if existing imports use the `.js` extension — match the surrounding style verbatim).

    Verify packages/common/types/index.ts barrel exports `./enrichment` and `./book`. If not, add the re-export.

    Do NOT modify any server or web code in this task — types only.
  </action>
  <verify>
    <automated>npm --workspace=common run build || npm --workspace=@koinsight/common run build</automated>
  </verify>
  <acceptance_criteria>
    - `grep -E "^export type FailureReason = 'no_match' \| 'ambiguous_match' \| 'network' \| 'parse_error';$" packages/common/types/enrichment.ts` returns exactly one match.
    - `grep "failure_reason: FailureReason \| null" packages/common/types/book.ts` returns exactly one match.
    - `npx tsc --noEmit -p packages/common/tsconfig.json` exits 0.
    - The string `'unknown'` does NOT appear in `packages/common/types/enrichment.ts` (UI-only).
  </acceptance_criteria>
  <done>
    FailureReason union + DbBook.failure_reason exist in @koinsight/common, exported via barrel, both apps can import the type. No runtime code touched.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Author server RED tests + fixtures (classify-failure, matcher-fuzzy, matcher-ambiguous, enqueue-many, retry-all-route, stuck-books)</name>
  <read_first>
    - apps/server/src/enrichment/__tests__/phase-04-retry.test.ts (analog: classifyFailure tests, branch-by-branch assertion style)
    - apps/server/src/enrichment/__tests__/phase-04-matcher.test.ts (analog: matcher fixtures + describe blocks; line 1-47)
    - apps/server/src/enrichment/__tests__/phase-04-enqueue.test.ts (analog: enqueue test scaffolding lines 1-27)
    - apps/server/src/enrichment/__tests__/unmatched-router.test.ts (analog: supertest + express mount lines 1-15)
    - apps/server/src/enrichment/matcher.ts (existing matchWork at lines 28-53; preserves strict path)
    - apps/server/src/enrichment/retry.ts (existing classifyFailure lines 15-34)
    - apps/server/src/enrichment/service.ts (existing enqueue lines 16-56)
    - apps/server/src/enrichment/router.ts (existing Zod boundary lines 18-28)
    - apps/server/src/enrichment/http/http-errors.ts (NotFoundError, UpstreamServerError exports)
    - .planning/phases/08-failure-triage-smarter-matcher/08-CONTEXT.md (D-03, D-05, D-07, D-08, D-09, D-15)
    - .planning/phases/08-failure-triage-smarter-matcher/08-RESEARCH.md §"Code Examples" + §"Validation Architecture"
    - .planning/phases/08-failure-triage-smarter-matcher/08-PATTERNS.md §"phase-08-classify-failure.test.ts" through §"phase-08-retry-all-route.test.ts"
  </read_first>
  <files>
    apps/server/src/enrichment/__tests__/phase-08-classify-failure.test.ts,
    apps/server/src/enrichment/__tests__/phase-08-matcher-fuzzy.test.ts,
    apps/server/src/enrichment/__tests__/phase-08-matcher-ambiguous.test.ts,
    apps/server/src/enrichment/__tests__/phase-08-enqueue-many.test.ts,
    apps/server/src/enrichment/__tests__/phase-08-retry-all-route.test.ts,
    apps/server/src/enrichment/__tests__/phase-08-stuck-books.test.ts,
    apps/server/src/enrichment/__tests__/fixtures/stuck-books.json
  </files>
  <behavior>
    Each test file imports symbols that DO NOT YET EXIST. Tests are written as RED (failing or skip-with-TODO). They turn GREEN as Waves 1-3 land implementations. Specifically:

    **phase-08-classify-failure.test.ts** (D-03):
    - `NotFoundError` with `/isbn/...` URL -> `{ class: 'retryable-isbn-fallback', reason: 'no_match' }`
    - `NotFoundError` with `/works/...` URL -> `{ class: 'permanent', reason: 'no_match' }`
    - `Error` with `name='AmbiguousMatchError'` -> `{ class: 'permanent', reason: 'ambiguous_match' }`
    - `Error` with `name='NoMatchError'` -> `{ class: 'permanent', reason: 'no_match' }`
    - `Error` with `message='no-match'` (legacy path) -> `{ class: 'permanent', reason: 'no_match' }`
    - `ZodError` -> `{ class: 'permanent', reason: 'parse_error' }`
    - `UpstreamServerError` -> `{ class: 'retryable', reason: 'network' }`
    - it.each over `['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'EOPENBREAKER', 'SQLITE_BUSY']` -> `{ class: 'retryable', reason: 'network' }`
    - Plain `new Error('something weird')` (catch-all) -> `{ class: 'retryable', reason: 'parse_error' }`

    **phase-08-matcher-fuzzy.test.ts** (D-07, D-08):
    - Export-level helpers (after Wave 1 lands): `normalizeTitleForFuzzy`, `swapLastFirst`, `diceCoefficient`, `DICE_THRESHOLD`.
    - NFKD strip: `normalizeTitleForFuzzy('Resolução')` returns string equal to `'resolucao'` (lowercased, diacritics stripped).
    - Subtitle strip: `normalizeTitleForFuzzy('Sapiens: A Brief History')` returns `'sapiens'`. Same for `'Sapiens — A Brief History'` and `'Sapiens - A Brief History'`.
    - Last,First swap: `swapLastFirst('Tolkien, J. R. R.')` returns `'J. R. R. Tolkien'`. Returns `null` for `'J. R. R. Tolkien'` (no comma).
    - Dice exact: `diceCoefficient('foo', 'foo')` === 1.
    - Dice short-string fallback: `diceCoefficient('It', 'Itz')` === 0 (when either string has < 2 bigrams; per RESEARCH Pitfall 3).
    - Dice threshold: `diceCoefficient('the lord of the rings', 'lord of the rings')` >= 0.85; assert it crosses the threshold.
    - `DICE_THRESHOLD` exported and equals exactly 0.85.

    **phase-08-matcher-ambiguous.test.ts** (D-05):
    - Build a fake top-3 candidates array where 2+ pass the strict token+author rule -> `expect(() => matchWork(book, candidates)).toThrow(AmbiguousMatchError)`.
    - When exactly 1 candidate passes -> returns that candidate (no throw).
    - When 0 pass strict and 0 pass fuzzy -> `expect(() => matchWork(...)).toThrow(NoMatchError)`.
    - When 0 pass strict but exactly 1 passes fuzzy (Dice >= 0.85 + author exact-after-normalize) -> returns the fuzzy candidate.
    - When 0 pass strict but 2+ pass fuzzy -> throws AmbiguousMatchError.

    **phase-08-enqueue-many.test.ts** (POLISH-01 / D-15):
    - `enqueueMany([])` returns `{ enqueued: 0, skipped: 0 }`.
    - `enqueueMany([md5_a, md5_b])` for two books with status `null` -> creates 2 `enrichment_job` rows status=`pending`; returns `{ enqueued: 2, skipped: 0 }`.
    - Calling enqueueMany twice with same md5s and no force flag -> second call returns `{ enqueued: 0, skipped: N }` (ON CONFLICT skip via partial unique index on open states).
    - With `{ force: true }` against a book whose `enrichment_status='failed'` -> book row flips to `pending`, new job row created.
    - Invalid md5 (e.g., `'not-an-md5'`) -> warned and dropped, count NOT incremented in either bucket.
    - Wrapper test: `enqueue(md5)` calls under the hood return same effects as `enqueueMany([md5])`.

    **phase-08-retry-all-route.test.ts** (RETRY-01 / CD-2):
    - `POST /api/enrichment/retry-all` with empty body and 0 failed books -> 200 + `{ enqueued: 0, skipped: 0 }`.
    - With N=3 failed books -> 200 + `{ enqueued: 3, skipped: 0 }`; book rows flipped to `pending`; 3 new pending `enrichment_job` rows present.
    - `POST` with extra body keys e.g. `{ filter: 'foo' }` -> 400 with Zod error JSON (T-08-03 mitigation: `.strict()`).
    - `POST` with non-boolean `force` (e.g., `{ force: 'yes' }`) -> 400 (T-08-03).

    **phase-08-stuck-books.test.ts** (D-09):
    - Loads fixtures/stuck-books.json. For each fixture book, runs `matchWork(book, candidates)` and asserts either:
      (a) returns a candidate (now-fixed by smarter heuristics), OR
      (b) throws `AmbiguousMatchError` or `NoMatchError` with the documented expected outcome from the fixture's `expected_outcome` field.
    - The test expects 8 fixture entries (D-09 says "8+ books currently stuck").

    **fixtures/stuck-books.json** (D-09):
    - JSON shape: `{ "_doc": "<one-paragraph documentation>", "books": [ { "md5": "...", "title": "...", "authors": "...", "candidates": [...trimmed search docs...], "failure_cause_observed": "<human note>", "expected_outcome": "match" | "ambiguous" | "no_match" } ] }`.
    - 8 entries. If the dev DB is not currently accessible to the agent at execution time, scaffold 8 SYNTHETIC entries that exercise: (1) diacritic-only title difference, (2) subtitle-only difference, (3) Last,First author swap, (4) Dice fuzzy match, (5) ambiguous (2+ candidates equally valid), (6) genuine no_match (no candidate has overlapping author), (7) parse_error trigger (malformed candidate doc), (8) network proxy (placeholder; actual classification occurs upstream of matcher).
    - Inline `failure_cause_observed` docstring on each entry per D-09 ("document each one's failure cause in a fixtures file").
  </behavior>
  <action>
    Author all 6 test files + 1 fixture JSON using the analog files cited in `<read_first>`. Tests must use `import { ... } from '../...'` against APIs that DO NOT YET EXIST — this is intentional (RED tests). When TypeScript fails to compile because of missing exports, mark the failing imports with `// @ts-expect-error: implemented in Wave 1 (08-02)` so the test files themselves at least parse and `vitest run` reports them as failing assertions rather than compile errors. Alternatively, wrap the entire `describe` block in `describe.skip(...)` with a TODO comment citing the Wave it lands in. Either approach is acceptable per VALIDATION.md "Wave 0 RED tests must fail (or skip with TODO) before Wave 1 begins."

    For every test file, copy the imports + scaffolding scaffolding pattern from the cited analog (08-PATTERNS.md cites exact line ranges).

    **classify-failure**: Mirror `phase-04-retry.test.ts` lines 1-77; widen assertions to `.toEqual({ class: ..., reason: ... })`. Cover ALL nine D-03 input shapes plus the catch-all.

    **matcher-fuzzy**: Mirror `phase-04-matcher.test.ts` describe pattern. Use string inputs only (no fixture files needed for the helper tests).

    **matcher-ambiguous**: Build inline candidate arrays. Each candidate is a minimal `MatcherCandidate`-shaped object: `{ key, title, author_name: [...] }`.

    **enqueue-many**: Mirror `phase-04-enqueue.test.ts` lines 1-27 (factory + countJobs helper). Use `createBook` from `../../db/factories/book-factory`. Each `it` runs the full DB lifecycle (vitest config presumably resets DB between tests; verify by reading existing test to confirm — if not, scope cleanup inside the test).

    **retry-all-route**: Mirror `unmatched-router.test.ts` lines 1-15 (express mount + supertest). Use `enrichmentRouter` from `../router`. Path under test: `'/retry-all'`.

    **stuck-books**: Use `readFileSync(join(__dirname, 'fixtures', 'stuck-books.json'), 'utf8')` per D-09 fixture loader. Iterate `it.each(fixtures.books)` and dispatch on `expected_outcome`.

    **stuck-books.json fixture**: Build 8 SYNTHETIC entries (the planner cannot read the dev DB; the executor MAY refresh this from `${DATA_PATH}/dev.db` if accessible at execute time, see D-09; otherwise the 8 synthetic entries cover the case-class matrix described in `<behavior>` above). Use ASCII-only strings; no em dashes.

    Keep tests under 60s total (VALIDATION.md sampling target). Use `it.each` aggressively to compress D-03 mapping coverage.
  </action>
  <verify>
    <automated>npm --workspace=server exec vitest run apps/server/src/enrichment/__tests__/phase-08- 2>&1 | tail -30</automated>
  </verify>
  <acceptance_criteria>
    - `find apps/server/src/enrichment/__tests__ -name 'phase-08-*.test.ts' | wc -l` returns >= 6.
    - `test -f apps/server/src/enrichment/__tests__/fixtures/stuck-books.json` exits 0.
    - `node -e "const j = require('./apps/server/src/enrichment/__tests__/fixtures/stuck-books.json'); if (!Array.isArray(j.books) || j.books.length < 8) process.exit(1);"` exits 0.
    - `grep -c "ambiguous_match" apps/server/src/enrichment/__tests__/phase-08-classify-failure.test.ts` returns >= 1.
    - `grep -c "AmbiguousMatchError" apps/server/src/enrichment/__tests__/phase-08-matcher-ambiguous.test.ts` returns >= 1.
    - `grep -c "DICE_THRESHOLD" apps/server/src/enrichment/__tests__/phase-08-matcher-fuzzy.test.ts` returns >= 1.
    - `grep -c "Resolução\|Resolucao" apps/server/src/enrichment/__tests__/phase-08-matcher-fuzzy.test.ts` returns >= 1 (NFKD test).
    - `grep -c "enqueueMany" apps/server/src/enrichment/__tests__/phase-08-enqueue-many.test.ts` returns >= 1.
    - `grep -c "retry-all" apps/server/src/enrichment/__tests__/phase-08-retry-all-route.test.ts` returns >= 1.
    - `grep -c "z.object({}).strict\|.strict()" apps/server/src/enrichment/__tests__/phase-08-retry-all-route.test.ts` returns >= 1 (T-08-03 unknown-keys test).
    - Running vitest on these files yields RED status (failing or skip with TODO; NOT all green) — confirmed by inspecting vitest output for at least one `FAIL` or `skipped` line.
  </acceptance_criteria>
  <done>
    All six server RED test files plus fixture JSON exist, parse, and yield RED status when run via vitest. They reference future symbols (FailureReason, AmbiguousMatchError, NoMatchError, enqueueMany, etc.) per D-03/D-05/D-07/D-08/D-15 verbatim.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Author web RED tests (failure-reason-badge, retry-all-button, re-enrich-button list-key mutate)</name>
  <read_first>
    - apps/web/src/components/provenance-badge/provenance-badge.tsx (analog component shape; full file)
    - apps/web/src/components/re-enrich-button/re-enrich-button.tsx (existing, lines 1-51; D-14 list-key mutate to assert)
    - apps/web/src/api/enrichment.ts (existing tuple SWR key at line 49; UnmatchedBookRow type)
    - apps/web/vitest.config.ts (jsdom config — verify RTL setup exists; if no .test.tsx files in apps/web yet, scaffold setup per A1 in 08-RESEARCH.md)
    - .planning/phases/08-failure-triage-smarter-matcher/08-UI-SPEC.md §"Failure Reason Vocabulary", §"Copywriting Contract", §"Component Inventory"
    - .planning/phases/08-failure-triage-smarter-matcher/08-CONTEXT.md (D-10, D-13, D-14)
    - .planning/phases/08-failure-triage-smarter-matcher/08-RESEARCH.md §"FailureReasonBadge component" + Pitfall 4 (tuple SWR key)
  </read_first>
  <files>
    apps/web/src/components/failure-reason-badge/failure-reason-badge.test.tsx,
    apps/web/src/pages/settings-page/retry-all-button.test.tsx,
    apps/web/src/components/re-enrich-button/re-enrich-button.test.tsx
  </files>
  <behavior>
    **failure-reason-badge.test.tsx** (RETRY-04 UI, UI-SPEC vocab locked):
    - Renders `<FailureReasonBadge reason="no_match" />` -> badge contains text `'No match'`, has `role="status"`, `aria-label="Failure reason: No match"`.
    - `reason="ambiguous_match"` -> text `'Ambiguous'`.
    - `reason="network"` -> text `'Network'`.
    - `reason="parse_error"` -> text `'Parse error'`.
    - `reason={null}` -> text `'Unknown'`, badge variant attribute reflects `outline` (defensive fallback, no crash).
    - Tooltip body for each reason matches UI-SPEC §"Failure Reason Vocabulary" verbatim (assert via `findByText` over the tooltip label or `aria-describedby` lookup; Mantine v8 portals tooltip DOM, so use `userEvent.hover` + `findByText`).

    **retry-all-button.test.tsx** (RETRY-01, D-10/D-13):
    - When `useEnrichmentStatus().data.failed === 0` -> button renders disabled with label `'Retry all failed'` (count parens omitted when 0, OR label includes `(0)` per planner discretion at execute time; test asserts the button is disabled).
    - When failed > 0 -> button is enabled.
    - Clicking the enabled button -> POSTs to `/api/enrichment/retry-all` (mocked via msw or fetch mock), THEN calls `notifications.show` with title or message containing the literal string `'Re-enqueued'` followed by a number followed by `'books'` (per D-13). Assert the toast wording matches `Re-enqueued N books` regex `/Re-enqueued \d+ books/`.
    - When server returns `{ enqueued: 0, skipped: 0 }` -> toast wording matches `'No failed books to retry'` exactly (D-13).
    - When server returns 500 -> toast title `'Could not start bulk retry'`, color `'red'` (UI-SPEC §"Copywriting Contract").
    - Per D-10, button click does NOT open a modal; the action fires immediately. Assert NO `modals.openConfirmModal` is opened (no element with `role="dialog"` appears after click).

    **re-enrich-button.test.tsx** (RETRY-02, D-14):
    - Mock `swr.mutate` (or import the global `mutate`) and assert that after a successful re-enrich, BOTH happen:
      (a) `mutate('books/<id>')` is called (existing Phase 5 behavior, preserve).
      (b) A predicate-style `mutate((key) => Array.isArray(key) && key[0] === 'enrichment/unmatched', ...)` invocation occurs (D-14 hardening). Assert via spy on `mutate`.
    - Verify `mutate('enrichment/status')` is also called (badge counter refresh per RESEARCH §"SWR list-key invalidation").
  </behavior>
  <action>
    Mirror `apps/web/src/components/provenance-badge/provenance-badge.tsx` for the badge file structure (location, named export, props interface).

    Use `@testing-library/react` + `@testing-library/user-event` (already standard). Wrap each render in `MantineProvider` if existing web tests do (check by listing `apps/web/src/**/*.test.tsx`; if none exist, scaffold a minimal `test-utils.tsx` helper that wraps with `MantineProvider` + `Notifications` provider, mirroring `apps/web/src/app.tsx:58`).

    For SWR `mutate` spy: import `* as swr from 'swr'` and `vi.spyOn(swr, 'mutate')` per RTL idiom. For the predicate assertion, inspect the first call argument and assert `typeof firstCall[0] === 'function'` AND `firstCall[0](['enrichment/unmatched', 0, 20]) === true`.

    For fetch mocking, use `vi.spyOn(global, 'fetch')` and return `Promise.resolve(new Response(JSON.stringify({ enqueued: N, skipped: 0 }), { status: 200 }))`. The api client is `apps/web/src/api/enrichment.ts`; fetch goes through a helper — confirm by reading the file.

    Tests should be RED. Imports of `FailureReasonBadge` / `RetryAllButton` will fail until Wave 3. Wrap in `describe.skip` or `// @ts-expect-error` per Task 2's pattern.

    If apps/web has no existing test infrastructure (A1 in 08-RESEARCH.md), scaffold `apps/web/vitest.config.ts` with jsdom environment + a `test-setup.ts` that imports `@testing-library/jest-dom`. Add minimal devDependencies if missing (`@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`). DO NOT add new RUNTIME deps; test deps are fine and follow the same Prettier-only convention.
  </action>
  <verify>
    <automated>npm --workspace=web exec vitest run apps/web/src/components/failure-reason-badge apps/web/src/pages/settings-page/retry-all-button apps/web/src/components/re-enrich-button 2>&1 | tail -30</automated>
  </verify>
  <acceptance_criteria>
    - `test -f apps/web/src/components/failure-reason-badge/failure-reason-badge.test.tsx` exits 0.
    - `test -f apps/web/src/pages/settings-page/retry-all-button.test.tsx` exits 0.
    - `test -f apps/web/src/components/re-enrich-button/re-enrich-button.test.tsx` exits 0.
    - `grep -c "Ambiguous\|No match\|Network\|Parse error\|Unknown" apps/web/src/components/failure-reason-badge/failure-reason-badge.test.tsx` returns >= 5.
    - `grep -c "Re-enqueued" apps/web/src/pages/settings-page/retry-all-button.test.tsx` returns >= 1 (D-13 wording test).
    - `grep -c "No failed books to retry" apps/web/src/pages/settings-page/retry-all-button.test.tsx` returns >= 1.
    - `grep -c "openConfirmModal\|role=\"dialog\"" apps/web/src/pages/settings-page/retry-all-button.test.tsx` returns >= 1 (D-10 no-modal assertion).
    - `grep -c "enrichment/unmatched" apps/web/src/components/re-enrich-button/re-enrich-button.test.tsx` returns >= 1 (D-14 list-key predicate).
    - Running vitest on these files yields RED (failing or skipped with TODO), NOT all green.
  </acceptance_criteria>
  <done>
    Three web RED test files exist, parse, and yield RED status. They lock the UI-SPEC vocabulary verbatim plus the D-14 list-key predicate behavior. If web testing infrastructure was missing, it has been scaffolded.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client -> /api/enrichment/retry-all | Untrusted POST body crosses here (Phase 8 introduces this) |

## STRIDE Threat Register (Wave 0 — tests only)

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-08-01 | Spoofing/DoS | POST /retry-all | accept | Project has no auth at large; accepted for v1.1. Wave 0 documents the disposition; no mitigation in this plan. |
| T-08-02 | Injection (XSS) | failure_reason badge label | mitigate | RED tests in `failure-reason-badge.test.tsx` assert label strings come from a closed lookup table (server emits enum keys; no string concat into JSX). Locked in Wave 0. |
| T-08-03 | Tampering | POST body parsing | mitigate | RED tests in `phase-08-retry-all-route.test.ts` assert Zod `.strict()` rejects unknown keys and non-boolean `force`. Wave 1/2 implements the route to satisfy these tests. |
</threat_model>

<verification>
- `npm --workspace=server run build:migrations` succeeds (no migration in this plan but verify infra unaffected).
- `npx tsc --noEmit -p packages/common/tsconfig.json` exits 0 (types compile).
- `npm --workspace=server exec vitest run apps/server/src/enrichment/__tests__/phase-08-` shows AT LEAST ONE failing or skipped test (RED proof).
- `npm --workspace=web exec vitest run` similarly shows RED for the three new web test files.
</verification>

<success_criteria>
- `FailureReason` union shipped in `@koinsight/common`, importable from both apps.
- `DbBook.failure_reason` field added.
- 6 server RED test files + 1 fixture JSON exist and reference future Wave 1-2 symbols verbatim per D-03/D-05/D-07/D-08/D-15.
- 3 web RED test files exist and lock UI-SPEC vocabulary + D-14 predicate behavior.
- All RED tests fail or skip with TODO (NOT green) — proving they are real contracts, not vacuous.
- Threat model T-08-02 and T-08-03 are encoded as test assertions, not just prose.
</success_criteria>

<output>
After completion, create `.planning/phases/08-failure-triage-smarter-matcher/08-01-SUMMARY.md` documenting:
- Final list of test files + fixture created.
- Whether `stuck-books.json` used real-DB extraction (preferred per D-09) or synthetic entries.
- Whether web testing infrastructure was already present or scaffolded.
- Any tests skipped vs failing, and which Wave is expected to turn each one GREEN.
</output>

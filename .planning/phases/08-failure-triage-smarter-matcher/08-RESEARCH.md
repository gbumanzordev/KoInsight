# Phase 8: Failure Triage & Smarter Matcher - Research

**Researched:** 2026-04-27
**Domain:** Enrichment failure classification, OL matcher heuristics, batch enqueue, SWR-driven inbox
**Confidence:** HIGH (all critical claims verified against current repo files; no new external dependencies)

## Summary

Phase 8 is a triage + matcher polish phase layered on top of the v1.0 enrichment pipeline (Phases 3-5) and the v1.1 reference-pages writer (Phase 7). The work is overwhelmingly internal: one new column (`book.failure_reason TEXT NULL`), one new server route (`POST /api/enrichment/retry-all`), one refactor (`enqueue` -> `enqueueMany`), one matcher subsystem upgrade (NFKD + subtitle stripping + Last,First swap + Dice-bigram fuzzy), and three small UI deltas (badge, retry-all button, list-key `mutate`). No new npm dependencies on either side, web or server, are needed; Dice coefficient on bigrams is a 30-line pure function that fits in `matcher.ts`.

All locked decisions in CONTEXT.md are technically feasible and idiomatic for this codebase. The most subtle implementation traps are: (1) `\p{M}` regex needs the `u` flag (already standard practice in this repo's matcher.ts line 22), (2) the SWR list key shape is the tuple `['enrichment/unmatched', offset, limit]` not a string, so list-key `mutate` from `re-enrich-button.tsx` must use a key-matcher predicate or import the literal-prefix pattern, (3) `markTerminalFailure` currently takes `(knex, jobId, bookMd5, error)` and writes only `book.enrichment_status='failed'`, so the new `failure_reason` parameter slots in naturally, (4) `classifyFailure` is called from `worker.ts` `scheduleRetryOrFail` AND inferred from the `markTerminalFailure` call site with raw `error`, so the refactor must thread the new `{class, reason}` shape through both paths.

**Primary recommendation:** Implement in this order: (1) migration + `FailureReason` type in `@koinsight/common`, (2) refactor `classifyFailure` to return `{class, reason}` with full test coverage, (3) refactor `markTerminalFailure` to accept and write `failure_reason`, (4) implement `enqueueMany` and rewrite `enqueue` as a wrapper, (5) ship matcher heuristics with `AmbiguousMatchError` + `NoMatchError` as named exports from `matcher.ts`, (6) wire `POST /api/enrichment/retry-all`, (7) UI deltas. Steps 1-4 are pure refactors with no behavior change; steps 5-7 ship user-visible value.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**failure_reason Persistence (RETRY-04)**
- **D-01:** `failure_reason TEXT NULL` column lives on the `book` row (not `enrichment_job`).
- **D-02:** `classifyFailure(err)` is refactored to return `{ class: FailureClass, reason: FailureReason }`. Existing retryable/permanent branching for backoff is preserved unchanged; the new `reason` field is a parallel return.
- **D-03:** Mapping rules (must match UI-SPEC vocabulary verbatim):
  - `NotFoundError` (non-isbn) -> `no_match`
  - `NoMatchError` / `'no-match'` -> `no_match`
  - `AmbiguousMatchError` (2+ of top-3 pass) -> `ambiguous_match`
  - `ZodError` -> `parse_error`
  - `UpstreamServerError`, `ECONNRESET`, `ETIMEDOUT`, `UND_ERR_CONNECT_TIMEOUT`, `EOPENBREAKER` -> `network`
  - `SQLITE_BUSY` and any retryable that exhausts `ENRICHMENT_MAX_ATTEMPTS` -> `network`
  - Any unmatched error -> `parse_error`
- **D-04:** Legacy 8 failed rows left NULL after migration.

**Matcher (RETRY-03)**
- **D-05:** Matcher throws `AmbiguousMatchError` when 2+ of top-3 satisfy title+author rule.
- **D-06:** Layer fuzzy ON TOP of strict path. Strict runs first; on miss, fuzzy runs over same top-3.
- **D-07:** Normalization: NFKD + strip `\p{M}`, subtitle split on first `:` / `—` / ` - `, Last,First <-> First Last swap. Initial expansion OUT of scope.
- **D-08:** Dice on bigrams; threshold `>= 0.85`; named constant. Author exact match post-normalization.
- **D-09:** Real-DB fixtures from 8 stuck books + synthetic fixtures.

**Retry-All UX (RETRY-01)**
- **D-10:** No confirmation modal. (NOTE: contradicts UI-SPEC which still describes a modal; see Open Questions Q1.)
- **D-11:** Retries every book in `enrichment_status='failed'` (no filter).
- **D-12:** No application-level cap.
- **D-13:** Mantine `notifications.show` "Re-enqueued N books" / "No failed books to retry"; `mutate(unmatchedBooksKey)` immediately.

**Per-Row (RETRY-02)**
- **D-14:** Existing `ReEnrichButton variant="row"` hardened: post-action handler triggers `mutate()` on unmatched-books LIST key in addition to per-book status key.

**Bulk-Enqueue (POLISH-01)**
- **D-15:** `enqueueMany(bookMd5s, { force? })` next to `enqueue` in `service.ts`. Single batched `INSERT...ON CONFLICT DO NOTHING` in one transaction. Returns `{ enqueued, skipped }`. `enqueue` reimplemented as wrapper.

### Claude's Discretion
- **CD-1:** Schema migration shape (column type, position, naming). Follow Phase 7 pattern.
- **CD-2:** HTTP endpoint shape for retry-all (likely `POST /api/enrichment/retry-all`).
- **CD-3:** Where `FailureReason` is exported from (`@koinsight/common` if surfaced to client).
- **CD-4:** No additional index on `failure_reason` this phase.

### Deferred Ideas (OUT OF SCOPE)
- Per-failure-reason filter UI on inbox header.
- Initial expansion/contraction in matcher (J. R. R. <-> JRR).
- Server-side bulk progress tracking.
- Backfill `failure_reason` for 8 legacy rows.
- Index on `book.failure_reason`.
- LLM-assisted matcher fallback.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| POLISH-01 | Bulk-enqueue helper accepts list of book IDs, single call, replaces per-book loop | D-15 + service.ts existing `enqueue` skeleton; `INSERT...ON CONFLICT DO NOTHING` already used line 47 |
| RETRY-01 | Bulk retry of all `enrichment_status='failed'` from dashboard, single action | New POST `/api/enrichment/retry-all` route + `enqueueMany`; UI button in `unmatched-books-section.tsx` |
| RETRY-02 | Single-book retry from inbox, row reflects new status without page reload | `ReEnrichButton variant="row"` already exists; only needs list-key `mutate` (D-14) |
| RETRY-03 | OL matcher heuristics (NFKD, subtitle, Last/First, fuzzy title) so previously-failing books match | New normalization + Dice-bigram in `matcher.ts`; `AmbiguousMatchError` |
| RETRY-04 | Structured `failure_reason` persisted on book row; inbox UI shows reason | D-01..D-04; `failure_reason` column + `FailureReason` enum in `@koinsight/common`; `FailureReasonBadge` |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| `failure_reason` enum schema + write | Database / Storage | API / Backend | Column lives on `book`; written from `markTerminalFailure` |
| `classifyFailure` refactor (`{class, reason}`) | API / Backend | — | Pure function; no DB or HTTP |
| `AmbiguousMatchError` + matcher heuristics | API / Backend | — | Pure function in `matcher.ts`; no I/O |
| `enqueueMany` batch insert | API / Backend | Database / Storage | Knex transaction; SQLite ON CONFLICT |
| `POST /api/enrichment/retry-all` route | API / Backend | — | Express + Zod boundary, enqueueMany call |
| `FailureReasonBadge` (label + tooltip + color) | Browser / Client | — | Pure presentational component |
| `RetryAllButton` (header action) | Browser / Client | API / Backend | Button + `notifications.show` + POST |
| List-key `mutate` after retry | Browser / Client | — | SWR cache invalidation, no API change |
| `FailureReason` shared type | Shared (`@koinsight/common`) | — | Crosses server emission and client rendering |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Knex | (already installed, see `apps/server/package.json`) | Migrations + query builder | Existing data layer; matches Phase 7 pattern |
| better-sqlite3 | (already installed) | SQLite engine | SQLite 3.35+ already required (worker uses RETURNING) |
| Zod | (already installed) | Route boundary validation | CLAUDE.md mandates Zod at route boundaries |
| Mantine v8.3.12 | (already installed) | UI component library | Phase 5 lock; `Badge`, `Button`, `Tooltip` |
| `@mantine/notifications` | (already installed) | Toast feedback | Provider wired in `apps/web/src/app.tsx:58` |
| SWR | (already installed) | Web data fetching + cache | List polling at 5s already in place |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | (already installed) | Test runner | Matcher unit tests, retry classification tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled Dice coefficient | `string-similarity` v4.0.4, `dice-coefficient` v2.1.1, `fast-fuzzy` v1.12.0 | All three are tiny but adding a dep for ~30 lines of code is not worth it; current matcher is dependency-free pure function (line 1: "// D-17 token-overlap acceptance over OL search candidates. Pure: no imports.") and we keep it that way [VERIFIED: matcher.ts:1-3] |
| New column on `enrichment_job` | New column on `book` | D-01 chose `book` to mirror v1.0 provenance pattern; inbox query already returns book rows |

**Installation:** No new packages. Phase ships zero `npm install` additions on either workspace [VERIFIED: UI-SPEC line 262, service.ts/matcher.ts have no external deps].

## Architecture Patterns

### System Architecture Diagram

```
[KOReader sync / manual retry]
            |
            v
+-------------------------+      +-----------------------------+
|  enqueue(md5, force?)   |----->|  enqueueMany(md5[], opts)   |  D-15: thin wrapper
|  (service.ts)           |      |  - 1 transaction            |
+-------------------------+      |  - INSERT ... ON CONFLICT   |
                                 |  - status-gate updates      |
                                 |  - returns {enqueued, skipped}
                                 +-----------------------------+
                                                 ^
+-------------------------+                      |
|  POST /retry-all        |----------------------+
|  (router.ts)            |
|  - Zod (empty body OK)  |
|  - SELECT md5 WHERE     |
|    enrichment_status=   |
|    'failed'             |
+-------------------------+

[enrichment_worker tick]
            |
            v
+-------------------------+
| processJob(book)        |
+-------------------------+
            |
            v search.json -> matchWork(book, candidates)
+--------------------------------------+
| matcher.ts                           |
|  STRICT path (existing token rule)   |
|    if 1 candidate passes -> return   |
|    if 2+ candidates pass -> THROW    |  <-- D-05 AmbiguousMatchError
|      AmbiguousMatchError             |
|    if 0 pass -> fuzzy path           |
|  FUZZY path (NEW, D-06/D-07/D-08)    |
|    normalize(NFKD, subtitle, swap)   |
|    Dice bigram >= 0.85 + author exact|
|    if 1 -> return                    |
|    if 2+ -> AmbiguousMatchError      |
|    if 0 -> NoMatchError              |
+--------------------------------------+
            |
            v error
+-------------------------+
| scheduleRetryOrFail     |--+
+-------------------------+  |
            |                |
            v                v
+-------------------------+ classifyFailure(err)
| markTerminalFailure     |   -> { class, reason }   D-02
|  - UPDATE book          |   reason -> book.failure_reason
|    SET enrichment_status|
|    = 'failed',          |
|    failure_reason = ?   |  <-- D-01
+-------------------------+

[Web /settings inbox]
            |
            v useUnmatchedBooks (SWR, 5s poll)
+-------------------------+
| UnmatchedBooksSection   |--- header: <RetryAllButton>
|                         |--- per row: <FailureReasonBadge>
|                         |             <ReEnrichButton variant="row"> --+
+-------------------------+                                              |
            ^                                                            |
            +--- mutate(['enrichment/unmatched', offset, limit])  <------+ D-14
```

### Recommended Project Structure

```
apps/server/src/
  enrichment/
    matcher.ts                           # EXTEND: NFKD, subtitle, swap, Dice, AmbiguousMatchError, NoMatchError
    retry.ts                             # REFACTOR: classifyFailure -> {class, reason}
    service.ts                           # EXTEND: enqueueMany; rewrite enqueue as wrapper
    applier.ts                           # MODIFY: markTerminalFailure accepts FailureReason
    router.ts                            # ADD: POST /retry-all
    unmatched-repository.ts              # MODIFY: SELECT b.failure_reason in getUnmatchedBooks
    __tests__/
      phase-08-matcher-fuzzy.test.ts     # NEW: NFKD, subtitle, Last/First, Dice
      phase-08-matcher-ambiguous.test.ts # NEW: AmbiguousMatchError emission
      phase-08-classify-failure.test.ts  # NEW: full failure_reason mapping table
      phase-08-enqueue-many.test.ts      # NEW: batch insert + ON CONFLICT
      phase-08-retry-all-route.test.ts   # NEW: POST /retry-all integration
      fixtures/
        stuck-books.json                 # NEW: real-DB extraction of the 8 books
  db/migrations/
    20260428xxxxxx_add_failure_reason_to_book.ts  # NEW

apps/web/src/
  components/
    failure-reason-badge/
      failure-reason-badge.tsx           # NEW
  pages/settings-page/
    unmatched-books-section.tsx          # MODIFY: badge + retry-all + remove last_error red text
    retry-all-button.tsx                 # NEW
  components/re-enrich-button/
    re-enrich-button.tsx                 # MODIFY: also mutate list keys (D-14)
  api/
    enrichment.ts                        # EXTEND: postRetryAll(); add failure_reason to UnmatchedBookRow

packages/common/types/
  enrichment.ts                          # ADD: FailureReason union, export from index.ts
```

### Pattern 1: New named-error subclass in matcher.ts

**What:** Subclass `Error`, set `.name`, export alongside the matcher function. Mirrors `http-errors.ts:1-23` pattern.
**When to use:** Any error that needs a specific `classifyFailure` mapping (D-03).
**Example:**
```typescript
// matcher.ts (NEW exports)
// Source: apps/server/src/enrichment/http/http-errors.ts:1-6 pattern
export class AmbiguousMatchError extends Error {
  constructor(public readonly candidates: MatcherCandidate[]) {
    super(`ambiguous-match: ${candidates.length} candidates accepted`);
    this.name = 'AmbiguousMatchError';
  }
}
export class NoMatchError extends Error {
  constructor() {
    super('no-match after top-3 candidates');
    this.name = 'NoMatchError';
  }
}
```

Then `worker.ts` line 145-146 (currently builds an inline `Error` and sets `.name`) is simplified to `throw new NoMatchError();`.

### Pattern 2: Knex `alterTable` adding a TEXT NULL column with CHECK

**Source:** `apps/server/src/db/migrations/20260427120000_add_reference_pages_source_to_book.ts` [VERIFIED: file exists].
```typescript
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('book', (table) => {
    table.string('failure_reason').nullable().checkIn(['no_match', 'ambiguous_match', 'network', 'parse_error']);
  });
}
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('book', (table) => {
    table.dropColumn('failure_reason');
  });
}
```

Note: D-04 says legacy rows left NULL. The `checkIn` constraint allows NULL (it only constrains non-null values). No backfill task. The UI's `unknown` rendering (UI-SPEC) handles NULL.

### Pattern 3: Batched INSERT with ON CONFLICT DO NOTHING in one transaction

**Source:** `apps/server/src/enrichment/service.ts:45-48` [VERIFIED: existing single-row pattern], extended to array.

```typescript
// service.ts (NEW)
type EnqueueManyResult = { enqueued: number; skipped: number };

export async function enqueueMany(
  bookMd5s: string[],
  options: { force?: boolean } = {}
): Promise<EnqueueManyResult> {
  // 1) validate every md5 with the same Md5Schema; drop invalid (warn each).
  // 2) within a single trx:
  //    - SELECT md5, enrichment_status FROM book WHERE md5 IN (...)
  //    - filter to gate-eligible (D-07: status null or 'pending', or force=true)
  //    - if force, UPDATE book SET enrichment_status='pending' WHERE md5 IN (gated)
  //    - INSERT INTO enrichment_job (book_md5, status) VALUES ... ON CONFLICT DO NOTHING
  //      (Knex: .insert(rows).onConflict().ignore())
  //    - returnedCount = result of the insert (Knex .insert returns rowsAffected on better-sqlite3? Verify; if not, count via a SELECT before/after)
  // 3) skipped = bookMd5s.length - enqueued
}

// Re-implement single enqueue as a wrapper:
export async function enqueue(bookMd5: string, options: { force?: boolean } = {}): Promise<void> {
  await enqueueMany([bookMd5], options);
}
```

[VERIFIED: existing service.ts uses `.onConflict().ignore()` which Knex 3.1 lowers to bare ON CONFLICT DO NOTHING per service.ts:46-48 comment]

**Implementation trap:** better-sqlite3 returns `{ changes: N }` from raw INSERT; Knex's `.insert()` Promise resolution typing can be ambiguous on multi-row inserts. Safest "enqueued count" is to compute it by re-querying the inserted rows by `created_at >= trx_start` OR by a pre-count of how many of the input md5s lack an open job:

```sql
SELECT COUNT(*) FROM enrichment_job
 WHERE book_md5 IN (...) AND status IN ('pending', 'running')
```

Use `inputCount - openJobsBefore` as `enqueued`, `openJobsBefore` as `skipped`. This is also the most semantic-meaningful split (not "rows actually inserted by ON CONFLICT" which can include duplicates already at-rest).

### Pattern 4: SWR list-key mutate from a deeply-nested component

**Trap:** The unmatched list key is `['enrichment/unmatched', offset, limit]` (a tuple, not a string) [VERIFIED: enrichment.ts:49]. A `mutate('enrichment/unmatched')` call will NOT match.

**Solution (D-14):** Use SWR's predicate-style global mutate:
```typescript
// Source: SWR docs https://swr.vercel.app/docs/mutation#mutate-multiple-items
import { mutate } from 'swr';

await mutate(
  (key) => Array.isArray(key) && key[0] === 'enrichment/unmatched',
  undefined,
  { revalidate: true }
);
// Also revalidate counters (string key) so the badge in nav updates:
await mutate('enrichment/status');
```

This invalidates every paginated cache slice (page 1, page 2, ...) which is correct after a bulk retry that may shift many rows out of the failed bucket.

### Pattern 5: Zod validation for empty-body POST

**Source:** existing `router.ts:18-22` [VERIFIED] uses `z.object(...)`. For retry-all we expect no body (or an optional body for future per-reason filter).
```typescript
// router.ts (NEW)
const retryAllBodySchema = z.object({}).strict(); // forbid extra keys; future-proofs
router.post('/retry-all', async (req, res) => {
  const parsed = retryAllBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const failedRows = await db('book')
      .where({ enrichment_status: 'failed' })
      .select<{ md5: string }[]>('md5');
    const result = await enqueueMany(failedRows.map((r) => r.md5), { force: true });
    res.status(200).json(result);  // { enqueued, skipped }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to enqueue retries' });
  }
});
```

[CITED: existing `unmatchedQuerySchema` style at router.ts:18-22]. Use `force: true` because failed -> pending requires bypassing the status gate (service.ts:36).

### Anti-Patterns to Avoid

- **Calling `mutate('enrichment/unmatched')` with a string** — won't match the tuple cache key. Use a predicate.
- **Adding a new dependency for Dice coefficient** — 30 lines of pure code; matcher.ts is already dependency-free; keep it that way.
- **Backfilling `failure_reason` from `last_error` strings** — D-04 explicitly defers this; natural reclassification on retry is simpler.
- **Putting an index on `failure_reason`** — CD-4 explicitly defers; row count too low.
- **Throwing inside `classifyFailure`** — it must be total; default branch (D-03 last bullet) returns `{ class: 'retryable', reason: 'parse_error' }`.
- **Mutating `\p{M}` regex without `u` flag** — silently fails to strip. Always include `u`.
- **Using SQLite `OFFSET`-style chunking on the retry-all SELECT** — the worker drains serially; a single bulk SELECT returning all md5s is fine even at hundreds of rows.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Diacritics fold | Custom char table | `s.normalize('NFKD').replace(/\p{M}+/gu, '')` | Built into V8; one line; Unicode-correct |
| Subtitle split | Regex with all separators | First-occurrence index scan or split | Use `s.split(/:\s|—| - /)[0]` cautiously; prefer explicit scan over multi-character regex split with limit semantics |
| Last,First swap | Heuristic comma-counting | If `s.includes(',')` then split once and rejoin reversed | Direct, audit-able |
| Dice bigram | Library | Hand-rolled function (see Code Examples) | 30 LOC, zero deps; matcher.ts must stay dep-free |
| ON CONFLICT semantics | Manual SELECT-then-INSERT race | `.insert(rows).onConflict().ignore()` | Knex 3.1 lowers correctly; existing partial UNIQUE index on open states does the dedup |
| Toast provider | Custom | `notifications.show` from `@mantine/notifications` | Already wired in `app.tsx:58` |
| Confirmation modal | Custom | `modals.openConfirmModal` (NOT NEEDED if D-10 wins) | Mantine modals manager (per UI-SPEC), but D-10 says no modal — see Open Questions |

**Key insight:** Phase 8 is structurally a thin layer over already-existing primitives. The hardest part is correctness of mapping rules (D-03) and exhaustive matcher fixtures (D-09).

## Common Pitfalls

### Pitfall 1: `\p{M}` without `u` flag
**What goes wrong:** Regex silently treats `\p` as escaped `p`; combining marks survive normalization.
**Why it happens:** Easy to copy-paste a regex without the flag.
**How to avoid:** Always `/\p{M}+/gu`; add a unit test asserting `Resolução` -> `Resolucao`.
**Warning signs:** Diacritics survive in the test output even when normalize is called.

### Pitfall 2: NFKD ligatures
**What goes wrong:** `ﬁ` (U+FB01) decomposes to `fi` under NFKD (good for us), but `ß` (U+00DF) does NOT decompose — NFKD leaves it as `ß`. Some titles will keep `ß`.
**Why it happens:** NFKD is canonical+compatibility decomposition, but ß has no decomposition mapping in Unicode.
**How to avoid:** Document this. If a fixture from the 8 stuck books contains `ß`, add a manual `.replace(/ß/g, 'ss')` step. Otherwise leave alone.
**Warning signs:** German titles fail to match despite normalization.

### Pitfall 3: Dice on tiny strings
**What goes wrong:** A title like `"It"` has 1 bigram (`" I"` or `"It"` depending on padding) and produces unstable scores.
**Why it happens:** Bigram count too low; Dice variance explodes.
**How to avoid:** Fall back to exact normalized comparison when either string has < 2 bigrams. Add unit test for short titles.
**Warning signs:** Random false positives on 1-2 character titles.

### Pitfall 4: Tuple SWR keys
**What goes wrong:** `mutate('enrichment/unmatched')` from `re-enrich-button.tsx` does nothing because the actual cache key is `['enrichment/unmatched', 0, 20]` and SWR uses key serialization.
**Why it happens:** Pagination requires the offset/limit in the key.
**How to avoid:** Use predicate `mutate((key) => Array.isArray(key) && key[0] === 'enrichment/unmatched')` OR export a helper from `enrichment.ts` that does this.
**Warning signs:** Row stays in the list after retry until the 5s poll arrives.

### Pitfall 5: `classifyFailure` is reachable from two paths
**What goes wrong:** Refactoring `classifyFailure` to return `{class, reason}` may break `worker.ts:204` which destructures only `klass`.
**Why it happens:** Two callers of `classifyFailure`: `worker.ts` `scheduleRetryOrFail` (uses `.class`) and `markTerminalFailure` (will use both fields). Both paths must converge on the new shape.
**How to avoid:** Refactor in a single PR; update both call sites; make `markTerminalFailure` accept the `reason` as a parameter rather than re-classifying internally (single source of truth).
**Warning signs:** Type error at worker.ts:204 after refactor.

### Pitfall 6: ENRICHMENT_MAX_ATTEMPTS exhaustion path doesn't preserve original error
**What goes wrong:** When attempts >= MAX, `markTerminalFailure(knex, jobId, md5, err)` is called with the LAST `err` which may be a transient one (timeout). The mapping rule "any retryable that exhausts ENRICHMENT_MAX_ATTEMPTS -> network" (D-03) needs special handling because the err itself classifies as `network` already.
**Why it happens:** worker.ts:209-212 calls `markTerminalFailure` whether the class is permanent or exhausted-retryable.
**How to avoid:** In `scheduleRetryOrFail`, capture `{class, reason}` once via `classifyFailure(err)` and pass `reason` explicitly to `markTerminalFailure`. The "exhausted retryable" path is implicit: if `class === 'retryable'` and we still call `markTerminalFailure`, the `reason` from classifyFailure (already `network` for ECONNRESET etc.) is correct as-is.
**Warning signs:** A book that timed out 5 times shows `failure_reason='unknown'` in the badge.

### Pitfall 7: `retryable-isbn-fallback` class is not "retryable" or "permanent"
**What goes wrong:** D-02 says preserve existing class branching unchanged. But `classifyFailure` returns three classes: `retryable`, `permanent`, `retryable-isbn-fallback`. The mapping table in D-03 doesn't address `isbn-fallback`'s reason.
**Why it happens:** `NotFoundError` with `/isbn/` URL is a special retryable variant in v1.0.
**How to avoid:** When `class === 'retryable-isbn-fallback'`, return `reason: 'no_match'` (it's still a "no match" semantically — OL doesn't have that ISBN). This case never reaches `markTerminalFailure` directly because the worker re-attempts via the search path; if it eventually exhausts, the final error will be a different one (likely `NoMatchError` -> `no_match`). But classify it consistently anyway.
**Warning signs:** A book that exhausted ISBN fallback shows wrong badge.

### Pitfall 8: SQLite CHECK constraint on column add — adding new enum value is painful
**What goes wrong:** SQLite ALTER TABLE cannot drop or modify a CHECK constraint. If a future phase adds a new failure_reason value, we'd need a table rebuild.
**Why it happens:** SQLite limitation.
**How to avoid:** Either (a) accept the rebuild cost when adding values, OR (b) skip the CHECK and rely on TS-level enum validation only. The Phase 7 reference_pages_source pattern uses `checkIn`, so consistency suggests (a). Document in the migration that future enum additions require a rebuild.
**Warning signs:** Future phase blocked on schema migration complexity.

## Code Examples

### Dice coefficient on character bigrams (NEW, hand-rolled)

```typescript
// matcher.ts (NEW — pure, no deps)
const DICE_THRESHOLD = 0.85; // D-08

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
  if (a.length < 2 || b.length < 2) return 0;
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
```

[CITED: standard formulation per https://en.wikipedia.org/wiki/Sørensen-Dice_coefficient]. Threshold 0.85 captured as named constant per D-08.

### Title normalization for fuzzy path

```typescript
// matcher.ts (NEW)
function stripDiacritics(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}+/gu, '');
}

function stripSubtitle(s: string): string {
  // D-07: split on first ':' or '—' (em-dash) or ' - ' (spaced hyphen)
  const m = s.match(/^(.*?)(?::| — | - )/);
  return (m ? m[1] : s).trim();
}

export function normalizeTitleForFuzzy(title: string): string {
  return stripDiacritics(stripSubtitle(title)).toLowerCase().trim();
}
```

### Last,First <-> First Last swap

```typescript
// matcher.ts (NEW)
export function swapLastFirst(author: string): string | null {
  if (!author.includes(',')) return null;
  const [last, first] = author.split(',', 2).map((s) => s.trim());
  if (!first || !last) return null;
  return `${first} ${last}`;
}
```

In `matchWork`, when the original author rule fails, try the swapped form against `candidate.author_name`.

### Refactored classifyFailure

```typescript
// retry.ts (REFACTOR)
export type FailureClass = 'retryable' | 'permanent' | 'retryable-isbn-fallback';
export type FailureReason = 'no_match' | 'ambiguous_match' | 'network' | 'parse_error';
// (FailureReason exported from @koinsight/common per CD-3.)

export interface FailureClassification {
  class: FailureClass;
  reason: FailureReason;
}

export function classifyFailure(err: unknown): FailureClassification {
  if (err instanceof NotFoundError) {
    if (err.url.includes('/isbn/')) return { class: 'retryable-isbn-fallback', reason: 'no_match' };
    return { class: 'permanent', reason: 'no_match' };
  }
  if (err instanceof UpstreamServerError) return { class: 'retryable', reason: 'network' };
  if (err instanceof Error) {
    if (err.name === 'AmbiguousMatchError') return { class: 'permanent', reason: 'ambiguous_match' };
    if (err.name === 'NoMatchError' || err.message === 'no-match') return { class: 'permanent', reason: 'no_match' };
    if (err.name === 'ZodError') return { class: 'permanent', reason: 'parse_error' };
    const code = (err as Error & { code?: string }).code;
    if (code === 'EOPENBREAKER' || code === 'SQLITE_BUSY' ||
        code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
      return { class: 'retryable', reason: 'network' };
    }
  }
  return { class: 'retryable', reason: 'parse_error' };  // D-03 catch-all
}
```

### markTerminalFailure accepting reason

```typescript
// applier.ts (MODIFY)
export async function markTerminalFailure(
  knex: Knex, jobId: number, bookMd5: string, error: unknown, reason: FailureReason
): Promise<void> {
  // ... existing message truncate ...
  await knex.transaction(async (trx) => {
    await trx('enrichment_job').where({ id: jobId }).update({ status: 'failed', last_error, updated_at: trx.fn.now() });
    await trx('book').where({ md5: bookMd5 }).update({
      enrichment_status: 'failed',
      failure_reason: reason,  // D-01
    });
  });
}
```

Caller in `worker.ts:204-212` becomes:
```typescript
const { class: klass, reason } = classifyFailure(err);
if (klass === 'permanent' || job.attempts >= ENRICHMENT_MAX_ATTEMPTS) {
  await markTerminalFailure(knex, job.id, job.book_md5, err, reason);
  return;
}
```

The `worker.ts:144-148` no-match path becomes `markTerminalFailure(knex, job.id, job.book_md5, new NoMatchError(), 'no_match')`.

### FailureReasonBadge component

```tsx
// apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx (NEW)
import { Badge, Tooltip } from '@mantine/core';
import type { FailureReason } from '@koinsight/common/types/enrichment';

const MAP: Record<FailureReason | 'unknown', { label: string; color: string; variant: 'light' | 'outline'; tooltip: string }> = {
  no_match:        { label: 'No match',     color: 'gray',   variant: 'light',   tooltip: 'OpenLibrary has no candidate for this title and author. Edit metadata manually.' },
  ambiguous_match: { label: 'Ambiguous',    color: 'yellow', variant: 'light',   tooltip: 'Multiple OpenLibrary candidates matched. Open the book and pick the right one manually.' },
  network:         { label: 'Network',      color: 'blue',   variant: 'light',   tooltip: 'OpenLibrary was unreachable. Retrying usually fixes this.' },
  parse_error:     { label: 'Parse error',  color: 'orange', variant: 'light',   tooltip: 'OpenLibrary returned data we could not read. Retry; if it persists, this is a bug.' },
  unknown:         { label: 'Unknown',      color: 'gray',   variant: 'outline', tooltip: 'This failure was logged before structured reasons existed. Retry to refresh it.' },
};

export function FailureReasonBadge({ reason }: { reason: FailureReason | null }) {
  const cfg = MAP[reason ?? 'unknown'] ?? MAP.unknown;
  return (
    <Tooltip label={cfg.tooltip}>
      <Badge size="sm" color={cfg.color} variant={cfg.variant} role="status" aria-label={`Failure reason: ${cfg.label}`}>
        {cfg.label}
      </Badge>
    </Tooltip>
  );
}
```

### Web API client extension

```typescript
// apps/web/src/api/enrichment.ts (EXTEND)
export type FailureReason = 'no_match' | 'ambiguous_match' | 'network' | 'parse_error';

export type UnmatchedBookRow = {
  // ... existing fields
  failure_reason: FailureReason | null;  // NEW
};

export async function postRetryAll(): Promise<{ enqueued: number; skipped: number }> {
  return fetchFromAPI('enrichment/retry-all', 'POST', {});
}

// Helper for D-14 list-key invalidation:
export async function invalidateUnmatchedList() {
  await mutate((key) => Array.isArray(key) && key[0] === 'enrichment/unmatched', undefined, { revalidate: true });
  await mutate('enrichment/status');
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Free-text `last_error` red text on row | Structured `failure_reason` enum + colored badge | Phase 8 | Users can distinguish transient vs permanent; raw error text moves to tooltip |
| Per-book enqueue loop | `enqueueMany` batched insert | Phase 8 (POLISH-01) | Single transaction; future bulk callers reuse |
| Strict token-overlap matcher | Strict path + fuzzy fallback (Dice >= 0.85) | Phase 8 (RETRY-03) | More permissive but still high-precision |
| First-passing top-3 candidate | Reject with `AmbiguousMatchError` if 2+ pass | Phase 8 (RETRY-03/D-05) | Higher precision; surfaces ambiguity to user |

**Deprecated/outdated:** `last_error` red text block in `unmatched-books-section.tsx:83-87` is removed (UI-SPEC explicitly).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (server + web both) |
| Config file | `apps/server/vitest.config.ts`, `apps/web/vitest.config.ts` |
| Quick run command (server) | `npm --workspace=server exec vitest run apps/server/src/enrichment/__tests__/phase-08-*.test.ts` |
| Full suite command | `npm run test:coverage` (turbo: all workspaces) |
| Migration prerequisite | `npm --workspace=server run build:migrations` (already auto-run by `test` script) |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| RETRY-04 | `failure_reason` column accepts only enum values + NULL | unit (migration) | `vitest run phase-08-schema.test.ts` | Wave 0 |
| RETRY-04 | `classifyFailure` maps every D-03 input -> correct `{class, reason}` | unit | `vitest run phase-08-classify-failure.test.ts` | Wave 0 |
| RETRY-04 | `markTerminalFailure` writes `book.failure_reason` | integration | `vitest run phase-08-applier.test.ts` (or extend phase-04) | Wave 0 |
| RETRY-03 | NFKD strips combining marks (`Resolução` -> `Resolucao`) | unit | `vitest run phase-08-matcher-fuzzy.test.ts -t NFKD` | Wave 0 |
| RETRY-03 | Subtitle stripping splits on `:`, `—`, ` - ` | unit | `vitest run phase-08-matcher-fuzzy.test.ts -t subtitle` | Wave 0 |
| RETRY-03 | Last,First <-> First Last swap | unit | `vitest run phase-08-matcher-fuzzy.test.ts -t Last` | Wave 0 |
| RETRY-03 | Dice >= 0.85 accepts; < 0.85 rejects | unit | `vitest run phase-08-matcher-fuzzy.test.ts -t Dice` | Wave 0 |
| RETRY-03 | All 8 stuck-book fixtures match (or are explicitly classified) | integration | `vitest run phase-08-stuck-books.test.ts` | Wave 0 |
| RETRY-03 | 2+ top-3 passes -> `AmbiguousMatchError` | unit | `vitest run phase-08-matcher-ambiguous.test.ts` | Wave 0 |
| POLISH-01 | `enqueueMany` batch INSERT + ON CONFLICT skips duplicates | integration | `vitest run phase-08-enqueue-many.test.ts` | Wave 0 |
| POLISH-01 | `enqueue` single-call delegates to `enqueueMany` | unit | `vitest run phase-08-enqueue-many.test.ts -t wrapper` | Wave 0 |
| RETRY-01 | `POST /api/enrichment/retry-all` returns `{ enqueued, skipped }` | integration | `vitest run phase-08-retry-all-route.test.ts` | Wave 0 |
| RETRY-01 | retry-all on empty failed set returns `{ enqueued: 0, skipped: 0 }` | integration | `vitest run phase-08-retry-all-route.test.ts -t empty` | Wave 0 |
| RETRY-02 | `re-enrich-button` calls list-key mutate after success | unit (RTL) | `vitest run re-enrich-button.test.tsx` (web) | Wave 0 |
| RETRY-04 | Inbox row renders `<FailureReasonBadge>` for each failed row | unit (RTL) | `vitest run unmatched-books-section.test.tsx` | Wave 0 |
| RETRY-04 | Badge renders `Unknown` (gray outline) for NULL | unit (RTL) | `vitest run failure-reason-badge.test.tsx` | Wave 0 |

**Manual verification (cannot fully automate):**
- Visual confirmation that the 8 real-DB stuck books drop off the inbox after running retry-all in dev.
- Mantine Notifications toast wording matches D-13 exactly (snapshot via RTL).

### Sampling Rate

- **Per task commit:** `npm --workspace=server exec vitest run apps/server/src/enrichment/__tests__/phase-08-*.test.ts` (~5s)
- **Per wave merge:** `npm --workspace=server test && npm --workspace=web test`
- **Phase gate:** `npm run test:coverage` green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `apps/server/src/enrichment/__tests__/phase-08-classify-failure.test.ts` — covers RETRY-04 mapping table (D-03)
- [ ] `apps/server/src/enrichment/__tests__/phase-08-matcher-fuzzy.test.ts` — covers RETRY-03 NFKD/subtitle/swap/Dice
- [ ] `apps/server/src/enrichment/__tests__/phase-08-matcher-ambiguous.test.ts` — covers D-05
- [ ] `apps/server/src/enrichment/__tests__/phase-08-stuck-books.test.ts` — covers D-09 real-DB regression suite
- [ ] `apps/server/src/enrichment/__tests__/phase-08-enqueue-many.test.ts` — covers POLISH-01 / D-15
- [ ] `apps/server/src/enrichment/__tests__/phase-08-retry-all-route.test.ts` — covers RETRY-01 / CD-2
- [ ] `apps/server/src/enrichment/__tests__/fixtures/stuck-books.json` — extracted from dev.db; document each book's failure cause inline
- [ ] `apps/web/src/components/failure-reason-badge/failure-reason-badge.test.tsx` — covers all 5 badge variants + NULL fallback
- [ ] `apps/web/src/pages/settings-page/retry-all-button.test.tsx` — covers RetryAllButton disabled state + click + toast
- [ ] Web RTL setup may already exist; verify by checking for an existing `*.test.tsx` file under `apps/web`

## Open Questions (RESOLVED)

1. **D-10 (no modal) vs UI-SPEC (Mantine `modals.openConfirmModal`):** CONTEXT.md D-10 says "No confirmation modal. Action fires immediately." UI-SPEC §"Section-level Retry all failed" still describes `modals.openConfirmModal`.
   - RESOLVED: Treat CONTEXT.md as authoritative. Ship per D-10 (no modal). UI-SPEC modal sections are SUPERSEDED-BY-D-10; Plan 04 Task 2 acceptance criteria assert zero `modals.openConfirmModal` references in the implementation, and the UI-SPEC will be annotated in the same change.

2. **`AmbiguousMatchError` reason for `retryable-isbn-fallback`:** The ISBN fallback path doesn't end at `markTerminalFailure` (it triggers a retry through search), so the question is moot at runtime, but `classifyFailure` still has to produce a reason.
   - RESOLVED: Map to `'no_match'` (semantically: this exact ISBN has no record). Codified in Plan 02 Task 2 mapping table.

3. **`enqueued` count semantics in `enqueueMany`:** Better-sqlite3's `INSERT...ON CONFLICT DO NOTHING` returns `changes` = rows actually inserted. The user-facing toast should report "rows that became eligible to be picked up by the worker."
   - RESOLVED: Pre-count open jobs for the input md5s, derive `enqueued = inputCount - openCount`, `skipped = openCount`. Documented in Plan 02 Task 4 JSDoc.

4. **`force: true` on retry-all:** Failed books need `enrichment_status` flipped to `pending` before re-enqueueing.
   - RESOLVED: retry-all calls `enqueueMany(md5s, { force: true })`. The failed -> pending -> running flow per D-15 is wired in Plan 03 Task 2.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node >=22 | All | ✓ | per package.json engines | — |
| npm 10.2.4 | All | ✓ | per packageManager | — |
| better-sqlite3 (SQLite 3.35+) | enqueueMany, retry-all | ✓ | already in apps/server | — |
| `@mantine/notifications` | RetryAllButton, ReEnrichButton | ✓ | wired in app.tsx:58 | — |
| SWR | inbox revalidation | ✓ | already used | — |
| Knex 3.1+ | migration + enqueueMany | ✓ | per existing pattern | — |
| External services | — | n/a | — | retry-all does NOT call OpenLibrary directly; it only enqueues |

**No external dependency blockers.** Phase 8 is a closed-loop change with no new HTTP integration.

## Project Constraints (from CLAUDE.md)

| Directive | Source | How Phase 8 Honors |
|-----------|--------|---------------------|
| Node >=22, npm 10.2.4 | engines / packageManager | Use existing toolchain |
| Express 5 + Knex + SQLite | "Tech stack" | New route uses Express Router, migration uses Knex `alterTable` |
| Zod at route boundaries | "Conventions" | `POST /retry-all` body schema uses Zod even for empty body |
| Prettier-only formatting | "Conventions" | Run `npx prettier --write .` before commit |
| Migrations build via `tsconfig.migrations.json` | "Common commands" | `npm --workspace=server run build:migrations` before tests if migration is new |
| Plain ASCII; no em dashes | global CLAUDE.md | All strings, comments, commit messages ASCII |
| `git push` never with `-u` flag | global CLAUDE.md | n/a for executor; relevant if planner commits |
| `@koinsight/common` for types crossing apps | "Cross-cutting packages" | `FailureReason` exported here per CD-3 |
| KOReader plugin contract not regressed | "Constraints" | `book` table additions are additive; plugin sync continues to work |
| Ramda is idiomatic | "Conventions" | Optional; matcher.ts is currently dep-free, keep it that way |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Web app already has React Testing Library set up for `.test.tsx` files | Validation Architecture | Wave 0 may need to add RTL deps; verify by listing `apps/web/src/**/*.test.tsx` |
| A2 | `enrichment_job` partial UNIQUE index on open states is named `enrichment_job_book_md5_open_unique` and Knex's `.onConflict().ignore()` matches against any unique index | Pattern 3 | If no-arg `.onConflict()` requires a column target on multi-row insert in this Knex version, must specify `.onConflict('book_md5').ignore()` or use a raw INSERT |
| A3 | The 8 stuck books are extractable as a JSON fixture via a quick `sqlite3` query | D-09 / Wave 0 | If the 8 books contain copyrighted/PII data, fixture must be sanitized; titles/authors are public |
| A4 | UI-SPEC's confirm-modal section is stale relative to D-10 | Open Question 1 | Planner must reconcile; default to D-10 |

## Sources

### Primary (HIGH confidence)
- `apps/server/src/enrichment/matcher.ts` — current matcher implementation, line numbers verified
- `apps/server/src/enrichment/retry.ts` — current `classifyFailure`, lines 15-34
- `apps/server/src/enrichment/service.ts` — current `enqueue`, lines 16-56
- `apps/server/src/enrichment/applier.ts` — current `markTerminalFailure`, lines 135-153
- `apps/server/src/enrichment/router.ts` — current routes (Zod boundary pattern)
- `apps/server/src/enrichment/worker.ts` — `processJob` and `scheduleRetryOrFail` call sites
- `apps/server/src/enrichment/http/http-errors.ts` — Error subclass pattern (lines 1-23)
- `apps/server/src/enrichment/unmatched-repository.ts` — `getUnmatchedBooks` SELECT shape
- `apps/server/src/db/migrations/20260427120000_add_reference_pages_source_to_book.ts` — Phase 7 migration template
- `apps/server/src/enrichment/__tests__/phase-04-matcher.test.ts` — existing matcher test style
- `apps/server/src/enrichment/__tests__/phase-04-retry.test.ts` — existing classifyFailure test style
- `apps/web/src/api/enrichment.ts` — exact SWR key shape `['enrichment/unmatched', offset, limit]` (line 49)
- `apps/web/src/components/re-enrich-button/re-enrich-button.tsx` — current `mutate(\`books/${bookId}\`)` only; needs list-key
- `apps/web/src/app.tsx:15,58` — `Notifications` provider wired
- `apps/web/src/pages/settings-page/unmatched-books-section.tsx` — current row layout including the `last_error` red text to remove
- `packages/common/types/enrichment.ts` — existing `EnrichmentStatus` / `EnrichmentJobStatus` types
- `packages/common/types/book.ts` — existing `DbBook` shape to extend with `failure_reason`
- `.planning/config.json` — `nyquist_validation: true` confirmed; Validation Architecture section required

### Secondary (MEDIUM confidence)
- Mantine v8 docs (already locked from Phase 5 spec) — `Badge`, `Button`, `Tooltip`, `notifications.show` APIs
- SWR predicate-mutate pattern — https://swr.vercel.app/docs/mutation#mutate-multiple-items
- Sørensen-Dice coefficient formula — Wikipedia
- npm registry: `string-similarity@4.0.4`, `dice-coefficient@2.1.1`, `fast-fuzzy@1.12.0` exist (verified via `npm view`); not adopted because hand-roll is trivial

### Tertiary (LOW confidence)
- None — every load-bearing claim is verified against the repo or npm registry.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in repo
- Architecture: HIGH — every refactor anchors to a verified file:line
- Pitfalls: HIGH (1-7) / MEDIUM (8) — pitfall 8 (CHECK constraint future-proofing) is hypothetical
- Mapping rules: HIGH — locked verbatim by D-03

**Research date:** 2026-04-27
**Valid until:** 2026-05-27 (30 days; codebase is stable, no fast-moving deps introduced)

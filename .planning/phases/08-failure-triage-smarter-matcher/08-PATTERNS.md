# Phase 8: Failure Triage & Smarter Matcher - Pattern Map

**Mapped:** 2026-04-27
**Files analyzed:** 14 (10 server + 3 web + 1 common)
**Analogs found:** 14 / 14

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/server/src/db/migrations/2026042Bxxxxxx_add_failure_reason_to_book.ts` (NEW) | migration | schema (alterTable + checkIn) | `apps/server/src/db/migrations/20260427120000_add_reference_pages_source_to_book.ts` | exact |
| `apps/server/src/enrichment/matcher.ts` (EXTEND) | utility (pure) | transform | self (existing `matchWork`) + `apps/server/src/enrichment/http/http-errors.ts` for new error subclasses | exact |
| `apps/server/src/enrichment/retry.ts` (REFACTOR) | utility (pure) | transform/classification | self (existing `classifyFailure`) | exact (extending shape) |
| `apps/server/src/enrichment/service.ts` (EXTEND) | service | CRUD (write-batch) | self (existing single `enqueue`) | exact (generalize) |
| `apps/server/src/enrichment/applier.ts` (MODIFY `markTerminalFailure`) | service | CRUD (transactional write) | self (`markTerminalFailure` lines 135-153) | exact |
| `apps/server/src/enrichment/router.ts` (ADD `/retry-all`) | route (controller) | request-response | self (existing GETs) + `apps/server/src/enrichment/service.ts` for write semantics | exact |
| `apps/server/src/enrichment/unmatched-repository.ts` (MODIFY) | repository | read | self (existing `getUnmatchedBooks`) | exact |
| `apps/server/src/enrichment/worker.ts` (MODIFY caller) | service | event-driven | self (lines 144-148, 199-221) | exact |
| `apps/server/src/enrichment/__tests__/phase-08-*.test.ts` (NEW) | test | unit/integration | `apps/server/src/enrichment/__tests__/phase-04-retry.test.ts`, `phase-04-matcher.test.ts`, `phase-04-enqueue.test.ts`, `unmatched-router.test.ts` | exact |
| `apps/server/src/enrichment/__tests__/fixtures/stuck-books.json` (NEW) | fixture | static | existing JSON fixtures in `__tests__/fixtures/` | exact |
| `apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx` (NEW) | component | presentational | `apps/web/src/components/provenance-badge/provenance-badge.tsx` | exact |
| `apps/web/src/pages/settings-page/retry-all-button.tsx` (NEW) | component | request-response | `apps/web/src/components/re-enrich-button/re-enrich-button.tsx` | exact |
| `apps/web/src/components/re-enrich-button/re-enrich-button.tsx` (MODIFY) | component | request-response | self (existing) | exact (extend `mutate`) |
| `apps/web/src/pages/settings-page/unmatched-books-section.tsx` (MODIFY) | page | request-response | self (existing) | exact |
| `apps/web/src/api/enrichment.ts` (EXTEND) | api client | request-response | self + `apps/web/src/api/books.ts:43-45` for POST helper | exact |
| `packages/common/types/enrichment.ts` (EXTEND) | type module | shared types | self (existing `EnrichmentStatus` union) | exact |

---

## Pattern Assignments

### `apps/server/src/db/migrations/{ts}_add_failure_reason_to_book.ts` (migration, schema)

**Analog:** `apps/server/src/db/migrations/20260427120000_add_reference_pages_source_to_book.ts`

Naming convention: timestamp prefix `YYYYMMDDhhmmss_` followed by snake_case description. Filename should end `_add_failure_reason_to_book.ts`. Latest existing migration timestamp is `20260427120000`; pick a strictly greater value (e.g., `20260428000000`).

**Full pattern (lines 1-17):**
```typescript
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('book', (table) => {
    // D-01 / D-04 comment block describing NULL semantics + no-backfill rationale.
    table.string('reference_pages_source').nullable().checkIn(['openlibrary', 'manual']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('book', (table) => {
    table.dropColumn('reference_pages_source');
  });
}
```

**Apply for Phase 8:** swap the column to `failure_reason` and the enum to `['no_match', 'ambiguous_match', 'network', 'parse_error']`. Mirror the comment style explaining D-01 (column on `book`, not `enrichment_job`) and D-04 (legacy NULL kept, no backfill).

---

### `apps/server/src/enrichment/matcher.ts` (utility, transform — EXTEND)

**Analog:** self (existing `matchWork` at lines 28-53) + `apps/server/src/enrichment/http/http-errors.ts:1-23` for the new named-error subclass pattern.

**Existing pure-function header to preserve (matcher.ts lines 1-3):**
```typescript
// D-17 token-overlap acceptance over OL search candidates. Pure: no imports.
// Callers (Plan 04 applier, Plan 05 worker) pass an already-parsed OL
// `/search.json` docs array; we only touch the fields we need.
```

**Existing strict-path body to preserve (lines 28-53)** is the contract for the strict path; layer fuzzy ON TOP per D-06. Return signature stays `MatcherCandidate | null` for the strict success case, but throws are added for ambiguity and final no-match (per D-05/D-09 worker integration).

**Named-error subclass pattern (copy from `http-errors.ts:1-6`):**
```typescript
export class NotFoundError extends Error {
  constructor(public readonly url: string) {
    super(`Upstream 404: ${url}`);
    this.name = 'NotFoundError';
  }
}
```

**Apply for Phase 8:** add `AmbiguousMatchError` and `NoMatchError` exports in `matcher.ts` (NOT in `http-errors.ts`, because they are matcher-domain, not HTTP). Set `.name` so `classifyFailure` can branch on `err.name`.

**Token regex pattern (lines 19-26)** already uses the `/u` flag; reuse it for the `\p{M}` diacritic strip per RESEARCH Pitfall 1.

---

### `apps/server/src/enrichment/retry.ts` (utility, classification — REFACTOR)

**Analog:** self (existing `classifyFailure` at lines 15-34).

**Existing structure to preserve (lines 1-14, 36-43):** module header comment ("This module is pure: no knex, no fetch, no Date.now()"); `truncateError` and `computeNextAttemptAt` are unchanged.

**Existing branch shape (lines 15-34)** — preserve every branch verbatim, just widen the return:
```typescript
export type FailureClass = 'retryable' | 'permanent' | 'retryable-isbn-fallback';
type CodedError = Error & { code?: string };
function getCode(err: Error): string | undefined { return (err as CodedError).code; }

export function classifyFailure(err: unknown): FailureClass {
  if (err instanceof NotFoundError) {
    return err.url.includes('/isbn/') ? 'retryable-isbn-fallback' : 'permanent';
  }
  if (err instanceof UpstreamServerError) return 'retryable';
  if (err instanceof Error) {
    if (err.name === 'ZodError') return 'permanent';
    if (err.name === 'NoMatchError' || err.message === 'no-match') return 'permanent';
    const code = getCode(err);
    if (code === 'EOPENBREAKER') return 'retryable';
    if (code === 'SQLITE_BUSY') return 'retryable';
    if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'retryable';
  }
  return 'retryable';
}
```

**Apply for Phase 8:** widen return to `{ class: FailureClass; reason: FailureReason }`. Add `AmbiguousMatchError` branch (returns `{ class: 'permanent', reason: 'ambiguous_match' }`). Final fallback returns `{ class: 'retryable', reason: 'parse_error' }` (D-03 catch-all). `FailureReason` imported from `@koinsight/common` per CD-3.

---

### `apps/server/src/enrichment/service.ts` (service, CRUD batch — EXTEND)

**Analog:** self (existing `enqueue` at lines 16-56).

**Existing zod boundary (lines 12, 17-21):**
```typescript
const Md5Schema = z.string().regex(/^[a-f0-9]{32}$/i);
// ...
const parsed = Md5Schema.safeParse(bookMd5);
if (!parsed.success) {
  console.warn('enrichment enqueue: invalid md5', { bookMd5 });
  return;
}
```

**Existing status-gate + force pattern (lines 31-40):**
```typescript
const status = book.enrichment_status;
if (!options.force && status !== null && status !== 'pending') return;
if (options.force && status !== 'pending') {
  await db('book').where({ md5: bookMd5 }).update({ enrichment_status: 'pending' });
}
```

**Existing ON CONFLICT pattern (lines 42-48):**
```typescript
// SQLite 3.24+ supports ON CONFLICT DO NOTHING without a column target,
// which resolves against any UNIQUE index including the partial one.
// Knex 3.1's no-arg `.onConflict().ignore()` lowers to the same behavior.
await db('enrichment_job')
  .insert({ book_md5: bookMd5, status: 'pending' })
  .onConflict()
  .ignore();
```

**Existing error swallow + export shape (lines 49-62):**
```typescript
} catch (err) {
  console.warn('enrichment enqueue failed', { bookMd5, phase: 'enqueue', err: String(err) });
}
// ...
export const enrichmentService = { enqueue };
export { enqueue };
```

**Apply for Phase 8 (D-15):**
- Add `enqueueMany(bookMd5s: string[], options?: { force?: boolean }): Promise<{ enqueued: number; skipped: number }>` next to `enqueue`.
- Wrap the body in a `db.transaction((trx) => ...)`; replace `db(...)` with `trx(...)` in all four queries.
- Validate every md5 with the same `Md5Schema`; warn-and-drop invalid (preserve D-09 swallow semantics for batch).
- Pre-count gate-eligible md5s for the `enqueued`/`skipped` split per RESEARCH Open Question 3.
- Re-implement `enqueue(md5, opts)` as `await enqueueMany([md5], opts)` and ignore the return value.
- Update `enrichmentService` export to include `enqueueMany`.

---

### `apps/server/src/enrichment/applier.ts` (service, transactional write — MODIFY `markTerminalFailure`)

**Analog:** self (existing `markTerminalFailure` at lines 135-153).

**Existing signature + transaction pattern (lines 135-153):**
```typescript
export async function markTerminalFailure(
  knex: Knex,
  jobId: number,
  bookMd5: string,
  error: unknown
): Promise<void> {
  const rawMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
  const lastError = truncateError(rawMessage);

  await knex.transaction(async (trx) => {
    await trx('enrichment_job').where({ id: jobId }).update({
      status: 'failed',
      last_error: lastError,
      updated_at: trx.fn.now(),
    });
    await trx('book').where({ md5: bookMd5 }).update({ enrichment_status: 'failed' });
  });
}
```

**Apply for Phase 8 (D-01/D-02):** add a 5th parameter `reason: FailureReason` and include `failure_reason: reason` in the `book` update object. Caller `worker.ts` lines 147 and 206/210 must thread the value (one source of truth: `classifyFailure(err)` in `scheduleRetryOrFail`, then pass `reason` through; the no-match path at line 145-147 builds a `NoMatchError` and passes `'no_match'` directly).

---

### `apps/server/src/enrichment/router.ts` (route, request-response — ADD `/retry-all`)

**Analog:** self (existing `router.ts` lines 1-50). Existing routes are GETs; the POST shape comes from this same file's Zod-at-boundary idiom + `service.ts` for write semantics.

**Existing Zod boundary pattern (lines 18-28):**
```typescript
const unmatchedQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get('/unmatched', async (req: Request, res: Response) => {
  const parsed = unmatchedQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { offset, limit } = parsed.data;
  try {
    // ... business call ...
    res.status(200).json(/* ... */);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load unmatched books' });
  }
});
```

**Apply for Phase 8 (CD-2):**
- Add `POST /retry-all` (router is mounted at `/api/enrichment` per `app.ts`).
- Body schema: `z.object({}).strict()` (forbid extra keys; future-proof for per-reason filter).
- Inside try: `SELECT md5 FROM book WHERE enrichment_status = 'failed'`, then `await enqueueMany(md5s, { force: true })`, return 200 with `{ enqueued, skipped }`. Use `force: true` because failed -> pending requires bypassing the status gate (service.ts:36).
- Match existing 400/500 error JSON shape verbatim.

Mounted path note: `app.ts` mounts the router at `/api/enrichment`, so the route declared here is `'/retry-all'` -> exposed as `POST /api/enrichment/retry-all`.

---

### `apps/server/src/enrichment/unmatched-repository.ts` (repository, read — MODIFY)

**Analog:** self (existing `getUnmatchedBooks` at lines 69-109).

**Existing SELECT shape (lines 85-102):**
```typescript
const rows = (await db('book as b')
  .leftJoin(latestFailedJob, 'lj.book_md5', 'b.md5')
  .leftJoin('enrichment_job as ej', 'ej.id', 'lj.id')
  .where('b.enrichment_status', 'failed')
  .select(
    'b.id',
    'b.md5',
    'b.title',
    'b.authors',
    'ej.last_error',
    'ej.updated_at as job_updated_at'
  )
  .orderByRaw('ej.updated_at IS NULL')
  .orderBy('ej.updated_at', 'desc')
  .orderBy('b.title', 'asc')
  .offset(offset)
  .limit(limit)) as UnmatchedBookRow[];
```

**Apply for Phase 8:** add `'b.failure_reason'` to the `.select(...)` list and add `failure_reason: FailureReason | null` to `UnmatchedBookRow` type at lines 18-25.

---

### `apps/server/src/enrichment/worker.ts` (service, event-driven — MODIFY callers)

**Analog:** self (lines 144-148 no-match path, 199-221 scheduleRetryOrFail).

**Existing no-match path (lines 144-148):**
```typescript
if (!candidate) {
  const err = new Error('no-match after top-3 candidates');
  err.name = 'NoMatchError';
  await markTerminalFailure(knex, job.id, job.book_md5, err);
  return;
}
```

**Existing classify+fail path (lines 199-221):**
```typescript
const klass = classifyFailure(err);
if (klass === 'permanent') {
  await markTerminalFailure(knex, job.id, job.book_md5, err);
  return;
}
if (job.attempts >= ENRICHMENT_MAX_ATTEMPTS) {
  await markTerminalFailure(knex, job.id, job.book_md5, err);
  return;
}
```

**Apply for Phase 8:**
- Replace inline `Error` + `.name = 'NoMatchError'` with `throw new NoMatchError()` (now exported from `matcher.ts`); the catch in `claimAndProcess` routes it to `scheduleRetryOrFail` -> `classifyFailure` -> `markTerminalFailure(..., 'no_match')` so the manual mark call at line 147 can be removed entirely OR kept and updated to pass `'no_match'`. Prefer routing through the shared path.
- Destructure: `const { class: klass, reason } = classifyFailure(err);` then pass `reason` as the new 5th arg to all `markTerminalFailure` calls. Per RESEARCH Pitfall 5, both call sites must be updated in one PR.

---

### `apps/server/src/enrichment/__tests__/phase-08-classify-failure.test.ts` (test, unit — NEW)

**Analog:** `apps/server/src/enrichment/__tests__/phase-04-retry.test.ts`.

**Imports + test scaffolding (phase-04-retry.test.ts lines 1-12):**
```typescript
import { describe, expect, it } from 'vitest';
import { ZodError, z } from 'zod';
import { NotFoundError, UpstreamServerError } from '../http/http-errors';
import { classifyFailure, computeNextAttemptAt, truncateError } from '../retry';
import { ENRICHMENT_LAST_ERROR_MAX } from '../constants';

function codedError(code: string, message = 'coded'): Error {
  const err = new Error(message) as Error & { code?: string };
  err.code = code;
  return err;
}
```

**Per-branch assertion style (lines 14-77):**
```typescript
describe('classifyFailure (D-14)', () => {
  it('UpstreamServerError -> retryable', () => {
    expect(classifyFailure(new UpstreamServerError(...))).toBe('retryable');
  });
  it.each([['ECONNRESET'], ['ETIMEDOUT'], ['UND_ERR_CONNECT_TIMEOUT']])(
    'plain Error with .code=%s -> retryable',
    (code) => { expect(classifyFailure(codedError(code))).toBe('retryable'); }
  );
});
```

**Apply for Phase 8:** widen assertions to the new shape: `expect(classifyFailure(...)).toEqual({ class: 'permanent', reason: 'no_match' })`. Cover every D-03 row including the new `AmbiguousMatchError` branch and the `parse_error` catch-all.

---

### `apps/server/src/enrichment/__tests__/phase-08-matcher-fuzzy.test.ts`, `phase-08-matcher-ambiguous.test.ts` (test, unit — NEW)

**Analog:** `apps/server/src/enrichment/__tests__/phase-04-matcher.test.ts`.

**Fixture-load + describe pattern (lines 1-10, 11-47):**
```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchWork, normalizeTokens, type MatcherCandidate } from '../matcher';

const enderSearch = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'search-ender.json'), 'utf8')
) as { docs: MatcherCandidate[] };

describe('normalizeTokens (D-17)', () => {
  it('lowercases + strips ASCII punctuation + drops short tokens', () => {
    expect(normalizeTokens("Ender's Game")).toEqual(['ender', 'game']);
  });
  it('handles unicode letters via \\p{L}', () => {
    expect(normalizeTokens('Café Society')).toEqual(['café', 'society']);
  });
});
```

**Apply for Phase 8:**
- New tests cover NFKD strip (`Resolução` -> `Resolucao`), subtitle splitter (on `:`, `—`, ` - `), Last,First swap, Dice >= 0.85 threshold, short-string fallback (< 2 bigrams).
- Ambiguity test asserts `expect(() => matchWork(...)).toThrow(AmbiguousMatchError)` when 2+ of top-3 pass.
- Ender fixture continues as the strict-path positive control.

---

### `apps/server/src/enrichment/__tests__/phase-08-enqueue-many.test.ts` (test, integration — NEW)

**Analog:** `apps/server/src/enrichment/__tests__/phase-04-enqueue.test.ts`.

**Test setup pattern (lines 1-27):**
```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBook } from '../../db/factories/book-factory';
import { db } from '../../knex';
import { enrichmentService, enqueue } from '../service';

describe('enrichmentService.enqueue', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  async function countJobs(bookMd5: string, status?: string): Promise<number> {
    const q = db('enrichment_job').where({ book_md5: bookMd5 });
    if (status) q.andWhere({ status });
    const rows = await q.select('id');
    return rows.length;
  }
  // ...
});
```

**Apply for Phase 8:** test `enqueueMany` with mixed-status input, ON CONFLICT dedup (insert twice, expect 1 row), `{ force: true }` flips failed -> pending, return shape `{ enqueued, skipped }` matches semantics from RESEARCH Open Q3, and a `wrapper`-named test verifies `enqueue([md5])` delegates correctly.

---

### `apps/server/src/enrichment/__tests__/phase-08-retry-all-route.test.ts` (test, integration — NEW)

**Analog:** `apps/server/src/enrichment/__tests__/unmatched-router.test.ts`.

**Express + supertest mount pattern (lines 1-15):**
```typescript
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createBook } from '../../db/factories/book-factory';
import { db } from '../../knex';
import { enrichmentRouter } from '../router';

describe('GET /enrichment/unmatched', () => {
  const app = express();
  app.use(express.json());
  app.use('/enrichment', enrichmentRouter);
  // ...
});
```

**Apply for Phase 8:**
- Seed N failed books, POST `/enrichment/retry-all`, assert 200 + body `{ enqueued: N, skipped: 0 }`.
- Empty-set case: returns `{ enqueued: 0, skipped: 0 }`.
- Verify `book.enrichment_status` flipped to `'pending'` and N rows now exist in `enrichment_job` with status `'pending'`.

---

### `apps/server/src/enrichment/__tests__/fixtures/stuck-books.json` (fixture, static — NEW)

**Analog:** existing fixtures `apps/server/src/enrichment/__tests__/fixtures/search-ender.json` etc.

JSON file under `__tests__/fixtures/`. Inline a comment-style preamble in a sibling `.md` (or via JSON top-level `_doc` key the loader can ignore) documenting each of the 8 books' failure cause per D-09. Loaded via `readFileSync(join(__dirname, 'fixtures', 'stuck-books.json'), 'utf8')` mirroring matcher test loader.

---

### `apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx` (component, presentational — NEW)

**Analog:** `apps/web/src/components/provenance-badge/provenance-badge.tsx`.

**Full pattern (provenance-badge.tsx, complete file):**
```typescript
import { FieldSource } from '@koinsight/common/types';
import { Badge } from '@mantine/core';
import { JSX } from 'react';

import './provenance-badge.module.css';

// Phase 5 Plan 04 (UI-02, D-15): pure presentational badge surfacing the
// `*_source` provenance for an editable field. NULL / undefined source renders
// nothing (no "unset" placeholder per the locked UI spec).
export type ProvenanceBadgeProps = {
  source: FieldSource | null | undefined;
  fieldName?: string;
};

export function ProvenanceBadge({ source, fieldName }: ProvenanceBadgeProps): JSX.Element | null {
  if (source !== 'manual' && source !== 'openlibrary') return null;
  if (source === 'manual') {
    return (
      <Badge color="yellow" variant="light" size="sm" role="status"
        aria-label={`${fieldName ?? 'Field'} is manual`}>
        manual
      </Badge>
    );
  }
  return (
    <Badge color="blue" variant="light" size="sm" role="status"
      aria-label={`${fieldName ?? 'Field'} is OpenLibrary`}>
      OpenLibrary
    </Badge>
  );
}
```

**Apply for Phase 8:**
- Same directory layout (`failure-reason-badge/failure-reason-badge.tsx` + optional `.module.css`).
- Replace single-branch logic with a const lookup map keyed by `FailureReason | 'unknown'`; map values match UI-SPEC vocabulary verbatim (labels: `No match`, `Ambiguous`, `Network`, `Parse error`, `Unknown`).
- Wrap the `Badge` in Mantine `<Tooltip label={tooltip}>` (UI-SPEC requires tooltip body per row).
- `role="status"` + `aria-label={`Failure reason: ${label}`}`. Same `size="sm"` + `variant="light"` (except `unknown` -> `variant="outline"` + `color="gray"`). Defensive fallback: unrecognized values render as `unknown`.

---

### `apps/web/src/pages/settings-page/retry-all-button.tsx` (component, request-response — NEW)

**Analog:** `apps/web/src/components/re-enrich-button/re-enrich-button.tsx`.

**Imports + state + onClick pattern (re-enrich-button.tsx lines 1-51):**
```typescript
import { Button, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconRefresh } from '@tabler/icons-react';
import { JSX, useState } from 'react';
import { mutate } from 'swr';
import { reEnrichBook } from '../../api/books';

export function ReEnrichButton({ bookId, enrichmentStatus, variant }: ReEnrichButtonProps): JSX.Element {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const onClick = async () => {
    try {
      setIsSubmitting(true);
      await reEnrichBook(bookId);
      notifications.show({
        title: 'Re-enriching...',
        message: "We're checking OpenLibrary for fresh metadata.",
        color: 'blue',
        position: 'top-center',
      });
      await mutate(`books/${bookId}`);
    } catch (error) {
      notifications.show({
        title: 'Enrichment failed',
        message: 'OpenLibrary could not match this book. Edit metadata manually to fix it.',
        color: 'red',
        position: 'top-center',
      });
    } finally { setIsSubmitting(false); }
  };
  return (
    <Tooltip label="Already running" disabled={!isOpen}>
      <Button disabled={isOpen || isSubmitting} loading={isSubmitting}
        leftSection={<IconRefresh size={16} />}
        variant={variant === 'primary' ? 'filled' : 'default'} onClick={onClick}>
        Re-enrich
      </Button>
    </Tooltip>
  );
}
```

**Apply for Phase 8 (RETRY-01 / D-10 / D-13):**
- Per D-10 (more recent than UI-SPEC), NO confirmation modal — fire on click.
- Use `useEnrichmentStatus()` to read `failed` count for label `Retry all failed ({n})` and disabled state when `n === 0`.
- Wrap disabled state in Mantine `<Tooltip label="No failed books to retry">` (UI-SPEC accessibility section).
- On success toast: `Re-enqueued ${enqueued} books` (or `No failed books to retry` if `enqueued === 0`); on error: `Could not start bulk retry` / `Server error. Try again in a moment.` with `color: 'red'`.
- After success, invalidate list+status keys via the helper described under "Shared Patterns" -> SWR list-key invalidation.
- `variant="default"` (NOT accent — UI-SPEC reserves `koinsight` for the four locked CTAs).

---

### `apps/web/src/components/re-enrich-button/re-enrich-button.tsx` (component — MODIFY)

**Analog:** self (existing).

**Existing `mutate` call (line 39):**
```typescript
await mutate(`books/${bookId}`);
```

**Apply for Phase 8 (D-14):** in addition to the existing per-book mutate, invalidate the unmatched-list cache slices via the predicate-style `mutate` from "Shared Patterns" (the list key is the tuple `['enrichment/unmatched', offset, limit]`, so a string key match is a no-op — see RESEARCH Pitfall 4).

---

### `apps/web/src/pages/settings-page/unmatched-books-section.tsx` (page — MODIFY)

**Analog:** self (existing lines 71-108 row layout).

**Existing row layout (lines 73-106):**
```tsx
{data.rows.map((row) => (
  <Paper key={row.id} p="md" withBorder>
    <Group justify="space-between" align="flex-start" wrap="nowrap">
      <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
        <Text fw={600} truncate>{row.title}</Text>
        <Text size="sm" c="dimmed" truncate>{row.authors ?? 'Unknown author'}</Text>
        {row.last_error && (
          <Text size="xs" c="red" lineClamp={2}>{row.last_error}</Text>
        )}
      </Stack>
      <Group gap="sm" wrap="nowrap">
        <Button component={Link} to={getBookPath(row.id)} variant="default" size="sm">
          Edit metadata
        </Button>
        <ReEnrichButton bookId={row.id} enrichmentStatus="failed" variant="row" />
      </Group>
    </Group>
  </Paper>
))}
```

**Apply for Phase 8:**
- Remove the `row.last_error` red text block (lines 83-87) per UI-SPEC.
- Replace with `<FailureReasonBadge reason={row.failure_reason} />` inside a `<Group gap="xs">` that also renders the relative-time text.
- Header: wrap `<Title order={2}>Unmatched books</Title>` in `<Group justify="space-between">` and add `<RetryAllButton />` on the right.

---

### `apps/web/src/api/enrichment.ts` (api client — EXTEND)

**Analog:** self (existing) + `apps/web/src/api/books.ts:43-45` for the POST helper shape.

**Existing POST helper (books.ts lines 43-45):**
```typescript
export async function reEnrichBook(id: Book['id']) {
  return fetchFromAPI<{ job: EnrichmentJob | null }>(`books/${id}/re-enrich`, 'POST', {});
}
```

**Apply for Phase 8:**
- Add `failure_reason: FailureReason | null` to `UnmatchedBookRow` (lines 17-25), importing `FailureReason` from `@koinsight/common`.
- Add `postRetryAll(): Promise<{ enqueued: number; skipped: number }>` calling `fetchFromAPI('enrichment/retry-all', 'POST', {})`.
- Export a helper `invalidateUnmatchedList()` that runs both predicate-style list-key mutate + the string `'enrichment/status'` mutate (single source for D-14 and `RetryAllButton`).

---

### `packages/common/types/enrichment.ts` (shared type — EXTEND)

**Analog:** self (existing union-type style at line 2).

**Existing pattern (lines 1-7):**
```typescript
export type EnrichmentStatus = 'pending' | 'running' | 'enriched' | 'failed' | 'skipped';
export type EnrichmentJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';
```

**Apply for Phase 8 (CD-3):** add `export type FailureReason = 'no_match' | 'ambiguous_match' | 'network' | 'parse_error';` (the `'unknown'` UI fallback is web-only display logic, NOT in the server emission union). The existing barrel re-export at `packages/common/types/index.ts:8` already exposes this module to both apps. Also widen `DbBook` in `packages/common/types/book.ts:20-36` with `failure_reason: FailureReason | null`.

---

## Shared Patterns

### SWR list-key invalidation (predicate mutate)

**Source:** RESEARCH Pitfall 4 + `apps/web/src/api/enrichment.ts:49` confirms tuple key shape.
**Apply to:** `RetryAllButton` (post-success), `ReEnrichButton` (post-success per D-14).

```typescript
import { mutate } from 'swr';

export async function invalidateUnmatchedList() {
  await mutate(
    (key) => Array.isArray(key) && key[0] === 'enrichment/unmatched',
    undefined,
    { revalidate: true }
  );
  await mutate('enrichment/status');
}
```

A bare `mutate('enrichment/unmatched')` (string) does NOT match the tuple key `['enrichment/unmatched', offset, limit]`. The predicate form invalidates every paginated slice, which is correct after a bulk retry.

### Mantine `notifications.show`

**Source:** `apps/web/src/components/re-enrich-button/re-enrich-button.tsx:32-47` (and 16 other call sites verified).
**Apply to:** `RetryAllButton`, modified `ReEnrichButton`.

```typescript
notifications.show({
  title: 'Re-enriching...',
  message: "We're checking OpenLibrary for fresh metadata.",
  color: 'blue',           // 'red' for error
  position: 'top-center',
});
```

### Knex transactional write with `trx.fn.now()`

**Source:** `apps/server/src/enrichment/applier.ts:145-152`.
**Apply to:** `markTerminalFailure` modification, `enqueueMany` write path.

```typescript
await knex.transaction(async (trx) => {
  await trx('enrichment_job').where({ id: jobId }).update({ /* ... */, updated_at: trx.fn.now() });
  await trx('book').where({ md5: bookMd5 }).update({ /* ... */ });
});
```

### Zod-at-the-route-boundary

**Source:** `apps/server/src/enrichment/router.ts:18-28` + service.ts:12,17-21 for input validation.
**Apply to:** new `POST /retry-all`.

```typescript
const schema = z.object({}).strict();
const parsed = schema.safeParse(req.body);
if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
```

### Named-error subclass (matcher domain)

**Source:** `apps/server/src/enrichment/http/http-errors.ts:1-23`.
**Apply to:** new `AmbiguousMatchError` and `NoMatchError` exports inside `matcher.ts`.

```typescript
export class AmbiguousMatchError extends Error {
  constructor(public readonly candidates: MatcherCandidate[]) {
    super(`ambiguous-match: ${candidates.length} candidates accepted`);
    this.name = 'AmbiguousMatchError';
  }
}
```

`classifyFailure` then branches on `err.name` (lines 23-24 of retry.ts already use this idiom for `ZodError`/`NoMatchError`).

---

## No Analog Found

None. Every Phase 8 file maps to an existing template or to itself plus a small extension.

---

## Metadata

**Analog search scope:** `apps/server/src/enrichment/`, `apps/server/src/db/migrations/`, `apps/server/src/enrichment/__tests__/`, `apps/web/src/components/`, `apps/web/src/pages/settings-page/`, `apps/web/src/api/`, `packages/common/types/`.
**Files scanned:** 25 (read-only).
**Pattern extraction date:** 2026-04-27.

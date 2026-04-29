---
phase: 09-orphan-author-gc
plan: 01
subsystem: server/admin
tags: [orphan-gc, author, knex, vitest, factory]
requires: []
provides:
  - deleteOrphanAuthors (server/admin)
  - OrphanAuthorGcResult (type)
  - fakeAuthor / createAuthor (server/db/factories)
affects:
  - apps/server/src/admin/orphan-author-gc.ts
  - apps/server/src/admin/orphan-author-gc.test.ts
  - apps/server/src/db/factories/author-factory.ts
tech-stack:
  added: []
  patterns:
    - Knex builder-only predicate (whereNotIn over distinct subquery), no db.raw
    - Single db.transaction wraps select+delete; dry-run path skips transaction
    - Sample cap at 20 rows captured before deletion
key-files:
  created:
    - apps/server/src/admin/orphan-author-gc.ts
    - apps/server/src/admin/orphan-author-gc.test.ts
    - apps/server/src/db/factories/author-factory.ts
  modified: []
decisions:
  - D-04 signature locked: deleteOrphanAuthors(db, opts) -> OrphanAuthorGcResult
  - D-05 transaction semantics: delete path uses single db.transaction, dry-run does not
  - D-06 predicate: id NOT IN (SELECT DISTINCT author_id FROM book_author), builder only
  - D-06 sample: first 20 rows by query order, [] when deleted=0
metrics:
  duration_minutes: 4
  completed: 2026-04-28
  tasks: 3
  files_created: 3
requirements: [AUTHGC-01, AUTHGC-02, AUTHGC-03]
---

# Phase 09 Plan 01: Orphan Author GC Core Summary

Shipped the shared `deleteOrphanAuthors` core function plus its 8-case vitest suite and the missing `author-factory`, locking the contract Plans 02 (HTTP) and 03 (CLI) will consume.

## Signatures shipped

```typescript
// apps/server/src/admin/orphan-author-gc.ts
export type OrphanAuthorGcResult = {
  deleted: number;
  sample: Array<{ id: number; name: string }>;
};

export async function deleteOrphanAuthors(
  db: Knex,
  opts: { dryRun: boolean }
): Promise<OrphanAuthorGcResult>;
```

```typescript
// apps/server/src/db/factories/author-factory.ts
export type AuthorRow = { ...full author column shape... };
export function fakeAuthor(overrides?: Partial<FakeAuthor>): FakeAuthor;
export async function createAuthor(db: Knex, overrides?: Partial<FakeAuthor>): Promise<AuthorRow>;
```

## Test coverage (8/8 passing)

`npm --workspace=server exec vitest run src/admin/orphan-author-gc.test.ts` reports 8 passing tests:

1. deletes only orphan authors and leaves referenced authors untouched
2. dry-run reports the count without mutating
3. returns deleted: 0 with empty sample on a DB with no orphans
4. is idempotent: second consecutive call deletes 0
5. caps sample at 20 when there are more than 20 orphans
6. authors referenced by any book_author row are never deleted
7. delete path opens a single transaction (`vi.spyOn(db, 'transaction')`)
8. dry-run path does NOT open a transaction

## Commits

- 55ead2b feat(09-01): add author-factory for test seeding
- 58f1ca1 feat(09-01): implement deleteOrphanAuthors core function
- 77d3891 test(09-01): cover deleteOrphanAuthors core behavior

## Verification

- `npm --workspace=server exec vitest run src/admin/orphan-author-gc.test.ts`: 8/8 green.
- `npm --workspace=server test`: 584/586 passing, 1 skipped, 2 pre-existing failures unrelated to Phase 9 (logged in `deferred-items.md`).
- TypeScript on the new files is clean; pre-existing tsc errors in unrelated files are out of scope and logged.

## Deviations from Plan

None. D-04 signature, D-05 transaction semantics, and D-06 predicate + sample cap are implemented exactly as specified.

## Deferred Issues

See `deferred-items.md` in this phase directory:
- Pre-existing failure in `phase-06-schema.test.ts` (migration up/down/up idempotency).
- Pre-existing failure in `phase-07-router.test.ts` (PUT reference_pages source flip).
- Pre-existing tsc errors in `book-factory.ts`, `backfill-reference-pages.ts`, several `phase-08-*` test files, and `reports-router.test.ts`.

None of these are in files this plan touched, and they pre-date this branch.

## Self-Check: PASSED

Verified files exist:
- apps/server/src/admin/orphan-author-gc.ts: FOUND
- apps/server/src/admin/orphan-author-gc.test.ts: FOUND
- apps/server/src/db/factories/author-factory.ts: FOUND

Verified commits exist on `gsd/phase-09-orphan-author-gc`:
- 55ead2b: FOUND
- 58f1ca1: FOUND
- 77d3891: FOUND

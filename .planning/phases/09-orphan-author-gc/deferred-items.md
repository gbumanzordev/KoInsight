# Deferred items discovered during Phase 9 execution

## Pre-existing test failures (not introduced by Phase 9)

Verified by running on master state (no Phase 9 files staged):

1. `apps/server/src/db/migrations/__tests__/phase-06-schema.test.ts` -- "migrate up -> down -> up is idempotent for the Phase 6 index migration" fails in isolation. Pre-dates this branch.
2. `apps/server/src/books/__tests__/phase-07-router.test.ts` -- "PUT /books/:bookId/reference_pages > different value flips source from openlibrary -> manual" fails. Pre-dates this branch.

Plan 09-01 added 8 new passing tests under `apps/server/src/admin/orphan-author-gc.test.ts`; the rest of the suite (584 tests) passes. These two pre-existing failures are out of scope for Phase 9.

## Pre-existing TypeScript errors (full server tsc --noEmit)

Pre-existing typecheck errors surface in `apps/server/src/enrichment/backfill-reference-pages.ts`, several `phase-08-*.test.ts` files (unused @ts-expect-error directives), `apps/server/src/db/factories/book-factory.ts`, and `apps/server/src/reports/__tests__/reports-router.test.ts`. None are in files modified by Phase 9 plans.

---
phase: 09-orphan-author-gc
plan: 02
subsystem: server/admin
tags: [http, admin, zod, supertest, orphan-author-gc]
requires:
  - apps/server/src/admin/orphan-author-gc.ts (Plan 01: deleteOrphanAuthors)
  - apps/server/src/knex.ts (shared db instance)
provides:
  - apps/server/src/admin/admin-router.ts (adminRouter)
  - POST /api/admin/authors/gc HTTP surface
affects:
  - apps/server/src/app.ts (mount + import)
  - apps/server/src/books/books-service.ts (comment update only)
tech-stack:
  added: []
  patterns:
    - express + zod safeParse at route boundary
    - export { router as adminRouter } alias convention
    - vi.spyOn(console, 'info') for log assertions
key-files:
  created:
    - apps/server/src/admin/admin-router.ts
    - apps/server/src/admin/admin-router.test.ts
  modified:
    - apps/server/src/app.ts
    - apps/server/src/books/books-service.ts
key-decisions:
  - D-07: Zod literal 'DELETE_ORPHANS' enforces case-sensitivity at the boundary
  - D-08: only POST registered; other methods 404 by Express default
  - D-09: response shape { deleted, dry_run, sample } with sample [] when 0
  - D-10: console.info on non-dry-run success; console.error + 500 on exception
  - dry_run resolution: explicit body field wins over query ?dry_run=1
requirements-completed:
  - AUTHGC-01
  - AUTHGC-03
metrics:
  duration: 4 min
  tasks: 3
  files: 4
  tests-added: 11
completed: 2026-04-28
---

# Phase 9 Plan 02: Admin HTTP Surface for Orphan Author GC Summary

POST /api/admin/authors/gc reaches `deleteOrphanAuthors` through a Zod-validated Express router; literal `confirm: 'DELETE_ORPHANS'` body, dry-run via body or query, console.info audit on non-dry-run success.

## What was built

Three commits, three artifacts:

| Commit  | Type | Subject                                                      |
| ------- | ---- | ------------------------------------------------------------ |
| bb7af2c | feat | add admin-router with POST /authors/gc                       |
| d42b37c | test | cover admin-router HTTP surface with 11 supertest cases      |
| 7bba1eb | feat | mount adminRouter and update books-service comment           |

### Route mount confirmation

`apps/server/src/app.ts` (verified):
- Import: `import { adminRouter } from './admin/admin-router';` — placed before `import { openAiRouter } from './ai/open-ai-router';` (alphabetical: `./admin/...` < `./ai/...`).
- Mount: `app.use('/api/admin', adminRouter);` — exactly once, immediately after `app.use('/api/reports', reportsRouter);`.
- Acceptance grep `grep -cE "app\.use\('/api/admin', adminRouter\)" apps/server/src/app.ts` returns `1`.
- Order check `awk '/api/reports{r=NR} /api/admin{a=NR} END{exit (a>r?0:1)}'` passes.

### 11 test cases (all green via `npm --workspace=server exec vitest run src/admin/admin-router.test.ts`)

| #  | Case                                                                      | Verifies                                  |
| -- | ------------------------------------------------------------------------- | ----------------------------------------- |
| 1  | 200: deletes orphan authors and returns deleted, dry_run:false, sample    | Happy path; non-orphan untouched          |
| 2  | 400: missing confirm field returns Zod flattened error and writes nothing | Boundary validation                       |
| 3  | 400: wrong-cased confirm (delete_orphans) is rejected                     | D-07 case-sensitivity                     |
| 4  | 400: completely wrong confirm string is rejected                          | Zod literal mismatch                      |
| 5  | 404: GET /api/admin/authors/gc returns 404 (no GET handler)               | D-08 method allow-list                    |
| 6  | 404: DELETE /api/admin/authors/gc returns 404 (no DELETE handler)         | D-08 method allow-list                    |
| 7  | 200: ?dry_run=1 query reports count without mutating                      | Query-string dry-run                      |
| 8  | 200: body {dry_run:true} reports count without mutating                   | Body-field dry-run                        |
| 9  | idempotency: second POST returns deleted:0 and writes nothing             | Stable repeat behavior                    |
| 10 | 200: console.info logs deleted count and sample on non-dry-run            | D-10 audit log                            |
| 11 | 200: console.info is NOT called on dry-run                                | D-10: log only on real deletes            |

### Comment update at apps/server/src/books/books-service.ts:148

Before:
```typescript
// - Orphan author rows are NOT garbage-collected (research Pitfall 2: matches
//   applier behavior; GC deferred to a future cleanup pass).
```

After:
```typescript
// - Orphan author rows are NOT touched by the manual edit path itself; they
//   are cleaned up out-of-band by the Phase 9 GC: POST /api/admin/authors/gc
//   or `npm --workspace=server run gc:orphan-authors` (see apps/server/src/admin/).
```

No behavioral change to `applyManualEdit`.

## Verification

- `npm --workspace=server exec vitest run src/admin/admin-router.test.ts` — 11 passing.
- `cd apps/server && npx tsc -p tsconfig.json --noEmit` — no errors in `apps/server/src/admin/**`. Pre-existing TS errors elsewhere (book-factory FailureReason, phase-08 unused @ts-expect-error directives, backfill-reference-pages overload, reports-router fixture) are out of scope for this plan.
- `npm --workspace=server test` — 595 passing, 1 pre-existing failure in `src/db/migrations/__tests__/phase-06-schema.test.ts` (idx_page_stat_start_time idempotency). Confirmed pre-existing by stash-and-rerun against `588b452` (Plan 01 tip): same failure reproduces. Out of scope per Plan 02.

## Deviations from Plan

None. All decisions D-02, D-07, D-08, D-09, D-10 implemented as locked.

## Authentication Gates

None. The endpoint is intentionally unauthenticated this milestone (T-09-06 accepted-deferred); the literal-confirm + POST-only shape is the in-scope mitigation.

## Issues Encountered

- Worktree was created from `master` instead of `gsd/phase-09-orphan-author-gc` (#2661). Resolved by `git reset --hard gsd/phase-09-orphan-author-gc` before any task work, so Plan 01's `apps/server/src/admin/orphan-author-gc.ts` and `apps/server/src/db/factories/author-factory.ts` were on the working tree as expected.
- Pre-existing test failure: `phase-06-schema.test.ts > migrate up -> down -> up is idempotent`. Reproduces against Plan 01 tip; not introduced or aggravated by Plan 02. Logged for follow-up; out of Plan 02 scope.

## Next

Ready for Plan 09-03 (CLI surface for orphan-author GC). Files Plan 03 owns (`orphan-author-gc-cli.ts`, `orphan-author-gc-cli.test.ts`, `apps/server/package.json`) were not touched by this plan.

## Self-Check: PASSED

- `apps/server/src/admin/admin-router.ts` exists.
- `apps/server/src/admin/admin-router.test.ts` exists.
- `apps/server/src/app.ts` contains `adminRouter` import and mount line.
- `apps/server/src/books/books-service.ts` no longer contains "Orphan author rows are NOT garbage-collected" and now contains `/api/admin/authors/gc`.
- Commits found in `git log --oneline`: bb7af2c, d42b37c, 7bba1eb.
- All 11 admin-router tests pass; 595 of 596 tests in the full server suite pass (one pre-existing migration test out of scope).

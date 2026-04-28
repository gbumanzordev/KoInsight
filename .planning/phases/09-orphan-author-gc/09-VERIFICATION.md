---
phase: 09-orphan-author-gc
verified: 2026-04-28T09:08:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
---

# Phase 9: Orphan Author GC Verification Report

**Phase Goal:** An operator can delete every `author` row that has zero `book_author` references, on demand, via either an HTTP endpoint or a CLI script; the operation is idempotent and cannot be triggered by a stray browser navigation.
**Verified:** 2026-04-28
**Status:** PASS
**Re-verification:** No, initial verification.

## Goal Achievement

### Observable Truths (mapped to SPEC requirements)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | AUTHGC-01: `POST /api/admin/authors/gc` with `{confirm:'DELETE_ORPHANS'}` deletes orphans, returns `{ deleted, dry_run, sample }` in a single transaction. | VERIFIED | `admin-router.ts:23-50` calls `deleteOrphanAuthors(db, { dryRun })`; core `orphan-author-gc.ts:41` wraps delete in `db.transaction(...)`. Tests in `admin-router.test.ts` cover the 200 success path with referenced authors untouched. |
| 2 | AUTHGC-01 protection: POST-only + literal `confirm` body required; 400 otherwise; GET/PUT/DELETE return 404. | VERIFIED | `admin-router.ts:8` uses `z.literal('DELETE_ORPHANS')` (case-sensitive). Only `router.post('/authors/gc', ...)` is registered. Tests cover wrong-case `delete_orphans`, missing field, GET 404, DELETE 404. |
| 3 | AUTHGC-02 + AUTHGC-03 dry-run: `?dry_run=1` query, `{dry_run:true}` body, and CLI `--dry-run` all return count without mutation; body wins over query. | VERIFIED | Router `admin-router.ts:30-31` resolves explicit body field over query truthiness; CLI `parseDryRun` at `orphan-author-gc-cli.ts:11`; core dry-run path skips `db.transaction`. Tests assert no mutation in all three forms. |
| 4 | AUTHGC-02: `npm --workspace=server run gc:orphan-authors` runs against SQLite without HTTP server, prints JSON, exits 0; `--dry-run` flag respected. | VERIFIED | `package.json:9` registers `"gc:orphan-authors": "tsx src/admin/orphan-author-gc-cli.ts"`. Self-invocation guard at `orphan-author-gc-cli.ts:28-52` calls `db.destroy()` then `process.exit(0/1)`. Behavioral spot-check ran the script with `--dry-run`; it printed valid JSON `{"deleted":1,"dry_run":true,"sample":[...]}` and exited 0. |
| 5 | Idempotency: a second invocation with no orphans returns `{ deleted: 0, sample: [] }`, no writes, no error. | VERIFIED | Core `orphan-author-gc.ts:46-48` short-circuits inside the transaction when `orphans.length === 0`. Idempotency tests exist in core (case 4), router (case 9), and CLI (case 5). All passing. |
| 6 | books-service.ts comment update: orphan-GC gap acknowledged at line ~148 now points operators at the new endpoint and CLI. | VERIFIED | `apps/server/src/books/books-service.ts:148-150` reads "Orphan author rows are NOT touched by the manual edit path itself; they are cleaned up out-of-band by the Phase 9 GC: POST /api/admin/authors/gc or `npm --workspace=server run gc:orphan-authors`". Old "NOT garbage-collected" line is gone. |

**Score:** 6/6 truths verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `apps/server/src/admin/orphan-author-gc.ts` | Shared core `deleteOrphanAuthors` | VERIFIED | 62 lines, exports `OrphanAuthorGcResult` + `deleteOrphanAuthors`, signature matches D-04, uses `whereNotIn` builder (no `db.raw`), no `import { db }`, transaction only on delete path, sample capped at 20. |
| `apps/server/src/admin/orphan-author-gc.test.ts` | 8 vitest cases | VERIFIED | 8 tests passing. |
| `apps/server/src/db/factories/author-factory.ts` | `fakeAuthor` + `createAuthor` | VERIFIED | Mirrors genre-factory shape; UNIQUE(name) caveat documented. |
| `apps/server/src/admin/admin-router.ts` | Express router with POST handler | VERIFIED | 52 lines, single POST handler, Zod validation, dry_run resolution, console.info on success, 500 on caught error, exported as `adminRouter`. |
| `apps/server/src/admin/admin-router.test.ts` | Supertest integration | VERIFIED | 11 tests passing. |
| `apps/server/src/admin/orphan-author-gc-cli.ts` | Tsx CLI entry | VERIFIED | Exports `parseDryRun`, `runCli`, `CliOutput`; self-invocation guard with exit 0/1 + `db.destroy()` on both paths. |
| `apps/server/src/admin/orphan-author-gc-cli.test.ts` | CLI semantics tests | VERIFIED | 6 deterministic tests pass + 1 skipped (optional E2E spawn case 7). |
| `apps/server/src/app.ts` | Mount line + import | VERIFIED | Import at line 6, mount at line 44 placed after `/api/reports`, exactly one `app.use('/api/admin', adminRouter)`. |
| `apps/server/package.json` | `gc:orphan-authors` script | VERIFIED | Line 9: `"gc:orphan-authors": "tsx src/admin/orphan-author-gc-cli.ts"` adjacent to `backfill:reference-pages`. |
| `apps/server/src/books/books-service.ts` | Comment update at ~148 | VERIFIED | Old "NOT garbage-collected" line removed; new comment references endpoint + CLI. No code change to `applyManualEdit`. |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `app.ts` | `admin-router.ts` | `import { adminRouter }` + `app.use('/api/admin', adminRouter)` | WIRED |
| `admin-router.ts` | `orphan-author-gc.ts` | `deleteOrphanAuthors(db, { dryRun })` | WIRED |
| `admin-router.ts` | `knex.ts` | `import { db } from '../knex'` | WIRED |
| `orphan-author-gc-cli.ts` | `orphan-author-gc.ts` | `deleteOrphanAuthors(db, { dryRun })` | WIRED |
| `orphan-author-gc-cli.ts` | `knex.ts` | `import { db } from '../knex'` + `await db.destroy()` | WIRED |
| `package.json` scripts | `orphan-author-gc-cli.ts` | `tsx src/admin/orphan-author-gc-cli.ts` | WIRED (smoke run succeeded) |
| `orphan-author-gc.ts` | `author` + `book_author` tables | `whereNotIn('id', db('book_author').distinct('author_id'))` | WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Admin tests pass | `npm --workspace=server exec vitest run src/admin/` | 25 passed, 1 skipped | PASS |
| CLI smoke (dry-run) | `npm --workspace=server run gc:orphan-authors -- --dry-run` | Exit 0; printed `{"deleted":1,"dry_run":true,"sample":[{"id":25,"name":"David Fernández"}]}` | PASS |
| Mount placement | `grep adminRouter app.ts` | Import at line 6; mount at line 44 (after `/api/reports`) | PASS |
| Comment update | `grep -n "NOT garbage-collected" books-service.ts` | No matches (old comment gone) | PASS |
| `package.json` JSON valid | implicit via `npm --workspace=server run` | Exit 0 | PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| AUTHGC-01 | 09-01, 09-02 | HTTP endpoint + protection | SATISFIED | Router truth #1, #2; tests in admin-router.test.ts |
| AUTHGC-02 | 09-01, 09-03 | CLI script + dry-run | SATISFIED | CLI truth #4; npm script + smoke run + tests |
| AUTHGC-03 | 09-01, 09-02, 09-03 | Idempotent shared core | SATISFIED | Core truth #5; idempotency tests in all three suites |

### Anti-Patterns Found

None. Manual scan of all 6 source files shows:
- No TODO/FIXME/PLACEHOLDER markers.
- No empty handlers or stub returns.
- No `db.raw` predicate (Knex builder only, per D-06).
- No new runtime deps added.
- No scope leak: only the 6 expected source files plus phase docs were touched on this branch.

### Human Verification Required

None. All goal-relevant behaviors are covered by automated tests and the CLI smoke run completed against the real dev DB. Auth/CSRF protections are explicitly out of scope per SPEC and deferred to the next milestone.

### Gaps Summary

No gaps. All 6 must-haves verified, all 9 SPEC acceptance criteria satisfied:

- [x] POST with `{confirm:'DELETE_ORPHANS'}` deletes only orphans, returns `{deleted}`.
- [x] POST with missing/wrong confirm returns 400, no deletion.
- [x] GET on path returns 404 (no GET handler).
- [x] `?dry_run=1` and `{dry_run:true}` both return count without mutation.
- [x] `npm --workspace=server run gc:orphan-authors` runs against SQLite without HTTP server, exits 0.
- [x] CLI `--dry-run` flag returns count without mutation.
- [x] Two consecutive runs yield `{deleted:K}` then `{deleted:0}`.
- [x] Referenced authors never deleted.
- [x] Deletion runs in a single `db.transaction(...)` (verified by core test case 7 spy).

Server suite reports 601 passing / 1 pre-existing failure (`phase-06-schema.test.ts`), documented in `deferred-items.md` and predates this branch. Not attributable to Phase 9.

---

_Verified: 2026-04-28_
_Verifier: Claude (gsd-verifier)_

# Phase 9: Orphan Author GC — Specification

**Created:** 2026-04-28
**Ambiguity score:** 0.12 (gate: ≤ 0.20)
**Requirements:** 5 locked

## Goal

An operator can delete every `author` row that has zero `book_author` references, on demand, via either an HTTP endpoint or a CLI script; the operation is idempotent and cannot be triggered by a stray browser navigation.

## Background

The `author` and `book_author` tables were introduced in migration `20260423221400_create_author_and_book_author.ts`. `book_author` has `ON DELETE CASCADE` on its `author_id` FK, so deleting a book's row in `book_author` is automatic — but deleting the underlying `author` row when no `book_author` references remain is not. `apps/server/src/books/books-service.ts:148` explicitly comments "Orphan author rows are NOT garbage-collected" — the gap is acknowledged in code with no current cleanup path.

No admin auth middleware exists today; CORS is open `*`. Web authentication is planned for the next milestone, so this phase ships protection sufficient to defeat accidental triggering (POST method + literal confirm string in body) and lets the future auth layer wrap the endpoint by adding middleware, with no expected rework.

A CLI-script pattern already exists for ops-style tasks — see `apps/server/src/enrichment/backfill-reference-pages.ts` invoked via `npm --workspace=server run backfill:reference-pages`. The orphan GC follows this pattern.

## Requirements

1. **HTTP endpoint deletes orphan authors**: An admin endpoint deletes every `author` row with zero `book_author` references and returns the deleted count.
   - Current: No HTTP endpoint exists for orphan-author cleanup; orphan rows accumulate indefinitely.
   - Target: `POST /api/admin/authors/gc` returns `{ deleted: N }` on success and deletes those rows in a single transaction.
   - Acceptance: Integration test seeds K orphan authors plus M referenced authors; calling the endpoint returns `{ deleted: K }` and only orphan rows are missing from the `author` table afterward; referenced authors are untouched.

2. **Endpoint is protected against accidental triggering**: The endpoint requires an explicit confirmation token in the request body.
   - Current: No `/api/admin/*` namespace; if naively added, any GET or stray browser navigation could trigger deletion.
   - Target: Endpoint accepts `POST` only (other methods return 405 or 404); request body must include `{ "confirm": "DELETE_ORPHANS" }` exactly; missing or mismatched confirm field returns HTTP 400 with no deletion.
   - Acceptance: GET/PUT/DELETE on the path do not delete rows. POST with empty body returns 400 and deletes nothing. POST with `{"confirm":"DELETE_ORPHANS"}` deletes orphans. POST with `{"confirm":"delete_orphans"}` (wrong case) returns 400 and deletes nothing.

3. **Dry-run mode reports without deleting**: Both endpoint and CLI support a dry-run that returns the would-delete count without mutating the database.
   - Current: No preview mechanism exists.
   - Target: HTTP endpoint accepts `?dry_run=1` query param OR `{"dry_run": true}` body field; CLI accepts `--dry-run` flag; both return the orphan count and exit/respond without deleting.
   - Acceptance: With K orphans seeded, dry-run reports K and the `author` row count is unchanged after the call/script returns.

4. **CLI script wraps the same logic**: An npm workspace script runs the GC against the SQLite database without requiring the HTTP server.
   - Current: No CLI exists; manual SQL is the only path.
   - Target: `npm --workspace=server run gc:orphan-authors` runs a `tsx` script that opens the database via the shared Knex instance, deletes orphan rows, and prints a JSON summary `{ deleted: N, dry_run: false }` to stdout. Supports `--dry-run`. Exits 0 on success, non-zero on unexpected error.
   - Acceptance: With K orphans seeded and the HTTP server NOT running, invoking the script deletes exactly K rows and prints `{ deleted: K, dry_run: false }`. The same database state could have been reached by calling the HTTP endpoint.

5. **Operation is idempotent**: Running GC against a database with no orphans is a side-effect-free no-op.
   - Current: N/A — no GC exists.
   - Target: Both HTTP and CLI paths return `{ deleted: 0 }` when invoked with no orphans, perform no writes, and do not error.
   - Acceptance: Integration test seeds K orphans, runs GC twice in a row; first call returns `{ deleted: K }`, second call returns `{ deleted: 0 }`; `author` row count and contents are identical between the two post-GC states.

## Boundaries

**In scope:**
- New `POST /api/admin/authors/gc` HTTP endpoint with confirm-string protection and dry-run support.
- New `gc:orphan-authors` npm script under `apps/server` (tsx-invoked, follows `backfill:reference-pages` pattern).
- Shared core function (e.g., `deleteOrphanAuthors`) consumed by both the route handler and the CLI to guarantee the two paths have identical behavior.
- Integration tests covering: HTTP success, HTTP missing/wrong confirm, HTTP dry-run, CLI delete, CLI dry-run, idempotency (delete twice).
- Logging: each invocation logs the deleted count via `console.info` (HTTP) and stdout (CLI).

**Out of scope:**
- Authentication / authorization beyond the confirm-string check — defer to the next milestone's web-auth work, which will wrap this endpoint with middleware.
- Any web UI affordance (button, settings panel, progress indicator) — backend + CLI only.
- Scheduled / cron / automatic GC — manual operator trigger only.
- GC for other tables (books, devices, reading sessions) — author orphans only.
- Cascading deletes from book deletion — out of scope; this phase cleans up existing orphans, it does not change book-deletion behavior.
- Audit logging beyond `console.info` — no persisted audit table.

## Constraints

- Must use the shared Knex instance (`apps/server/src/knex.ts`) so it works against both `dev.db` and `prod.db` without bespoke connection logic.
- The deletion must run inside a single transaction so a partial failure does not leave a half-cleaned state.
- The orphan predicate must be: `author.id NOT IN (SELECT DISTINCT author_id FROM book_author)`; the SQL must execute correctly against SQLite (no Postgres-specific syntax).
- No new runtime dependencies (Zod is already available for body validation; tsx is already used by `backfill:reference-pages`).
- The endpoint path `/api/admin/authors/gc` is reserved for this phase — future admin endpoints will share the `/api/admin/` prefix, so the route should be mounted via a small `adminRouter` rather than inlined into `app.ts`, leaving room for siblings.

## Acceptance Criteria

- [ ] `POST /api/admin/authors/gc` with `{"confirm":"DELETE_ORPHANS"}` deletes all and only orphan authors and returns `{ deleted: N }`.
- [ ] `POST /api/admin/authors/gc` with missing or mismatched `confirm` returns HTTP 400 and deletes nothing.
- [ ] `GET /api/admin/authors/gc` does NOT delete anything (returns 404 or 405).
- [ ] `?dry_run=1` (query) and `{"dry_run":true}` (body) both return the count without mutation.
- [ ] `npm --workspace=server run gc:orphan-authors` deletes orphans against the SQLite DB without the HTTP server running and exits 0.
- [ ] CLI `--dry-run` flag returns the count without mutation.
- [ ] Running either path twice in a row yields `{ deleted: K }` then `{ deleted: 0 }`; second run performs no writes.
- [ ] Referenced authors (with one or more `book_author` rows) are never deleted by either path.
- [ ] Deletion runs in a single transaction (verified by the shared core function calling `db.transaction(...)`).

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                              |
|--------------------|-------|------|--------|----------------------------------------------------|
| Goal Clarity       | 0.92  | 0.75 | ✓      | Endpoint + CLI + idempotent + dry-run, all locked  |
| Boundary Clarity   | 0.90  | 0.70 | ✓      | Explicit out-of-scope list incl. UI and auth       |
| Constraint Clarity | 0.80  | 0.65 | ✓      | POST+confirm protection; SQLite-safe predicate     |
| Acceptance Criteria| 0.85  | 0.70 | ✓      | 9 pass/fail criteria                               |
| **Ambiguity**      | 0.12  | ≤0.20| ✓      |                                                    |

## Interview Log

| Round | Perspective              | Question summary                              | Decision locked                                                                 |
|-------|--------------------------|-----------------------------------------------|---------------------------------------------------------------------------------|
| 1     | Researcher + Boundary    | Protection mechanism for the HTTP endpoint?   | Defer real auth to next milestone; ship POST + literal `confirm` body string.   |
| 1     | Boundary Keeper          | Web UI affordance in scope?                   | No — backend + CLI only this phase.                                             |
| 1     | Simplifier               | Dry-run / preview mode?                       | Yes — both endpoint (`?dry_run=1` or body field) and CLI (`--dry-run`) support. |
| 1     | Boundary Keeper          | HTTP scope given upcoming auth milestone?     | Ship endpoint now with POST + confirm body; auth wraps it later as middleware.  |

---

*Phase: 09-orphan-author-gc*
*Spec created: 2026-04-28*
*Next step: /gsd-discuss-phase 9 — implementation decisions (router structure, shared core function placement, test fixtures)*

# Phase 9: Orphan Author GC - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Operator-triggered cleanup of `author` rows that have zero `book_author` references. Two surfaces: an admin HTTP endpoint and an npm workspace CLI script, both backed by a single shared core function. Idempotent and side-effect-free when no orphans exist.

</domain>

<spec_lock>
## Locked Requirements (from SPEC.md)

Requirements, boundaries, and acceptance criteria are locked in `.planning/phases/09-orphan-author-gc/09-SPEC.md` (5 requirements). Downstream agents MUST read SPEC.md before planning. Discussion below covers implementation choices only.

Key locked points:
- Endpoint: `POST /api/admin/authors/gc`, requires `{"confirm":"DELETE_ORPHANS"}` literal in body.
- Both surfaces support dry-run (`?dry_run=1` / `{"dry_run":true}` / `--dry-run`).
- Single transaction; SQLite-safe predicate `author.id NOT IN (SELECT DISTINCT author_id FROM book_author)`.
- No web UI; no auth (deferred to next milestone — auth will wrap as middleware).
- CLI follows the `backfill-reference-pages.ts` invocation pattern.

</spec_lock>

<decisions>
## Implementation Decisions

### Module layout
- **D-01:** Create new `apps/server/src/admin/` module to host admin-only endpoints. Files: `admin-router.ts` (Express router, mounted at `/api/admin`), `orphan-author-gc.ts` (shared core function `deleteOrphanAuthors`), `orphan-author-gc-cli.ts` (CLI entry, mirrors the `backfill-reference-pages.ts` self-invocation pattern).
- **D-02:** `admin-router.ts` exports `adminRouter` per the project convention (`export { router as adminRouter }`). Mount in `app.ts` after `/api/reports`: `app.use('/api/admin', adminRouter)`.
- **D-03:** Future admin endpoints (e.g., other GC operations, ops health checks) will be added to this same `admin-router.ts` rather than spawning new top-level routers — the module is the home for all admin-namespaced operations going forward.

### Shared core function
- **D-04:** Signature: `async function deleteOrphanAuthors(db: Knex, opts: { dryRun: boolean }): Promise<{ deleted: number; sample: Array<{ id: number; name: string }> }>`. Both the route handler and the CLI call this directly with the shared `db` instance from `apps/server/src/knex.ts`.
- **D-05:** Implementation runs inside a single `db.transaction(...)` for the delete path. Dry-run path performs the SELECT only (no transaction needed) and returns `deleted` as the count of rows that WOULD be deleted.
- **D-06:** Predicate is one query: `SELECT id, name FROM author WHERE id NOT IN (SELECT DISTINCT author_id FROM book_author)`. Capture rows first, then delete by id list. The "sample" is the first 20 captured rows by insertion order.

### HTTP route
- **D-07:** Body validation via Zod (per project convention from `books-router.ts:11`). Schema: `z.object({ confirm: z.literal('DELETE_ORPHANS'), dry_run: z.boolean().optional() })`. Mismatch → 400 with `{ error: '...' }`. Query param `?dry_run=1` is also accepted (resolved to boolean before calling core).
- **D-08:** Only `POST` handler is registered. Other methods on the path naturally return 404 (Express default), satisfying SPEC acceptance criterion 3.
- **D-09:** Response: `{ deleted: number, dry_run: boolean, sample: Array<{ id: number, name: string }> }`. Sample is empty array when `deleted = 0`.
- **D-10:** Side log on every successful (non-dry-run) call: `console.info('admin:orphan-author-gc', { deleted, sample })`. Errors logged with `console.error` and surfaced as 500.

### CLI script
- **D-11:** npm script in `apps/server/package.json`: `"gc:orphan-authors": "tsx src/admin/orphan-author-gc-cli.ts"`. Invoked from repo root via `npm --workspace=server run gc:orphan-authors`.
- **D-12:** Args: support `--dry-run` flag only; parse with manual `process.argv.includes('--dry-run')` (no new dependency — backfill script does the same).
- **D-13:** Self-invocation guard mirrors `backfill-reference-pages.ts`: check `invokedPath.endsWith('orphan-author-gc-cli.ts' | '.js')` before executing. Calls `deleteOrphanAuthors(db, { dryRun })`, prints `JSON.stringify(result)` to stdout, awaits `db.destroy()`.
- **D-14:** Exit codes: `0` on success (including `deleted: 0`), `1` on unexpected error (caught at the top level; error message goes to stderr). Differs from `backfill-reference-pages.ts` (which always exits 0) because GC failures should be visible to ops/CI callers.

### Tests
- **D-15:** Integration tests in `apps/server/src/admin/admin-router.test.ts` (HTTP path) and `apps/server/src/admin/orphan-author-gc.test.ts` (core function + CLI semantics). Use the existing per-test `knex` migration setup pattern from `apps/server/src/books/books-router.test.ts`. Seed with the `book-factory.ts` plus a fresh `author-factory` if one doesn't exist (planner to confirm); `book_author` rows inserted directly.
- **D-16:** Required test cases (one each, mapped to SPEC acceptance criteria):
  - HTTP success deletes K orphans, leaves M referenced authors untouched.
  - HTTP missing/wrong `confirm` → 400, no deletion.
  - HTTP `?dry_run=1` and body `dry_run:true` → returns count, no mutation.
  - GET on the path → 404.
  - Core function called twice in a row: first returns `deleted: K`, second returns `deleted: 0` and writes nothing (verify by checking row counts and a transaction-spy or by snapshotting `author` table).
  - CLI: spawn or invoke the CLI module directly, assert exit code and JSON output.

### Claude's Discretion
- Exact wording of 400/500 error messages.
- Whether to add a tiny `author-factory.ts` if one doesn't already exist (planner to decide based on what `db/factories/` currently has).
- Whether to colocate a `__tests__/` subfolder under `admin/` or use sibling `.test.ts` files (sibling preferred per CONVENTIONS.md, but planner to confirm).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements (locked)
- `.planning/phases/09-orphan-author-gc/09-SPEC.md` — Locked requirements, boundaries, acceptance criteria. MUST read before planning.

### Schema authority
- `apps/server/src/db/migrations/20260423221400_create_author_and_book_author.ts` — Defines `author` and `book_author` tables, FK relationships, and the `book_author.author_id ON DELETE CASCADE` rule that motivates the GC (deleting a book_author row does not cascade to its author).
- `apps/server/src/db/migrations/20260423221700_backfill_book_authors.ts` — Backfill that originally populated `author` and `book_author`; understanding it explains how orphans accumulate.

### Patterns to mirror
- `apps/server/src/enrichment/backfill-reference-pages.ts` — Reference pattern for a CLI script that uses the shared Knex instance, self-invokes when run directly, and tears down the connection.
- `apps/server/src/books/books-router.ts` — Router structure, Zod-on-touch convention, JSDoc route summaries, `export { router as <name>Router }` alias pattern.
- `apps/server/src/books/books-router.test.ts` — Integration test setup using per-test Knex migrations.

### Project conventions
- `CLAUDE.md` — Zod for route validation; Knex for DB; one shared Knex instance.
- `.planning/codebase/CONVENTIONS.md` — File naming, router export alias, server module layout (router/repository/service/middleware).

### Code-acknowledged gap
- `apps/server/src/books/books-service.ts:148` — Existing comment "Orphan author rows are NOT garbage-collected" — this phase closes that gap. Planner should remove or update the comment when wiring the GC.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/server/src/knex.ts` (`db`) — Shared Knex instance used by every existing router/service. `deleteOrphanAuthors` accepts a `Knex` so tests can pass a per-test instance.
- `apps/server/src/enrichment/backfill-reference-pages.ts` — Drop-in template for the CLI entry: argv parse, run, JSON-stringify result, `db.destroy()`, self-invocation guard.
- Zod is already a runtime dep on the server; no new packages.
- `tsx` is already wired for the existing `backfill:reference-pages` script — no devDep changes needed for the CLI.

### Established Patterns
- Routers live next to their feature module under `apps/server/src/<feature>/`; mounted in `app.ts` with a single `app.use('/path', router)` line.
- Body validation uses Zod when touching a route; legacy hand-rolled checks are tolerated only in already-existing handlers, never in new ones.
- Tests are sibling `*.test.ts` files (per CONVENTIONS.md), use Vitest, and run migrations against a fresh per-test SQLite DB.
- Functional helpers from Ramda are common but not required; `Array.prototype` methods are equally accepted.

### Integration Points
- `apps/server/src/app.ts` — One new line: `app.use('/api/admin', adminRouter)` in the existing `setupServer()` mount block, after `/api/reports`. Add the import in alphabetical block.
- `apps/server/package.json` — One new entry under `"scripts"`: `"gc:orphan-authors": "tsx src/admin/orphan-author-gc-cli.ts"`.
- No frontend integration. No migration. No KOReader plugin update.

</code_context>

<deferred>
## Deferred Ideas

- **Real auth on `/api/admin/*`** — Will be added by the next milestone's web-auth phase as middleware around `adminRouter`. Phase 9 deliberately leaves the endpoint protected only by the confirm-string body to avoid auth design coupling.
- **Web UI affordance for GC** — Not in v1.1; reconsider only if operators actually surface a need.
- **GC for other tables** — Books, devices, reading-session orphans are not in scope. If they become real concerns, add `/api/admin/<thing>/gc` endpoints alongside in the same `admin/` module.
- **Audit table for admin operations** — Beyond `console.info` logging. Would be addressed alongside auth (caller identity is the missing piece today).
- **Cascading author cleanup on book deletion** — A different problem (lifecycle), not a GC. Would change `BooksRepository.delete` behavior; deliberately out of Phase 9 per SPEC.

</deferred>

---

*Phase: 09-orphan-author-gc*
*Context gathered: 2026-04-28*

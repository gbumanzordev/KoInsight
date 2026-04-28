# Phase 9: Orphan Author GC — Discussion Log

**Date:** 2026-04-28
**Mode:** discuss (default)
**SPEC.md loaded:** yes (5 requirements locked)

## Areas Discussed

### Module layout
- **Question:** Where should the shared GC core, admin router, and CLI live in the server tree?
- **Options presented:**
  1. New `admin/` module (Recommended)
  2. New `authors/` module parallel to `books/`
  3. Reuse `enrichment/`
- **User selected:** New `admin/` module
- **Notes:** Aligns with SPEC.md reservation of `/api/admin/` namespace; future admin siblings land in the same module.

### Response shape & logging detail
- **Question:** What should the success response and logs include?
- **Options presented:**
  1. Count + sample of deleted author names (Recommended)
  2. Count only
  3. Count + full list of deleted (id, name)
- **User selected:** Count + sample (capped, e.g. 20)
- **Notes:** Balances audit usefulness against log/response size when cleaning up many orphans.

### CLI script name
- **Question:** What should the CLI script be named in `apps/server/package.json`?
- **Options presented:**
  1. `gc:orphan-authors` (Recommended)
  2. `authors:gc`
  3. `admin:gc-orphan-authors`
- **User selected:** `gc:orphan-authors`
- **Notes:** Verb-first convention; future GC scripts follow `gc:<thing>`.

## Claude's Discretion (no decision asked)

- Exact wording of 400 / 500 error response bodies.
- Decision to add a small `author-factory.ts` if `apps/server/src/db/factories/` doesn't already provide one — planner will confirm.
- Whether tests sit in `__tests__/` or as sibling `.test.ts` files (sibling preferred per CONVENTIONS.md).

## Deferred Ideas (captured in CONTEXT.md)

- Real auth on `/api/admin/*` — handled by next-milestone web-auth work as middleware.
- Web UI affordance for GC.
- GC for other tables (books, devices, reading sessions).
- Audit table for admin operations.
- Cascading author cleanup on book deletion (different lifecycle problem).

## Scope Creep Redirected

None — discussion stayed inside SPEC.md boundaries.

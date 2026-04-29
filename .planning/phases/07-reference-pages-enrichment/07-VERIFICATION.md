---
phase: 07-reference-pages-enrichment
verified: 2026-04-27T10:05:00Z
uat_completed: 2026-04-27T18:00:00Z
status: verified
score: 4/4 must-haves verified
overrides_applied: 0
verdict: PASS
---

> UAT closed 2026-04-27 with all 6 tests passing (see 07-UAT.md). The
> "pending human UAT" caveat in the original report has been resolved.

# Phase 7: Reference Pages Enrichment Verification Report

**Phase Goal:** The enrichment pipeline populates `book.reference_pages` directly from OpenLibrary, with manual stickiness, so the yearly report (and any other consumer) reads `book.reference_pages` instead of falling back to `MAX(book_device.pages)`.

**Verified:** 2026-04-27
**Status:** human_needed (automated checks all green; UI affordance and end-to-end smoke require human eyes)
**Re-verification:** No, initial verification

## Goal Verdict: PASS (with UAT recommendation)

All four ROADMAP success criteria and all four REFPAGES requirements are delivered in code and exercised by green automated tests. One pre-existing failure (phase-06 schema idempotency) is documented out of scope. Browser smoke of the "Page count missing" affordance is the only remaining check, recommended via `/gsd-verify-work`.

## Observable Truths

| # | Truth (Success Criteria) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Fresh enrichment writes `reference_pages` + `reference_pages_source='openlibrary'` from OL Edition `number_of_pages`; NULL when OL has none | VERIFIED | `apps/server/src/enrichment/applier.ts:111-119` (D-06 guard); `apps/server/src/enrichment/worker.ts:159-160` (`getEdition`); `phase-07-applier.test.ts` 5/5 + `phase-07-worker.test.ts` 5/5 |
| 2 | A book with `reference_pages_source='manual'` retains its value across re-enrichment | VERIFIED | `applier.ts:114` guard `book.reference_pages_source !== 'manual'`; applier test case 4 (sticky) and worker test case 5 (end-to-end manual sticky) |
| 3 | One-time backfill populates already-enriched books idempotently from OL | VERIFIED | `apps/server/src/enrichment/backfill-reference-pages.ts` exists; `package.json:8` wires `backfill:reference-pages`; `phase-07-backfill.test.ts` 4/4 (predicate, idempotency, status filter, error tolerance); operator smoke documented in 07-04-SUMMARY: scanned=17 populated=11 no_pages=6 errored=0 |
| 4 | Yearly report reads `b.reference_pages` directly with no COALESCE/device fallback; consumers aligned; doc note recorded | VERIFIED | `reports-repository.ts:60-62` uses bare `b.reference_pages`; `grep "device_pages"` in that file returns 0; `books-service.ts:16` `getTotalPages(book)` returns `book.reference_pages ?? 0`; `CLAUDE.md:90` carries the D-17 conventions bullet |

**Score:** 4/4 truths verified.

## Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `apps/server/src/db/migrations/20260427120000_add_reference_pages_source_to_book.ts` | Adds `reference_pages_source` with CHECK domain `{openlibrary,manual}` | VERIFIED | `checkIn(['openlibrary','manual'])` at line 9; nullable, no default (D-01/D-02) |
| `packages/common/types/book.ts` (DbBook) | Adds `reference_pages_source: FieldSource \| null` | VERIFIED | Loaded by applier and matcher; type compiles |
| `apps/server/src/enrichment/applier.ts` | D-06 provenance guard inside `applyEnrichment` transaction | VERIFIED | Lines 111-119; reads `BookSourceRow.reference_pages_source` (line 35); SELECT updated at line 52 |
| `apps/server/src/enrichment/worker.ts` | Single Edition fetch gated on `candidate.cover_edition_key` between match and apply | VERIFIED | Lines 157-165 (`getEdition` call + positive int guard); errors propagate through D-05 retry classifier |
| `apps/server/src/open-library/open-library-schemas.ts` (SearchDocSchema) | `cover_edition_key` field preserved through Zod | VERIFIED | Plan 02 fix; `phase-07-schema.test.ts` 3/3 |
| `apps/server/src/open-library/open-library-client.ts` (`getWorkEditions`) | D-09 option-b method | VERIFIED | `phase-07-work-editions.test.ts` 4/4 |
| `apps/server/src/books/books-router.ts` (PUT `/books/:id/reference_pages`) | Zod union; D-12 confirm-no-lock; clear path | VERIFIED | Lines 13-16 (Zod union pos-int / null / 0); 107-131 (D-12 same-value no-op, clear, manual stamp); `phase-07-router.test.ts` 8/8 |
| `apps/server/src/books/books-repository.ts` (`setReferencePages`) | Three-arg signature writing both columns | VERIFIED | Used by router for clear (line 121) and manual (line 123) paths |
| `apps/server/src/enrichment/backfill-reference-pages.ts` | One-shot backfill module + CLI shim | VERIFIED | `runReferencePagesBackfill(knex)` exported; npm script `backfill:reference-pages` wired in `apps/server/package.json:8` |
| `apps/server/src/reports/reports-repository.ts` | COALESCE/device_pages fallback removed | VERIFIED | Lines 60-62 use bare `b.reference_pages`; header comment at 11-14 documents D-15/D-17; `grep device_pages` = 0 matches |
| `apps/server/src/books/books-service.ts` (`getTotalPages`) | One-arg, no `Math.max(...bookDevices)` | VERIFIED | Lines 13-17; call sites updated |
| `apps/web/src/pages/book-page/book-page.tsx` | NULL-aware affordance, no synthetic 0% ring | VERIFIED | Line 202 (`bookPages = book?.reference_pages ?? null`); 229-247 (conditional label + empty `sections={[]}` when null) |
| `apps/web/src/pages/stats-page/week-stats.tsx` | D-15 guard preserved + documented | VERIFIED | Inline D-15 comment over the truthy guard |
| `CLAUDE.md` | D-17 conventions bullet | VERIFIED | Line 90 |

## Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| worker.ts | open-library-client.getEdition | `candidate.cover_edition_key` truthy branch | WIRED (worker:159-160) |
| applier.ts | book.reference_pages / reference_pages_source columns | `updates.reference_pages = bundle.referencePages` inside D-18 transaction | WIRED (applier:115-117) |
| books-router PUT | BooksRepository.setReferencePages | clear + diff branches | WIRED (router:121,123) |
| backfill-reference-pages.ts | openLibraryClient.getWorkEditions + getEdition | shared HTTP limiter | WIRED (07-04 SUMMARY smoke: 17 scanned) |
| reports-repository.ts | book.reference_pages | bare column reference (no COALESCE) | WIRED (line 60-62) |
| book-page.tsx | book.reference_pages | `bookPages` derived value drives RingProgress branch | WIRED (line 202, 229-251) |

## Requirements Coverage

| Requirement | Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| REFPAGES-01 | 07-02, 07-03 | Enrichment populates `book.reference_pages` from OL Edition | SATISFIED | Applier D-06 + worker getEdition; `phase-07-worker.test.ts` cases 1-3 |
| REFPAGES-02 | 07-04 | One-time backfill task | SATISFIED | `backfill-reference-pages.ts` + `phase-07-backfill.test.ts` 4/4; live smoke 17/11/6/0 |
| REFPAGES-03 | 07-01, 07-04 | Schema column + manual stickiness | SATISFIED | Migration with CHECK; applier guard; PUT manual stamp; `phase-07-router.test.ts` 8/8 |
| REFPAGES-04 | 07-05, 07-06 | Drop COALESCE, align consumers, document fallback | SATISFIED | reports-repository SQL + books-service helper rewritten; UI NULL-aware; CLAUDE.md note |

## Test Execution Summary

| Suite | Result |
| --- | --- |
| `src/db/migrations/__tests__/phase-07-migration.test.ts` | 5/5 pass |
| `src/enrichment/__tests__/phase-07-schema.test.ts` | 3/3 pass |
| `src/open-library/__tests__/phase-07-work-editions.test.ts` | 4/4 pass |
| `src/enrichment/__tests__/phase-07-applier.test.ts` | 5/5 pass |
| `src/enrichment/__tests__/phase-07-worker.test.ts` | 5/5 pass |
| `src/enrichment/__tests__/phase-07-backfill.test.ts` | 4/4 pass |
| `src/books/__tests__/phase-07-router.test.ts` | 8/8 pass |
| `src/reports/__tests__/reports-repository.test.ts` | 15/15 pass |
| `src/books/books-service.test.ts` | 17/17 pass |
| `npm --workspace=web run build` | exit 0 (29.57s) |

Total Phase 7 directly attributable tests: 66/66 passing.

## Outstanding Issues / Pre-existing Failures (Out of Scope)

1. `apps/server/src/db/migrations/__tests__/phase-06-schema.test.ts` — 1 case fails ("idx_page_stat_start_time" idempotency on `up -> down -> up`). Documented in 07-05-SUMMARY and confirmed reproducible. Pre-dates Phase 7 work; belongs to a Phase 6 follow-up, not Phase 7 scope.
2. `apps/server/src/reports/__tests__/reports-router.test.ts:210` — TS-only error `Type 'null' is not assignable to type 'string'`. Documented in 07-02, 07-03, 07-04, 07-05 SUMMARYs as pre-existing on the base branch (`c2d037f`). Not introduced by Phase 7.
3. Web bundle warning: `dist/assets/index-CdBXgRuq.js` 1.2 MB exceeds 500 kB chunk threshold. This is the POLISH-03 deliverable for Phase 10; not Phase 7.

None of these block the Phase 7 goal.

## Human Verification Required

Phase 7 plans 03 (worker), 04 (backfill smoke), and 06 (UI affordance) all explicitly recommend a brief manual smoke. Items:

### 1. Browser smoke: NULL `reference_pages` book renders "Page count missing"

- **Test:** Start `npm run dev`, open the book page for any book where `reference_pages IS NULL` in the dev DB. Inspect the RingProgress widget on the StatsCard.
- **Expected:** Dimmed two-line "Page count / missing" text inside an unfilled ring. No NaN, no synthetic 0%.
- **Why human:** Visual rendering and Mantine `c="dimmed"` styling cannot be verified by grep; 07-06-SUMMARY notes the planner did not drive a real browser session.

### 2. Backfill operator UX smoke

- **Test:** Re-run `npm --workspace=server run backfill:reference-pages` against the dev DB. Confirm idempotency (no_pages rows re-attempted, populated rows untouched) and that the per-row + summary log lines are operator-readable.
- **Expected:** Summary `backfill:reference-pages complete { scanned, populated, no_pages, errored }` with `populated` near 0 on a second run; per-row diagnostics for any errored / no-pages rows.
- **Why human:** Tests cover the function but the operator-facing log shape is a UX concern.

### 3. End-to-end enrichment of a fresh book

- **Test:** Soft-import or re-trigger enrichment on a book whose OL Edition exposes `number_of_pages`. Confirm the book row updates with `reference_pages` populated and `reference_pages_source = 'openlibrary'` in SQLite.
- **Expected:** Live OL fetch + applier write produces the expected DB state and the dashboard reflects the value.
- **Why human:** Validates real OL HTTP path and full pipeline against a populated KOReader stats DB; tests stub fetch.

## Recommendation

Run `/gsd-verify-work 7` to drive the three human verification items above. Once UAT passes, mark Phase 7 closed in ROADMAP and proceed to Phase 8 (Failure Triage & Smarter Matcher).

---

*Verified: 2026-04-27T10:05:00Z*
*Verifier: Claude (gsd-verifier)*

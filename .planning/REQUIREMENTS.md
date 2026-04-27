# Milestone v1.1 Requirements: Enrichment Polish & Cleanup

**Milestone:** v1.1 Enrichment Polish & Cleanup
**Goal:** Pay down v1.0 carry-over debt and polish the enrichment pipeline so the dashboard runs on clean, complete data without workarounds.
**Started:** 2026-04-26

## Categories

- **REFPAGES** — Edition page count enrichment + workaround removal
- **RETRY** — Bulk and per-book retry of failed enrichments + smarter matcher
- **AUTHGC** — Orphan author garbage collection
- **POLISH** — Bulk enqueue helper, dependency pin convention, web bundle code-splitting

## v1.1 Requirements

### Reference Pages (REFPAGES)

- [ ] **REFPAGES-01**: Enrichment service populates `book.reference_pages` from the resolved OL Edition `number_of_pages` (when present) on the same enrichment run that fills genres / authors / publication info.
- [x] **REFPAGES-02**: A one-time backfill task populates `reference_pages` for books that were already enriched before REFPAGES-01 shipped, without re-running the full enrichment pipeline against those books.
- [x] **REFPAGES-03**: Schema gains a `reference_pages_source` column on `book` (values: `openlibrary` | `manual`); enrichment respects manual stickiness exactly like other enriched fields (never overwrites a `*_source = 'manual'` value).
- [ ] **REFPAGES-04**: The yearly report (and any other consumer) stops using `COALESCE(book.reference_pages, MAX(book_device.pages))`; reads `book.reference_pages` directly. The fallback strategy for books that remain `NULL` after enrichment is documented and consistent across consumers.

### Retry & Matcher (RETRY)

- [ ] **RETRY-01**: User can bulk-retry all books in `enrichment_status = 'failed'` from the dashboard (single action, optional filter); each book is re-enqueued through the normal enrichment pipeline.
- [ ] **RETRY-02**: User can retry a single book from the unmatched/failed inbox UI without leaving the page; the row reflects the new status after the retry resolves.
- [x] **RETRY-03**: The OL matcher uses improved heuristics (title/author normalization, fuzzy title compare, author alias / "Last, First" handling) so that books which currently fail matching but are present in OL succeed on retry.
- [ ] **RETRY-04**: Each enrichment failure persists a structured `failure_reason` on the book row (e.g., `no_match`, `ambiguous_match`, `network`, `parse_error`); the inbox UI shows the reason next to each failed book.

### Orphan Author GC (AUTHGC)

- [ ] **AUTHGC-01**: An admin HTTP endpoint deletes `author` rows that have zero `book_author` references and returns the deleted count; protected so it cannot be triggered accidentally.
- [ ] **AUTHGC-02**: A CLI script (npm workspace script) wraps the same GC logic for ops use without requiring the HTTP server to be running.
- [ ] **AUTHGC-03**: GC is idempotent and side-effect-free when there are no orphans; running it twice in a row deletes zero rows on the second pass.

### Polish (POLISH)

- [x] **POLISH-01**: A bulk-enqueue helper accepts a list of book IDs and enqueues them all for enrichment in a single call (used by RETRY-01 and any future batch operation); replaces the per-book enqueue loop currently in use.
- [ ] **POLISH-02**: `package.json` files across all workspaces follow a single, documented version-pin convention (e.g., caret for libraries, exact for tools); the convention is recorded in `CLAUDE.md` and the repo passes a check (manual or scripted) confirming consistency.
- [ ] **POLISH-03**: The web app's largest initial JS chunks are reduced via route-level and/or vendor splitting so no single chunk exceeds an agreed threshold (target captured in plan); measured with `vite build` output.

## Future Requirements

(Items deferred during planning / scoping. Empty at milestone start.)

## Out of Scope

- **LLM-assisted matcher fallback** — RETRY-03 is heuristic-only; no `/api/ai` calls inside the matcher this milestone (consistent with v1.0 decision to keep enrichment deterministic and free).
- **Scheduled / cron-based author GC** — AUTHGC stays on-demand only this milestone; scheduling infrastructure is not in scope.
- **Author-centric UI (browseable author index, author detail pages)** — still deferred from v1.0; AUTHGC is a data-cleanup operation, not a UI feature.
- **New enrichment providers (Google Books, Goodreads, etc.)** — RETRY-03 only improves the OL matcher; no second provider integration.
- **Auto-applying matcher heuristic suggestions to historical mismatches** — RETRY-03 changes future matches; books that already matched something wrong are corrected through the existing manual-edit UI, not a bulk re-match.
- **Bundle-size budget enforcement in CI** — POLISH-03 measures and improves the bundle but does not add a CI gate; that can come in a later milestone if desired.

## Traceability

Coverage: 14/14 v1.1 requirements mapped.

| REQ-ID | Phase | Status |
|--------|-------|--------|
| REFPAGES-01 | Phase 7: Reference Pages Enrichment | Pending |
| REFPAGES-02 | Phase 7: Reference Pages Enrichment | Complete |
| REFPAGES-03 | Phase 7: Reference Pages Enrichment | Complete |
| REFPAGES-04 | Phase 7: Reference Pages Enrichment | Pending |
| POLISH-01 | Phase 8: Failure Triage & Smarter Matcher | Complete |
| RETRY-01 | Phase 8: Failure Triage & Smarter Matcher | Pending |
| RETRY-02 | Phase 8: Failure Triage & Smarter Matcher | Pending |
| RETRY-03 | Phase 8: Failure Triage & Smarter Matcher | Complete |
| RETRY-04 | Phase 8: Failure Triage & Smarter Matcher | Partial (column + classification ready in Plan 02; persist write lands in Plan 03) |
| AUTHGC-01 | Phase 9: Orphan Author GC | Pending |
| AUTHGC-02 | Phase 9: Orphan Author GC | Pending |
| AUTHGC-03 | Phase 9: Orphan Author GC | Pending |
| POLISH-02 | Phase 10: Repo Polish | Pending |
| POLISH-03 | Phase 10: Repo Polish | Pending |

---
*Last updated: 2026-04-26 — milestone v1.1 roadmap drafted (Phases 7-10)*

# Roadmap: KoInsight

## Shipped Milestones

- [x] **v1.0 — Book Metadata Enrichment + Yearly Reports** (2026-04-23 → 2026-04-26, 6 phases / 35 plans). See [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md).

## Active Milestone: v1.1 Enrichment Polish & Cleanup

**Started:** 2026-04-26
**Goal:** Pay down v1.0 carry-over debt and polish the enrichment pipeline so the dashboard runs on clean, complete data without workarounds.
**Requirements:** `.planning/REQUIREMENTS.md` (14 requirements across REFPAGES / RETRY / AUTHGC / POLISH)

### Phases

**Phase Numbering:** Continuing from v1.0 (which ended at Phase 6). v1.1 starts at Phase 7.

- [ ] **Phase 7: Reference Pages Enrichment** - Enrichment writes `book.reference_pages` from OL Edition data, manual stickiness via `reference_pages_source`, backfill, and drop the yearly-report COALESCE workaround.
- [x] **Phase 8: Failure Triage & Smarter Matcher** (complete 2026-04-27) - Bulk-enqueue helper, smarter OL matcher, structured `failure_reason` on each failure, and per-book + bulk retry from the unmatched inbox UI.
- [ ] **Phase 9: Orphan Author GC** - Admin HTTP endpoint + CLI script that delete authors with zero `book_author` references, idempotent and protected against accidental triggering.
- [ ] **Phase 10: Repo Polish** - Documented version-pin convention across all workspaces and web bundle splitting so no initial chunk exceeds the agreed threshold.

### Phase Details

#### Phase 7: Reference Pages Enrichment
**Goal**: The enrichment pipeline populates `book.reference_pages` directly from OpenLibrary, with manual stickiness, so the yearly report (and any other consumer) reads `book.reference_pages` instead of falling back to `MAX(book_device.pages)`.
**Depends on**: Nothing in v1.1 (builds on v1.0 enrichment service + provenance pattern)
**Requirements**: REFPAGES-01, REFPAGES-02, REFPAGES-03, REFPAGES-04
**Success Criteria** (what must be TRUE):
  1. After a fresh enrichment run, a book whose resolved OL Edition exposes `number_of_pages` has `book.reference_pages` populated and `book.reference_pages_source = 'openlibrary'`; books without OL page data leave the field NULL.
  2. A book with `reference_pages_source = 'manual'` retains its manual page count after re-enrichment, even when OL returns a different `number_of_pages` (provenance respected, parity with v1.0 stickiness rules).
  3. A one-time backfill task populates `reference_pages` for already-enriched books from cached OL data without re-running the full enrichment pipeline; running the backfill twice is a no-op.
  4. The yearly report query reads `book.reference_pages` directly (no `COALESCE(book.reference_pages, MAX(book_device.pages))`), and the documented fallback strategy for books still NULL after enrichment is applied consistently across consumers.
**Plans:** 6 plans
- [x] 07-01-PLAN.md — Schema migration for reference_pages_source + DbBook type extension + Wave 0 fixtures
- [x] 07-02-PLAN.md — SearchDocSchema cover_edition_key fix + getWorkEditions OL client method
- [x] 07-03-PLAN.md — Worker Edition fetch + applier D-06 provenance block
- [x] 07-04-PLAN.md — PUT /reference_pages provenance rewrite + one-shot backfill script
- [x] 07-05-PLAN.md — Drop COALESCE in reports + drop device fallback in books-service
- [x] 07-06-PLAN.md — Web UI Page-count-missing affordance + CLAUDE.md doc note

#### Phase 8: Failure Triage & Smarter Matcher
**Goal**: Users can triage and recover the 8+ books currently stuck in `enrichment_status='failed'` from the dashboard, the OL matcher succeeds on retry for books that are actually present in OL, and every failure carries a structured reason so users know whether to retry, edit, or wait.
**Depends on**: Phase 7 (so reference_pages writes participate in retried enrichments)
**Requirements**: POLISH-01, RETRY-01, RETRY-02, RETRY-03, RETRY-04
**Success Criteria** (what must be TRUE):
  1. A bulk-enqueue helper accepts a list of book IDs and enqueues them through the normal enrichment pipeline in a single call; the per-book enqueue loop currently in use is replaced and RETRY-01 consumes this helper.
  2. From the unmatched/failed inbox, the user can trigger "Retry all failed" (single action, optional filter) and "Retry this book" (per row); both actions re-enqueue through the normal pipeline and the row reflects the new status after the retry resolves without a page reload.
  3. A book that previously failed with a title/author normalization or "Last, First" alias mismatch (covered by a fixture suite) succeeds matching on retry once the improved heuristics ship; matcher unit tests document the new normalization, fuzzy-compare, and alias-handling rules.
  4. Every enrichment failure persists a structured `failure_reason` (`no_match`, `ambiguous_match`, `network`, `parse_error`, etc.) on the book row, and the inbox UI displays the reason next to each failed book so users can distinguish "needs manual edit" from "transient network error worth retrying".
**UI hint**: yes
**Plans:** 4 plans
- [x] 08-01-wave0-tests-types-PLAN.md — Wave 0 RED tests + FailureReason type in @koinsight/common + stuck-books fixtures
- [x] 08-02-server-core-PLAN.md — Migration + classifyFailure refactor + matcher fuzzy/ambiguous + enqueueMany
- [x] 08-03-server-wiring-PLAN.md — markTerminalFailure failure_reason write + worker call sites + POST /retry-all + repo SELECT
- [x] 08-04-web-ui-PLAN.md — FailureReasonBadge + RetryAllButton + inbox row integration + ReEnrichButton list-key mutate

#### Phase 9: Orphan Author GC
**Goal**: Authors that no longer back any book can be removed on demand via either an HTTP endpoint or a CLI script, the operation is idempotent, and it is protected against accidental triggering.
**Depends on**: Nothing in v1.1 (orthogonal to enrichment changes)
**Requirements**: AUTHGC-01, AUTHGC-02, AUTHGC-03
**Success Criteria** (what must be TRUE):
  1. An admin HTTP endpoint deletes every `author` row that has zero `book_author` references and returns the deleted count; the endpoint is protected so it cannot be triggered by an unauthenticated request or a stray browser navigation.
  2. An npm workspace script wraps the same GC logic and runs successfully against the SQLite database without requiring the HTTP server to be running, deleting the same set of rows the HTTP endpoint would.
  3. Running GC twice in a row deletes some N orphans on the first run and exactly zero on the second run (idempotency + side-effect-free behavior verifiable in an integration test).
**Plans**: TBD

#### Phase 10: Repo Polish
**Goal**: Workspace `package.json` files follow one documented version-pin convention, and the web app's initial JS payload is split so no single chunk exceeds the agreed threshold.
**Depends on**: Nothing in v1.1 (pure repo + build chores)
**Requirements**: POLISH-02, POLISH-03
**Success Criteria** (what must be TRUE):
  1. Every workspace `package.json` follows a single, documented version-pin convention (e.g., caret for libraries, exact for tools); the convention is recorded in `CLAUDE.md` and a manual or scripted check confirms consistency across all workspaces.
  2. `vite build` output shows the largest initial chunk is below the agreed threshold (target captured in plan), achieved via route-level and/or vendor splitting; no production route regresses to a larger initial payload than today.
**UI hint**: yes
**Plans**: TBD

### Parallelization

`config.parallelization = true`. Phase 7 should land first because Phase 8 retries should benefit from the new `reference_pages` writer. Phases 9 and 10 are orthogonal to Phases 7 and 8 and to each other; they can be developed in parallel with (or after) Phase 8.

- **Wave 1 (sequential):** Phase 7 — reference pages writer + backfill + drop COALESCE.
- **Wave 2 (sequential after Wave 1):** Phase 8 — bulk-enqueue helper, matcher, retry UI, failure_reason. Retried books exercise the Phase 7 writer.
- **Wave 3 (parallel, can begin alongside Wave 2):** Phase 9 (author GC) and Phase 10 (repo polish), both isolated from the enrichment slice.

### Progress

**Execution Order:** 7 → 8, with 9 and 10 eligible to run in parallel after Phase 7.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 7. Reference Pages Enrichment | 6/6 | Complete | 2026-04-27 |
| 8. Failure Triage & Smarter Matcher | 4/4 | Complete | 2026-04-27 |
| 9. Orphan Author GC | 0/TBD | Not started | - |
| 10. Repo Polish | 0/TBD | Not started | - |

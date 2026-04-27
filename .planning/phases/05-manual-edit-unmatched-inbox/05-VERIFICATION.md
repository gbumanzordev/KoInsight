---
phase: 05-manual-edit-unmatched-inbox
verified: 2026-04-25T00:30:17Z
status: human_needed
score: 8/10 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Edit modal flow end-to-end on book detail page"
    expected: "Modal opens, provenance badges render correctly, authors row editor works (add/remove/reorder with OL-key confirm), Save fires PATCH and reflects updated data, Cancel discards silently, Re-enrich button disables while polling and fires terminal toast"
    why_human: "Web workspace has no RTL/Vitest browser test infra; human-verify checkpoints in Plans 04 and 05 were auto-approved in auto-mode"
  - test: "Settings page + Unmatched inbox + Navbar Indicator"
    expected: "Navbar shows red badge with failed count (hidden when 0), /settings redirects to /settings/unmatched, four stat cards match SQL counts, failed books list paginate, Re-enrich row action fires toast, single 5s poll feeds Navbar + Settings page"
    why_human: "UI behavior (SWR dedupe, Indicator hide-at-zero, pagination cycling) cannot be verified without a running browser; auto-mode auto-approved the Plan 05 checkpoint"
---

# Phase 5: Manual Edit + Unmatched Inbox Verification Report

**Phase Goal:** Users can correct any wrong or missing metadata from the web UI, find books OpenLibrary failed on, and re-trigger enrichment per book; and every manual change is sticky against future re-enrichment.
**Verified:** 2026-04-25T00:30:17Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `PATCH /api/books/:md5/metadata` with a Zod-valid body persists fields and stamps `*_source='manual'`, returns updated book; invalid body returns 400 | ✓ VERIFIED | `books-router.ts:116` safeParse; `books-service.ts:164,180,185,190` stamp; 9 supertest cases in `books-router.test.ts:116-249` |
| 2 | After a manual edit, `POST /api/books/:md5/re-enrich` runs enrichment and manually-set fields remain unchanged | ✓ VERIFIED | `manual-edit-stickiness.test.ts` (4 cases) proves applyEnrichment does not overwrite `*_source='manual'` fields; `re-enrich-idempotency.test.ts` (2 cases) proves double-submit idempotency |
| 3 | From book detail, user opens edit form, sees provenance chip per field, edits authors/genres/year/language, saves, sees changes reflected | ? HUMAN NEEDED | Components exist and build; form wired to `metadataPatchSchema` + PATCH; ProvenanceBadge null-renders for null source; but end-to-end UX flow requires human verification (auto-mode auto-approved Plan 04 checkpoint) |
| 4 | "Unmatched books" view linked from nav with count badge lists `enrichment_status='failed'` books, supports per-book Edit + Re-enrich, count drops as resolved | ? HUMAN NEEDED | All components exist and build (Navbar Indicator with `disabled={!status?.failed}`, UnmatchedBooksSection with ReEnrichButton + getBookPath); but live behavior requires human verification (auto-mode auto-approved Plan 05 checkpoint) |
| 5 | `GET /api/enrichment/status` returns aggregate counts matching direct SQL count of `book.enrichment_status` | ✓ VERIFIED | `status-router.test.ts` case 2 runs parallel raw SQL cross-check; 3 test cases total; endpoint live at `/api/enrichment` (`app.ts`) |
| 6 | Zod validation at PATCH boundary: `.strict()` rejects unknown keys, `.refine` rejects empty body, field-level constraints enforced | ✓ VERIFIED | `books-edit-api.test.ts` (17 cases) + `books-router.test.ts` "400: invalid publication_year", "400: empty body", "400: unknown field strict mode" |
| 7 | `GET /api/enrichment/unmatched` returns paginated `enrichment_status='failed'` books sorted by last-failed date with correct offset/limit controls | ✓ VERIFIED | `unmatched-router.test.ts` (8 cases) covers empty list, sort order, null-ts fallback to title, offset/limit, 400 on invalid params, filter exclusion of non-failed statuses |
| 8 | Book detail shows enrichment status and a Re-enrich button that calls `POST /re-enrich` | ✓ VERIFIED (partial) | `book-page.tsx` has Edit metadata + ReEnrichButton wired; `re-enrich-button.tsx` POSTs via `reEnrichBook`, disables while open; SWR polls every 2s on open status; but live rendering requires human smoke |
| 9 | `enrichment_status` index migration is structure-only (no network, no data operations) | ✓ VERIFIED | `20260425000000_book_enrichment_status_index.ts`: grep for `fetch(/axios/https://` returns empty; content is one `alterTable` with `table.index(...)` up and `table.dropIndex(...)` down |
| 10 | SWR status-counts key is shared between Navbar and Settings page so a single poll feeds both surfaces | ✓ VERIFIED | `api/enrichment.ts:STATUS_KEY = 'enrichment/status'` (plain string); Navbar imports same `useEnrichmentStatus()`; SWR dedupes on matching key |

**Score:** 8/10 truths verified (2 require human verification)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/common/types/books-edit-api.ts` | `metadataPatchSchema`, `MetadataPatch`, `AuthorEdit` types | ✓ VERIFIED | Exports `metadataPatchSchema` (strict, refine, field constraints), `authorEditSchema`, both inferred types |
| `apps/server/src/enrichment/author-upsert.ts` | `upsertAuthor(trx, author, source)` with `source` param | ✓ VERIFIED | Exports `upsertAuthor`; `source` defaults to `'openlibrary'`, preserving Phase 4 call sites |
| `apps/server/src/books/books-service.ts` | `applyManualEdit` transactional writer | ✓ VERIFIED | `db.transaction` wraps all writes; stamps `authors_source`, `genres_source`, `publication_year_source`, `original_language_source` to `'manual'` for each present field |
| `apps/server/src/books/books-router.ts` | PATCH + POST routes | ✓ VERIFIED | `router.patch('/:bookId/metadata'` line 115; `router.post('/:bookId/re-enrich'` in scope; `metadataPatchSchema.safeParse` at boundary |
| `apps/server/src/db/migrations/20260425000000_book_enrichment_status_index.ts` | Non-unique index on `book.enrichment_status` | ✓ VERIFIED | `idx_book_enrichment_status` appears in both `up` and `down`; structure-only |
| `apps/server/src/enrichment/router.ts` | `enrichmentRouter` with GET /unmatched + GET /status | ✓ VERIFIED | Both routes present; `safeParse` for query params; mounted at `/api/enrichment` in `app.ts` |
| `apps/server/src/enrichment/unmatched-repository.ts` | `getEnrichmentStatusCounts` + `getUnmatchedBooks` | ✓ VERIFIED | Real DB queries; LEFT JOIN to `enrichment_job` on `ej.status='failed'`; independent COUNT for total; zero-defaulted 5-bucket object |
| `apps/web/src/components/provenance-badge/provenance-badge.tsx` | `ProvenanceBadge` with null render for missing source | ✓ VERIFIED | Returns `null` when source is null/undefined; yellow badge for `'manual'`, blue for `'openlibrary'` |
| `apps/web/src/components/re-enrich-button/re-enrich-button.tsx` | `ReEnrichButton` with disabled state + toast | ✓ VERIFIED | `disabled={isOpen || isSubmitting}`; Tooltip "Already running"; "Re-enriching..." toast at `top-center` |
| `apps/web/src/pages/book-page/book-metadata-form.tsx` | Form with `zod4Resolver(metadataPatchSchema)` + 4 ProvenanceBadge | ✓ VERIFIED | `zod4Resolver(metadataPatchSchema)` at line 1 of useForm; 5 ProvenanceBadge call sites (1 import + 4 renders) |
| `apps/web/src/pages/book-page/book-metadata-edit-modal.tsx` | Modal + form composition + handleSubmit | ✓ VERIFIED | `Modal size="lg" title="Edit metadata"` ; handleSubmit calls `patchBookMetadata` + `mutate` + `notifications.show` |
| `apps/web/src/pages/book-page/author-row-editor.tsx` | Per-author row with OL-key remove confirm | ✓ VERIFIED | `modals.openConfirmModal` with title "Remove author?" present; `aria-label="Unlink OpenLibrary key"` present |
| `apps/web/src/api/enrichment.ts` | `useEnrichmentStatus` + `useUnmatchedBooks` with shared key | ✓ VERIFIED | `STATUS_KEY = 'enrichment/status'`; `refreshInterval: 5000` on both hooks |
| `apps/web/src/pages/settings-page/settings-layout.tsx` | Two-pane layout with NavLink rail + `<Outlet />` | ✓ VERIFIED | `<Outlet />` imported and rendered; `data-active` styling present |
| `apps/web/src/pages/settings-page/unmatched-books-section.tsx` | Paginated list + stat cards + row actions | ✓ VERIFIED | `useUnmatchedBooks`, `EnrichmentStatusCards`, `Pagination`, `ReEnrichButton`, `getBookPath` all wired; locked UI-SPEC copy present |
| `apps/web/src/pages/settings-page/enrichment-status-cards.tsx` | Four stat cards | ✓ VERIFIED | 4 CARDS constant (pending/running/enriched/failed) rendering `SimpleGrid` of `Paper` cards |
| `apps/web/src/constants/iso-3166.ts` | 200+ ISO 3166-1 alpha-2 entries | ✓ VERIFIED | 261 lines (249 entries + overhead) |
| `apps/web/src/constants/iso-639.ts` | 180+ ISO 639-1 entries | ✓ VERIFIED | 194 lines (184 entries + overhead) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `books-router.ts` | `@koinsight/common` metadataPatchSchema | `import { metadataPatchSchema } from '@koinsight/common/dist/types/books-edit-api.js'` | ✓ WIRED | `books-router.ts:1`; `metadataPatchSchema.safeParse(req.body)` at line 116 |
| `books-router.ts` | `books-service.ts` applyManualEdit | `import { applyManualEdit, BooksService }` | ✓ WIRED | `books-router.ts:6`; `await applyManualEdit(book, parsed.data)` at line 123 |
| `books-service.ts` | `author-upsert.ts` | `import { upsertAuthor }` from `../enrichment/author-upsert` | ✓ WIRED | Confirmed by grep; `upsertAuthor(trx, ...)` called in author loop |
| `applier.ts` | `author-upsert.ts` | `from './author-upsert'` | ✓ WIRED | `grep -c "from './author-upsert'"` -> 1; original private function removed (grep -> 0) |
| `app.ts` | `enrichment/router.ts` | `app.use('/api/enrichment', enrichmentRouter)` | ✓ WIRED | `grep -c "app.use('/api/enrichment'"` -> 1; `grep -c enrichmentRouter` -> 2 |
| `enrichment/router.ts` | `unmatched-repository.ts` | `import { getEnrichmentStatusCounts, getUnmatchedBooks }` | ✓ WIRED | `router.ts:3`; both called in route handlers |
| `book-metadata-form.tsx` | `@koinsight/common` metadataPatchSchema | `import { metadataPatchSchema, MetadataPatch } from '@koinsight/common/types'` | ✓ WIRED | `zod4Resolver(metadataPatchSchema)` in useForm; `CANONICAL_GENRES` imported and used in MultiSelect |
| `book-page.tsx` | `book-metadata-edit-modal.tsx` + `re-enrich-button.tsx` | `BookMetadataEditModal` + `ReEnrichButton` in JSX | ✓ WIRED | `grep -c "Edit metadata" book-page.tsx` -> 2 |
| `navbar.tsx` | `api/enrichment.ts` useEnrichmentStatus | `useEnrichmentStatus()` -> `Indicator label={status?.failed} disabled={!status?.failed}` | ✓ WIRED | Indicator present; `disabled={!status?.failed}` for Pitfall-7 hide-at-zero |
| `app.tsx` | `settings-layout.tsx` | nested Route `<SettingsLayout />` + index Navigate | ✓ WIRED | `grep -c SettingsLayout` -> 2; `Navigate to="unmatched"` index redirect present |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `unmatched-books-section.tsx` | `data` (UnmatchedBooksResponse) | `useUnmatchedBooks` -> `GET /api/enrichment/unmatched` -> `getUnmatchedBooks(offset, limit)` | DB LEFT JOIN query on `book + enrichment_job` with WHERE `enrichment_status='failed'` | ✓ FLOWING |
| `enrichment-status-cards.tsx` | `data` (EnrichmentStatusCounts) | `useEnrichmentStatus` -> `GET /api/enrichment/status` -> `getEnrichmentStatusCounts()` | DB GROUP BY query on `book.enrichment_status` | ✓ FLOWING |
| `book-metadata-form.tsx` | `book` (BookWithData) | Prop from `BookMetadataEditModal` <- `book-page.tsx` <- `useBookWithData(id)` SWR | Server PATCH returns fresh `BooksService.withData(...)` reload | ✓ FLOWING |
| `navbar.tsx` Indicator | `status?.failed` | `useEnrichmentStatus()` shared key `'enrichment/status'` | Same DB query as status cards; deduplicated by SWR | ✓ FLOWING |

### Behavioral Spot-Checks

Step 7b: SKIPPED for interactive UI behaviors (no running server). Server-side routes are covered by automated tests.

| Behavior | Evidence | Status |
|----------|----------|--------|
| PATCH /api/books/:id/metadata returns 200 + stamps `*_source='manual'` | 9 supertest cases in `books-router.test.ts:116-249` (green per Plan 01 summary: 402 passing) | ✓ PASS |
| POST /api/books/:id/re-enrich returns 202 + is idempotent | 4 supertest + 2 idempotency tests (green per Plan 02 summary: 407 passing) | ✓ PASS |
| GET /api/enrichment/unmatched paginates failed books | 8 supertest cases (green per Plan 03 summary: 412 passing) | ✓ PASS |
| GET /api/enrichment/status returns 5-bucket counters matching SQL | 3 cases including SQL cross-check (green per Plan 03 summary) | ✓ PASS |
| Manual-edit stickiness survives `applyEnrichment` run | `manual-edit-stickiness.test.ts` 4 cases (green per Plan 01 summary) | ✓ PASS |
| UI edit modal flow, provenance badges, polling | Cannot test without running browser | ? HUMAN NEEDED |
| Settings nav Indicator shows/hides, single poll, pagination | Cannot test without running browser | ? HUMAN NEEDED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| EDIT-01 | 05-01 | `PATCH /api/books/:md5/metadata` accepts Zod-validated body (authors, genres, publication_year, original_language) | ✓ SATISFIED | `books-router.ts` route + `metadataPatchSchema.safeParse`; 9 supertest cases |
| EDIT-02 | 05-01 | Every field changed via manual edit has its `*_source='manual'`, locking it against future enrichment | ✓ SATISFIED | `books-service.ts:164,180,185,190`; `manual-edit-stickiness.test.ts` proves lock survives `applyEnrichment` |
| EDIT-03 | 05-02 | `POST /api/books/:md5/re-enrich` re-runs enrichment while honoring `*_source='manual'` locks | ✓ SATISFIED | Route wired to `enrichmentService.enqueue`; stickiness already enforced by Phase 4 applier; idempotency proven |
| EDIT-04 | 05-03 | `GET /api/enrichment/unmatched` returns paginated `enrichment_status='failed'` books | ✓ SATISFIED | `unmatched-repository.ts` + `router.ts`; 8 integration tests passing |
| EDIT-05 | 05-03 | `GET /api/enrichment/status` returns aggregate counters (pending/running/enriched/failed) | ✓ SATISFIED | `unmatched-repository.ts` `getEnrichmentStatusCounts()`; SQL cross-check test |
| UI-01 | 05-04 | Edit metadata button opens Mantine form with all fields + per-author nationality Select | ✓ SATISFIED (build only) | `book-metadata-form.tsx`, `author-row-editor.tsx` exist; `npm --workspace=web run build` passes; live UX deferred to human |
| UI-02 | 05-04 | Edit form shows provenance badge next to each field | ✓ SATISFIED (build only) | 4 `ProvenanceBadge` render sites in `book-metadata-form.tsx`; null render for missing source verified |
| UI-03 | 05-04 | Save calls PATCH; success toast; SWR mutates; cancel discards; Zod errors inline | ✓ SATISFIED (build only) | `BookMetadataEditModal.handleSubmit`; `notifications.show`; `mutate` call; Modal `onClose`; live UX deferred |
| UI-04 | 05-05 | Unmatched books view with nav count badge, per-book Edit + Re-enrich, count drops on resolve | ✓ SATISFIED (build only) | Navbar Indicator + `disabled={!status?.failed}`; `UnmatchedBooksSection` with `ReEnrichButton` + `getBookPath`; live UX deferred |
| UI-05 | 05-04 | Book detail shows enrichment status and manual Re-enrich button | ✓ SATISFIED (build only) | `ReEnrichButton` in `book-page.tsx`; conditional 2s SWR polling on `useBookWithData`; terminal toast effect |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | - | No TODO/FIXME/placeholder/stub patterns in new files | - | All new server files have real DB queries; all new UI files render real data via SWR hooks |

### Human Verification Required

#### 1. Book detail: Edit metadata flow

**Test:** Start `npm run dev`. Navigate to any book detail page. Click "Edit metadata".
**Expected:** Modal opens (size lg, title "Edit metadata"). Each field label shows a ProvenanceBadge: yellow "manual" for `*_source='manual'`, blue "OpenLibrary" for `'openlibrary'`, no badge for `null`. Edit publication year to 1953, save. Green toast "Metadata saved" fires. Modal closes. Re-open: year = 1953, badge is now yellow "manual". Enter invalid year (999): inline Zod error appears; no toast. Cancel while dirty: modal closes silently (no confirm). Re-enrich button: fires "Re-enriching..." toast; disables while pending/running; fires terminal toast on completion. DevTools: one GET `/books/:id` every 2s while open, 0 when terminal.
**Why human:** Web workspace has no RTL/Vitest browser test infrastructure. Auto-mode auto-approved the Plan 04 human-verify checkpoint. The underlying server contracts (PATCH, POST /re-enrich) are covered by automated tests in Plans 01 and 02.

#### 2. Settings page + Unmatched inbox

**Test:** Seed: `sqlite3 data/dev.db "UPDATE book SET enrichment_status='failed' WHERE id IN (1,2,3);"`. Reload the app.
**Expected:** Navbar "Settings" shows red badge with "3". Navigate to `/settings` -> redirects to `/settings/unmatched`. Side rail shows "Unmatched books" active (violet background). Four stat cards (Pending/Running/Enriched/Failed) match SQL counts. List shows 3 rows each with title + authors + last_error + "Edit metadata" + "Re-enrich". Re-enrich fires toast; badge count decrements as books resolve; badge disappears at 0. DevTools: only ONE GET to `/api/enrichment/status` every 5s even though both Navbar and Settings page subscribe.
**Why human:** SWR key deduplication, Indicator hide-at-zero, live polling cadence, and pagination cycling are observable only in a running browser. Auto-mode auto-approved the Plan 05 human-verify checkpoint.

### Known Gaps and Caveats

**No blocking gaps found.** All server-side requirements (EDIT-01 through EDIT-05) are implemented with automated test coverage. All web UI requirements (UI-01 through UI-05) compile cleanly and components are correctly wired; live UX behavior awaits human verification.

**Environment caveat:** The Plans 01-03 summaries report full server test suites passing (402, 407, 412 cases respectively) in executor worktree contexts. The phase context notes a local Node v25 + better-sqlite3 prebuild mismatch that may block running `npm --workspace=server test` directly in the main tree without first running `npm rebuild better-sqlite3`. This does not affect code correctness; the tests themselves are valid and passed in the worktrees where the plans executed.

**Web UI test coverage gap (by design):** The web workspace has no React Testing Library / Vitest browser infrastructure. Plans 04 and 05 explicitly document this as intentional (deferred scope); the human-verify checkpoints serve as the verification floor for UI behavior. Server-side contract tests in Plans 01-03 cover every API boundary the UI consumes.

### Deferred Items

None. All Phase 5 requirements are addressed. No items deferred to Phase 6 (the next phase is the Yearly Report, which is independent of Phase 5's manual-edit surface).

---

_Verified: 2026-04-25T00:30:17Z_
_Verifier: Claude (gsd-verifier)_

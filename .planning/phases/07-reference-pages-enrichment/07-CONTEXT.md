# Phase 7: Reference Pages Enrichment - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 7 makes `book.reference_pages` a first-class enriched field. It delivers, and only delivers:

1. A schema migration adding `book.reference_pages_source` (CHECK domain `{'openlibrary', 'manual'}`, NULL allowed) following the per-field provenance pattern from Phase 1 / Phase 4 D-14.
2. An enrichment-pipeline change that fetches the OL Edition referenced by the search candidate's `cover_edition_key` and writes `book.reference_pages` + stamps `reference_pages_source = 'openlibrary'` when the Edition exposes `number_of_pages`. Honors the universal D-20 manual-source guard.
3. A one-time, idempotent npm-workspace ops script (`npm --workspace=server run backfill:reference-pages`) that targets already-enriched books, fetches one Edition each through the shared HTTP limiter, and populates `reference_pages`.
4. Updates to `apps/server/src/books/books-router.ts` (`PUT /books/:bookId/reference_pages`) so manual edits stamp `reference_pages_source = 'manual'` only when the new value differs from the current `book.reference_pages`, and PUT with `null` / `0` clears both the value and the source back to NULL.
5. Removal of the `COALESCE(book.reference_pages, MAX(book_device.pages))` workaround in `apps/server/src/reports/reports-repository.ts` AND alignment of every other consumer (`books-service.ts`, `stats-service.ts`, `apps/web/src/pages/book-page/book-page.tsx`, `apps/web/src/pages/stats-page/week-stats.tsx`) to read `book.reference_pages` directly with no device-pages fallback.

Out of scope for Phase 7 (belongs to Phase 8+ or v2):
- Bulk-retry / matcher heuristics (Phase 8 RETRY-*).
- Author GC (Phase 9).
- Repo polish (Phase 10).
- ISBN ingestion from KOReader sidecars (no `book.isbn*` column exists today; ISBN-first edition lookup deferred until that ships).
- A response-cache table for OL fetches.
- A `device` value on `reference_pages_source` (no third source for v1.1; NULL means "no data").
- A separate "Reset to enrichment" button on the web UI; clearing happens via the existing PUT with null/0.
- Adding ISBN, edition list walks, or a cover-edition-key-fallback chain inside the worker.

Phase 7 assumes and does not re-introduce:
- The Phase 1 `enrichment_status` CHECK and the per-field `*_source` columns.
- The Phase 3 `sharedHttpLimiter` (Bottleneck 1 req/s) and `openLibraryClient` singleton with `getEdition(editionKey)`.
- The Phase 4 transactional applier in `apps/server/src/enrichment/applier.ts` and its D-18 / D-20 guard pattern.
- The Phase 4 retry classification in `apps/server/src/enrichment/retry.ts`.

</domain>

<decisions>
## Implementation Decisions

### Schema (REFPAGES-03)

- **D-01:** New migration `<ts>_add_reference_pages_source_to_book.ts` adds one column to `book`:
  ```ts
  table.string('reference_pages_source').nullable().checkIn(['openlibrary', 'manual']);
  ```
  No default. NULL means "never touched by a provenance-aware write". Mirrors the four `*_source` columns added in `20260423221600_extend_book_columns.ts`. The existing `reference_pages INTEGER NULL` column stays untouched (added in `20250412065854_add_reference_pages_to_book.ts`).

- **D-02:** No retroactive backfill of `reference_pages_source`. Books that already have a non-NULL `reference_pages` (set via the legacy PUT endpoint) keep `reference_pages_source = NULL` after the migration, which means "enrichment-writable" under the universal D-20 semantics. Rationale: NULL = unknown provenance = free to overwrite is the same rule Phase 4 chose for the other four source columns; explicit migration to `'manual'` would lock data in a stale value.

### Edition selection (REFPAGES-01)

- **D-03:** The enrichment worker fetches exactly **one** OL Edition per book, using the search candidate's `cover_edition_key` field (already returned by `/search.json` — see `open-library-types.ts:16`). No ISBN-first branch (no ISBN on `book` today). No edition-list walk on miss. No `number_of_pages_median` fallback. Single call per book through the shared 1 req/s limiter.

- **D-04:** Fetch happens in `worker.ts::processJob`, after `matchWork` succeeds and before `applyEnrichment`. The Edition fetch result populates a new field `referencePages: number | null` on the `EnrichedBundle` type defined in `applier.ts`. Resolution rules:
  - `cover_edition_key` missing on the search candidate → `referencePages = null`.
  - Edition fetched but `number_of_pages` is undefined → `referencePages = null`.
  - Edition fetched and `number_of_pages` is a positive integer → `referencePages = number_of_pages`.

- **D-05:** Edition fetch errors flow through the existing D-14 retry classification in `apps/server/src/enrichment/retry.ts` unchanged. Specifically: 5xx / network / SQLITE_BUSY → retryable (consume an attempt, schedule backoff per Phase 4 D-12); 404 on `/books/{cover_edition_key}.json` → permanent (book hits `enrichment_status='failed'`).
  - **Known consequence to surface in REVIEW.md:** a permanently-broken `cover_edition_key` will fail the entire book's enrichment even though the rest of the bundle (authors, genres, year) was resolved successfully. Researcher / planner should weigh whether a future phase introduces a `partial_enriched` status; for v1.1 we accept the existing two-state model and let the unmatched inbox surface these books.

- **D-06:** Edition writes follow Phase 4 D-20 provenance rules at the column level inside `applier.ts`. Pseudocode added to the `applyEnrichment` body:
  ```ts
  if (book.reference_pages_source !== 'manual') {
    if (bundle.referencePages !== null) {
      updates.reference_pages = bundle.referencePages;
      updates.reference_pages_source = 'openlibrary';
    }
    // bundle.referencePages === null → leave reference_pages and reference_pages_source untouched
    // (do NOT clear an existing OL-sourced value just because this enrichment run got nothing).
  }
  ```
  Apply happens inside the existing `applyEnrichment` transaction (Phase 4 D-18) — no new transaction, no separate write step.

### Backfill (REFPAGES-02)

- **D-07:** Backfill is a **one-shot npm-workspace script** at `apps/server/src/enrichment/backfill-reference-pages.ts` (companion to the existing boot-time `backfill.ts`). Wired as `npm --workspace=server run backfill:reference-pages`. Runs against the shared knex instance with no HTTP server required. Idempotent: re-running selects zero rows after the first successful pass for any book that has been resolved (either populated or confirmed-no-OL-data).

- **D-08:** Backfill predicate:
  ```sql
  SELECT md5, openlibrary_work_key
  FROM book
  WHERE enrichment_status = 'enriched'
    AND reference_pages IS NULL
    AND (reference_pages_source IS NULL OR reference_pages_source <> 'manual')
    AND openlibrary_work_key IS NOT NULL
  ```
  Skips manual edits. Skips books still in queue. Skips books OL never resolved. Iterated row-by-row in Node, not a single SQL pass, so each row goes through the rate-limited HTTP fetch.

- **D-09:** For each candidate book the backfill must re-resolve the `cover_edition_key`. Two implementation options for the planner (Claude's discretion):
  - (a) Re-run `searchWork(book.title, primary_author)` and re-extract `cover_edition_key` from the top-1 hit (cheap because the matcher is deterministic and the search is cached only by OL's CDN).
  - (b) Call `/works/{openlibrary_work_key}/editions.json?limit=1` and use that edition's key.
  Either way, fetch the resulting Edition, extract `number_of_pages`, write through the same provenance-aware path as live enrichment (D-06). Two HTTP calls per book, both through the shared limiter.

- **D-10:** Failure handling inside the backfill is best-effort and **does not** flip `book.enrichment_status`. On a fetch error or a no-page-data result for a row: log a warning with `bookMd5` and continue to the next book. The script returns a summary counter (`{ scanned, populated, no_pages, errored }`) and exits 0 even if some rows errored. Re-running the script picks up where the last run left off.

- **D-11:** Idempotency invariant: running the script twice in a row writes zero rows on the second run for any book whose Edition was successfully fetched on the first run AND yielded a positive `number_of_pages`. Books that returned `no_pages` on run 1 will be re-attempted on run 2 (cheap, single HTTP call per book) — the cost of re-attempt is bounded and acceptable; persisting "we tried and got nothing" would require a new column and is out of scope.

### Manual edit endpoint (REFPAGES-03 stickiness)

- **D-12:** `PUT /books/:bookId/reference_pages` becomes provenance-aware:
  - Body `{ reference_pages: number > 0 }`: read the current `book.reference_pages` value. If the new value **differs** from the current value, write the new value AND stamp `reference_pages_source = 'manual'`. If the new value **equals** the current value, write nothing (no-op) and leave `reference_pages_source` as-is. Rationale: a user "confirming" the displayed (OL-sourced) value should not silently lock the book against future re-enrichment.
  - Body `{ reference_pages: null }` or `{ reference_pages: 0 }`: write `reference_pages = NULL` AND `reference_pages_source = NULL`. The book is now eligible for enrichment / backfill to repopulate.
  - The current 400 response when `reference_pages` is missing entirely from the body stays.

- **D-13:** Validate the body with Zod at the route boundary (project convention). Schema accepts `number().int().positive()` OR `null` OR `0`. Anything else → 400.

- **D-14:** No new endpoint, no new web UI, no separate "reset" button in v1.1. The existing book-page edit control (`apps/web/src/pages/book-page/book-page-manage/book-reference-pages.tsx`) keeps its current shape; it can already submit the value, and a follow-up pass within Phase 7 wires a "clear" action only if the planner judges it cheap (otherwise users clear via the API directly, accepted tradeoff).

### Drop COALESCE + align consumers (REFPAGES-04)

- **D-15:** All consumers read `book.reference_pages` directly. No device-pages fallback at the SQL layer, no `||` fallback in TS. NULL `reference_pages` propagates to UI as missing data; coverage banners / Unknown buckets explain it. The visibility tradeoff (books with NULL reference_pages will display 0 pages-read estimates in stats and per-book views) is accepted: data quality matters; manual edit or successful re-enrichment is the user's recourse.

- **D-16:** Concrete code changes in scope:
  - `apps/server/src/reports/reports-repository.ts:65-67` — replace `COALESCE(b.reference_pages, d.dev_p)` with `b.reference_pages` in both predicates of the ≥95%-read rule. The `MAX(book_device.pages)` CTE / join can be dropped from this query entirely if it is only used to feed the COALESCE.
  - `apps/server/src/books/books-service.ts:14` — `getEffectivePages` (or whatever the helper is named) returns `book.reference_pages` directly; remove the `Math.max(...book_device.pages)` fallback.
  - `apps/server/src/books/books-service.ts:46-65` — both branches that gate on `if (book.reference_pages)` keep working unchanged because they already short-circuit when NULL; just confirm the call sites no longer pre-compute a fallback elsewhere.
  - `apps/web/src/pages/book-page/book-page.tsx:203` — the `book?.reference_pages || …` fallback becomes `book?.reference_pages ?? null` and the UI shows a "page count missing" affordance instead of a synthetic value (planner picks the exact UI; "—" / "missing" badge / link to the manual-edit form is acceptable).
  - `apps/web/src/pages/stats-page/week-stats.tsx:64-83` — the `if (… booksByMd5[stat.book_md5]?.reference_pages)` guard already excludes NULL books from the estimate; just confirm the surrounding totals reflect the change in coverage banners (or accept that week-stats now under-counts books with no enriched / manual page count, consistent with the data-quality stance).

- **D-17:** Documented fallback strategy lands in two places: a one-line note in `CLAUDE.md` ("Reading metrics derived from `book.reference_pages`; books with NULL are excluded from completion-based predicates and surfaced as `Unknown` in coverage") and an inline comment at the top of `reports-repository.ts` replacing the existing COALESCE explanation.

### Claude's Discretion

- Migration timestamp + filename (follow `YYYYMMDDHHMMSS_<snake_case>.ts`).
- Whether the backfill script reuses `searchWork` (D-09 option a) or hits `/works/{key}/editions.json` (option b). Planner decides; both are bounded by the shared limiter.
- Logging shape inside the backfill script — structured per-book logs vs. summary line. Mirror Phase 4's `console.log` conventions; do not introduce pino in Phase 7.
- Whether to re-export an `extractReferencePages(edition)` helper from `applier.ts` or inline it. Helper is preferable for unit testability.
- Test layout for new fixtures (Edition response with `number_of_pages`, Edition without, 404 on Edition). Extend `apps/server/src/enrichment/__tests__/fixtures/` with the existing `vi.stubGlobal('fetch', …)` pattern.
- Exact UI affordance for "page count missing" on book-page.tsx (badge vs. inline "—" vs. link). Mantine idioms; consult existing pattern in unmatched inbox (Phase 5 EDIT-04).
- Whether to drop the `MAX(book_device.pages)` join from `reports-repository.ts` once unused, or keep it for a future report. Cleanup is preferred but not required.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` — Phase 7 block (Goal, Success Criteria 1..4, Requirements REFPAGES-01..04).
- `.planning/REQUIREMENTS.md` — REFPAGES-01, REFPAGES-02, REFPAGES-03, REFPAGES-04.
- `.planning/PROJECT.md` — milestone v1.1 goal; "clean, complete data without workarounds" principle; per-field `*_source` provenance pattern as a project-level decision.

### Prior phase context (locked decisions Phase 7 builds on)
- `.planning/milestones/v1.0/phases/01-schema-foundations-provenance/01-CONTEXT.md` — D-13..D-16 (provenance semantics, NULL = enrichment-writable, CHECK constraint domain).
- `.planning/milestones/v1.0/phases/04-enrichment-service-backfill/04-CONTEXT.md` — D-14 (failure classification: 5xx retryable, 404 permanent), D-18 (transactional apply), D-20 (per-field provenance guard pattern), D-12 (`ENRICHMENT_MAX_ATTEMPTS = 5`, exponential backoff).
- `.planning/milestones/v1.0/phases/06-yearly-report/06-CONTEXT.md` — D-08 (Unknown bucket never silently dropped — informs the visibility tradeoff in D-15), D-10 (no caching layer; on-demand SQL).
- `.planning/v1.0-MILESTONE-AUDIT.md` — confirmation that the COALESCE workaround in `reports-repository.ts` is a v1.0 carry-over to be paid down in v1.1.

### Existing code Phase 7 modifies (do NOT recreate)
- `apps/server/src/db/migrations/20250412065854_add_reference_pages_to_book.ts` — `book.reference_pages INTEGER NULL` column. Phase 7 does NOT alter this column; only adds the sibling `_source` column.
- `apps/server/src/db/migrations/20260423221600_extend_book_columns.ts` — pattern for adding `*_source` columns. Phase 7's new migration follows this shape.
- `apps/server/src/enrichment/worker.ts` (lines 122-185) — `processJob` is where the Edition fetch slots in between `matchWork` and `applyEnrichment`.
- `apps/server/src/enrichment/applier.ts` — `EnrichedBundle` type and `applyEnrichment` transaction; D-06 adds one column to the bundle and one guarded write inside the transaction.
- `apps/server/src/enrichment/retry.ts` — failure classifier; reused unchanged.
- `apps/server/src/enrichment/backfill.ts` — boot-time enqueue backfill; the new `backfill-reference-pages.ts` is a sibling, NOT a modification of this file.
- `apps/server/src/books/books-router.ts` (lines 90-105) — `PUT /books/:bookId/reference_pages`; D-12 + D-13 changes here.
- `apps/server/src/books/books-repository.ts:135` — `setReferencePages`; needs to also write `reference_pages_source` per D-12.
- `apps/server/src/books/books-service.ts:14, 46-65` — drop the `Math.max(...book_device.pages)` fallback per D-16.
- `apps/server/src/reports/reports-repository.ts` (lines 10, 34, 65-67) — drop COALESCE per D-16.
- `apps/web/src/pages/book-page/book-page.tsx:203` — UI fallback removal per D-16.
- `apps/web/src/pages/book-page/book-page-manage/book-reference-pages.tsx` — manual-edit form; no schema change needed but planner confirms.
- `apps/web/src/pages/stats-page/week-stats.tsx:64-83` — coverage check per D-16.
- `apps/web/src/api/books.ts:28-30` — client-side `setReferencePages`; confirm body shape stays compatible after D-12.

### OL endpoint surface Phase 7 uses
- `apps/server/src/open-library/open-library-client.ts:68` — `getEdition(editionKey)`; Phase 7 imports unchanged.
- `apps/server/src/open-library/open-library-schemas.ts:51` — `OpenLibraryEditionSchema.number_of_pages` already validated and optional.
- `apps/server/src/open-library/open-library-types.ts:16` — `cover_edition_key` on the search docs payload.

### Convention anchors
- `CLAUDE.md` — Prettier only, Zod at route boundaries, plain ASCII (no em-dashes), Node >=22, npm 10.2.4. D-17 adds the documented fallback strategy line.
- `apps/server/src/knex.ts` + `apps/server/src/knexfile.ts` — shared knex instance for migrations, queries, and the new backfill script.
- Project convention from Phase 4: ops scripts run via `npm --workspace=server run <name>` over the shared knex; no separate process pool.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`openLibraryClient.getEdition(editionKey)`** — already returns a Zod-validated `OpenLibraryEdition` with optional `number_of_pages`. Phase 7 calls this once per book in the worker and once per book in the backfill script. No client-level changes.
- **`sharedHttpLimiter`** (Phase 3) — the Bottleneck singleton. The new Edition fetch goes through it just like every other OL call; reference-equality invariant preserved.
- **`applyEnrichment` transaction** — D-06 adds one extra `updates.reference_pages` / `updates.reference_pages_source` write inside the existing transaction. No new transaction, no new repository.
- **`enrichment-job` retry pipeline + `retry.ts` classifier** — Phase 7 inherits, no new failure classes.
- **`books-repository.setReferencePages(id, pages)`** — extend to also accept / write `reference_pages_source`; do NOT introduce a parallel writer.

### Established Patterns

- **`*_source` column shape** — `string().nullable().checkIn(['openlibrary', 'manual'])`. Phase 7 follows it exactly; planner does not introduce a third value.
- **Provenance guard at application layer** — Phase 4 D-20 helper pattern. Phase 7 adds one more column but reuses the helper / inline guard style.
- **Boot-time vs. one-shot backfill** — Phase 4 D-11 chose boot-time for the enqueue backfill. Phase 7 deliberately picks one-shot (D-07) because reference-pages backfill is bounded and ops-triggered, not a steady-state safety net.
- **Vitest + `vi.stubGlobal('fetch', …)` fixtures** — extend the Phase 3 / Phase 4 pattern with Edition fixtures (with pages, without pages, 404).
- **Idempotency tests** — Phase 4 SC-3 pattern (run twice, snapshot-diff). Repeat for the worker-path Edition fetch and for the backfill script.

### Integration Points

- `apps/server/src/enrichment/worker.ts::processJob` — single new statement: `const edition = candidate.cover_edition_key ? await openLibraryClient.getEdition(candidate.cover_edition_key) : null;` (or equivalent), followed by `referencePages: edition?.number_of_pages ?? null` on the bundle.
- `apps/server/src/enrichment/applier.ts::applyEnrichment` — one extra block inside the transaction, gated on `book.reference_pages_source !== 'manual'`.
- `apps/server/src/books/books-router.ts` (PUT /books/:bookId/reference_pages) — replace the body parse with a Zod schema; route through a new repository method that handles the diff-vs-current rule and the null-clear rule.
- `apps/server/package.json` `scripts` — new `"backfill:reference-pages": "tsx src/enrichment/backfill-reference-pages.ts"` (or whichever runner the workspace uses; planner confirms).
- `apps/server/src/reports/reports-repository.ts` — drop COALESCE; possibly drop the `book_device.pages` join entirely if unused after the change.
- `apps/web/src/pages/book-page/book-page.tsx` + `book-reference-pages.tsx` — UI affordance for NULL pages; planner picks Mantine idiom.

</code_context>

<specifics>
## Specific Ideas

- The bundle field name in `EnrichedBundle` should be `referencePages` (camelCase, matching `publicationYear` and `originalLanguage` in the existing type). The DB column stays `reference_pages` snake_case.
- Edition fixtures land at `apps/server/src/enrichment/__tests__/fixtures/edition-with-pages.json`, `edition-without-pages.json`, and a 404 test path. Re-use the Phase 4 fetch-stub harness exactly.
- A specific test for D-06 idempotency: seed a book with `reference_pages = 320`, `reference_pages_source = 'openlibrary'`, run enrichment with a fixture exposing `number_of_pages = 384`. Assert the value flips to 384 and source stays `'openlibrary'`. Then run a fixture with no `number_of_pages`. Assert the value stays at 384 (do NOT clear OL-sourced data because the new run has no info).
- A specific test for D-12 manual stickiness: seed a book with `reference_pages = 320`, `reference_pages_source = 'manual'`. Run enrichment with `number_of_pages = 384`. Assert `reference_pages = 320` and source stays `'manual'`.
- A specific test for D-12 confirm-no-lock: seed a book with `reference_pages = 320`, `reference_pages_source = 'openlibrary'`. PUT `/books/:id/reference_pages { reference_pages: 320 }`. Assert source is still `'openlibrary'` (no-op write). Then PUT `{ reference_pages: 321 }`. Assert source flips to `'manual'`.
- A specific test for D-12 clear path: seed a manual edit. PUT `{ reference_pages: null }`. Assert `reference_pages = NULL` and `reference_pages_source = NULL`. Run enrichment with a fixture exposing pages. Assert the book gets re-populated.
- The "reading metrics excludes NULL" change is observable; add a regression test to `reports-repository.ts` covering a book with `reference_pages = NULL` and `book_device.pages = 300`: it should be excluded from the ≥95%-read predicate (today's COALESCE keeps it in).
- Backfill idempotency test: seed three books — (a) enriched with pages, (b) enriched no pages no Edition, (c) manual. Run backfill twice. Assert (a) is unchanged, (b) is re-attempted on run 2 (and stays NULL), (c) is never touched. Snapshot the rows at end of run 1 and run 2.

</specifics>

<deferred>
## Deferred Ideas

- **ISBN ingestion from KOReader sidecars** → would unlock ISBN-first edition selection (more authoritative). Add a column + sidecar parser in a future v1.x or v2 phase.
- **Edition list walk on miss** → call `/works/{key}/editions.json` when `cover_edition_key` is missing or has no pages. Adds paginated fetches, not justified for v1.1.
- **`number_of_pages_median` as a soft fallback** → use the search candidate's median when no Edition pages are available. Could lift coverage but blends edition-specific and aggregate data; revisit only if NULL counts after Phase 7 land high.
- **`device` as a third `reference_pages_source` value** → would let the system carry the historical device-pages fallback as data, not as a read-side workaround. Considered and rejected for v1.1: complicates the universal `*_source` CHECK domain across the codebase.
- **`partial_enriched` enrichment_status** → would let the worker apply most of the bundle and surface "edition-level data missing" without flipping the whole book to `failed`. Out of scope; the unmatched inbox is the v1.1 escape hatch.
- **Dedicated "Reset to enrichment" UI button** → optional v2 polish; clearing via PUT-with-null is acceptable for v1.1.
- **OL response cache** → suggested for the backfill but rejected (too much surface, conflicts with on-demand SQL ethos). If profiling shows the backfill is too slow over a real library, revisit as its own milestone.
- **Bundle-size / route-split impact of UI affordance changes** → deferred to Phase 10 POLISH-03.
- **Reviewed Todos (not folded)** — none surfaced for Phase 7.

</deferred>

---

*Phase: 07-reference-pages-enrichment*
*Context gathered: 2026-04-27*

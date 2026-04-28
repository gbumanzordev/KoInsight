# Phase 7: Reference Pages Enrichment - Research

**Researched:** 2026-04-27
**Domain:** Enrichment pipeline extension, provenance schema, backfill script, COALESCE removal
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- D-01: Add `reference_pages_source STRING NULL CHECK IN ('openlibrary','manual')` to `book` via migration. No default. NULL = enrichment-writable.
- D-02: No retroactive source backfill. Existing `reference_pages` with `NULL` source stays writable.
- D-03: Worker fetches exactly one OL Edition using `cover_edition_key` from the search candidate. No ISBN-first, no edition-list walk, no median fallback.
- D-04: Edition fetch in `processJob` between `matchWork` and `applyEnrichment`. New `referencePages: number | null` field on `EnrichedBundle`.
- D-05: Edition 404 = permanent failure (entire book flips to `failed`). 5xx = retryable. Accepted known consequence.
- D-06: Applier writes `reference_pages` + `reference_pages_source='openlibrary'` only when `book.reference_pages_source !== 'manual'` AND `bundle.referencePages !== null`. No-clear-on-null semantics (existing OL value survives a run that returned null).
- D-07: Backfill is a one-shot npm-workspace script at `backfill-reference-pages.ts`, not a modification of boot-time `backfill.ts`.
- D-08: Backfill predicate targets `enrichment_status='enriched' AND reference_pages IS NULL AND (reference_pages_source IS NULL OR reference_pages_source <> 'manual') AND openlibrary_work_key IS NOT NULL`.
- D-09: Cover-edition-key resolution in backfill is Claude's discretion (option a: re-run searchWork; option b: hit `/works/{key}/editions.json?limit=1`).
- D-10: Backfill is best-effort; errors do not flip `enrichment_status`. Returns summary `{ scanned, populated, no_pages, errored }`. Exits 0.
- D-11: Books with `no_pages` on run 1 are re-attempted on run 2 (acceptable; no "tried and got nothing" column).
- D-12: PUT `/books/:bookId/reference_pages` provenance rules: diff-only stamps `'manual'`; same-value is a no-op; null/0 clears both columns.
- D-13: Zod validation at route boundary. Schema: `z.number().int().positive()` OR `null` OR `0`.
- D-14: No new endpoint, no new "reset" button in v1.1.
- D-15: All consumers read `book.reference_pages` directly; NULL propagates to UI as missing data.
- D-16: Drop COALESCE in `reports-repository.ts` lines 65-67; drop `getTotalPages` device fallback in `books-service.ts:14`; align `book-page.tsx:203` and `week-stats.tsx`.
- D-17: Add one-line note to `CLAUDE.md` and inline comment at top of `reports-repository.ts`.

### Claude's Discretion

- Migration timestamp + filename.
- D-09 option a vs. b for backfill cover-edition-key resolution.
- Logging shape inside backfill script.
- Whether to extract `extractReferencePages(edition)` helper or inline it.
- Test layout for new Edition fixtures.
- Exact UI affordance for "page count missing" on book-page.tsx.
- Whether to drop the `MAX(book_device.pages)` join from `reports-repository.ts` once unused.

### Deferred Ideas (OUT OF SCOPE)

- ISBN ingestion from KOReader sidecars.
- Edition list walk on miss.
- `number_of_pages_median` as soft fallback.
- `device` as a third `reference_pages_source` value.
- `partial_enriched` enrichment_status.
- Dedicated "Reset to enrichment" UI button.
- OL response cache.
- Bundle-size / route-split impact of UI affordance changes.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REFPAGES-01 | Enrichment service populates `book.reference_pages` from OL Edition `number_of_pages` | `SearchDocSchema` must gain `cover_edition_key`; `MatcherCandidate` must gain it; `EnrichedBundle` gains `referencePages`; worker calls `getEdition` |
| REFPAGES-02 | One-time backfill populates `reference_pages` for already-enriched books | New `backfill-reference-pages.ts` sibling script with D-08 predicate; D-09 option b recommended |
| REFPAGES-03 | Schema gains `reference_pages_source`; manual stickiness enforced | Migration following `20260423221600_extend_book_columns.ts` pattern; applier D-06 block; PUT endpoint D-12 rules |
| REFPAGES-04 | Drop COALESCE; read `book.reference_pages` directly everywhere | `reports-repository.ts` lines 65-67; `books-service.ts:14`; `book-page.tsx:203`; `week-stats.tsx:64-83` |

</phase_requirements>

---

## Summary

Phase 7 is an incremental extension of the enrichment pipeline established in Phases 1, 3, and 4. The change surface is well-defined: one schema migration, one new field on `EnrichedBundle`, one additional HTTP call in the worker, a sibling backfill script, provenance-aware changes to the PUT endpoint and the applier, and COALESCE removal across two files. No new infrastructure is required.

**Critical finding:** `cover_edition_key` is present in the TypeScript `Doc` interface (`open-library-types.ts:16`) but is NOT in the Zod `SearchDocSchema`. By default Zod strips unknown keys, so `candidate.cover_edition_key` is undefined at runtime in the current pipeline. Both `SearchDocSchema` and `MatcherCandidate` must be extended with `cover_edition_key?: string` before the worker can use it. This is a one-line schema change but the planner must include it as an explicit task.

**Secondary finding:** The backfill script (D-09) needs a way to re-derive `cover_edition_key` for already-enriched books. Option b (`/works/{openlibrary_work_key}/editions.json?limit=1`) is recommended: it avoids a second OL search call and uses the authoritative work-to-editions relationship, which is more stable than replaying the fuzzy search matcher. The response is a paginated list; only the first entry's key is needed.

**Primary recommendation:** Sequence as five waves: (1) schema migration, (2) `SearchDocSchema` + `MatcherCandidate` + `EnrichedBundle` + applier + worker, (3) backfill script, (4) PUT endpoint D-12/D-13 + repository, (5) COALESCE removal + UI affordance. Tests are written alongside each wave using the established `vi.stubGlobal` / `vi.spyOn` harness.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `reference_pages_source` schema column | Database / Storage | -- | Pure DDL; no runtime behavior |
| Edition fetch (OL `/books/{key}.json`) | API / Backend | -- | HTTP + rate limiter live server-side; client never calls OL directly |
| `EnrichedBundle.referencePages` population | API / Backend | -- | Computed in worker during enrichment run |
| Applier provenance guard | API / Backend | -- | Transactional DB write with column-level guard |
| Backfill script | API / Backend (CLI) | -- | Node script over shared knex; no HTTP server |
| PUT `/books/:bookId/reference_pages` diff rule | API / Backend | -- | Route handler + repository; Zod validation at boundary |
| COALESCE removal in reports SQL | API / Backend | -- | `reports-repository.ts` raw SQL; consumer is the reports service |
| `getTotalPages` device fallback removal | API / Backend | -- | `books-service.ts` helper; consumed by both `getAllWithData` and `withData` |
| Web UI "page count missing" affordance | Browser / Client | -- | React component in `book-page.tsx`; Mantine Badge or Text |
| `week-stats.tsx` NULL guard alignment | Browser / Client | -- | Already guards via `?.reference_pages` truthy check; needs review |

---

## Standard Stack

No new libraries are required. Phase 7 uses only what is already installed.

### Existing Infrastructure Reused

| Asset | Location | Phase 7 Usage |
|-------|----------|---------------|
| `openLibraryClient.getEdition(key)` | `open-library-client.ts:68` | Called once per book in worker and once per book in backfill |
| `sharedHttpLimiter` (Bottleneck, 1 req/s) | `enrichment/http/rate-limiter.ts` | All Edition fetches go through it |
| `applyEnrichment` transaction | `applier.ts:35` | D-06 block added inside existing transaction |
| `EditionSchema.number_of_pages` | `open-library-schemas.ts:51` | Already `z.number().int().optional()`; no schema change needed |
| `db` knex singleton | `knex.ts` | Backfill script imports it directly |
| Vitest + `vi.stubGlobal('fetch', ...)` harness | `__tests__/phase-04-integration.test.ts` | Extended with three new Edition fixture JSONs |

### Version Verification

All dependencies are already installed at the versions pinned in `apps/server/package.json`:
- `zod`: 4.3.5 [VERIFIED: package.json]
- `knex`: 3.1.0 [VERIFIED: package.json]
- `tsx`: 4.21.0 [VERIFIED: package.json] (used as the backfill runner)
- `vitest`: 4.0.16 [VERIFIED: package.json]
- `better-sqlite3`: 12.6.0 [VERIFIED: package.json]

---

## Architecture Patterns

### System Architecture Diagram

```
PUT /books/:id/reference_pages
       |
       v
   Zod schema (D-13)
   diff-vs-current rule (D-12)
       |
       v
   BooksRepository.setReferencePages(id, pages, source)
       |
       v
   book.reference_pages + book.reference_pages_source

enrichmentService.enqueue(md5)
       |
       v
   worker.processJob(knex, job)
       |-- openLibraryClient.searchWork()         [rate-limited]
       |-- matchWork() -> candidate
       |-- cover_edition_key present?
       |     yes -> openLibraryClient.getEdition() [rate-limited]
       |            extract number_of_pages
       |     no  -> referencePages = null
       |
       v
   EnrichedBundle { workKey, publicationYear, ..., referencePages }
       |
       v
   applyEnrichment(knex, bookMd5, jobId, bundle)  [transaction]
       |-- book.reference_pages_source !== 'manual' AND bundle.referencePages !== null?
       |     yes -> UPDATE book SET reference_pages = N, reference_pages_source = 'openlibrary'
       |     no  -> skip (manual protected or no data)

npm run backfill:reference-pages
       |
       v
   SELECT enriched books with NULL reference_pages (D-08)
       |
       for each book:
       |-- GET /works/{openlibrary_work_key}/editions.json?limit=1  [rate-limited]
       |-- extract cover_edition_key from first entry
       |-- GET /books/{cover_edition_key}.json                       [rate-limited]
       |-- extract number_of_pages
       |-- provenance-aware write (D-06 rules)
       |
       v
   summary { scanned, populated, no_pages, errored }

GET /api/reports/:year
       |
       v
   reports-repository.getBooksReadInYear()
       |-- no COALESCE; uses b.reference_pages directly
       |-- books with NULL reference_pages excluded from >=95% predicate
```

### Recommended File Touch List

```
apps/server/src/
  db/migrations/<ts>_add_reference_pages_source_to_book.ts  [NEW]
  open-library/open-library-schemas.ts                       [EXTEND SearchDocSchema]
  enrichment/matcher.ts                                      [EXTEND MatcherCandidate]
  enrichment/applier.ts                                      [EXTEND EnrichedBundle + D-06 block]
  enrichment/worker.ts                                       [Edition fetch in processJob]
  enrichment/backfill-reference-pages.ts                     [NEW]
  books/books-repository.ts                                  [EXTEND setReferencePages]
  books/books-router.ts                                      [D-12/D-13 PUT rewrite]
  books/books-service.ts                                     [Remove device fallback at line 14]
  reports/reports-repository.ts                              [Drop COALESCE lines 65-67]
  enrichment/__tests__/fixtures/edition-with-pages.json      [NEW]
  enrichment/__tests__/fixtures/edition-without-pages.json   [NEW]
  enrichment/__tests__/phase-07-*.test.ts                    [NEW test files]
apps/web/src/
  pages/book-page/book-page.tsx                              [line 203 fallback removal]
  pages/stats-page/week-stats.tsx                            [lines 64-83 guard review]
packages/common/types/
  book.ts                                                    [Add reference_pages_source]
CLAUDE.md                                                    [D-17 one-liner]
```

---

## Critical Finding: SearchDocSchema Missing cover_edition_key

**This is the most important technical finding for the planner.**

`cover_edition_key` appears in the TypeScript `Doc` interface (`open-library-types.ts:16`) but is absent from the Zod `SearchDocSchema` (`open-library-schemas.ts:5-13`). Zod strips unknown keys by default (`z.object()` without `.passthrough()`). Therefore, after `typedFetch` runs `schema.parse(body)`, the returned `OpenLibrarySearchDoc` objects have no `cover_edition_key` property, even when OL returns one.

The `matchWork` function takes `MatcherCandidate[]` (`matcher.ts:12-14`), which also lacks `cover_edition_key`. Even if `cover_edition_key` were preserved via a Zod passthrough, the matcher return type would not carry it.

**Required code changes (both are part of REFPAGES-01):**

1. `SearchDocSchema` gains `cover_edition_key: z.string().optional()`. This is a non-breaking additive change to the schema.
2. `MatcherCandidate` gains `cover_edition_key?: string`. This is a non-breaking additive change.

After these changes, `candidate.cover_edition_key` is accessible in `processJob` as intended by D-03/D-04.

**Also required:** The `search-ender.json` fixture used in integration tests does not include `cover_edition_key`. A new test fixture `search-ender-with-edition-key.json` (or inline override in `buildFetchMock`) is needed for tests that exercise the edition fetch path. The existing `edition-ender.json` fixture already includes `number_of_pages: 352` so it serves as the "edition with pages" fixture; a second fixture without `number_of_pages` is needed for the null-bundle path.

---

## Critical Finding: `@koinsight/common` Book Type

`packages/common/types/book.ts` defines `Book` as `DbBook & { soft_deleted: boolean; reference_pages: number | null }`. The `DbBook` interface holds all the `*_source` fields. Phase 7 adds `reference_pages_source`, which must be added to `DbBook` in `packages/common/types/book.ts`. This propagates the type to both the server (`BooksRepository`, `BooksService`) and the web (`book-page.tsx` can then read `book.reference_pages_source` to decide the UI affordance).

The `FieldSource` type (`'openlibrary' | 'manual' | null`) already exists in `packages/common/types/author.ts` and is imported by `book.ts`. The new field follows the same pattern:

```typescript
// In DbBook:
reference_pages_source: FieldSource | null;
```

[VERIFIED: packages/common/types/book.ts read in this session]

---

## Architecture Patterns

### Pattern 1: SearchDocSchema Extension (REFPAGES-01 prerequisite)

```typescript
// Source: apps/server/src/open-library/open-library-schemas.ts
export const SearchDocSchema = z.object({
  key: z.string().regex(/^\/works\/OL[0-9]+W$/),
  title: z.string(),
  author_name: z.array(z.string()).optional(),
  author_key: z.array(z.string()).optional(),
  first_publish_year: z.number().int().optional(),
  isbn: z.array(z.string()).optional(),
  cover_i: z.number().optional(),
  cover_edition_key: z.string().optional(),  // ADD THIS
});
```

### Pattern 2: EnrichedBundle Extension (D-04)

```typescript
// Source: apps/server/src/enrichment/applier.ts
export interface EnrichedBundle {
  workKey: string;
  publicationYear: number | null;
  originalLanguage: string | null;
  authors: EnrichedAuthor[];
  subjects: string[];
  referencePages: number | null;  // ADD THIS
}
```

### Pattern 3: Worker Edition Fetch (D-04)

Insert between `matchWork` result (line 150) and `bundle` construction (line 176) in `worker.ts`:

```typescript
// Source: worker.ts processJob, after line 150 (workKey extraction)
const edition = candidate.cover_edition_key
  ? await openLibraryClient.getEdition(candidate.cover_edition_key)
  : null;
const referencePages =
  edition?.number_of_pages != null && edition.number_of_pages > 0
    ? edition.number_of_pages
    : null;
```

Then add `referencePages` to the bundle object at line 176-183.

### Pattern 4: Applier D-06 Block

```typescript
// Source: apps/server/src/enrichment/applier.ts, inside applyEnrichment transaction
// After the existing original_language_source guard block:
if (book.reference_pages_source !== 'manual') {
  if (bundle.referencePages !== null) {
    updates.reference_pages = bundle.referencePages;
    updates.reference_pages_source = 'openlibrary';
  }
  // null bundle.referencePages: leave existing value intact (D-06 no-clear semantics)
}
```

The `BookSourceRow` interface (line 28-33 in applier.ts) must add `reference_pages_source: FieldSource`.

### Pattern 5: PUT Endpoint Rewrite (D-12/D-13)

```typescript
// Source: apps/server/src/books/books-router.ts, replace lines 90-106
const referencePagesBodySchema = z.union([
  z.object({ reference_pages: z.number().int().positive() }),
  z.object({ reference_pages: z.null() }),
  z.object({ reference_pages: z.literal(0) }),
]);

router.put('/:bookId/reference_pages', getBookById, async (req, res) => {
  const book = req.book!;
  const parsed = referencePagesBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const newValue = parsed.data.reference_pages;
  const clearAction = newValue === null || newValue === 0;

  if (clearAction) {
    await BooksRepository.setReferencePages(book.id, null, null);
  } else if (newValue !== book.reference_pages) {
    await BooksRepository.setReferencePages(book.id, newValue, 'manual');
  }
  // same-value no-op: do nothing
  res.status(200).json({ message: 'Reference pages updated' });
});
```

Note: `getBookById` middleware loads the full `Book` row into `req.book`, providing `book.reference_pages` for the diff check.

### Pattern 6: Repository Extension (D-12)

```typescript
// Source: apps/server/src/books/books-repository.ts, replace line 134-136
static async setReferencePages(
  id: number,
  referencePages: number | null,
  source: 'openlibrary' | 'manual' | null
) {
  return db<Book>('book').where({ id }).update({
    reference_pages: referencePages,
    reference_pages_source: source,
  });
}
```

### Pattern 7: getTotalPages Removal (D-16)

```typescript
// Source: apps/server/src/books/books-service.ts line 13-15
// BEFORE:
static getTotalPages(book: Book, bookDevices: BookDevice[]): number {
  return book.reference_pages || Math.max(...bookDevices.map((device) => device.pages || 0));
}

// AFTER:
static getTotalPages(book: Book): number {
  return book.reference_pages ?? 0;
}
```

This changes the call signature. Both call sites in `books-repository.ts:94` (`getAllWithData`) and `books-service.ts:94` (`withData`) pass `(book, bookDevices)`. Both need updating to `getTotalPages(book)`. The `getAllWithData` call at repository line 94 is inside the `books.map` callback.

### Pattern 8: COALESCE Removal (D-16)

```sql
-- BEFORE (reports-repository.ts lines 48-76):
WITH max_page_by_end AS (...),
     device_pages AS (
       SELECT book_md5, MAX(pages) AS dev_p
       FROM book_device WHERE pages IS NOT NULL AND pages > 0
       GROUP BY book_md5
     )
SELECT b.md5
FROM book b
INNER JOIN max_page_by_end m ON m.book_md5 = b.md5
LEFT JOIN device_pages d ON d.book_md5 = b.md5
WHERE b.soft_deleted = 0
  AND COALESCE(b.reference_pages, d.dev_p) IS NOT NULL
  AND COALESCE(b.reference_pages, d.dev_p) > 0
  AND m.max_p >= CAST(0.95 * COALESCE(b.reference_pages, d.dev_p) AS INTEGER)
  ...

-- AFTER:
-- Drop device_pages CTE and LEFT JOIN entirely (if unused elsewhere in the query).
SELECT b.md5
FROM book b
INNER JOIN max_page_by_end m ON m.book_md5 = b.md5
WHERE b.soft_deleted = 0
  AND b.reference_pages IS NOT NULL
  AND b.reference_pages > 0
  AND m.max_p >= CAST(0.95 * b.reference_pages AS INTEGER)
  ...
```

The `device_pages` CTE and the `LEFT JOIN device_pages d` are ONLY used to feed the COALESCE. After removal, drop both. [VERIFIED: reports-repository.ts read in this session; `d.dev_p` appears only in the COALESCE expressions]

### Pattern 9: UI Affordance (book-page.tsx line 203)

```typescript
// BEFORE (lines 202-205):
const bookPages =
  book?.reference_pages ||
  book?.device_data.reduce((acc, device) => Math.max(acc, device.pages), 0) ||
  0;

// AFTER (recommended: inline null badge in RingProgress label):
const bookPages = book?.reference_pages ?? null;
```

When `bookPages` is null, the `RingProgress` label should show "Page count missing" instead of "0% / 0 pages". Use a Mantine `Text` with `c="dimmed"` for the label. The ring itself can show 0% with `sections={[]}` or `value: 0`. The `book-reference-pages.tsx` component in the "Manage data" tab already serves as the call-to-action.

### Pattern 10: Backfill D-09 Option b (Recommended)

Option b hits `/works/{openlibrary_work_key}/editions.json?limit=1` for each book. This avoids replaying the fuzzy search matcher (option a) and uses the work key that is already stored on the book row (guaranteed available by D-08 predicate). The OL editions endpoint returns a JSON object with `{ entries: [{key, ...},...] }`. The first entry's `key` field is the edition key to pass to `getEdition`.

The `openLibraryClient` does not currently have a `getWorkEditions(workKey)` method. The backfill script can either:
1. Call `getEdition` directly after constructing the editions URL, or
2. Add `getWorkEditions` to `OpenLibraryClient` for reusability.

Option 1 is simpler and keeps the backfill self-contained; option 2 is cleaner for future use. Either is acceptable.

### Anti-Patterns to Avoid

- **Using `candidate` from `matchWork` before extending schema:** `matchWork` returns `MatcherCandidate`, which currently only has `{ title, author_name?, key? }`. Accessing `candidate.cover_edition_key` without the schema fix returns `undefined` silently.
- **Clearing an existing OL-sourced value when a re-run returns no pages:** D-06 explicitly prohibits this. The null-pages branch must be a no-op, not a `reference_pages = NULL` write.
- **Modifying the boot-time `backfill.ts`:** The backfill script is a NEW sibling file. The boot-time backfill only enqueues pending/null-status books; it does not apply page data.
- **Passing `reference_pages: 0` in the backfill write path:** The backfill must write `null` (or skip) when `number_of_pages` is 0 or absent, not write 0.
- **Running `getTotalPages(book, bookDevices)` after removing the second parameter:** All callers in `BooksRepository.getAllWithData` and `BooksService.withData` must be updated.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP rate limiting | Custom throttle | `sharedHttpLimiter` (Bottleneck) | Already wires edition fetches through 1 req/s limiter |
| Edition JSON validation | Custom parser | `EditionSchema` via `openLibraryClient.getEdition()` | Zod already validates `number_of_pages` as `z.number().int().optional()` |
| Backfill runner | Custom process pool | `tsx` script + `npm --workspace=server run backfill:reference-pages` | Established pattern from Phase 4 (see `package.json scripts`) |
| Provenance guard | New guard function | Inline `if (source !== 'manual')` pattern from applier.ts | Existing pattern is simple; extraction optional per Claude's Discretion |

---

## Common Pitfalls

### Pitfall 1: cover_edition_key stripped by Zod (CRITICAL)

**What goes wrong:** Worker accesses `candidate.cover_edition_key` and always gets `undefined` because `SearchDocSchema` strips it. All books appear to have no edition key; `referencePages` is always null.

**Why it happens:** `z.object()` without `.passthrough()` strips unrecognized keys. `cover_edition_key` is not in `SearchDocSchema`.

**How to avoid:** Add `cover_edition_key: z.string().optional()` to `SearchDocSchema` and `cover_edition_key?: string` to `MatcherCandidate` BEFORE implementing the worker fetch. Write a unit test that asserts `candidate.cover_edition_key` is defined when the search fixture includes it.

**Warning signs:** Worker integration test passes with no pages written even though edition fixture has `number_of_pages`.

### Pitfall 2: Edition 404 fails the whole enrichment (D-05 known consequence)

**What goes wrong:** A broken `cover_edition_key` (OL removed the edition or the key is invalid) causes a `NotFoundError`, which `classifyFailure` marks as `permanent`, flipping the entire book to `failed` even though authors/genres/year were resolved.

**Why it happens:** D-05 accepts this tradeoff explicitly. The existing two-state model (`enriched` / `failed`) has no `partial_enriched`.

**How to avoid:** This is intended behavior per D-05. Test coverage must assert this path explicitly. The unmatched inbox (Phase 5) surfaces these books for manual re-enrichment.

**Warning signs:** A book that had correct authors/genres after Phase 4 shows `enrichment_status='failed'` after Phase 7 worker processes it.

### Pitfall 3: same-value PUT no-op must NOT stamp 'manual' (D-12)

**What goes wrong:** User opens book page, sees pages = 320 (from OL), clicks save without changing the value. If the route always stamps `'manual'`, the book is now locked against re-enrichment even though the user did nothing.

**Why it happens:** The previous `setReferencePages` had no diff logic; it always wrote the value.

**How to avoid:** The route handler must read `book.reference_pages` (available from `req.book` via `getBookById` middleware) and compare. Only stamp `'manual'` on a genuine diff.

**Warning signs:** After the change, `reference_pages_source` flips to `'manual'` when the user submits the form without editing.

### Pitfall 4: getTotalPages signature change breaks getAllWithData

**What goes wrong:** `getTotalPages` loses the `bookDevices` parameter. `BooksRepository.getAllWithData` calls `BooksService.getTotalPages(book, bookDevices)` at line 94 of `books-repository.ts`. If the signature is changed but the call site is not updated, TypeScript compilation fails.

**Why it happens:** `getTotalPages` is a static method on `BooksService`, called from two places: `books-repository.ts:94` (inside `getAllWithData`) and `books-service.ts:94` (inside `withData`).

**How to avoid:** Update both call sites in the same commit as the signature change. The existing test `books-service.test.ts` "returns the max pages from device data if reference pages are not available" will fail after the change and should be updated to assert `total_pages = 0` or removed.

### Pitfall 5: Backfill re-runs re-attempt no_pages books (D-11 behavior)

**What goes wrong:** After a first backfill run, all books that got no pages from OL remain `reference_pages IS NULL`. A second run re-fetches all of them. This is intentional per D-11 but could surprise the operator if the library is large.

**Why it happens:** Persisting "tried and got nothing" requires a new column, which is out of scope.

**How to avoid:** Document in the script's console output: "X books had no edition pages; they will be re-attempted on the next run." The summary counter `{ scanned, populated, no_pages, errored }` makes this visible.

### Pitfall 6: reports-repository.test.ts uses device_pages indirectly

**What goes wrong:** After COALESCE removal, existing test cases that rely on `book_device.pages` feeding the 95% threshold will silently stop qualifying books. The test assertion changes from "book qualifies" to "book does not qualify."

**Why it happens:** `seedYearlyReportScenario` in `yearly-report-fixture.ts` sets both `referencePages` and `pages` on each book spec. Most existing tests set both, so the existing passing tests likely pass via `reference_pages` already. But a new regression test should specifically seed a book with `reference_pages = NULL` and `book_device.pages = 300` to confirm exclusion.

**How to avoid:** Add the explicit regression test described in the CONTEXT.md `<specifics>` section (per D-16).

---

## Runtime State Inventory

Step 2.6: SKIPPED (Phase 7 is a rename/refactor of no externally-registered names; no Mem0 user IDs, no n8n workflows, no OS-registered tasks, no SOPS keys, no build artifacts affected).

---

## Environment Availability

Step 2.6: SKIPPED (no new external dependencies; all required tools already present in the repo).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.16 |
| Config file | `apps/server/vitest.config.ts` (or root `vitest.config.ts`) |
| Quick run command | `npm --workspace=server exec vitest run path/to/file.test.ts` |
| Full suite command | `npm --workspace=server test` (builds migrations first) |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REFPAGES-01 | `SearchDocSchema` passes through `cover_edition_key` | unit | `vitest run .../phase-07-schema.test.ts` | Wave 0 |
| REFPAGES-01 | Worker calls `getEdition` when `cover_edition_key` present | integration | `vitest run .../phase-07-worker.test.ts` | Wave 0 |
| REFPAGES-01 | Worker sets `referencePages=null` when key absent | integration | `vitest run .../phase-07-worker.test.ts` | Wave 0 |
| REFPAGES-01 | Worker sets `referencePages=null` when edition has no `number_of_pages` | integration | `vitest run .../phase-07-worker.test.ts` | Wave 0 |
| REFPAGES-01 | Applier writes `reference_pages` + `_source='openlibrary'` when source != manual | integration | `vitest run .../phase-07-applier.test.ts` | Wave 0 |
| REFPAGES-01 | Applier: OL value not cleared when new run has no pages (D-06 no-clear) | integration | `vitest run .../phase-07-applier.test.ts` | Wave 0 |
| REFPAGES-01 | Applier: manual source blocks OL overwrite (D-06 guard) | integration | `vitest run .../phase-07-applier.test.ts` | Wave 0 |
| REFPAGES-01 | Edition 404 flips book to `failed` (D-05) | integration | `vitest run .../phase-07-worker.test.ts` | Wave 0 |
| REFPAGES-02 | Backfill selects only enriched+null+non-manual books (D-08) | integration | `vitest run .../phase-07-backfill.test.ts` | Wave 0 |
| REFPAGES-02 | Backfill is idempotent: second run writes 0 rows for populated books | integration | `vitest run .../phase-07-backfill.test.ts` | Wave 0 |
| REFPAGES-02 | Backfill does not touch manual-source books | integration | `vitest run .../phase-07-backfill.test.ts` | Wave 0 |
| REFPAGES-02 | Backfill summary counters correct | integration | `vitest run .../phase-07-backfill.test.ts` | Wave 0 |
| REFPAGES-03 | Migration: `reference_pages_source` column added with CHECK domain | unit | `vitest run .../phase-07-migration.test.ts` | Wave 0 |
| REFPAGES-03 | PUT same-value is a no-op (source unchanged) | integration | `vitest run .../phase-07-router.test.ts` | Wave 0 |
| REFPAGES-03 | PUT different-value stamps `'manual'` | integration | `vitest run .../phase-07-router.test.ts` | Wave 0 |
| REFPAGES-03 | PUT null clears both columns | integration | `vitest run .../phase-07-router.test.ts` | Wave 0 |
| REFPAGES-03 | After clear, enrichment re-populates reference_pages | integration | `vitest run .../phase-07-applier.test.ts` | Wave 0 |
| REFPAGES-04 | reports-repository: NULL reference_pages excludes book from >=95% predicate | integration | `vitest run .../reports-repository.test.ts` | Exists (extend) |
| REFPAGES-04 | books-service: getTotalPages returns 0 when reference_pages = NULL | unit | `vitest run .../books-service.test.ts` | Exists (update) |

### Fixture Strategy

Three new JSON files in `apps/server/src/enrichment/__tests__/fixtures/`:

1. **`edition-ender.json`** (already exists, has `"number_of_pages": 352`) - use as the "edition with pages" fixture.
2. **`edition-no-pages.json`** (NEW) - `edition-ender.json` shape minus `number_of_pages`.
3. **`search-ender-with-edition-key.json`** (NEW) - `search-ender.json` with `"cover_edition_key": "/books/OL7641985M"` added to the doc.

The integration test `buildFetchMock` in `phase-04-integration.test.ts` already dispatches `/books/` URLs to `editionFixture`. Phase 7 tests will extend this mock to support URL-specific responses (e.g., return `edition-no-pages.json` for a specific edition key).

### Sampling Rate

- **Per task commit:** Quick run of the specific new test file
- **Per wave merge:** `npm --workspace=server test` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `apps/server/src/enrichment/__tests__/phase-07-schema.test.ts` -- covers SearchDocSchema + MatcherCandidate extension
- [ ] `apps/server/src/enrichment/__tests__/phase-07-worker.test.ts` -- covers Edition fetch paths in processJob
- [ ] `apps/server/src/enrichment/__tests__/phase-07-applier.test.ts` -- covers D-06 provenance block (manual guard, no-clear, re-enrichment after clear)
- [ ] `apps/server/src/enrichment/__tests__/phase-07-backfill.test.ts` -- covers backfill predicate, idempotency, manual exclusion, summary counters
- [ ] `apps/server/src/enrichment/__tests__/fixtures/edition-no-pages.json` -- fixture for null-pages path
- [ ] `apps/server/src/enrichment/__tests__/fixtures/search-ender-with-edition-key.json` -- fixture with cover_edition_key
- [ ] `apps/server/src/books/__tests__/phase-07-router.test.ts` -- covers PUT D-12 rules (same-value no-op, diff stamps manual, null clears)
- [ ] `apps/server/src/db/migrations/__tests__/phase-07-migration.test.ts` -- covers schema column + CHECK constraint

---

## Open Questions

1. **D-09 option a vs b for backfill:** Research recommends option b (`/works/{key}/editions.json?limit=1`) because it avoids replaying the fuzzy search and uses the authoritative OL work-editions relationship. However, the OL editions endpoint returns a paginated `WorkEditions` response shape that is NOT currently in `open-library-schemas.ts` or `open-library-client.ts`. The planner must decide whether to add `getWorkEditions(workKey)` to `OpenLibraryClient` with a Zod schema, or make the raw fetch inline in the backfill script.
   - **Recommendation:** Add a minimal `WorkEditionsSchema = z.object({ entries: z.array(z.object({ key: z.string() })).optional().default([]) })` and a `getWorkEditions(workKey)` method to `OpenLibraryClient`. This makes the backfill consistent with the rest of the OL client interface and is testable with `vi.spyOn`.

2. **`getBookById` middleware type availability for diff check:** The PUT route uses `req.book` (injected by `getBookById` middleware). The `Book` type must include `reference_pages_source` after the common-types update so the route can read it. The planner should ensure the common-types task precedes the route task.

3. **books-service.test.ts regression:** The test "returns the max pages from device data if reference pages are not available" tests the device fallback that D-16 removes. After `getTotalPages` is simplified, this test will fail. The planner should schedule a test update as part of the D-16 wave, asserting `total_pages = 0` (or the new behavior) instead.

4. **`getAllWithData` in books-repository.ts:** This method calls `BooksService.getTotalPages(book, bookDevices)` at line 94. It is NOT in `books-service.ts`; it is a static call to `BooksService` from within `BooksRepository`. Both the service method and the repository call site need updating in the same task.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `COALESCE(reference_pages, device_pages)` for 95% predicate | `b.reference_pages` directly | Phase 7 (this phase) | Books with NULL pages excluded from report; user must enrich or set manually |
| No provenance on `reference_pages` | `reference_pages_source` column | Phase 7 (this phase) | Manual edits are sticky; enrichment respects the guard |
| `getTotalPages` falls back to device pages | Returns `reference_pages ?? 0` | Phase 7 (this phase) | `total_pages` is 0 for unenriched books; UI should show affordance |

**Deprecated/outdated after Phase 7:**

- `COALESCE(b.reference_pages, d.dev_p)` in `reports-repository.ts`: removed.
- Device fallback `Math.max(...bookDevices.map(d => d.pages || 0))` in `getTotalPages`: removed.
- `book?.reference_pages || book?.device_data.reduce(...)` in `book-page.tsx:203`: removed.
- `BooksRepository.setReferencePages(id, pages)` two-parameter signature: replaced with three-parameter `(id, pages, source)`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | OL `/works/{key}/editions.json?limit=1` returns `{ entries: [{key, ...}] }` | D-09 option b pattern | Backfill script may need a different field name; verify with OL API docs before implementing |
| A2 | `getBookById` middleware provides the full `Book` row including `reference_pages` | PUT endpoint diff check | If middleware only returns a partial row, the diff check cannot compare current value |

[ASSUMED tags: A1 is based on known OL API shape from training data; recommend a quick `curl https://openlibrary.org/works/OL27448W/editions.json?limit=1` during Wave 0 to confirm field names before writing the Zod schema.]

---

## Sources

### Primary (HIGH confidence)

- [VERIFIED: apps/server/src/open-library/open-library-schemas.ts] - `SearchDocSchema` field inventory, `EditionSchema.number_of_pages`
- [VERIFIED: apps/server/src/open-library/open-library-types.ts:16] - `cover_edition_key` in `Doc` interface
- [VERIFIED: apps/server/src/enrichment/worker.ts] - `processJob` call sequence (lines 122-185)
- [VERIFIED: apps/server/src/enrichment/applier.ts] - `EnrichedBundle` type, `applyEnrichment` transaction, `BookSourceRow`
- [VERIFIED: apps/server/src/enrichment/matcher.ts] - `MatcherCandidate` interface (no `cover_edition_key`)
- [VERIFIED: apps/server/src/enrichment/retry.ts] - `classifyFailure`: 404 = permanent, 5xx = retryable
- [VERIFIED: apps/server/src/books/books-router.ts] - `PUT /books/:bookId/reference_pages` current shape (lines 90-106)
- [VERIFIED: apps/server/src/books/books-repository.ts:134-136] - `setReferencePages` current signature
- [VERIFIED: apps/server/src/books/books-service.ts:13-14] - `getTotalPages` device fallback
- [VERIFIED: apps/server/src/reports/reports-repository.ts:48-76] - COALESCE + `device_pages` CTE
- [VERIFIED: apps/server/src/enrichment/__tests__/phase-04-integration.test.ts] - `buildFetchMock` fetch dispatch pattern
- [VERIFIED: apps/server/src/enrichment/__tests__/fixtures/edition-ender.json] - has `"number_of_pages": 352`
- [VERIFIED: apps/server/src/enrichment/__tests__/fixtures/search-ender.json] - does NOT have `cover_edition_key`
- [VERIFIED: packages/common/types/book.ts] - `Book` type, `DbBook`, `FieldSource` import
- [VERIFIED: apps/server/package.json] - `tsx` installed as devDep; no `backfill:reference-pages` script yet
- [VERIFIED: .planning/config.json] - `workflow.nyquist_validation: true`

### Tertiary (LOW confidence)

- A1: OL `/works/{key}/editions.json?limit=1` response shape [ASSUMED] -- verify with live curl before implementing Zod schema

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - all libraries verified in package.json
- Architecture: HIGH - all integration points verified by reading source
- Critical finding (Zod stripping): HIGH - verified by reading both schema files
- Pitfalls: HIGH for items 1-4 (derived from reading code), MEDIUM for pitfall 5 (reasoning from D-11 semantics)
- D-09 option b recommendation: MEDIUM - OL editions endpoint shape not verified this session

**Research date:** 2026-04-27
**Valid until:** 2026-05-27 (stable domain; OL API shape is the only external unknown)

---

## RESEARCH COMPLETE

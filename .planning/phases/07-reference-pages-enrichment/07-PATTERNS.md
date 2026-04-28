# Phase 7: Reference Pages Enrichment - Pattern Map

**Mapped:** 2026-04-27
**Files analyzed:** 17 new/modified files
**Analogs found:** 16 / 17

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/server/src/db/migrations/<ts>_add_reference_pages_source_to_book.ts` | migration | CRUD | `apps/server/src/db/migrations/20260423221600_extend_book_columns.ts` | exact |
| `apps/server/src/open-library/open-library-schemas.ts` | config/schema | transform | `apps/server/src/open-library/open-library-schemas.ts` (self, additive) | exact |
| `apps/server/src/enrichment/matcher.ts` | utility | transform | `apps/server/src/enrichment/matcher.ts` (self, additive) | exact |
| `apps/server/src/enrichment/applier.ts` | service | CRUD | `apps/server/src/enrichment/applier.ts` (self, additive) | exact |
| `apps/server/src/enrichment/worker.ts` | service | request-response | `apps/server/src/enrichment/worker.ts` (self, additive) | exact |
| `apps/server/src/enrichment/backfill-reference-pages.ts` | utility (CLI script) | batch | `apps/server/src/enrichment/backfill.ts` | role-match |
| `apps/server/src/books/books-repository.ts` | service | CRUD | `apps/server/src/books/books-repository.ts` (self, extend) | exact |
| `apps/server/src/books/books-router.ts` | controller | request-response | `apps/server/src/books/books-router.ts` (self, rewrite one route) | exact |
| `apps/server/src/books/books-service.ts` | service | CRUD | `apps/server/src/books/books-service.ts` (self, simplify) | exact |
| `apps/server/src/reports/reports-repository.ts` | service | CRUD | `apps/server/src/reports/reports-repository.ts` (self, drop COALESCE) | exact |
| `apps/server/src/open-library/open-library-client.ts` | service | request-response | `apps/server/src/open-library/open-library-client.ts` (self, add method) | exact |
| `apps/server/src/enrichment/__tests__/fixtures/edition-no-pages.json` | test fixture | -- | `apps/server/src/enrichment/__tests__/fixtures/edition-ender.json` | exact |
| `apps/server/src/enrichment/__tests__/fixtures/search-ender-with-edition-key.json` | test fixture | -- | `apps/server/src/enrichment/__tests__/fixtures/search-ender.json` | exact |
| `apps/web/src/pages/book-page/book-page.tsx` | component | request-response | `apps/web/src/pages/book-page/book-page.tsx` (self, modify StatsCard) | exact |
| `apps/web/src/pages/stats-page/week-stats.tsx` | component | request-response | `apps/web/src/pages/stats-page/week-stats.tsx` (self, review guard) | exact |
| `packages/common/types/book.ts` | model | -- | `packages/common/types/book.ts` (self, add field) | exact |
| `apps/server/src/enrichment/__tests__/phase-07-*.test.ts` (multiple) | test | -- | `apps/server/src/enrichment/__tests__/phase-04-integration.test.ts` | role-match |

---

## Pattern Assignments

---

### `apps/server/src/db/migrations/<ts>_add_reference_pages_source_to_book.ts` (migration, CRUD)

**Analog:** `apps/server/src/db/migrations/20260423221600_extend_book_columns.ts`

**Full migration pattern** (lines 1-41):
```typescript
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('book', (table) => {
    // D-14: four *_source columns, NULL = "never touched by provenance-aware write".
    // CHECK constraint on the non-null domain {openlibrary, manual}.
    table.string('authors_source').nullable().checkIn(['openlibrary', 'manual']);
    table.string('genres_source').nullable().checkIn(['openlibrary', 'manual']);
    table.string('publication_year_source').nullable().checkIn(['openlibrary', 'manual']);
    table.string('original_language_source').nullable().checkIn(['openlibrary', 'manual']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('book', (table) => {
    table.dropColumn('original_language_source');
    table.dropColumn('publication_year_source');
    table.dropColumn('genres_source');
    table.dropColumn('authors_source');
  });
}
```

**Phase 7 adaptation:** Add one column only:
```typescript
table.string('reference_pages_source').nullable().checkIn(['openlibrary', 'manual']);
```
`down` drops it with `table.dropColumn('reference_pages_source')`. No `defaultTo`; no retroactive backfill (D-02).

**Filename convention:** `YYYYMMDDHHMMSS_add_reference_pages_source_to_book.ts` (follow `20260423221600_` timestamp style).

---

### `apps/server/src/open-library/open-library-schemas.ts` (config/schema, transform)

**Analog:** Self (additive change to `SearchDocSchema`, lines 5-13)

**Current SearchDocSchema** (lines 5-13):
```typescript
export const SearchDocSchema = z.object({
  key: z.string().regex(/^\/works\/OL[0-9]+W$/),
  title: z.string(),
  author_name: z.array(z.string()).optional(),
  author_key: z.array(z.string()).optional(),
  first_publish_year: z.number().int().optional(),
  isbn: z.array(z.string()).optional(),
  cover_i: z.number().optional(),
});
```

**Phase 7 change:** Add one field (CRITICAL: without this, Zod strips the key and `candidate.cover_edition_key` is always undefined at runtime):
```typescript
  cover_edition_key: z.string().optional(),  // ADD - required for REFPAGES-01
```

**Also update** `searchWork` fields param in `open-library-client.ts` (line 57) to include `cover_edition_key`:
```typescript
fields: 'key,title,author_name,author_key,first_publish_year,isbn,cover_i,cover_edition_key',
```

---

### `apps/server/src/enrichment/matcher.ts` (utility, transform)

**Analog:** Self (additive change to `MatcherCandidate`, lines 10-14)

**Current MatcherCandidate** (lines 10-14):
```typescript
export interface MatcherCandidate {
  title: string;
  author_name?: string[];
  key?: string;
}
```

**Phase 7 change:**
```typescript
export interface MatcherCandidate {
  title: string;
  author_name?: string[];
  key?: string;
  cover_edition_key?: string;  // ADD - carried through from SearchDocSchema for worker
}
```

No change to `matchWork` logic; the field is only read by the worker after `matchWork` returns.

---

### `apps/server/src/enrichment/applier.ts` (service, CRUD)

**Analog:** Self (three targeted additions)

**Current EnrichedBundle** (lines 18-24):
```typescript
export interface EnrichedBundle {
  workKey: string;
  publicationYear: number | null;
  originalLanguage: string | null; // ISO 639-1 or null
  authors: EnrichedAuthor[];
  subjects: string[];
}
```

**Phase 7 change 1 - extend EnrichedBundle:**
```typescript
export interface EnrichedBundle {
  workKey: string;
  publicationYear: number | null;
  originalLanguage: string | null;
  authors: EnrichedAuthor[];
  subjects: string[];
  referencePages: number | null;  // ADD - D-04; null if no cover_edition_key or no number_of_pages
}
```

**Phase 7 change 2 - extend BookSourceRow** (lines 28-33):
```typescript
interface BookSourceRow {
  authors_source: FieldSource;
  genres_source: FieldSource;
  publication_year_source: FieldSource;
  original_language_source: FieldSource;
  reference_pages_source: FieldSource;  // ADD
}
```

**Phase 7 change 3 - extend SELECT in applyEnrichment** (line 44-49):
```typescript
const book = (await trx('book')
  .where({ md5: bookMd5 })
  .select(
    'authors_source',
    'genres_source',
    'publication_year_source',
    'original_language_source',
    'reference_pages_source'  // ADD
  )
  .first()) as BookSourceRow | undefined;
```

**Phase 7 change 4 - D-06 provenance block** (insert after line 106, after `original_language_source` guard):
```typescript
// D-06: reference_pages provenance guard.
// null bundle.referencePages is a no-op: do NOT clear an existing OL-sourced
// value just because this enrichment run returned nothing (no-clear semantics).
if (book.reference_pages_source !== 'manual') {
  if (bundle.referencePages !== null) {
    updates.reference_pages = bundle.referencePages;
    updates.reference_pages_source = 'openlibrary';
  }
}
```

**Copy the existing guard pattern** from lines 99-106 (publication_year and original_language guards) exactly; this is the fourth application of the same D-20 pattern.

---

### `apps/server/src/enrichment/worker.ts` (service, request-response)

**Analog:** Self (insert Edition fetch between `matchWork` and bundle construction)

**Current processJob flow** (lines 128-184):
- Line 128: function entry, fetch book row
- Line 138: `openLibraryClient.searchWork()`
- Line 140-149: `matchWork()` -> candidate or terminal fail
- Line 151-153: extract `workKey`
- Line 157: `openLibraryClient.getWork(workKey)`
- Line 160-174: resolve authors via `getAuthor` + wikidata loop
- Line 176-183: construct `bundle`
- Line 184: `applyEnrichment(knex, job.book_md5, job.id, bundle)`

**Phase 7 insertion - after line 153 (workKey extracted), before line 157 (getWork):**
```typescript
// D-04: fetch one Edition to populate referencePages.
// cover_edition_key is present on the search candidate when SearchDocSchema
// includes it AND OL returned it; null when absent or OL omitted the field.
const edition = candidate.cover_edition_key
  ? await openLibraryClient.getEdition(candidate.cover_edition_key)
  : null;
const referencePages =
  edition?.number_of_pages != null && edition.number_of_pages > 0
    ? edition.number_of_pages
    : null;
```

**Phase 7 change - bundle construction** (line 176-182, add `referencePages`):
```typescript
const bundle: EnrichedBundle = {
  workKey,
  publicationYear: extractPublicationYear(work, candidate as { first_publish_year?: number }),
  originalLanguage: null,
  authors: enrichedAuthors,
  subjects: work.subjects ?? [],
  referencePages,  // ADD
};
```

**Error handling:** Edition fetch errors propagate naturally to `scheduleRetryOrFail` via the existing `try/catch` in `claimAndProcess` (lines 116-119). No special handling needed; `classifyFailure` in `retry.ts` handles 404 (permanent) and 5xx/network (retryable) unchanged.

---

### `apps/server/src/enrichment/backfill-reference-pages.ts` (utility CLI script, batch)

**Analog:** `apps/server/src/enrichment/backfill.ts` (structure), `apps/server/src/enrichment/worker.ts` (OL client usage)

**backfill.ts pattern** (full file, lines 1-23):
```typescript
import type { Knex } from 'knex';

export async function runBackfill(knex: Knex): Promise<void> {
  await knex.raw(`INSERT INTO enrichment_job ...`);
  console.log('enrichment backfill: complete');
}
```

**Phase 7 script structure** (standalone tsx script, not exported function):
```typescript
import { db } from '../knex';
import { openLibraryClient } from '../open-library/open-library-client';

// D-08 predicate: enriched books with NULL reference_pages, excluding manual.
// D-09 option b: /works/{key}/editions.json?limit=1 to get cover_edition_key.
// D-10: best-effort; errors logged, enrichment_status NOT changed.
// D-11: no_pages books re-attempted on re-run (no "tried and got nothing" column).

interface BackfillSummary {
  scanned: number;
  populated: number;
  no_pages: number;
  errored: number;
}

async function main(): Promise<void> {
  const candidates = await db('book')
    .where({ enrichment_status: 'enriched' })
    .whereNull('reference_pages')
    .where(function () {
      this.whereNull('reference_pages_source').orWhereNot('reference_pages_source', 'manual');
    })
    .whereNotNull('openlibrary_work_key')
    .select('md5', 'openlibrary_work_key');

  const summary: BackfillSummary = { scanned: candidates.length, populated: 0, no_pages: 0, errored: 0 };

  for (const book of candidates) {
    try {
      // D-09 option b: get first edition key via works editions endpoint
      const editions = await openLibraryClient.getWorkEditions(book.openlibrary_work_key!);
      const editionKey = editions.entries?.[0]?.key ?? null;
      if (!editionKey) {
        console.warn(`backfill: no edition entry for ${book.md5} (work ${book.openlibrary_work_key})`);
        summary.no_pages++;
        continue;
      }

      const edition = await openLibraryClient.getEdition(editionKey);
      if (!edition.number_of_pages || edition.number_of_pages <= 0) {
        console.warn(`backfill: no number_of_pages for ${book.md5}`);
        summary.no_pages++;
        continue;
      }

      // D-06 provenance-aware write (inline; manual guard enforced by predicate above)
      await db('book').where({ md5: book.md5 }).update({
        reference_pages: edition.number_of_pages,
        reference_pages_source: 'openlibrary',
      });
      summary.populated++;
    } catch (err) {
      console.warn(`backfill: error for ${book.md5}`, err);
      summary.errored++;
    }
  }

  console.log('backfill:reference-pages complete', summary);
  await db.destroy();
}

void main();
```

**package.json script to add** (`apps/server/package.json`):
```json
"backfill:reference-pages": "tsx src/enrichment/backfill-reference-pages.ts"
```

**Verify runner:** `tsx` is already installed as devDep at 4.21.0 (verified in package.json). Check existing scripts section for the runner pattern used by other scripts.

---

### `apps/server/src/open-library/open-library-client.ts` (service, request-response)

**Analog:** Self (`getEdition` method at lines 68-81 is the closest shape; `getWorkEditions` follows the same `normalizePath` + `typedFetch` pattern)

**getEdition pattern** (lines 68-81) to copy for `getWorkEditions`:
```typescript
async getEdition(editionKey: string): Promise<OpenLibraryEdition> {
  const trimmed = editionKey.trim();
  if (trimmed.startsWith('/isbn/')) {
    const tail = trimmed.slice('/isbn/'.length);
    if (tail.includes('/') || tail.includes('..')) {
      throw new Error(`Invalid ISBN path segment: ${editionKey}`);
    }
    return typedFetch(`${OPEN_LIBRARY_API}${trimmed}.json`, EditionSchema, this.deps);
  }
  const path = normalizePath(editionKey, '/books/');
  return typedFetch(`${OPEN_LIBRARY_API}${path}.json`, EditionSchema, this.deps);
}
```

**New method to add** (add after `getEdition`, before `getAuthor`):
```typescript
async getWorkEditions(workKey: string): Promise<OpenLibraryWorkEditions> {
  const path = normalizePath(workKey, '/works/');
  // Append /editions.json?limit=1 (path already ends with bare key, no .json)
  return typedFetch(
    `${OPEN_LIBRARY_API}${path}/editions.json?limit=1`,
    WorkEditionsSchema,
    this.deps
  );
}
```

**New schemas to add to `open-library-schemas.ts`** (after `WorkSchema`):
```typescript
// === Work Editions (used by backfill D-09 option b) ===
export const WorkEditionsSchema = z.object({
  entries: z.array(z.object({ key: z.string() })).optional().default([]),
});
export type OpenLibraryWorkEditions = z.infer<typeof WorkEditionsSchema>;
```

**Import update in `open-library-client.ts`:** Add `WorkEditionsSchema`, `OpenLibraryWorkEditions` to the import from `./open-library-schemas`.

---

### `apps/server/src/books/books-repository.ts` (service, CRUD)

**Analog:** Self (`setReferencePages` at lines 134-136)

**Current setReferencePages** (lines 134-136):
```typescript
static async setReferencePages(id: number, referencePages: number | null) {
  return db<Book>('book').where({ id }).update({ reference_pages: referencePages });
}
```

**Phase 7 change - extend signature to accept source:**
```typescript
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

**Note:** `Book` type in `@koinsight/common/types/book.ts` must be updated first (add `reference_pages_source` to `DbBook`) so the `db<Book>` generic accepts the new column.

---

### `apps/server/src/books/books-router.ts` (controller, request-response)

**Analog:** Self + `PATCH /:bookId/metadata` route (lines 113-129) for the Zod-at-boundary pattern

**Existing Zod pattern from PATCH metadata** (lines 113-129):
```typescript
router.patch('/:bookId/metadata', getBookById, async (req: Request, res: Response) => {
  const book = req.book!;

  const parsed = metadataPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const updated = await applyManualEdit(book, parsed.data);
    res.status(200).json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update book metadata' });
  }
});
```

**Phase 7 rewrite of PUT /:bookId/reference_pages** (replace lines 87-106):
```typescript
// D-13: Zod schema accepts positive integer, null, or 0 (clear path).
// D-12: diff-only stamps 'manual'; same-value is no-op; null/0 clears both columns.
const referencePagesBodySchema = z.union([
  z.object({ reference_pages: z.number().int().positive() }),
  z.object({ reference_pages: z.null() }),
  z.object({ reference_pages: z.literal(0) }),
]);

/**
 * Updates a book's reference pages with provenance tracking.
 * D-12: diff-only stamps 'manual'; same-value is no-op; null/0 clears both columns.
 */
router.put('/:bookId/reference_pages', getBookById, async (req: Request, res: Response) => {
  const book = req.book!;

  const parsed = referencePagesBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const newValue = parsed.data.reference_pages;
  const clearAction = newValue === null || newValue === 0;

  try {
    if (clearAction) {
      await BooksRepository.setReferencePages(book.id, null, null);
    } else if (newValue !== book.reference_pages) {
      // Genuine diff: stamp manual source.
      await BooksRepository.setReferencePages(book.id, newValue, 'manual');
    }
    // Same-value no-op: do nothing (D-12 pitfall 3: must not stamp 'manual' on confirm).
    res.status(200).json({ message: 'Reference pages updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update reference pages' });
  }
});
```

**Import to add at top of file:** `import { z } from 'zod';` (if not already present).

---

### `apps/server/src/books/books-service.ts` (service, CRUD)

**Analog:** Self (`getTotalPages` at line 13-15)

**Current getTotalPages** (lines 13-15):
```typescript
static getTotalPages(book: Book, bookDevices: BookDevice[]): number {
  return book.reference_pages || Math.max(...bookDevices.map((device) => device.pages || 0));
}
```

**Phase 7 change - D-16 simplification:**
```typescript
static getTotalPages(book: Book): number {
  return book.reference_pages ?? 0;
}
```

**Two call sites to update in the same change:**
1. `books-repository.ts:94`: `BooksService.getTotalPages(book, bookDevices)` becomes `BooksService.getTotalPages(book)`
2. `books-service.ts:94` inside `withData`: `this.getTotalPages(book, bookDevices)` becomes `this.getTotalPages(book)`

**BookDevice import** in `books-service.ts` line 1 may become unused after this; confirm and remove if so.

---

### `apps/server/src/reports/reports-repository.ts` (service, CRUD)

**Analog:** Self (`getBooksReadInYear` at lines 43-78)

**Current COALESCE query** (lines 47-77):
```sql
WITH max_page_by_end AS (
  SELECT book_md5, MAX(page) AS max_p
  FROM page_stat
  WHERE start_time < ?
  GROUP BY book_md5
),
device_pages AS (
  SELECT book_md5, MAX(pages) AS dev_p
  FROM book_device
  WHERE pages IS NOT NULL AND pages > 0
  GROUP BY book_md5
)
SELECT b.md5 AS md5
FROM book b
INNER JOIN max_page_by_end m ON m.book_md5 = b.md5
LEFT JOIN device_pages d ON d.book_md5 = b.md5
WHERE b.soft_deleted = 0
  AND COALESCE(b.reference_pages, d.dev_p) IS NOT NULL
  AND COALESCE(b.reference_pages, d.dev_p) > 0
  AND m.max_p >= CAST(0.95 * COALESCE(b.reference_pages, d.dev_p) AS INTEGER)
  ...
```

**Phase 7 replacement - D-16 (drop device_pages CTE and LEFT JOIN entirely):**
```sql
WITH max_page_by_end AS (
  SELECT book_md5, MAX(page) AS max_p
  FROM page_stat
  WHERE start_time < ?
  GROUP BY book_md5
)
SELECT b.md5 AS md5
FROM book b
INNER JOIN max_page_by_end m ON m.book_md5 = b.md5
WHERE b.soft_deleted = 0
  AND b.reference_pages IS NOT NULL
  AND b.reference_pages > 0
  AND m.max_p >= CAST(0.95 * b.reference_pages AS INTEGER)
  AND EXISTS (
    SELECT 1 FROM page_stat ps2
    WHERE ps2.book_md5 = b.md5
      AND ps2.start_time >= ?
      AND ps2.start_time < ?
  )
ORDER BY b.md5 ASC
```

**D-17 inline comment** to replace the existing COALESCE explanation at lines 9-12:
```typescript
// Reading metrics are derived from book.reference_pages (D-15/D-17).
// Books with NULL reference_pages are excluded from completion-based predicates
// and surface as Unknown in coverage (v1.1 data-quality stance). To populate
// reference_pages, trigger enrichment or use PUT /books/:id/reference_pages.
```

---

### `packages/common/types/book.ts` (model)

**Analog:** Self (additive change to `DbBook`)

**Current DbBook** (lines 21-35):
```typescript
export type DbBook = {
  id: number;
  md5: string;
  title: string;
  authors: string;
  series: string;
  language: string;
  enrichment_status: EnrichmentStatus;
  openlibrary_work_key: string | null;
  publication_year: number | null;
  original_language: string | null;
  authors_source: FieldSource | null;
  genres_source: FieldSource | null;
  publication_year_source: FieldSource | null;
  original_language_source: FieldSource | null;
};
```

**Phase 7 change - add `reference_pages_source`:**
```typescript
  reference_pages_source: FieldSource | null;  // ADD after original_language_source
```

`FieldSource` is already imported from `./author` (line 1); no new import needed. This propagates the type to server (`BooksRepository`, route handler diff check via `req.book.reference_pages_source`) and web (`book-page.tsx` can read it to decide the UI affordance).

---

### `apps/web/src/pages/book-page/book-page.tsx` (component, request-response)

**Analog:** Self (`StatsCard` component, lines 201-205)

**Current bookPages fallback** (lines 202-205):
```typescript
const bookPages =
  book?.reference_pages ||
  book?.device_data.reduce((acc, device) => Math.max(acc, device.pages), 0) ||
  0;
```

**Phase 7 change - D-16, remove device fallback:**
```typescript
const bookPages = book?.reference_pages ?? null;
```

**UI affordance when bookPages is null** (inside `RingProgress` label block at lines 231-240):
```typescript
// When bookPages is null, show "Page count missing" instead of 0% / 0 pages.
// Mantine idiom: Text with c="dimmed" for the message; sections={[]} for empty ring.
label={
  bookPages === null ? (
    <Text size="xs" c="dimmed" ta="center">
      Page count<br />missing
    </Text>
  ) : (
    <Stack gap={0} align="center">
      <Text size="xl" fw={700} ta="center">
        {Math.round((book.unique_read_pages / bookPages) * 100)}%
      </Text>
      <Text size="xs" c="dimmed" ta="center" fw="bold">
        {book.unique_read_pages} / {bookPages} <br /> pages read
      </Text>
    </Stack>
  )
}
sections={bookPages === null ? [] : [
  { value: (book.unique_read_pages / bookPages) * 100, color: 'koinsight' },
]}
```

**Mantine reference:** Existing `Text c="dimmed"` pattern is used throughout `book-page.tsx` (lines 223, 237, etc.). The `book-reference-pages.tsx` component in the "Manage data" tab already serves as the call-to-action for setting pages manually; no new link required.

---

### `apps/web/src/pages/stats-page/week-stats.tsx` (component, request-response)

**Analog:** Self (lines 60-91 already use `?.reference_pages` truthy guard)

**Current pagesRead guard** (lines 60-71):
```typescript
const pagesRead = useMemo(
  () =>
    Math.round(
      weekData?.reduce((acc, stat) => {
        if (stat.total_pages && booksByMd5[stat.book_md5]?.reference_pages) {
          return acc + (1 / stat.total_pages) * booksByMd5[stat.book_md5].reference_pages!;
        } else {
          return acc + 1;
        }
      }, 0) ?? 0
    ),
  [weekData]
);
```

**Phase 7 review:** The existing `?.reference_pages` truthy check already excludes NULL books from the estimate (falls through to `acc + 1`, counting page turns instead). This is consistent with D-15/D-16: NULL reference_pages means the book is excluded from estimation. Confirm that `avgPagesPerDay` (lines 74-91) uses the same guard (it does, same pattern). No structural code change required; add a comment confirming the intent:
```typescript
// D-15: books with NULL reference_pages fall back to counting raw page turns (acc + 1).
// This under-counts for unenriched books; the data-quality stance accepts this tradeoff.
```

---

### Test fixtures

**Analog:** `apps/server/src/enrichment/__tests__/fixtures/edition-ender.json` + `search-ender.json`

**`edition-no-pages.json`** (new fixture for null-pages path):
```json
{
  "key": "/books/OL7641986M",
  "title": "Ender's Game",
  "works": [{ "key": "/works/OL27448W" }],
  "subjects": [],
  "publish_date": "July 15, 1994",
  "languages": [{ "key": "/languages/eng" }],
  "isbn_13": ["9780812550703"]
}
```
(Identical shape to `edition-ender.json` but omit `number_of_pages`.)

**`search-ender-with-edition-key.json`** (new fixture for Edition fetch path in worker):
```json
{
  "numFound": 1,
  "docs": [
    {
      "key": "/works/OL27448W",
      "title": "Ender's Game",
      "author_name": ["Orson Scott Card"],
      "author_key": ["OL27695A"],
      "first_publish_year": 1985,
      "isbn": ["9780812550702", "0812550706"],
      "cover_i": 8474200,
      "cover_edition_key": "/books/OL7641985M"
    }
  ]
}
```
(Identical to `search-ender.json` but adds `cover_edition_key` pointing to `edition-ender.json`'s key.)

---

### Test files (`phase-07-*.test.ts`)

**Analog:** `apps/server/src/enrichment/__tests__/phase-04-integration.test.ts`

**Key patterns to copy from phase-04-integration.test.ts:**

**Import + fetch stub harness** (lines 1-13):
```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBook } from '../../db/factories/book-factory';
import { db } from '../../knex';
import { enrichmentService } from '../service';
import { ENRICHMENT_POLL_INTERVAL_MS } from '../constants';
import { sharedHttpLimiter } from '../http/rate-limiter';
import { startEnrichmentWorker, type EnrichmentWorker } from '../worker';
import editionFixture from './fixtures/edition-ender.json';
import searchFixture from './fixtures/search-ender-with-edition-key.json';
// ... other fixtures
```

**buildFetchMock pattern** (lines 38-58) - extend to support per-URL overrides:
```typescript
function buildFetchMock(overrides: {
  searchDocs?: unknown;
  editionBody?: unknown;
  editionStatus?: number;
} = {}): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.includes('/search.json')) return jsonResponse(/* search body */);
    if (url.includes('/works/') && url.includes('/editions.json')) return jsonResponse(/* editions */);
    if (url.includes('/works/')) return jsonResponse(workFixture);
    if (url.includes('/books/')) {
      const status = overrides.editionStatus ?? 200;
      if (status === 404) return new Response('Not Found', { status: 404 });
      return jsonResponse(overrides.editionBody ?? editionFixture, status);
    }
    if (url.includes('/authors/')) return jsonResponse(authorFixture);
    if (url.includes('wikidata.org')) return jsonResponse(wikidataFixture);
    throw new Error('unexpected fetch url: ' + url);
  });
}
```

**runOneTick helper** (lines 77-83) - copy verbatim for all phase-07 test files that drive the worker.

**createBook factory usage** for seeding test books:
```typescript
const book = await createBook(db, {
  title: "Ender's Game",
  authors: 'Orson Scott Card',
  enrichment_status: 'pending',
  reference_pages: null,
  reference_pages_source: null,  // after common types update
});
```

---

## Shared Patterns

### Provenance Guard Pattern (D-20)
**Source:** `apps/server/src/enrichment/applier.ts` lines 99-110
**Apply to:** `applier.ts` (new D-06 block), `books-router.ts` (D-12 diff check), `backfill-reference-pages.ts` (inline predicate via SQL)
```typescript
// Column-level manual gate: if source is 'manual', skip the write entirely.
if (book.<field>_source !== 'manual') {
  updates.<field> = bundle.<value>;
  updates.<field>_source = 'openlibrary';
}
```

### Zod at Route Boundary Pattern
**Source:** `apps/server/src/books/books-router.ts` lines 113-129 (PATCH metadata)
**Apply to:** `books-router.ts` PUT reference_pages rewrite
```typescript
const parsed = schema.safeParse(req.body);
if (!parsed.success) {
  res.status(400).json({ error: parsed.error.flatten() });
  return;
}
```

### Knex Transaction Pattern (D-18)
**Source:** `apps/server/src/enrichment/applier.ts` lines 41-119
**Apply to:** D-06 block slots inside the existing `applyEnrichment` transaction; no new transaction needed
```typescript
await knex.transaction(async (trx) => {
  // All reads and writes through trx, not knex directly
});
```

### getBookById Middleware for diff check
**Source:** `apps/server/src/books/books-router.ts` line 90 + all other routes using `getBookById`
**Apply to:** PUT reference_pages rewrite needs `req.book.reference_pages` and `req.book.reference_pages_source` for the D-12 diff/no-op/clear logic. The `Book` type in common must include `reference_pages_source` before this works.
```typescript
router.put('/:bookId/reference_pages', getBookById, async (req: Request, res: Response) => {
  const book = req.book!;  // Full Book row including reference_pages and reference_pages_source
  ...
```

### Fetch Mock + Timer Pattern (integration tests)
**Source:** `apps/server/src/enrichment/__tests__/phase-04-integration.test.ts` lines 38-80
**Apply to:** All `phase-07-worker.test.ts` and `phase-07-applier.test.ts` test files
```typescript
vi.stubGlobal('fetch', buildFetchMock());
// ...
await runOneTick();
vi.useRealTimers();
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | -- | -- | All Phase 7 files have strong analogs in the existing codebase. |

---

## Metadata

**Analog search scope:** `apps/server/src/`, `apps/web/src/`, `packages/common/types/`
**Files scanned:** 17 primary files + fixtures
**Pattern extraction date:** 2026-04-27

---

## PATTERN MAPPING COMPLETE

**Phase:** 7 - reference-pages-enrichment
**Files classified:** 17 (12 modified, 5 new)
**Analogs found:** 17 / 17

### Coverage
- Files with exact analog: 14 (self-modifications with clear extension points)
- Files with role-match analog: 3 (backfill script, test files, new OL client method)
- Files with no analog: 0

### Key Patterns Identified
- All `*_source` columns follow `string().nullable().checkIn(['openlibrary', 'manual'])` shape from `20260423221600_extend_book_columns.ts`; Phase 7 migration copies exactly one column.
- The D-20 provenance guard (`if (book.field_source !== 'manual') { updates... }`) is the universal pattern in `applier.ts` lines 99-110; the D-06 block is the fifth application.
- Route rewrites use the `PATCH /:bookId/metadata` Zod pattern: `schema.safeParse` + `.flatten()` error + `getBookById` middleware for current-row access.
- Backfill script follows the `tsx` + shared knex singleton pattern; row-by-row iteration through the rate-limited OL client, summary counter logged on exit.
- Integration tests copy the `buildFetchMock` + `runOneTick` + `vi.stubGlobal('fetch', ...)` harness from `phase-04-integration.test.ts` verbatim, extending URL dispatch to cover `/editions.json` and edition 404 paths.

### File Created
`/Users/gbumanzordev/Dev/Personal/KoInsight/.planning/phases/07-reference-pages-enrichment/07-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference analog patterns in PLAN.md files.

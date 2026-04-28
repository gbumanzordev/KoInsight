# Phase 5: Manual Edit + Unmatched Inbox - Pattern Map

**Mapped:** 2026-04-24
**Files analyzed:** 22 (server: 8, web: 12, common: 1, app-mount: 1)
**Analogs found:** 22 / 22

This map tells the planner exactly which existing file each new file should mimic, with concrete excerpts to copy. Phase 5 is integration heavy and almost every primitive already exists in the codebase, so analog quality is overall HIGH.

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/server/src/enrichment/router.ts` (NEW) | router | request-response (CRUD-read) | `apps/server/src/books/books-router.ts` | role + flow exact |
| `apps/server/src/enrichment/unmatched-repository.ts` (NEW) | repository | CRUD (read aggregate) | `apps/server/src/books/books-repository.ts` (`getAllWithData`) | role exact |
| `apps/server/src/books/books-router.ts` (MOD: add PATCH `/:bookId/metadata` + POST `/:bookId/re-enrich`) | router | request-response | self (extend `PUT /:bookId/hide`, `POST /:bookId/genres`) | self extension |
| `apps/server/src/books/books-service.ts` (MOD: `applyManualEdit`) | service | CRUD-write transactional | `apps/server/src/enrichment/applier.ts` (`applyEnrichment`) | role + flow exact |
| `apps/server/src/enrichment/author-upsert.ts` (NEW; extracted) | service helper | CRUD-write | `apps/server/src/enrichment/applier.ts:upsertAuthor` (lines 37-85) | self extraction |
| `packages/common/types/books-edit-api.ts` (NEW) | shared schema | n/a (Zod) | `apps/server/src/enrichment/service.ts` (`Md5Schema`) + `packages/common/types/books-api.ts` | partial (project has no shared Zod yet) |
| `apps/server/src/books/books-router.test.ts` (MOD: extend) | test (supertest) | request-response | self | self extension |
| `apps/server/src/books/__tests__/manual-edit-stickiness.test.ts` (NEW) | test (integration) | CRUD-write | `apps/server/src/enrichment/__tests__/phase-04-applier.test.ts` (assumed shape) + `phase-04-enqueue.test.ts` | role exact |
| `apps/server/src/enrichment/__tests__/unmatched-router.test.ts` (NEW) | test (supertest) | request-response | `apps/server/src/books/books-router.test.ts` | role + flow exact |
| `apps/server/src/enrichment/__tests__/status-router.test.ts` (NEW) | test (supertest) | request-response | `apps/server/src/books/books-router.test.ts` | role + flow exact |
| `apps/server/src/enrichment/__tests__/re-enrich-idempotency.test.ts` (NEW) | test (integration) | event-driven | `apps/server/src/enrichment/__tests__/phase-04-enqueue.test.ts` | role + flow exact |
| `apps/server/src/app.ts` (MOD: mount `/api/enrichment`) | bootstrap | n/a | self (existing `app.use('/api/...', ...)` lines 31-38) | self extension |
| `apps/web/src/api/books.ts` (MOD: `patchBookMetadata`, `reEnrichBook`) | api wrapper | request-response | self (existing `hideBook`, `updateBookReferencePages`) | self extension |
| `apps/web/src/api/enrichment.ts` (NEW: `useEnrichmentStatus`, `useUnmatchedBooks`) | SWR hook | request-response (poll) | `apps/web/src/api/books.ts` (`useBooks`) + `apps/web/src/api/use-book-with-data.ts` | role exact |
| `apps/web/src/components/provenance-badge/provenance-badge.tsx` (NEW) | React component (presentational) | render-only | `apps/web/src/pages/book-page/book-card.tsx` (Mantine usage) | role partial; no exact analog |
| `apps/web/src/components/re-enrich-button/re-enrich-button.tsx` (NEW) | React component | request-response (mutate) | `apps/web/src/pages/book-page/book-page-manage/book-delete.tsx` | role + flow exact |
| `apps/web/src/pages/book-page/book-metadata-edit-modal.tsx` (NEW) | React component (modal shell) | request-response | `apps/web/src/pages/book-page/book-card.tsx` (Modal block lines 79-100) | role + flow exact |
| `apps/web/src/pages/book-page/book-metadata-form.tsx` (NEW) | React component (form) | request-response | `apps/web/src/pages/book-page/book-page-manage/book-reference-pages.tsx` | role exact (form scope) |
| `apps/web/src/pages/book-page/author-row-editor.tsx` (NEW) | React component (form row) | render + state | `apps/web/src/pages/book-page/book-page-manage/book-reference-pages.tsx` | role partial |
| `apps/web/src/pages/settings-page/settings-layout.tsx` (NEW) | React page (layout) | render + nested route | `apps/web/src/components/navbar/navbar.tsx` (NavLink usage) | partial; no Outlet analog yet |
| `apps/web/src/pages/settings-page/unmatched-books-section.tsx` (NEW) | React page section | request-response (poll) | `apps/web/src/pages/books-page/books-page.tsx` (assumed) + `book-page-manage.tsx` | role partial |
| `apps/web/src/pages/settings-page/enrichment-status-cards.tsx` (NEW) | React component (stat cards) | render-only | `apps/web/src/components/statistics/*` (assumed) | role partial |
| `apps/web/src/components/navbar/navbar.tsx` (MOD: add Settings tab + Indicator) | React component | render | self (existing `tabs` array, lines 37-43) | self extension |
| `apps/web/src/routes.ts` (MOD: add `SETTINGS`) | enum/config | n/a | self (existing `RoutePath` enum, lines 3-11) | self extension |
| `apps/web/src/app.tsx` (MOD: nested `/settings` route) | route tree | n/a | self (existing `<Routes>` block, lines 68-84) | self extension |

## Pattern Assignments

### `apps/server/src/enrichment/router.ts` (NEW router, request-response)

**Analog:** `apps/server/src/books/books-router.ts`

**Imports + router skeleton pattern** (books-router.ts lines 1-7):
```typescript
import { NextFunction, Request, Response, Router } from 'express';
import { BooksRepository } from './books-repository';
import { BooksService } from './books-service';
import { coversRouter } from './covers/covers-router';
import { getBookById } from './get-book-by-id-middleware';

const router = Router();
```

**Per-route async handler shape** (books-router.ts lines 14-18):
```typescript
router.get('/', async (req: Request, res: Response) => {
  const returnDeleted = Boolean(req.query.showHidden && req.query.showHidden === 'true');
  const books = await BooksRepository.getAllWithData(returnDeleted);
  res.status(200).json(books);
});
```

**Try/catch error handling pattern** (books-router.ts lines 36-42):
```typescript
try {
  await BooksRepository.delete(book);
  res.status(200).json({ message: 'Book deleted' });
} catch (error) {
  console.error(error);
  res.status(500).json({ error: 'Failed to delete book' });
}
```

**Module export footer** (books-router.ts line 105):
```typescript
export { router as booksRouter };
```
Use `export { router as enrichmentRouter };` for the new file.

**Apply this analog for:** `GET /unmatched` (offset/limit query parsing + repository call), `GET /status` (single repository call returning the four counters).

---

### `apps/server/src/enrichment/unmatched-repository.ts` (NEW repository, CRUD-read)

**Analog:** `apps/server/src/books/books-repository.ts`

**Static-class repository pattern** (books-repository.ts lines 12-30):
```typescript
export class BooksRepository {
  static async getAll(): Promise<Book[]> {
    return db<Book>('book').select('*').where({ soft_deleted: false });
  }

  static async getById(id: number): Promise<Book | undefined> {
    return db<Book>('book').where({ id }).first();
  }
}
```

**Knex `db` import (top of file):** `import { db } from '../knex';` (matches Phase 4 `service.ts` line 2).

**Apply this analog for:** the `getEnrichmentStatusCounts()` GROUP BY query and the `getUnmatchedBooks(offset, limit)` join + count, both already sketched in RESEARCH.md "Code Examples" section. Use `static async` methods on a `UnmatchedRepository` (or named exports — both are present in the codebase: `enrichment/service.ts` uses named exports, `books-repository.ts` uses static class). RESEARCH.md recommends named exports for the new module to match the rest of `enrichment/`.

---

### `apps/server/src/books/books-router.ts` (MOD: PATCH `/:bookId/metadata`, POST `/:bookId/re-enrich`)

**Analog:** self.

**Use existing middleware verbatim** (books-router.ts line 23, 33, 45, 66, 87): `router.patch('/:bookId/metadata', getBookById, async (req, res) => { ... })`. The middleware sets `req.book!` already containing `book.md5`.

**PUT-with-body precedent** (books-router.ts lines 45-61, `PUT /:bookId/hide`):
```typescript
router.put('/:bookId/hide', getBookById, async (req: Request, res: Response) => {
  const book = req.book!;
  const hidden = req.body.hidden;

  if (hidden === undefined || hidden === null) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  try {
    await BooksRepository.softDelete(book.id, hidden);
    res.status(200).json({ message: `Book ${hidden ? 'hidden' : 'shown'}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update book visibility' });
  }
});
```

**Replace the manual `if (...) 400` block with Zod** (per CLAUDE.md "Zod at route boundaries"):
```typescript
const parsed = metadataPatchSchema.safeParse(req.body);
if (!parsed.success) {
  res.status(400).json({ error: parsed.error.flatten() });
  return;
}
```
Pattern reference for `safeParse`: `apps/server/src/enrichment/service.ts` lines 12, 17-21.

---

### `apps/server/src/books/books-service.ts` (MOD: `applyManualEdit`)

**Analog:** `apps/server/src/enrichment/applier.ts`

**Knex transaction shape** (applier.ts lines 87-93):
```typescript
export async function applyEnrichment(
  knex: Knex,
  bookMd5: string,
  jobId: number,
  bundle: EnrichedBundle
): Promise<void> {
  await knex.transaction(async (trx) => {
```

**Author upsert call site** (applier.ts lines 107-127). Reuse this exact shape; the planner is told to extract `upsertAuthor` to a shared helper:
```typescript
const authorIds: number[] = [];
for (const a of bundle.authors) {
  const id = await upsertAuthor(trx, a);
  authorIds.push(id);
}

if (book.authors_source !== 'manual') {
  await trx('book_author').where({ book_md5: bookMd5 }).delete();
  if (authorIds.length > 0) {
    await trx('book_author').insert(
      authorIds.map((author_id, position) => ({
        book_md5: bookMd5,
        author_id,
        position,
        role: 'author',
      }))
    );
  }
}
```
For manual edit, the `if (book.authors_source !== 'manual')` guard is REMOVED (manual edit always wins) and `authors_source = 'manual'` is set in the `updates` object.

**Per-column update with provenance** (applier.ts lines 147-165):
```typescript
const updates: Record<string, unknown> = {
  openlibrary_work_key: bundle.workKey,
  enrichment_status: 'enriched',
};
if (book.publication_year_source !== 'manual') {
  updates.publication_year = bundle.publicationYear;
  updates.publication_year_source = 'openlibrary';
}
// ... other fields
await trx('book').where({ md5: bookMd5 }).update(updates);
```
For manual edit: drop all `if (... !== 'manual')` guards; for every key present in the parsed body, write the value AND `<key>_source = 'manual'`. See RESEARCH.md "PATCH transaction skeleton" for the exact mapping.

---

### `apps/server/src/enrichment/author-upsert.ts` (NEW; extracted)

**Analog:** `apps/server/src/enrichment/applier.ts:upsertAuthor` (lines 37-85)

The full function body is already the canonical pattern. Extract verbatim and add a `source: 'openlibrary' | 'manual'` parameter so manual-edit insertions stamp `nationality_source = 'manual'` instead of hard-coded `'openlibrary'` (lines 47, 67, 81).

**Original gating block** (applier.ts lines 44-49):
```typescript
if (existing.nationality_source === null || existing.nationality_source === 'openlibrary') {
  await trx('author').where({ id: existing.id }).update({
    nationality: a.nationality,
    nationality_source: 'openlibrary',
  });
}
```
Generalize the literal `'openlibrary'` to the `source` param; keep the gate (`source==='manual'` should also be allowed to overwrite `null` and `'openlibrary'`).

---

### `packages/common/types/books-edit-api.ts` (NEW shared Zod schema)

**Analog:** `apps/server/src/enrichment/service.ts` (Zod usage pattern) + `packages/common/types/books-api.ts` (shared types pattern)

**Zod import + schema definition** (service.ts lines 1, 12):
```typescript
import { z } from 'zod';

const Md5Schema = z.string().regex(/^[a-f0-9]{32}$/i);
```

**Common-package type pattern** (books-api.ts top — pure type definitions, ESM):
```typescript
import { Annotation } from './annotation';
// ...
export type BookWithData = Book & Stats & RelatedEntities;
```
Add this barrel re-export to `packages/common/types/index.ts` (line 5 already has `export * from './books-api';` — append `export * from './books-edit-api';`).

**Server-side import idiom for runtime modules from `@koinsight/common`** — RESEARCH.md cites `applier.ts:2`:
```typescript
import { mapOpenLibrarySubjects } from '@koinsight/common/dist/genres/map.js';
```
The new schema must be runtime-importable on the server through the same `dist/*.js` path, so it cannot live in a `.d.ts` file. Author it as `.ts` (compiled to `.js`).

---

### `apps/server/src/app.ts` (MOD: mount `/api/enrichment`)

**Analog:** self.

**Mount block** (app.ts lines 31-38):
```typescript
app.use('/', kosyncRouter); // Needs to be mounted at root to follow KoSync API
app.use('/api/plugin', kopluginRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/books', booksRouter);
app.use('/api/stats', statsRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/open-library', openLibraryRouter);
app.use('/api/ai', openAiRouter);
```
Append: `app.use('/api/enrichment', enrichmentRouter);`. Add the import next to existing `enrichment/*` imports (lines 10-11).

---

### `apps/server/src/books/books-router.test.ts` (MOD: extend)

**Analog:** self.

**Supertest harness pattern** (books-router.test.ts lines 7-11):
```typescript
const app = express();
app.use(express.json());
app.use('/books', booksRouter);
```

**Test-case shape** (lines 49-57):
```typescript
describe('GET /books/:bookId', () => {
  it('returns a book by id', async () => {
    const book = await createBook(db, { title: 'Test Book' });
    const response = await request(app).get(`/books/${book.id}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ title: 'Test Book' }));
  });
});
```
Extend with `describe('PATCH /books/:bookId/metadata', ...)` and `describe('POST /books/:bookId/re-enrich', ...)` blocks.

---

### `apps/server/src/enrichment/__tests__/{unmatched,status}-router.test.ts` (NEW)

**Analog:** `apps/server/src/books/books-router.test.ts` (entire file structure).

Mirror the harness from books-router.test.ts (excerpt above). Mount the new `enrichmentRouter` at `/enrichment`. Use `createBook(db, { enrichment_status: 'failed' })` to seed (factory verified by `phase-04-enqueue.test.ts` line 30).

---

### `apps/server/src/enrichment/__tests__/re-enrich-idempotency.test.ts` (NEW)

**Analog:** `apps/server/src/enrichment/__tests__/phase-04-enqueue.test.ts` (lines 1-50)

**`countJobs` helper + factory pattern** (phase-04-enqueue.test.ts lines 22-43):
```typescript
async function countJobs(bookMd5: string, status?: string): Promise<number> {
  const q = db('enrichment_job').where({ book_md5: bookMd5 });
  if (status) q.andWhere({ status });
  const rows = await q.select('id');
  return rows.length;
}

it('enqueues a pending-status book (default status after insert)', async () => {
  const book = await createBook(db, { md5: 'a'.repeat(32), enrichment_status: 'pending' });
  await enrichmentService.enqueue(book.md5);
  expect(await countJobs(book.md5, 'pending')).toBe(1);
});
```
Same harness, but assert that two POST `/re-enrich` calls produce exactly one open job row (Phase 1 partial UNIQUE).

---

### `apps/server/src/books/__tests__/manual-edit-stickiness.test.ts` (NEW)

**Analog:** `phase-04-enqueue.test.ts` (factory + db assertions) + `applier.ts` flow.

**Test shape:** seed a book, PATCH metadata, assert `*_source = 'manual'`, then call `applyEnrichment` with a fake bundle, assert manual fields unchanged. Both halves are thin combinations of the existing patterns.

---

### `apps/web/src/api/books.ts` (MOD)

**Analog:** self.

**Existing single-line wrapper pattern** (books.ts lines 19-31):
```typescript
export async function hideBook(id: Book['id']) {
  return fetchFromAPI<{ message: string }>(`books/${id}/hide`, 'PUT', { hidden: true });
}

export async function updateBookReferencePages(id: Book['id'], referencePages: number | null) {
  return fetchFromAPI<Book>(`books/${id}/reference_pages`, 'PUT', {
    reference_pages: referencePages,
  });
}
```
Add:
```typescript
export async function patchBookMetadata(id: Book['id'], patch: MetadataPatch) {
  return fetchFromAPI<BookWithData>(`books/${id}/metadata`, 'PATCH', patch);
}

export async function reEnrichBook(id: Book['id']) {
  return fetchFromAPI<{ job: EnrichmentJob }>(`books/${id}/re-enrich`, 'POST', {});
}
```
Note: `fetchFromAPI` (api.ts lines 4-30) sets `Content-Type: application/json` and JSON-stringifies the body for non-GET methods. PATCH is supported because `method` is just forwarded.

---

### `apps/web/src/api/enrichment.ts` (NEW SWR hook)

**Analog:** `apps/web/src/api/books.ts` (`useBooks`) + `apps/web/src/api/use-book-with-data.ts`

**Plain SWR hook** (use-book-with-data.ts lines 1-7):
```typescript
import { BookWithData } from '@koinsight/common/types';
import useSWR from 'swr';
import { fetchFromAPI } from './api';

export function useBookWithData(id: number) {
  return useSWR(`books/${id}`, () => fetchFromAPI<BookWithData>(`books/${id}`));
}
```

**SWR with options + fallbackData** (books.ts lines 5-13):
```typescript
export function useBooks({ showHidden } = { showHidden: false }) {
  return useSWR(
    ['books', showHidden],
    () => fetchFromAPI<BookWithData[]>('books', 'GET', { showHidden }),
    { fallbackData: [] }
  );
}
```

**Conditional polling extension (Phase 5 specific):** add a `refreshInterval` option per RESEARCH.md Pattern 4. The hook signature for `useBookWithData` should be extended to accept polling, not duplicated.

---

### `apps/web/src/components/provenance-badge/provenance-badge.tsx` (NEW)

**Analog:** No exact analog (no shared "tag" component yet). Closest: Mantine `Badge` usage in book-card.tsx (`<Tooltip>` wrappers) — but Phase 5 has no in-repo Badge precedent. Use Mantine's `Badge` directly per UI-SPEC color contract.

**Pattern source:** UI-SPEC.md lines 94-95 (literal copy + colors locked):
- `<Badge color="yellow" variant="light">manual</Badge>`
- `<Badge color="blue" variant="light">OpenLibrary</Badge>`
- Return `null` when `source` is `null` (no badge for unset).

---

### `apps/web/src/components/re-enrich-button/re-enrich-button.tsx` (NEW)

**Analog:** `apps/web/src/pages/book-page/book-page-manage/book-delete.tsx`

**Loading + notification + mutate pattern** (book-delete.tsx lines 36-56):
```typescript
const onDelete = async () => {
  try {
    setDeleteLoading(true);
    await deleteBook(book.id);
    await mutate('books');
    navigate(RoutePath.HOME);
    notifications.show({
      title: 'Book deleted',
      message: `${book ? `"${book?.title}"` : 'Book'} deleted successfully.`,
      color: 'green',
      position: 'top-center',
    });
  } catch (error) {
    notifications.show({
      title: 'Failed to delete the book',
      message: 'Failed to delete the book.',
      color: 'red',
      position: 'top-center',
    });
  }
};
```
For Re-enrich: replace `deleteBook` with `reEnrichBook`, replace `'books'` mutate key with `` `books/${id}` ``, replace toast strings with the locked copy in UI-SPEC.md "Toasts" table.

**Disable + tooltip** — per D-13 wrap with Mantine `Tooltip label="Already running"` and set `disabled={isOpen(status)}`. UI-SPEC line 196 confirms.

---

### `apps/web/src/pages/book-page/book-metadata-edit-modal.tsx` (NEW)

**Analog:** `apps/web/src/pages/book-page/book-card.tsx` (Modal block)

**Modal + useDisclosure pattern** (book-card.tsx lines 38-39, 79-100):
```typescript
const [isCoverSelectorOpened, { open: openCoverSelector, close: closeCoverSelector }] =
  useDisclosure(false);

<Modal
  opened={isCoverSelectorOpened}
  onClose={closeCoverSelector}
  title="Change book cover"
  size="calc(100vw - 3rem)"
  centered
>
  {/* body */}
</Modal>
```
For Phase 5: `size="lg"` per UI-SPEC line 60; `title="Edit metadata"` per UI-SPEC button copy.

---

### `apps/web/src/pages/book-page/book-metadata-form.tsx` (NEW)

**Analog:** `apps/web/src/pages/book-page/book-page-manage/book-reference-pages.tsx`

**Loading state + notifications pattern** (book-reference-pages.tsx lines 16-37):
```typescript
const [updateLoading, setUpdateLoading] = useState(false);

const onUpdateReferencePages = async () => {
  try {
    setUpdateLoading(true);
    await updateBookReferencePages(book.id, referencePages);
    notifications.show({ title: '...', color: 'green', position: 'top-center' });
  } catch (error) {
    notifications.show({ title: 'Failed ...', color: 'red', position: 'top-center' });
  } finally {
    setUpdateLoading(false);
  }
};
```
Replace `useState` + manual handlers with `useForm({ resolver: zod4Resolver(metadataPatchSchema) })` (RESEARCH.md Pattern 3 has the full skeleton). Keep the try/catch+notifications shape.

---

### `apps/web/src/pages/book-page/author-row-editor.tsx` (NEW)

**Analog:** `book-reference-pages.tsx` (Mantine input layout) + `book-delete.tsx` (modals.openConfirmModal for OL-key remove confirm).

**Confirm-modal pattern** (book-delete.tsx lines 21-34):
```typescript
modals.openConfirmModal({
  title: 'Delete Book?',
  centered: true,
  children: (<Text size="sm">Are you sure you want to delete <strong>...</strong>?</Text>),
  labels: { confirm: 'Delete', cancel: "No, don't delete it" },
  confirmProps: { color: 'red' },
  onConfirm: onDelete,
});
```
Apply per UI-SPEC "Destructive confirmations": title `Remove author?`, labels `{ confirm: 'Remove', cancel: 'Keep' }`, `confirmProps: { color: 'red' }`. Only fires when row has a saved OL key.

---

### `apps/web/src/pages/settings-page/settings-layout.tsx` (NEW)

**Analog:** `apps/web/src/components/navbar/navbar.tsx` (NavLink + active-state pattern) for the side rail; `apps/web/src/app.tsx` (`<Routes>` block) for the nested route.

**NavLink + active-data-attribute pattern** (navbar.tsx lines 54-65):
```tsx
<NavLink
  className={style.Link}
  data-active={item.link === active || undefined}
  to={item.link}
  key={item.label}
  onClick={() => onClick(item.link)}
>
  <item.icon className={style.LinkIcon} stroke={1.5} />
  <span>{item.label}</span>
</NavLink>
```
Note: `navbar.module.css` lines 37-46 already define the `[data-active]` violet-light styling, which the UI-SPEC color contract calls out for the side-nav active section. Reuse the CSS module idiom (new file: `settings-layout.module.css`).

---

### `apps/web/src/pages/settings-page/unmatched-books-section.tsx` + `enrichment-status-cards.tsx` (NEW)

**Analog (list + pagination):** `apps/web/src/api/books.ts` `useBooks` for the SWR shape + Mantine `Pagination` (no in-repo precedent — Mantine docs).

**Analog (stat cards):** No exact analog in the inspected dirs. Use Mantine `Paper` with the typography contract from UI-SPEC line 80 (28px / 600 numerals; 14px / 400 dimmed label).

**SWR poll wiring (use enrichment.ts hook):** add `{ refreshInterval: 5000 }` per D-14. Same SWR key in Navbar `Indicator` (per A6) so a single poll feeds both surfaces.

---

### `apps/web/src/components/navbar/navbar.tsx` (MOD)

**Analog:** self.

**Tabs array extension point** (navbar.tsx lines 37-43):
```typescript
const tabs = [
  { link: RoutePath.BOOKS, label: 'Books', icon: IconBooks },
  { link: RoutePath.CALENDAR, label: 'Calendar', icon: IconCalendar },
  { link: RoutePath.STATS, label: 'Reading stats', icon: IconChartBar },
  { link: RoutePath.SYNCS, label: 'Progress syncs', icon: IconReload },
  { onClick: openDownload, label: 'KOReader Plugin', icon: IconDownload },
];
```
Add `{ link: RoutePath.SETTINGS, label: 'Settings', icon: IconSettings }`. Wrap the rendered NavLink for SETTINGS with Mantine `<Indicator label={status?.failed} disabled={!status?.failed} ...>` per UI-SPEC line 200 + Pitfall 7 (use `disabled={!count}`, NOT `label={0}`).

---

### `apps/web/src/routes.ts` (MOD)

**Analog:** self.

**Enum extension** (routes.ts lines 3-11):
```typescript
export enum RoutePath {
  BOOKS = '/books',
  BOOK = '/books/:id',
  CALENDAR = '/calendar/',
  STATS = '/stats/',
  SYNCS = '/syncs',
  HOME = BOOKS,
}
```
Append:
```typescript
SETTINGS = '/settings',
SETTINGS_UNMATCHED = '/settings/unmatched',
```
(Naming choice for the nested-route option; planner picks per D-10.)

---

### `apps/web/src/app.tsx` (MOD: nested `/settings` route)

**Analog:** self.

**Routes block** (app.tsx lines 68-84):
```tsx
<Routes>
  <Route index element={<Navigate to={RoutePath.BOOKS} />} />
  <Route path={RoutePath.BOOKS} element={<BooksPage />} />
  <Route path={RoutePath.BOOK} element={<BookPage />} />
  ...
  <Route path="*" element={<Stack ...>...</Stack>} />
</Routes>
```
Add (per RESEARCH.md Open Question 4 recommendation):
```tsx
<Route path={RoutePath.SETTINGS} element={<SettingsLayout />}>
  <Route index element={<Navigate to="unmatched" replace />} />
  <Route path="unmatched" element={<UnmatchedBooksSection />} />
</Route>
```
This requires `SettingsLayout` to render an `<Outlet />`.

---

## Shared Patterns

### Pattern A: Express Router with `getBookById` middleware

**Source:** `apps/server/src/books/get-book-by-id-middleware.ts` lines 13-36

```typescript
export async function getBookById(req: Request, res: Response, next: NextFunction) {
  const bookId = req.params.bookId;
  if (!bookId) {
    res.status(400).json({ error: 'Book ID is required' });
    return;
  }
  try {
    const book = await BooksRepository.getById(Number(bookId));
    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }
    req.book = book;
    next();
  } catch (error) {
    console.error('Error fetching book:', error);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
}
```
**Apply to:** every new `/:bookId/...` route (`PATCH metadata`, `POST re-enrich`). The middleware sets `req.book` with `book.md5` already on it, which is what `enrichmentService.enqueue(...)` expects.

### Pattern B: Zod boundary validation

**Source:** `apps/server/src/enrichment/service.ts` lines 12, 17-21
```typescript
const Md5Schema = z.string().regex(/^[a-f0-9]{32}$/i);
const parsed = Md5Schema.safeParse(bookMd5);
if (!parsed.success) {
  console.warn('enrichment enqueue: invalid md5', { bookMd5 });
  return;
}
```
**Apply to:** `PATCH /:bookId/metadata` body parsing. Replace `console.warn` with `res.status(400).json({ error: parsed.error.flatten() })`.

### Pattern C: Knex transaction shape

**Source:** `apps/server/src/enrichment/applier.ts` lines 87-93, 165, 167-170
```typescript
await knex.transaction(async (trx) => {
  // ... reads + writes ...
  await trx('book').where({ md5: bookMd5 }).update(updates);
  await trx('enrichment_job').where({ id: jobId }).update({ status: 'succeeded', updated_at: trx.fn.now() });
});
```
**Apply to:** `BooksService.applyManualEdit` (transactional all-or-nothing PATCH), and verifiably to the `book_author` rewrite (DELETE + INSERT inside one trx, no FK collisions per Pitfall 6).

### Pattern D: SWR + `fetchFromAPI` (no custom HTTP client)

**Source:** `apps/web/src/api/api.ts` lines 4-30 (the only HTTP wrapper) + `apps/web/src/api/books.ts` lines 5-13
```typescript
return fetch(`${API_URL}/${endpoint}${searchParams}`, {
  method,
  body: method !== 'GET' && body ? JSON.stringify(body) : null,
  headers: { 'Content-Type': 'application/json' },
});
```
**Apply to:** every Phase 5 web fetch (`patchBookMetadata`, `reEnrichBook`, `useEnrichmentStatus`, `useUnmatchedBooks`). Anti-pattern: do NOT introduce `axios` / `ky` / a second wrapper.

### Pattern E: Mantine notification toast

**Source:** `apps/web/src/pages/book-page/book-page-manage/book-delete.tsx` lines 42-55, `book-reference-pages.tsx` lines 20-31
```typescript
notifications.show({
  title: 'Book deleted',
  message: `${...}`,
  color: 'green',
  position: 'top-center',
});
```
**Apply to:** all Phase 5 toasts (save success/failure, re-enrich kickoff/success/failure). Strings locked in UI-SPEC.md "Toasts" table. Keep `position: 'top-center'` for consistency with existing toasts.

### Pattern F: `useDisclosure` modal

**Source:** `apps/web/src/pages/book-page/book-card.tsx` lines 38-39, 79-100; `apps/web/src/components/navbar/navbar.tsx` line 35
```typescript
const [opened, { open, close }] = useDisclosure(false);
<Modal opened={opened} onClose={close} title="..." size="lg" centered>...</Modal>
```
**Apply to:** the `BookMetadataEditModal`. Open trigger is the new "Edit metadata" button on the book detail page; close discards form state silently per D-02.

### Pattern G: Confirm modal (`@mantine/modals`)

**Source:** `apps/web/src/pages/book-page/book-page-manage/book-delete.tsx` lines 21-34
```typescript
modals.openConfirmModal({
  title: '...',
  centered: true,
  children: (<Text size="sm">...</Text>),
  labels: { confirm: 'Delete', cancel: "No, don't delete it" },
  confirmProps: { color: 'red' },
  onConfirm: onDelete,
});
```
**Apply to:** "Remove author with OL key" confirmation only (UI-SPEC). Cancel-while-dirty is silent (D-02), so no confirm there.

### Pattern H: Test factory + `:memory:` SQLite harness

**Source:** `apps/server/src/enrichment/__tests__/phase-04-enqueue.test.ts` lines 22-43, `apps/server/src/books/books-router.test.ts` lines 7-11
```typescript
const app = express();
app.use(express.json());
app.use('/books', booksRouter);
// ...
const book = await createBook(db, { md5: 'a'.repeat(32), enrichment_status: 'pending' });
```
**Apply to:** every new test file. Use `createBook(db, ...)` factory (existing helper at `apps/server/src/db/factories/book-factory.ts`).

### Pattern I: Mantine `[data-active]` violet styling

**Source:** `apps/web/src/components/navbar/navbar.module.css` lines 37-46
```css
&[data-active] {
  &,
  &:hover {
    background-color: var(--mantine-color-violet-light);
    color: var(--mantine-color-violet-text);
  }
}
```
**Apply to:** `SettingsLayout` side-nav. Reuse the `data-active` CSS-module idiom; do NOT diverge to Mantine `active` prop (the existing app uses the data attribute everywhere).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `provenance-badge.tsx` | presentational | render-only | No precedent for a pure Mantine `Badge` wrapper component in the codebase; UI-SPEC fully specifies colors/copy so analog is not required. |
| `enrichment-status-cards.tsx` | presentational | render-only | No `Paper`-based stat-card precedent in the inspected components. UI-SPEC locks the typography (28px/600 numerals over 14px/400 label) so this is a green-field component. |
| `settings-layout.tsx` (`<Outlet />` shell) | layout | render | No nested-route layout exists yet; the closest is `app.tsx`'s `<Routes>` block, which is route-tree definition, not an Outlet host. Planner authors green-field with NavLink + Outlet. |
| `mantine-form-zod-resolver` form | form | render | New library this phase; no in-repo precedent. RESEARCH.md Pattern 3 carries the canonical skeleton; STATE.md/UI-SPEC verify `zod4Resolver` is the correct export. |

## Metadata

**Analog search scope:**
- `apps/server/src/books/`, `apps/server/src/enrichment/`, `apps/server/src/`, `apps/server/src/db/migrations/`
- `apps/web/src/api/`, `apps/web/src/components/`, `apps/web/src/pages/book-page/`, `apps/web/src/pages/`
- `packages/common/types/`

**Files scanned:** ~24 read in full, ~10 listed.
**Pattern extraction date:** 2026-04-24

## PATTERN MAPPING COMPLETE

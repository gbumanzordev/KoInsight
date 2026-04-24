# Phase 5: Manual Edit + Unmatched Inbox - Research

**Researched:** 2026-04-24
**Domain:** Express 5 + Knex/SQLite API; React 18 + Mantine 8 + SWR frontend; Zod-shared validation
**Confidence:** HIGH

## Summary

Phase 5 wires a Mantine `Modal` edit form, a `/settings` shell with an Unmatched Books section, and a small set of new API endpoints onto the Phase 4 enrichment pipeline. The hard work is already in place: `enrichmentService.enqueue(md5)` is the exact entry point the re-enrich endpoint should call, the per-field manual-wins guard is already enforced in `applier.ts` (any field whose `*_source = 'manual'` is unconditionally skipped), and the `enrichment_job` partial UNIQUE index already prevents double-submit. The remaining work is plumbing: a PATCH router with a Zod schema shared from `@koinsight/common`, two GET endpoints for `/api/enrichment/{unmatched,status}`, the form + list React surfaces, and one nav-bar wiring change.

Three concrete planning decisions are pre-resolved by code inspection: (1) the existing `getBookById` middleware uses `Number(req.params.bookId)` against `book.id` (numeric primary key), so adopting `:bookId` for the new routes is a one-line consistency win that requires no new lookup, no migration, and zero divergence from REQUIREMENTS' `:md5` wording (the wording is descriptive, not normative; the actual identifier is whatever the existing routes accept); (2) `mantine-form-zod-resolver@1.3.0` ships a dedicated `zod4Resolver` export specifically for Zod v4 and the project pins `zod@4.3.5`, so the STATE.md compatibility concern is resolved before install; (3) the entire pipeline already routes on `book.md5` internally (see `applyEnrichment(knex, bookMd5, ...)`), so the existing middleware's `Number(bookId) -> book.id -> book.md5` translation is the only reconciliation needed.

**Primary recommendation:** Adopt the existing `:bookId` (numeric) URL convention and reuse `getBookById` as middleware; share Zod schemas from `@koinsight/common/types`; build the form with `useForm({ resolver: zod4Resolver(schema) })`; conditionally poll SWR via `refreshInterval: (data) => isOpenStatus(data?.enrichment_status) ? 2000 : 0`; write the metadata patch as one `knex.transaction` that pre-reads the row, applies only fields present in the body, stamps each touched field's `*_source='manual'`, and reconciles `book_author` rows by full-replacement (delete + reinsert) inside the transaction.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Metadata edit validation | API (Zod at boundary) | Browser (`zod4Resolver` reuses same schema) | CLAUDE.md mandates Zod at route boundaries; sharing the schema avoids drift |
| Re-enrich trigger | API | — | `enrichmentService.enqueue` already exists in-process; UI just calls 202 endpoint |
| Manual-wins enforcement | API (applier.ts) | DB (`*_source` columns) | Phase 4 D-20 guard reads `*_source` before writing; Phase 5 only writes the lock |
| Unmatched list pagination | DB (offset/limit + index) | API (router) | SQLite handles offset/limit cheaply at this scale |
| Status counters | DB (single GROUP BY) | API | Aggregate is one query; no caching needed |
| Edit form UI | Browser (`@mantine/form`) | — | Modal + `useForm` is purely client-side |
| Conditional polling | Browser (SWR `refreshInterval`) | API (returns terminal status) | API exposes status; client decides when to stop |
| Nav badge count | Browser (SWR poll on `/api/enrichment/status`) | API | One global `useSWR` in Navbar; refetch every 5000 ms |

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Edit form is a Mantine `Modal` over the book detail page; opened via `useDisclosure` from an "Edit metadata" button. No new route, no Manage tab takeover.
- **D-02:** Cancel discards form state silently. No confirm-on-discard. SWR refetches on next open.
- **D-03:** Form is `@mantine/form` + `mantine-form-zod-resolver` (both new deps in this phase). The Zod schema is defined ONCE in `packages/common` and reused server-side.
- **D-04:** Authors edited via row-per-author editor. Each row: name `TextInput`, nationality `Select` (ISO 3166-1 alpha-2), read-only OL key + unlink button. Add / remove / reorder.
- **D-05:** OL key is read-only; users may unlink (`openlibrary_key = null`) but cannot type one.
- **D-06:** Server reconciles `author` / `book_author` rows. Orphan author GC is **planner's choice** (see Claude's Discretion).
- **D-07:** New `/settings` route hosts an "Unmatched books" section. Settings is scaffolded for future sections; only Unmatched ships.
- **D-08:** Settings = vertical side-nav (Mantine `NavLink`) + content pane.
- **D-09:** New top-level "Settings" tab in `Navbar`. Mantine `Indicator` shows the failed count; hidden at zero.
- **D-10:** Route path `/settings`. Section routing inside (nested vs query param) is **planner's choice**.
- **D-11:** `POST /api/books/:bookId/re-enrich` returns `202 Accepted` with the current `enrichment_job` row state.
- **D-12:** Book detail page polls SWR at `refreshInterval: 2000` while `enrichment_status ∈ {pending, running}`; stops on terminal.
- **D-13:** Re-enrich button disabled with tooltip "Already running" while pending/running. Server enforces idempotency via the Phase 1 partial UNIQUE index.
- **D-14:** Unmatched inbox list polls at `refreshInterval: 5000`. No per-row polling. Books transitioning out of `failed` drop off naturally.
- **D-15:** Provenance `Badge` to the right of each field label: "manual" (yellow) / "OpenLibrary" (blue). NULL `*_source` renders no badge.
- **D-16:** 4 stat cards (pending / running / enriched / failed) shown ONLY at top of Unmatched section. No counters elsewhere.
- **D-17:** `failed` count drives the Settings nav badge (D-09). Other three are informational.
- **D-18:** New module `apps/server/src/enrichment/router.ts` exposing `GET /api/enrichment/unmatched` and `GET /api/enrichment/status`. `books-router` gains `PATCH /:bookId/metadata` and `POST /:bookId/re-enrich`. The `:md5` vs `:bookId` debate is resolved here (see § Identifier Decision).
- **D-19:** `PATCH` accepts a Zod-validated partial body. Each present field is written; its `*_source` flips to `'manual'`. Absent fields are NOT touched.
- **D-20:** `/api/enrichment/unmatched` uses offset/limit pagination, sorted `enrichment_job.updated_at DESC`, fallback `book.title`. Filter: `failed` only this phase.

### Claude's Discretion

- Section routing inside `/settings` (nested vs query param).
- Inbox SWR `refreshInterval` exact tuning (default 5000 ms; range 3000-10000).
- Whether to GC orphan `author` rows on remove.
- Drag-reorder vs up/down buttons for author rows (UI-SPEC locks: up/down `ActionIcon` buttons, no DnD).
- Toast copy and error-message wording (UI-SPEC locks final copy).
- Per-row spinner during inbox poll cycles (UI-SPEC: omit).

### Deferred Ideas (OUT OF SCOPE)

- User and password section in Settings.
- Import-debug / backfill-status admin views.
- Inbox filter chips for `pending` / `running` / `enriched` (only `failed` ships).
- Per-row spinner during poll.
- Drag-reorder for author rows.
- Bulk operations in inbox (v2).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EDIT-01 | `PATCH /api/books/:md5/metadata` accepts Zod-validated body (authors entities, genres, year, language, nationality_overrides) | § Edit API Contract; shared Zod schema; `applyEnrichment` author upsert pattern transferable |
| EDIT-02 | Each changed field flips `*_source = 'manual'` | § PATCH transaction; Phase 4 applier.ts proves the pattern |
| EDIT-03 | `POST /api/books/:md5/re-enrich` re-runs enrichment honoring manual locks | § Re-enrich endpoint; `enrichmentService.enqueue(md5)` exists; partial UNIQUE prevents dupes |
| EDIT-04 | `GET /api/enrichment/unmatched` paginated list of `enrichment_status='failed'` | § Unmatched list query; offset/limit + composite index |
| EDIT-05 | `GET /api/enrichment/status` aggregate counters | § Status aggregate query (single GROUP BY) |
| UI-01 | Mantine form with `@mantine/form` + `mantine-form-zod-resolver`, all field types | § Form patterns; verified `zod4Resolver` available |
| UI-02 | Provenance badge per field | § ProvenanceBadge; `*_source` columns already populated by Phase 4 |
| UI-03 | Save calls PATCH; cancel reverts; success toast + SWR mutation | § SWR mutation pattern from existing api/books.ts |
| UI-04 | Unmatched view + per-book Edit/Re-enrich + nav count badge | § Settings page layout; Mantine `Indicator` |
| UI-05 | Book detail shows enrichment status + Re-enrich button | § Re-enrich UX; conditional `refreshInterval` polling |

## Project Constraints (from CLAUDE.md)

- **Stack lock:** Express 5, Knex 3.1 + better-sqlite3, React 18 + Mantine 8, SWR. Do NOT introduce alternative UI libraries, alternative form/state libraries, or alternative HTTP clients.
- **Zod at route boundaries:** PATCH must validate via Zod. Reuse the `@koinsight/common` schema, do not hand-roll a second validator.
- **Ramda is available** for functional idioms; existing code uses it. Not required.
- **Prettier-only formatting** (`npx prettier --write .`). No ESLint.
- **Plain ASCII, no em dashes** (also user global rule). Confirmed UI-SPEC copy is em-dash-free.
- **Node >= 22, npm 10.2.4.**
- **kosync-router root-mounted at `/`:** Phase 5 endpoints are all under `/api/*`, no conflict.
- **`@koinsight/common` is `"type": "module"` ESM** with a `dist/` build step. Existing pattern: `import { mapOpenLibrarySubjects } from '@koinsight/common/dist/genres/map.js'` (see applier.ts). New shared Zod schemas should be importable the same way.
- **50mb JSON limit** is set on Express; PATCH bodies are tiny (kilobytes), no impact.

## Standard Stack

### Core (already installed; reuse)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@mantine/core` | 8.3.12 | Modal, Badge, NavLink, Indicator, Select, MultiSelect, NumberInput, TextInput, Pagination, Paper, Title, ActionIcon, Tooltip, LoadingOverlay, Alert, Stack, Group, Flex | UI library lock per CLAUDE.md |
| `@mantine/hooks` | 8.3.12 | `useDisclosure` for modal lifecycle | Existing pattern in `book-card.tsx` |
| `@mantine/notifications` | 8.3.12 | `notifications.show` for save / re-enrich toasts | UI-SPEC contract |
| `@mantine/modals` | 8.3.12 | `modals.openConfirmModal` for "Remove author" confirm | Existing pattern in `book-delete.tsx` |
| `@tabler/icons-react` | 3.36.1 | `IconSettings`, `IconTrash`, `IconArrowUp`, `IconArrowDown`, `IconX`, `IconRefresh` | UI-SPEC |
| `swr` | 2.3.8 | All data fetching + conditional polling via `refreshInterval` | App-wide pattern |
| `react-router` | 7.9.4 | Nested route for `/settings` and `/settings/<section>` | Already in use |
| `zod` | 4.3.5 | Server + shared schema | Already a server dep; pins to v4 |
| `knex` | 3.1.0 | Query builder for new endpoints + manual transactions | Existing pattern |

### New (install in this phase)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@mantine/form` | 8.3.12 | `useForm` for the edit form | Mantine ecosystem standard, version-locked to existing Mantine packages |
| `mantine-form-zod-resolver` | 1.3.0 | `zod4Resolver` import for Zod v4 schemas | Verified Zod v4 support; latest version `[VERIFIED: npm view 1.3.0]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@mantine/form` | `react-hook-form` | Smaller, but a second form library in a Mantine-only codebase; CLAUDE.md UI lock argues against |
| `mantine-form-zod-resolver` `zod4Resolver` | Hand-written resolver `validate: (values) => schema.safeParse(values).error?.flatten().fieldErrors` | Same shape; only meaningful if compat breaks. Resolver works fine, no fallback needed |
| Offset/limit pagination | Cursor pagination on `enrichment_job.updated_at` | Cursor is more correct under writes; offset is simpler and inbox is small (n < 1000); D-20 locks offset |

**Installation:**

```bash
npm --workspace=web install @mantine/form@8.3.12 mantine-form-zod-resolver@1.3.0
```

**Version verification:** `npm view mantine-form-zod-resolver version` returned `1.3.0` `[VERIFIED]`. `mantine-form@8.3.12` exists in the Mantine 8.3.12 release line `[VERIFIED: matches existing @mantine/* dep pins in apps/web/package.json]`.

## Architecture Patterns

### System Architecture Diagram

```
                    USER ACTIONS                                  SERVER STATE
                    -------------                                 ------------

Book detail "Edit metadata"  ───►  Modal opens (useDisclosure)
                                   │
                                   ▼
                                   useForm + zod4Resolver
                                   │  (validates client-side)
                                   ▼
        on submit: fetchFromAPI("books/{id}/metadata", "PATCH", body)
                                   │
                                   ▼
                          Express PATCH /api/books/:bookId/metadata
                                   │
                                   ├─► getBookById middleware (numeric id → book row)
                                   │
                                   ▼
                          metadataPatchSchema.parse(body)  [Zod, shared with web]
                                   │
                                   ▼
                          knex.transaction:                       ┌─────────────────────────┐
                            • SELECT current *_source columns   ──┤ book table              │
                            • UPSERT authors (D-19 strategy)    ──┤ author table            │
                            • DELETE+INSERT book_author rows    ──┤ book_author junction    │
                            • DELETE+INSERT book_genre rows     ──┤ book_genre + genre      │
                            • UPDATE book SET ... *_source =    ──┤ book.*_source = manual  │
                              'manual' for each touched field
                                   │
                                   ▼
                          200 OK { book: BookWithData }
                                   │
                                   ▼
                          Web: mutate(bookSwrKey) → notification

Book detail "Re-enrich" ──────►   POST /api/books/:bookId/re-enrich
                                   │
                                   ▼
                          enrichmentService.enqueue(book.md5)        ┌─────────────────────────┐
                            (INSERT enrichment_job ON CONFLICT  ─────┤ enrichment_job          │
                             DO NOTHING; partial UNIQUE on open)     │ partial UNIQUE          │
                                   │
                                   ▼                                 ┌─────────────────────────┐
                          202 Accepted { job: { id, status,     ──┐  │ Phase 4 worker          │
                            attempts, last_error } }              │  │ polls every 1500ms,     │
                                   │                              └─►│ runs applier.ts which   │
                                   ▼                                 │ honors *_source=manual  │
                          Web SWR refreshInterval=2000ms                └─────────────────────────┘
                            while status ∈ {pending, running}
                            stops on terminal → toast

Settings page mount ──────────►  GET /api/enrichment/status (SWR poll 5000ms)
                                 │     SELECT enrichment_status, COUNT(*)
                                 │     FROM book GROUP BY enrichment_status
                                 ▼
                                 4 stat cards rendered
                                 │
                                 ▼
                                 GET /api/enrichment/unmatched?offset=0&limit=20
                                       SELECT b.*, ej.updated_at, ej.last_error
                                       FROM book b
                                       LEFT JOIN enrichment_job ej ON ej.book_md5 = b.md5
                                       WHERE b.enrichment_status = 'failed'
                                       ORDER BY ej.updated_at DESC, b.title
                                       LIMIT ? OFFSET ?

Navbar mount ─────────────────►  GET /api/enrichment/status (same SWR key, dedupes)
                                 │
                                 ▼
                                 Indicator label={failedCount} disabled={failedCount===0}
```

### Recommended Project Structure

**Server additions:**

```
apps/server/src/
├── books/
│   ├── books-router.ts             # add PATCH /:bookId/metadata + POST /:bookId/re-enrich
│   ├── books-service.ts            # add applyManualEdit(book, patch) (transactional)
│   ├── books-repository.ts         # add new author reconciliation queries (or push into service)
│   └── metadata-edit-schema.ts     # OPTIONAL local re-export from @koinsight/common
├── enrichment/
│   ├── router.ts                   # NEW: GET /unmatched, GET /status
│   ├── unmatched-repository.ts     # NEW: pagination + counts queries
│   └── service.ts                  # unchanged (re-enrich reuses enqueue)
└── app.ts                          # mount new enrichment router at /api/enrichment

packages/common/
└── types/
    └── books-api.ts (or new books-edit-api.ts)
                                     # NEW: metadataPatchSchema (Zod) + inferred type
```

**Web additions:**

```
apps/web/src/
├── api/
│   ├── books.ts                    # add patchBookMetadata, reEnrichBook
│   └── enrichment.ts               # NEW: useEnrichmentStatus, useUnmatchedBooks
├── components/
│   ├── navbar/
│   │   └── navbar.tsx              # add Settings tab + Indicator wrapping
│   ├── provenance-badge/
│   │   └── provenance-badge.tsx    # NEW: pure presentational badge
│   └── re-enrich-button/
│       └── re-enrich-button.tsx    # NEW: shared button with disabled-while-pending state
├── pages/
│   ├── book-page/
│   │   ├── book-metadata-edit-modal.tsx     # NEW
│   │   ├── book-metadata-form.tsx           # NEW
│   │   ├── author-row-editor.tsx            # NEW
│   │   └── book-page.tsx                    # extend: Edit metadata button + Re-enrich + status
│   └── settings-page/
│       ├── settings-layout.tsx              # NEW: side-nav + outlet
│       ├── unmatched-books-section.tsx      # NEW: stat cards + paginated list
│       └── enrichment-status-cards.tsx      # NEW: 4 Paper cards
├── routes.ts                       # add SETTINGS = '/settings' (and SETTINGS_UNMATCHED if nested)
└── app.tsx                         # mount /settings route tree
```

### Pattern 1: Identifier in Routes (RESOLVED)

**Decision:** Use `:bookId` (numeric) for all new endpoints. Reuse `getBookById` middleware verbatim.

**Why:** The existing middleware does `BooksRepository.getById(Number(bookId))` against `book.id`. The middleware sets `req.book` which already exposes `book.md5`. The Phase 4 enrichment internally identifies by `md5` (e.g., `enrichmentService.enqueue(book.md5)`, `applyEnrichment(knex, bookMd5, ...)`). The translation `bookId(numeric) → book.md5(string)` is one already-working middleware step, NOT a migration.

REQUIREMENTS.md uses `:md5` as descriptive prose, not normative URL structure (compare with `book.id` being the actual primary key in the schema). Adopting numeric `:bookId` keeps the existing fleet of routes consistent (`/:bookId`, `/:bookId/cover`, `/:bookId/genres`, `/:bookId/hide`, `/:bookId/reference_pages`).

**Both columns exist on every book row:** `book.id` (autoincrement integer, primary key) and `book.md5` (32-char hex, unique). Verified via `packages/common/types/book.ts` and `apps/server/src/books/books-repository.ts` patterns.

**Migration impact:** ZERO. No new index, no new column.

```typescript
// apps/server/src/books/books-router.ts (sketch)
router.patch('/:bookId/metadata', getBookById, async (req, res) => {
  const parsed = metadataPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const updated = await BooksService.applyManualEdit(req.book!, parsed.data);
  res.status(200).json(updated);
});

router.post('/:bookId/re-enrich', getBookById, async (req, res) => {
  await enrichmentService.enqueue(req.book!.md5);
  const job = await db('enrichment_job')
    .where({ book_md5: req.book!.md5 })
    .orderBy('id', 'desc')
    .first();
  res.status(202).json({ job });
});
```

### Pattern 2: Shared Zod Schema (Server + Web)

The Phase 1 D-21 note explicitly defers Zod schemas for shared types to Phase 5. Define the schema in `packages/common/types/books-edit-api.ts` (or extend `books-api.ts`):

```typescript
// packages/common/types/books-edit-api.ts
import { z } from 'zod';

export const authorEditSchema = z.object({
  name: z.string().trim().min(1, 'Author name is required'),
  nationality: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
  openlibrary_key: z.string().nullable().optional(), // null = explicit unlink (D-05)
});

export const metadataPatchSchema = z.object({
  authors: z.array(authorEditSchema).min(1).optional(),
  genres: z.array(z.string()).optional(),
  publication_year: z.number().int().min(1000).max(2100).nullable().optional(),
  original_language: z.string().regex(/^[a-z]{2}$/).nullable().optional(),
}).strict();

export type MetadataPatch = z.infer<typeof metadataPatchSchema>;
export type AuthorEdit = z.infer<typeof authorEditSchema>;
```

**Web import side:** `import { metadataPatchSchema } from '@koinsight/common'` (re-export via `packages/common/types/index.ts`). Used as `useForm({ resolver: zod4Resolver(metadataPatchSchema), ... })`.

**Server import side:** Same module. Used as `metadataPatchSchema.safeParse(req.body)`.

**Build note:** `packages/common` is `"type": "module"` and ships TypeScript source consumed by Vite directly in dev. The server compiles via `tsc -b` and consumes built `dist/*.js`. The applier.ts already consumes `@koinsight/common/dist/genres/map.js` directly; new schemas should follow the same dist path or work through the package barrel.

[VERIFIED: `apps/server/src/enrichment/applier.ts:2` confirms the `@koinsight/common/dist/...js` import idiom currently in use]

### Pattern 3: `@mantine/form` + `zod4Resolver`

```typescript
// apps/web/src/pages/book-page/book-metadata-form.tsx (sketch)
import { useForm } from '@mantine/form';
import { zod4Resolver } from 'mantine-form-zod-resolver';
import { metadataPatchSchema, type MetadataPatch } from '@koinsight/common';

export function BookMetadataForm({ book, onSubmit }: Props) {
  const form = useForm<MetadataPatch>({
    mode: 'controlled',
    initialValues: {
      authors: book.book_authors?.map(ba => ({
        name: ba.author.name,
        nationality: ba.author.nationality,
        openlibrary_key: ba.author.openlibrary_key,
      })) ?? [],
      genres: book.genres?.map(g => g.name) ?? [],
      publication_year: book.publication_year,
      original_language: book.original_language,
    },
    validate: zod4Resolver(metadataPatchSchema),
  });

  return (
    <form onSubmit={form.onSubmit(onSubmit)}>
      {/* TextInput, MultiSelect, NumberInput, Select wired with form.getInputProps('field') */}
    </form>
  );
}
```

[CITED: https://github.com/mantinedev/mantine-form-zod-resolver/blob/master/README.md — `zod4Resolver` is the Zod v4 export]

### Pattern 4: Conditional SWR Polling (D-12)

```typescript
// Book detail SWR hook (extension of useBookWithData)
const isOpenStatus = (s?: string | null) => s === 'pending' || s === 'running';

export function useBookWithData(id: number) {
  return useSWR(
    `books/${id}`,
    () => fetchFromAPI<BookWithData>(`books/${id}`),
    {
      refreshInterval: (latest) => isOpenStatus(latest?.enrichment_status) ? 2000 : 0,
      revalidateOnFocus: false,
    }
  );
}
```

`refreshInterval` accepting a function `(latestData) => number` is a documented SWR feature; returning `0` halts polling. The hook stops fetching as soon as the latest payload reports `enriched` or `failed`.

[CITED: SWR docs — refreshInterval accepts a function returning the next interval, 0 disables]

### Pattern 5: Mantine `NavLink` Side-nav + `Indicator` Badge

```tsx
// apps/web/src/pages/settings-page/settings-layout.tsx (sketch)
import { NavLink } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';

<Stack gap="xs" w={240}>
  <NavLink
    href="#"
    label="Unmatched books"
    leftSection={<IconAlertCircle size={16} stroke={1.5} />}
    active={section === 'unmatched'}
    onClick={() => setSection('unmatched')}
  />
</Stack>

// Navbar Indicator wiring:
import { Indicator } from '@mantine/core';
const { data: status } = useEnrichmentStatus(); // SWR refreshInterval 5000
<Indicator label={status?.failed ?? 0} size={16} disabled={!status?.failed} color="red" inline>
  <NavLink ... label="Settings" />
</Indicator>
```

[CITED: https://mantine.dev/core/indicator/ — `disabled` prop hides the badge; `label` accepts number]

### Anti-Patterns to Avoid

- **Hand-rolling another fetch wrapper.** Use `fetchFromAPI` from `apps/web/src/api/api.ts`. It already throws on non-2xx and JSON-parses.
- **Per-row SWR loops in the inbox.** D-14 explicit: one list-level poll. N parallel `useSWR(`books/${id}`)` instances would cause N concurrent polls every 5s.
- **Confirm-on-discard prompt.** D-02 explicit: cancel discards silently.
- **Manual OL key entry in the form.** D-05 explicit: read-only; clear-only.
- **Optimistic update on PATCH.** Server is the source of truth (it stamps `*_source`). Use SWR's `mutate(key)` POST-response to revalidate. Optimistic would race the manual-wins logic.
- **Adding `:md5` routes alongside `:bookId` routes.** Two URL conventions for the same resource is technical debt for zero benefit. Pick one.
- **Allowing `book.id` mutation via PATCH.** The schema is `.strict()` and only enumerates editable fields, so unknown keys are rejected.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Form validation + state | Custom `useState` + manual error handling | `@mantine/form` + `zod4Resolver` | Already shared with server; touched/dirty/error tracking is non-trivial |
| Modal lifecycle | Plain `useState` boolean + portal | `useDisclosure` + Mantine `Modal` | Existing app pattern; focus trap, ESC, overlay all included |
| Toast notifications | Custom alert component | `notifications.show` from `@mantine/notifications` | Already mounted in `app.tsx` |
| Confirm dialog (remove author with OL key) | Inline conditional Modal | `modals.openConfirmModal` | Existing pattern in `book-delete.tsx` |
| Pagination control | Custom prev/next buttons | Mantine `Pagination` | Standard component; already in dep tree |
| Status countdown polling | `setInterval` + manual cleanup | SWR `refreshInterval` (function form) | Race-safe, abort-safe, dedupes |
| Job idempotency | App-layer SELECT-then-INSERT | Phase 1 partial UNIQUE + `ON CONFLICT DO NOTHING` (already in `enqueue`) | Race-safe at the DB layer |
| Author dedup on rename | Custom matching | The Phase 4 `upsertAuthor` strategy (`apps/server/src/enrichment/applier.ts`) | Same OL-key-then-normalized-name pattern works for manual edit |

**Key insight:** Almost every primitive Phase 5 needs already exists in the codebase. The phase is integration, not invention.

## Common Pitfalls

### Pitfall 1: Forgetting `*_source` writes on PATCH

**What goes wrong:** Manual edit succeeds but on next re-enrich the field gets overwritten by OpenLibrary.
**Why it happens:** The applier (Phase 4 D-20) gates writes on `*_source != 'manual'`. If PATCH writes the value but not the source, the lock never engages.
**How to avoid:** Single transaction; for every key in the parsed body, write BOTH the value AND `<key>_source = 'manual'`. The Zod schema's `.strict()` ensures no spurious keys leak through.
**Warning signs:** Re-enrich integration test shows manual fields bouncing back to OpenLibrary values.

### Pitfall 2: Author row reconciliation deletes orphans without coordination

**What goes wrong:** A manual edit removes the only book that referenced an author, the orphan author row sticks around, and Phase 6 yearly report shows a phantom nationality slice.
**Why it happens:** Phase 4 applier always writes new `author` rows but only deletes `book_author` junction rows; `author` rows are never garbage-collected.
**How to avoid:** Decide explicitly. Recommended: **leave orphans in place** for Phase 5 (matches current applier behavior; consistent state). If a future phase wants GC, add it as a one-shot SQL pass. Document the choice in PLAN.md so the planner doesn't accidentally diverge.
**Warning signs:** Yearly report shows authors with zero books.

### Pitfall 3: SWR polling continues after modal close

**What goes wrong:** Modal closes but `refreshInterval` continues firing because the SWR hook lives on the parent page.
**Why it happens:** Polling is page-level, not modal-level. This is correct (the page wants live status), but if you mount a *separate* SWR hook inside the modal you create dual fetches.
**How to avoid:** Single SWR key per book; modal reads from parent's data, doesn't refetch.
**Warning signs:** Network tab shows two `GET /books/:id` calls every 2s.

### Pitfall 4: Empty body PATCH

**What goes wrong:** `PATCH` with `{}` matches the Zod schema (all fields optional) and silently succeeds with no writes.
**Why it happens:** Schema permissiveness.
**How to avoid:** Either (a) reject empty body explicitly with `.refine(obj => Object.keys(obj).length > 0, 'No fields to update')`, or (b) accept the no-op as harmless (it doesn't even open a transaction). Recommended: (a) for clearer client UX.

### Pitfall 5: `enrichment_job` returned by re-enrich endpoint may be a leftover terminal row

**What goes wrong:** D-11 says "return the current `enrichment_job` row state". After `enqueue` (which is `INSERT ... ON CONFLICT DO NOTHING`), an existing OPEN job survives but a previously FAILED terminal job also exists in the table. The naive `SELECT ... ORDER BY id DESC LIMIT 1` returns whichever id is latest, which may be the just-created `pending` row OR a stale `failed` one if `enqueue` no-op'd.
**Why it happens:** There is no schema-level "active row" pointer; the partial UNIQUE only enforces at-most-one open job, multiple terminal jobs can stack up over time.
**How to avoid:** After `enqueue`, query `SELECT * FROM enrichment_job WHERE book_md5 = ? AND status IN ('pending','running') ORDER BY id DESC LIMIT 1`. If null, fall back to most-recent terminal row. The 202 contract should always show an open row when the user just clicked Re-enrich (the partial UNIQUE guarantees this is unambiguous).
**Warning signs:** UI shows `failed` immediately after click.

### Pitfall 6: `book_author` reorder via DELETE+INSERT inside the same transaction can collide with the FK

**What goes wrong:** SQLite enforces FK constraints; if `book_genre` or other tables reference `book_author` (they don't currently — both reference `book.md5` and `genre.id` directly, see Phase 1), a delete-then-insert with the same `(book_md5, author_id)` pair could violate UNIQUE inside the same transaction.
**Why it happens:** Knex/sqlite3 may serialize operations such that the unique check runs before the delete commits.
**How to avoid:** The Phase 4 applier (lines 116-126) already does `DELETE` then `INSERT` inside one `knex.transaction` against `book_author` and it works. Mirror that pattern. If a UNIQUE error emerges in testing, add `pragma defer_foreign_keys = ON` per transaction or drop+recreate index — but Phase 4's tests prove it isn't needed.
**Warning signs:** SQLITE_CONSTRAINT errors during PATCH.

### Pitfall 7: Mantine `Indicator` `label` of `0`

**What goes wrong:** `label={0}` renders the badge with text "0".
**Why it happens:** `0` is truthy as a `number` in `label`.
**How to avoid:** Use `disabled={!count}` (where `count = 0` → `disabled = true`). Verified in UI-SPEC; planner must enforce.

### Pitfall 8: kosync router's root mount

**What goes wrong:** `app.use('/', kosyncRouter)` mounts at root. A new `/settings` route on the FRONTEND, served via the SPA catch-all `/.*/`, could collide if kosync registered a `/settings` endpoint (it does not currently).
**Why it happens:** kosync's KOReader-defined endpoints are enumerated explicitly (`/users/create`, `/users/auth`, `/syncs/progress`, etc.). None match `/settings`.
**How to avoid:** Verified by reading `apps/server/src/kosync/kosync-router.ts` — no `/settings` path. Frontend `/settings` resolves to the SPA fallback and renders the React route tree. **Verified safe.**

## Code Examples

### Status aggregate query (single GROUP BY)

```typescript
// apps/server/src/enrichment/unmatched-repository.ts
import { db } from '../knex';

export async function getEnrichmentStatusCounts() {
  const rows = await db('book')
    .select('enrichment_status')
    .count<Array<{ enrichment_status: string; count: number }>>('* as count')
    .groupBy('enrichment_status');
  // Initialize all keys so the API always returns the four counters even at zero.
  const result = { pending: 0, running: 0, enriched: 0, failed: 0, skipped: 0 };
  for (const row of rows) {
    if (row.enrichment_status in result) {
      (result as any)[row.enrichment_status] = Number(row.count);
    }
  }
  return result;
}
```

**Why one query, not four:** SQLite's GROUP BY on an indexed column (`book.enrichment_status` has a CHECK constraint; we recommend adding an index in this phase if not present — see § Index Recommendations) is O(N) once and produces all four counts.

### Unmatched list query

```typescript
export async function getUnmatchedBooks(offset: number, limit: number) {
  const rows = await db('book as b')
    .leftJoin('enrichment_job as ej', function () {
      this.on('ej.book_md5', '=', 'b.md5')
        .andOn('ej.status', '=', db.raw('?', ['failed']));
    })
    .where('b.enrichment_status', 'failed')
    .select(
      'b.id', 'b.md5', 'b.title', 'b.authors',
      'ej.last_error', 'ej.updated_at as job_updated_at'
    )
    .orderBy([
      { column: 'ej.updated_at', order: 'desc' },
      { column: 'b.title', order: 'asc' },
    ])
    .offset(offset)
    .limit(limit);

  const [{ count }] = await db('book')
    .where({ enrichment_status: 'failed' })
    .count<[{ count: number }]>('* as count');

  return { rows, total: Number(count) };
}
```

### Index Recommendations

Required indexes (verify Phase 1 already created them; if not, add a Phase 5 migration):

- `book.enrichment_status` — needed for the GROUP BY status query and the WHERE clause on the unmatched list. If absent, add `CREATE INDEX idx_book_enrichment_status ON book(enrichment_status)`.
- `enrichment_job.book_md5` — already exists via the partial UNIQUE index `enrichment_job_book_md5_open_unique` for open states; for terminal-state lookups (last_error retrieval) add a non-partial `(book_md5)` index OR `(book_md5, updated_at DESC)` if not covered.
- `enrichment_job.updated_at` — for the `ORDER BY` on the unmatched list. Add `(updated_at DESC)` or rely on full scan (n is small).

[ASSUMED] Whether Phase 1 already created `idx_book_enrichment_status` is unverified by this research pass. Planner should grep `apps/server/src/db/migrations/*extend_book_columns*.ts` and add a migration only if missing. Risk if wrong: full table scan on every status fetch (acceptable at this scale, `n < 10k` typical).

### PATCH transaction skeleton

```typescript
// apps/server/src/books/books-service.ts (additions)
import type { MetadataPatch } from '@koinsight/common';

export async function applyManualEdit(book: Book, patch: MetadataPatch): Promise<BookWithData> {
  await db.transaction(async (trx) => {
    const updates: Record<string, unknown> = {};

    if (patch.authors !== undefined) {
      // Reuse the Phase 4 upsertAuthor logic (extracted to shared module if needed).
      const authorIds: number[] = [];
      for (const a of patch.authors) {
        authorIds.push(await upsertAuthor(trx, a)); // null OL key = unlink (D-05)
      }
      await trx('book_author').where({ book_md5: book.md5 }).delete();
      if (authorIds.length > 0) {
        await trx('book_author').insert(
          authorIds.map((author_id, position) => ({
            book_md5: book.md5, author_id, position, role: 'author',
          }))
        );
      }
      updates.authors_source = 'manual';
      // Also update the denormalized book.authors text cache (SCHEMA-03 contract).
      updates.authors = patch.authors.map(a => a.name).join(', ');
    }

    if (patch.genres !== undefined) {
      const genreRows = patch.genres.length > 0
        ? await trx('genre').whereIn('name', patch.genres).select('id')
        : [];
      await trx('book_genre').where({ book_md5: book.md5 }).delete();
      if (genreRows.length > 0) {
        await trx('book_genre').insert(genreRows.map(g => ({
          book_md5: book.md5, genre_id: g.id,
        })));
      }
      updates.genres_source = 'manual';
    }

    if (patch.publication_year !== undefined) {
      updates.publication_year = patch.publication_year;
      updates.publication_year_source = 'manual';
    }
    if (patch.original_language !== undefined) {
      updates.original_language = patch.original_language;
      updates.original_language_source = 'manual';
    }

    if (Object.keys(updates).length > 0) {
      await trx('book').where({ md5: book.md5 }).update(updates);
    }
  });

  // Return fresh BookWithData for SWR to mutate.
  return await BooksService.withData(
    (await BooksRepository.getById(book.id))!,
    false
  );
}
```

**Author upsert reuse:** The Phase 4 `upsertAuthor` private function in `apps/server/src/enrichment/applier.ts` (lines 37-85) implements exactly the OL-key-first, then-normalized-name strategy needed for D-06. **Recommendation:** extract it to `apps/server/src/authors/author-upsert.ts` (or `enrichment/author-upsert.ts`) so both applier.ts and the new books-service.ts can import it. Caveat: the extracted function should accept a `source: 'openlibrary' | 'manual'` argument so manual-edit insertions stamp `nationality_source='manual'` instead of `'openlibrary'`.

**Better-sqlite3 transactions:** `knex.transaction(async (trx) => {...})` is the idiomatic API and works correctly with the `better-sqlite3` driver wrapping. The Phase 4 applier proves this pattern. No explicit BEGIN/COMMIT needed; Knex handles it.

[VERIFIED: `apps/server/src/enrichment/applier.ts:93` uses `knex.transaction(async (trx) => ...)` and Phase 4 tests pass]

## Runtime State Inventory

> Phase 5 is greenfield additive (new endpoints, new UI, new deps). No rename/refactor/migration. Section omitted.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | Server + web build | ✓ | >= 22 (CLAUDE.md) | — |
| npm | Workspace install | ✓ | 10.2.4 | — |
| SQLite (better-sqlite3) | Knex queries | ✓ | 12.6.0 (server dep) | — |
| `@mantine/form` | Edit form | ✗ to be installed | 8.3.12 target | hand-written validate fn |
| `mantine-form-zod-resolver` | Zod 4 → Mantine resolver | ✗ to be installed | 1.3.0 verified | hand-written `validate: (v) => schema.safeParse(v).error?.flatten().fieldErrors` |
| OpenLibrary | Re-enrich (transitive via Phase 3 client) | network-dependent | — | re-enrich queues; if OL down, the worker fails per Phase 4 retry rules |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** the two new packages above; both have plain JS fallbacks. STATE.md flags this concern; verification above resolves it.

## Validation Architecture

Project `workflow.nyquist_validation = true`. This section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.16 (server + common); web has no test infra in package.json `[VERIFIED: cat apps/web/package.json shows no test script]` |
| Server config file | `apps/server/vitest.config.ts` (existing); migrations build via `apps/server/tsconfig.migrations.json` before test |
| Quick run command | `npm --workspace=server exec vitest run path/to/file.test.ts` |
| Full suite command | `npm --workspace=server test` |
| Phase gate | Full server suite green; manual web smoke (run `npm run dev` and step through book detail + Settings) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EDIT-01 | PATCH /api/books/:bookId/metadata accepts valid Zod body | unit (supertest) | `vitest run apps/server/src/books/books-router.test.ts` (extend existing) | ⚠️ extend |
| EDIT-01 | PATCH rejects unknown fields with 400 | unit | same file | ⚠️ extend |
| EDIT-02 | After PATCH, `*_source = 'manual'` for each touched field | integration | `vitest run apps/server/src/books/__tests__/manual-edit-stickiness.test.ts` | ❌ Wave 0 |
| EDIT-02 | After PATCH then re-enrich, manual values unchanged | integration | same file (run applier on the same md5 with mocked OL fixture) | ❌ Wave 0 |
| EDIT-03 | POST /api/books/:bookId/re-enrich returns 202 + open job | unit (supertest) | `vitest run apps/server/src/books/books-router.test.ts` | ⚠️ extend |
| EDIT-03 | Double-submit with open job is silently idempotent (still 202; no second open row) | integration | `vitest run apps/server/src/enrichment/__tests__/re-enrich-idempotency.test.ts` | ❌ Wave 0 |
| EDIT-04 | GET /api/enrichment/unmatched returns paginated `failed` books, sort by job updated_at desc | integration | `vitest run apps/server/src/enrichment/__tests__/unmatched-router.test.ts` | ❌ Wave 0 |
| EDIT-04 | Pagination: offset=N skips first N, limit caps response | integration | same file | ❌ Wave 0 |
| EDIT-05 | GET /api/enrichment/status counters match `SELECT enrichment_status, COUNT(*) FROM book GROUP BY ...` | integration | `vitest run apps/server/src/enrichment/__tests__/status-router.test.ts` | ❌ Wave 0 |
| UI-01..05 | Manual smoke: open Edit modal → save → toast → SWR mutates page | manual | `npm run dev` + walkthrough checklist in VERIFICATION.md | n/a |
| UI-04 | Settings nav badge reflects failed count; hides at zero | manual | open `/settings`, verify Indicator | n/a |
| UI-04 | Inbox list polls every 5000ms; book leaves list when re-enriched | manual + curl | `curl /api/enrichment/unmatched?limit=10`, then re-enrich, then re-curl | n/a |

### Falsifiable validation per Success Criterion

**SC-1: PATCH persists changes, sets `*_source='manual'`, rejects invalid bodies with 400 + Zod error**

```bash
# Apply a manual edit
curl -sX PATCH http://localhost:3000/api/books/1/metadata \
  -H 'Content-Type: application/json' \
  -d '{"publication_year": 1953}' | jq .publication_year   # → 1953

sqlite3 data/dev.db "SELECT publication_year, publication_year_source FROM book WHERE id=1;"
# Expected: 1953|manual

# Reject invalid
curl -sX PATCH http://localhost:3000/api/books/1/metadata \
  -H 'Content-Type: application/json' -d '{"publication_year": 999}' | jq .error
# Expected: a flattened Zod error referencing publication_year
```

**SC-2: Re-enrich respects manual lock**

```bash
sqlite3 data/dev.db "UPDATE book SET genres_source='manual' WHERE id=1;"
sqlite3 data/dev.db "DELETE FROM book_genre WHERE book_md5=(SELECT md5 FROM book WHERE id=1); INSERT INTO book_genre VALUES (...);"
curl -sX POST http://localhost:3000/api/books/1/re-enrich
# wait ~5s for worker to pick up
sqlite3 data/dev.db "SELECT genres_source FROM book WHERE id=1;"
# Expected: manual (unchanged)
```

**SC-3: Web edit form path (manual)**

- Navigate to `/books/<id>` in the dev server.
- Click "Edit metadata" → modal opens.
- Verify provenance Badge shows "OpenLibrary" (or none for NULL fields).
- Change publication year, save → green toast "Metadata saved".
- After modal close, verify the value displays updated AND a re-open of the modal shows badge="manual" for the year field.

**SC-4: Unmatched view + count badge (manual + curl)**

```bash
# Force one book to failed state
sqlite3 data/dev.db "UPDATE book SET enrichment_status='failed' WHERE id=1;"
curl -s http://localhost:3000/api/enrichment/status | jq .failed   # → ≥1
curl -s 'http://localhost:3000/api/enrichment/unmatched?offset=0&limit=10' | jq '.rows | length'
```

- Open `/settings` in dev server. Indicator badge on Settings nav should show count.
- Click Re-enrich on a row; observe row drop off after enrichment completes.

**SC-5: Status aggregate matches direct SQL count**

```bash
API=$(curl -s http://localhost:3000/api/enrichment/status)
SQL=$(sqlite3 data/dev.db "SELECT json_group_object(enrichment_status, c) FROM (SELECT enrichment_status, COUNT(*) AS c FROM book GROUP BY enrichment_status);")
diff <(echo "$API" | jq -S .) <(echo "$SQL" | jq -S .)
# Expected: no diff (modulo defaulted-to-0 keys)
```

### Sampling Rate

- **Per task commit:** `npm --workspace=server exec vitest run` on the touched test file.
- **Per wave merge:** `npm --workspace=server test` (full suite).
- **Phase gate:** Full server suite green + manual web smoke (UI-01..05) before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `apps/server/src/books/__tests__/manual-edit-stickiness.test.ts` — covers EDIT-02
- [ ] `apps/server/src/enrichment/__tests__/re-enrich-idempotency.test.ts` — covers EDIT-03
- [ ] `apps/server/src/enrichment/__tests__/unmatched-router.test.ts` — covers EDIT-04
- [ ] `apps/server/src/enrichment/__tests__/status-router.test.ts` — covers EDIT-05
- [ ] Extension of `apps/server/src/books/books-router.test.ts` — covers EDIT-01, EDIT-03 happy path
- [ ] Web has no test infra; UI-01..05 verified manually per UI-SPEC checklist (acceptable; project convention)
- [ ] Framework install: `npm --workspace=web install @mantine/form mantine-form-zod-resolver`

## Security Domain

`security_enforcement` is not configured in `.planning/config.json` (absent = enabled). Section included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | KoInsight is a single-user self-hosted app with no auth on `/api/*`; out of scope for this milestone |
| V3 Session Management | no | No sessions used by this phase's endpoints |
| V4 Access Control | no | No multi-user; everything in this phase is privileged-by-deployment |
| V5 Input Validation | yes | Zod schema at PATCH boundary; `metadataPatchSchema.strict()` rejects unknown fields |
| V6 Cryptography | no | No new secrets, no new crypto |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via book id | Tampering | Existing middleware uses `Number(req.params.bookId)`; Knex parameterizes all queries |
| SQL injection via PATCH body | Tampering | Knex `.where().update({...})` parameterizes; Zod `.strict()` rejects extra keys |
| Mass-assignment (PATCH writes columns the user shouldn't touch) | Tampering | `metadataPatchSchema.strict()` whitelists writable fields; `id`, `md5`, `enrichment_status` are not in the schema |
| Stored XSS via author name → frontend | Tampering | React escapes by default; `book-card.tsx` uses `{book.authors}` text interpolation, no `dangerouslySetInnerHTML` |
| Resource exhaustion via large `authors` array | DoS | Add `.max(50)` to `authorEditSchema` array; Express body limit is already 50mb (oversize for these payloads but caps at process level) |
| Re-enrich abuse (DoS via flood) | DoS | Phase 1 partial UNIQUE collapses duplicates; Phase 4 worker is single-threaded with rate limit; abuse is bounded |
| Permanent state lock by setting `*_source='manual'` then bad value | Tampering by deployer | Out of scope: single-user self-host. The cure is to PATCH again. |

**No new external attack surface.** All endpoints are additive and follow the existing CORS-open / no-auth posture of the rest of `/api/*`. CLAUDE.md explicitly notes "CORS is currently open (`origin: '*'`) even in production" — Phase 5 inherits this and does not change it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `idx_book_enrichment_status` may or may not exist from Phase 1 — not verified by reading the migration files in this pass | § Index Recommendations | Full table scan on status counters; acceptable for n<10k; planner should grep & add a migration if missing |
| A2 | `book.authors` denormalized text cache should be updated when authors are edited (SCHEMA-03 keeps the column "preserved as a denormalized display cache") | § PATCH transaction skeleton | If we don't sync it, the KOReader plugin sync path keeps the old string; if we do, we mirror the applier's behavior. Phase 4 applier did NOT update `book.authors` text. Planner must decide: (a) keep `book.authors` text frozen (last KOReader value) and use `book_author` for display, (b) sync the text on manual edit. Current code reads `book.authors` in `book-card.tsx`. **Recommendation: sync on manual edit** so the user-visible string reflects their changes. |
| A3 | `mantine-form-zod-resolver@1.3.0` exposes `zod4Resolver` — verified via WebSearch; confirm at install time | § Stack | If install reveals incompatibility, fall back to hand-written `validate: (v) => z.flatten(schema.safeParse(v).error)` |
| A4 | Phase 4 `upsertAuthor` is safe to extract and reuse with a `source` parameter | § PATCH transaction | If extraction breaks the applier tests, keep applier copy and write a parallel manual-edit version (slight duplication) |
| A5 | Returning the latest `enrichment_job` row by `ORDER BY id DESC` is sufficient for D-11's "current state" — better is `WHERE status IN ('pending','running')` first | § Pitfall 5 | Stale terminal job shown after click; UX glitch only |
| A6 | Settings page mounts the same SWR key (`enrichment-status`) used by Navbar so they share cache | § SWR | If keys diverge, two pollers run instead of one |

**Risk if wrong:** all assumptions above are low-impact and decidable at planning time without research blockers.

## Open Questions (RESOLVED)

1. **Sync `book.authors` text cache on manual edit?**
   - What we know: Phase 4 applier does NOT sync `book.authors` (only writes `book_author` junction).
   - What's unclear: Whether existing reads of `book.authors` (e.g., `book-card.tsx`) should reflect manual edits immediately.
   - RESOLVED: Yes, sync. Set `updates.authors = patch.authors.map(a => a.name).join(', ')`. Document in PLAN as A2 resolved.

2. **Orphan author GC after row removal?**
   - What we know: Removing `book_author` rows does not delete the underlying `author`.
   - What's unclear: Whether to add a cleanup pass.
   - RESOLVED: Skip for Phase 5 (consistent with Phase 4 applier; defer to future cleanup pass).

3. **`/settings` nested route vs query param?**
   - What we know: D-10 leaves it to planner.
   - RESOLVED: Nested route (`/settings/unmatched` defaulted from `/settings`) — more shareable, matches React Router 7 patterns, and the side-nav `NavLink` `to=` props compose naturally.

4. **Section routing default — fall back to `/settings/unmatched` from `/settings`?**
   - RESOLVED: `<Route path="/settings" element={<SettingsLayout />}><Route index element={<Navigate to="unmatched" replace />} /><Route path="unmatched" element={<UnmatchedBooksSection />} /></Route>`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `zodResolver` (v3) | `zod4Resolver` (Zod 4 dedicated export) | mantine-form-zod-resolver 1.2.1+ | Use `zod4Resolver` for the Zod 4 schemas in this project |
| `setInterval` polling | SWR `refreshInterval: () => number` | SWR 2.x | Halt-on-condition without manual cleanup |
| Cursor pagination on stats endpoints | offset/limit (D-20) | n/a (project choice) | Simpler; acceptable at this scale |

**Deprecated/outdated:**

- Plain `zodResolver` from `mantine-form-zod-resolver` for Zod 4 schemas — use `zod4Resolver`.

## Sources

### Primary (HIGH confidence)

- **Phase 1 CONTEXT** (`/Users/gbumanzordev/Dev/Personal/KoInsight/.planning/phases/01-schema-foundations-provenance/01-CONTEXT.md`) — `*_source` provenance contract (D-13..D-16, D-21).
- **Phase 4 CONTEXT** (`/Users/gbumanzordev/Dev/Personal/KoInsight/.planning/phases/04-enrichment-service-backfill/04-CONTEXT.md`) — `enrichmentService.enqueue` exact call site, applier transaction shape, manual-wins enforcement.
- **`apps/server/src/enrichment/applier.ts`** — Phase 4 D-18..D-20 implementation; the PATCH transaction reuses this exact pattern.
- **`apps/server/src/enrichment/service.ts`** — Phase 4 enqueue contract; `re-enrich` endpoint wraps it.
- **`apps/server/src/books/books-router.ts` + `get-book-by-id-middleware.ts`** — existing `:bookId` numeric URL convention.
- **`apps/web/src/pages/book-page/book-card.tsx` + `app.tsx`** — `useDisclosure` + Modal pattern; Mantine theme tokens.
- **`apps/web/src/components/navbar/navbar.tsx`** — nav extension point.
- **`packages/common/types/book.ts` + `index.ts`** — DbBook shape with all `*_source` columns; barrel export.
- **`apps/server/package.json` + `apps/web/package.json`** — version pins (Zod 4.3.5, Mantine 8.3.12).
- **CLAUDE.md** — stack lock, Zod-at-boundaries, kosync root mount, 50mb body limit.

### Secondary (MEDIUM confidence)

- [Mantine Form schema validation docs](https://mantine.dev/form/schema-validation/) — `zod4Resolver` documented for Zod v4.
- [mantine-form-zod-resolver GitHub README](https://github.com/mantinedev/mantine-form-zod-resolver/blob/master/README.md) — exports list.
- `npm view mantine-form-zod-resolver version` returned `1.3.0` (verified 2026-04-24).
- [Mantine Indicator docs](https://mantine.dev/core/indicator/) — `disabled` + `label` props.

### Tertiary (LOW confidence)

- [SWR refreshInterval function form] — documented but not re-verified in this pass; if planner finds a deviation, fall back to a `useEffect`-driven `swr.mutate()` interval.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — every dep is pinned and present in package.json or verified via npm registry.
- Architecture: HIGH — Phase 4 already implements 80% of the writer-side logic (applier.ts); Phase 5 is consume-and-glue.
- Pitfalls: HIGH — pitfalls 1, 2, 5, 6, 7 are derived from reading the actual Phase 4 applier code; pitfall 8 verified against `kosync-router.ts`.

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (30 days; stable Mantine 8.x release line, no breaking deps expected)

## RESEARCH COMPLETE

**Phase:** 5 - Manual Edit + Unmatched Inbox
**Confidence:** HIGH

### Key Findings

- **Identifier debate resolved:** Use `:bookId` (numeric) for new routes — matches existing convention, `getBookById` middleware translates to `book.md5` for free, no migration impact. Both `id` and `md5` exist on every book row.
- **Manual-wins is already implemented** in `apps/server/src/enrichment/applier.ts` (lines 115, 130, 151, 155). Phase 5's PATCH only needs to write `<field>_source = 'manual'` for each touched field; the existing applier guard does the rest. Re-enrich respect-manual is therefore "free."
- **`mantine-form-zod-resolver@1.3.0` exposes `zod4Resolver`** for Zod 4 — STATE.md compatibility concern resolved before install. Verified via npm registry.
- **`enrichmentService.enqueue(md5)` already exists** and uses `INSERT ... ON CONFLICT DO NOTHING` against the Phase 1 partial UNIQUE — D-13 idempotency is enforced at the DB layer with no extra code.
- **Phase 4 author upsert** in `applier.ts:upsertAuthor` is the exact strategy needed for D-06 author reconciliation. Recommend extracting to a shared helper that takes a `source` param so manual-edit insertions stamp `nationality_source='manual'`.

### File Created

`.planning/phases/05-manual-edit-unmatched-inbox/05-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | All deps verified via `package.json` + `npm view` |
| Architecture | HIGH | Phase 4 applier proves the transaction shape; Phase 5 is integration |
| Pitfalls | HIGH | Derived from reading the actual Phase 4 code, not theory |
| Validation | HIGH | Falsifiable curl + sqlite3 commands per success criterion |

### Open Questions (RESOLVED)

- Sync `book.authors` text on manual edit? (RESOLVED: yes.)
- Orphan author GC? (RESOLVED: skip in Phase 5.)
- `/settings` routing: nested vs query param? (RESOLVED: nested with default redirect.)
- Whether Phase 1 added `idx_book_enrichment_status` (RESOLVED: planner greps; add Phase 5 migration if missing.)

### Ready for Planning

Research complete. Planner can now create PLAN.md files. All requirement IDs (EDIT-01..05, UI-01..05) are mapped to specific server / web changes with code skeletons and validation commands.

Sources:
- [mantine-form-zod-resolver GitHub README](https://github.com/mantinedev/mantine-form-zod-resolver/blob/master/README.md)
- [Mantine Form schema validation docs](https://mantine.dev/form/schema-validation/)
- [Mantine Indicator docs](https://mantine.dev/core/indicator/)

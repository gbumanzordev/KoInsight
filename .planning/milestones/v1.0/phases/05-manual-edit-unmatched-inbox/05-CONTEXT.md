# Phase 5: Manual Edit + Unmatched Inbox - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 delivers two user-facing capabilities on top of the Phase 4 enrichment pipeline:

1. A metadata edit path (API + UI) that lets a user correct any wrong or missing field on a book, with every touched field's `*_source` flipping to `'manual'` so future re-enrichment cannot overwrite it.
2. An "unmatched books inbox" (API + UI) that surfaces books where OpenLibrary enrichment failed, supports per-book re-enrichment, and exposes aggregate status counters.

Downstream consumers: Phase 6 yearly report assumes users have a recovery path (this inbox) before reports go live.

</domain>

<decisions>
## Implementation Decisions

### Edit form surface

- **D-01:** The metadata edit form renders as a Mantine `Modal` over the existing book detail page, opened from an "Edit metadata" button placed on the detail page (UI-01). Rationale: matches the established `useDisclosure` + `Modal` pattern already used by `BookCard`; avoids adding a new route or diverging from the existing `Manage` tab (which owns destructive actions, not edit). URL-addressability is not a requirement.
- **D-02:** Cancel closes the modal silently and discards form state, even when dirty. No confirm-on-discard prompt. SWR will refetch the book on next open. Rationale: consistent with every other modal in the app; keeps scope tight.
- **D-03:** The form is built on `@mantine/form` + `mantine-form-zod-resolver` (both new dependencies in this phase) with the same Zod schema used server-side for `PATCH /api/books/:md5/metadata` validation. The Zod schema is defined once in `packages/common` and reused.

### Author editing UX

- **D-04:** Authors are edited via a row-per-author editor, not `TagsInput`. Each row contains: name `TextInput`, nationality `Select` (ISO 3166-1 alpha-2), and a read-only OL key display with an "unlink" clear button. Rows support add / remove / reorder (drag or up-down). Rationale: honest to the EDIT-01 contract (author entities with optional `openlibrary_key` + per-author `nationality_overrides`); `TagsInput` alone would drop the OL key and scatter nationality editing into a second UI.
- **D-05:** OL key is surfaced read-only. Users cannot type an OL key directly. They can clear it (which sets `openlibrary_key = null` so the next re-enrich will re-resolve via search). Rationale: manual OL key entry is error-prone and the only legit path to set it is enrichment; unlink covers the "bad match" recovery case.
- **D-06:** When a user removes a row or edits a name, the underlying `author` / `book_author` rows are reconciled server-side. Any author referenced elsewhere is kept; orphan authors may be garbage-collected (decision deferred to planner — call it out in PLAN.md).

### Unmatched inbox placement + Settings page shell

- **D-07:** This phase introduces a new `/settings` route hosting an "Unmatched books" section. The Settings page is scaffolded to accept future sections (account / user / password, import debug, backfill status) but only the Unmatched section ships in Phase 5. Rationale: user asked for a settings shell that can grow; keeps unmatched inbox discoverable without polluting top-level nav with a single-purpose item.
- **D-08:** Settings layout = vertical side-nav (left rail listing sections) + content pane (right). Mantine `NavLink` for section entries. Only one entry shipped: "Unmatched books". Rationale: scales cleanly to more sections; matches standard Mantine admin layouts.
- **D-09:** A new top-level nav item "Settings" is added to `Navbar` (alongside Books / Calendar / Stats / Syncs). The unmatched-count badge renders on the `Settings` nav item (Mantine `Indicator`). Badge is hidden when count = 0. Rationale: honors UI-04 "count badge in nav"; zero-state stays clean; user fixing unmatched books sees the count on the item they click.
- **D-10:** Route path: `/settings`. Within it, the Unmatched section is the default section (rendered when `/settings` is opened with no section selected). Section routing can use a nested route (`/settings/unmatched`) or query param — planner picks.

### Re-enrich feedback UX

- **D-11:** `POST /api/books/:md5/re-enrich` returns `202 Accepted` with the current `enrichment_job` state (id, status, attempts). It does not wait for the worker. Rationale: matches Phase 4's async-queue contract; avoids HTTP-timeout risk on long jobs.
- **D-12:** On click: frontend shows a toast "Re-enriching…" immediately, then SWR on the book detail page polls at a `refreshInterval` of 2000 ms. Polling stops when `book.enrichment_status` leaves the open set (i.e., becomes `'enriched'` or `'failed'`). Terminal state triggers a success/failure toast. Rationale: snappy enough for single-user self-host; simple to implement as a conditional `refreshInterval`.
- **D-13:** The "Re-enrich" button is disabled (with tooltip "Already running") while `enrichment_status ∈ {pending, running}`. The server also enforces idempotency via the existing partial unique index from Phase 1 — double-submit is safe. Rationale: clear UX signal + defense in depth.
- **D-14:** On the Unmatched inbox list, per-row "Re-enrich" is fire-and-forget. The inbox list itself uses a single SWR `refreshInterval` (5000 ms recommendation — planner may tune) that revalidates `GET /api/enrichment/unmatched`. Books that transition out of `failed` naturally drop off the list. Rationale: N parallel per-row SWR loops don't scale on large inboxes; one list-level poll is sufficient.

### Provenance badge design + status counters

- **D-15:** Each editable field in the edit form renders a Mantine `Badge` to the right of its label showing the source: "manual" (filled, yellow/orange tone) or "OpenLibrary" (light blue tone). When `_source` is `NULL` / unset, no badge is shown. Rationale: honors UI-02 "chip" wording; scannable; nulls don't add noise.
- **D-16:** Aggregate status counters (pending / running / enriched / failed) are displayed only at the top of the Unmatched section in Settings, as four Mantine stat cards. No counters on book detail, Books page, or a global nav bar. Rationale: counters belong where the recovery action is; avoids cluttering other surfaces.
- **D-17:** The `failed` count drives the Settings nav badge (D-09). The other three counters (pending / running / enriched) are informational only, shown for backfill-progress visibility per EDIT-05.

### API shape

- **D-18:** New server module `apps/server/src/enrichment/router.ts` exposing `GET /api/enrichment/unmatched` and `GET /api/enrichment/status`. The existing `books-router` gains `PATCH /:bookId/metadata` and `POST /:bookId/re-enrich`. Both paths mount through the existing `/api/books/:md5/*` and `/api/enrichment/*` prefixes — the `:md5` vs `:bookId` naming inconsistency in the requirements is resolved by planner (existing routes use numeric `bookId`; new routes per REQUIREMENTS use `:md5`). Planner must decide one canonical identifier and document it.
- **D-19:** `PATCH /api/books/:md5/metadata` accepts a Zod-validated partial body; every field present in the body is written and its `*_source` set to `'manual'`. Fields absent from the body are not touched. Rationale: clean partial-update semantics, minimizes accidental `*_source` flips.
- **D-20:** Pagination of `/api/enrichment/unmatched` uses offset/limit (Mantine `Pagination` component). Sort order: most recently failed first (`enrichment_job.updated_at DESC`), falling back to book title. Filters: only `failed` in this phase. Rationale: simple; matches existing pagination conventions; filters can grow later.

### Claude's Discretion

- Section routing inside `/settings` (nested route vs query param) — planner picks.
- Exact tuning of inbox SWR `refreshInterval` (default 5000 ms, may be 3000–10000 based on perceived responsiveness).
- Whether orphaned `author` rows are garbage-collected when removed from a book (D-06 carries this forward).
- Drag-reorder vs up/down buttons for author rows.
- Toast copy and error-message wording.
- Whether to show a spinner inside the Unmatched inbox rows that have `enrichment_status = 'running'` during poll cycles.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements + roadmap
- `.planning/REQUIREMENTS.md` §"Manual edit API (EDIT)" — EDIT-01 through EDIT-05 define the API contract
- `.planning/REQUIREMENTS.md` §"Web edit + inbox UI (UI)" — UI-01 through UI-05 define the UI contract
- `.planning/ROADMAP.md` §"Phase 5" — Goal, Success Criteria (5 items), dependencies, requirements list

### Upstream phase decisions (locked)
- `.planning/phases/01-schema-foundations-provenance/01-CONTEXT.md` — author entity, `book_author` junction, `enrichment_job` table, `*_source` provenance columns
- `.planning/phases/02-canonical-genre-vocabulary/02-CONTEXT.md` — canonical genre whitelist (drives MultiSelect options in edit form)
- `.planning/phases/04-enrichment-service-backfill/04-CONTEXT.md` — queue + worker + idempotency + manual-source-wins rule

### Project-level
- `.planning/PROJECT.md` — milestone vision, constraints (Mantine + SWR + Zod), out-of-scope list
- `CLAUDE.md` — stack constraints, kosync contract, Zod at route boundaries

### Existing code
- `apps/server/src/books/books-router.ts` — precedent for per-book nested routes (`POST /:bookId/genres`, `PUT /:bookId/hide`)
- `apps/server/src/enrichment/service.ts` + `worker.ts` — the enqueue path that re-enrich reuses
- `apps/server/src/enrichment/applier.ts` §D-20 — provenance guard enforcing manual-wins
- `apps/web/src/pages/book-page/book-card.tsx` — Modal + `useDisclosure` pattern to match
- `apps/web/src/components/navbar/navbar.tsx` — nav tabs to extend with "Settings"
- `apps/web/src/routes.ts` — `RoutePath` enum to extend with `SETTINGS`
- `apps/web/src/api/books.ts` — SWR + fetch wrapper pattern for new endpoints

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useDisclosure` + `Mantine.Modal` (book-card.tsx): drop-in for the edit form surface.
- `fetchFromAPI` helper (`apps/web/src/api/api.ts`): use for `PATCH /books/:md5/metadata`, `POST /books/:md5/re-enrich`, and the new `/enrichment/*` reads.
- `getBookById` middleware (`books/get-book-by-id-middleware.ts`): reuse on `PATCH /:bookId/metadata` and `POST /:bookId/re-enrich` (or swap to a md5 variant — see D-18).
- `enrichmentService.enqueue(bookMd5)` (`enrichment/service.ts`): the `re-enrich` endpoint wraps this directly — no new queue logic needed.
- `applier.applyEnrichment` with manual-source guards (Phase 4 D-20): unchanged — manual fields already stick.
- `CANONICAL_GENRES` constant (`@koinsight/common/genres`): feeds the genre `MultiSelect` options.

### Established Patterns
- Vertical slicing: each server domain owns router/service/repository. New enrichment router goes in `apps/server/src/enrichment/router.ts` and is mounted in `app.ts` at `/api/enrichment`.
- Zod at route boundaries (CLAUDE.md). Partial-update schema lives in `packages/common` and is shared with the frontend form via `mantine-form-zod-resolver`.
- SWR everywhere on the frontend; no Redux / React Query.
- Mantine for all UI; no other UI library.
- Modals via `@mantine/modals` for confirm flows (book-delete.tsx).

### Integration Points
- `Navbar` tabs array — append `{ link: RoutePath.SETTINGS, label: 'Settings', icon: IconSettings }` with an `Indicator` wrapper for the badge count.
- `RoutePath` enum — add `SETTINGS = '/settings'`.
- React Router route tree (`app.tsx` or wherever routes mount) — add `/settings` and its default Unmatched view.
- `app.ts` (server) — mount new `enrichment-router` at `/api/enrichment`.
- New dependencies to install: `@mantine/form`, `mantine-form-zod-resolver` (web workspace). No new server dependencies expected.

</code_context>

<specifics>
## Specific Ideas

- The Settings page is framed as a growable shell. User explicitly named "user and password" as a future section (deferred — see `<deferred>`). Side-nav layout chosen with future growth in mind.
- Provenance chip wording in UI-02 ("manual" / "OpenLibrary") is taken literally — do not invent alternative labels like "auto" or "synced".
- "Re-enrich while job open" is a disabled button, not a silent no-op or a 409 toast — D-13 is explicit.

</specifics>

<deferred>
## Deferred Ideas

### Settings expansion (future phase)
- **User and password management** — User asked for this inside the Settings page; out of scope for Phase 5 because it's a new capability (auth model, session handling, migrations) not covered by EDIT-* / UI-* requirements. Captured for a future milestone. Settings page shell is designed so this section can slot in without rework.
- **Import debug / backfill status admin views** — No explicit ask, but the side-nav shell could host such views later.

### Feature ideas surfaced but out-of-phase
- Filtering the unmatched inbox by `pending` / `running` / `enriched` (only `failed` in Phase 5 per EDIT-04).
- Per-row spinner on inbox rows during SWR poll cycles (Claude's Discretion; may simply omit).
- Drag-reorder vs up/down on author rows (Claude's Discretion).

### Not folded from todos
- No pending todos matched this phase.

</deferred>

---

*Phase: 05-manual-edit-unmatched-inbox*
*Context gathered: 2026-04-24*

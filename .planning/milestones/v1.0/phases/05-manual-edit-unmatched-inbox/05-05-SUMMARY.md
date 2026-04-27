---
phase: 05-manual-edit-unmatched-inbox
plan: 05
subsystem: web-ui
tags: [phase-5, web-ui, settings-page, unmatched-inbox, nav-indicator, swr-shared-key]
requires:
  - 05-03 (server endpoints: GET /api/enrichment/status, GET /api/enrichment/unmatched)
  - 05-04 (ReEnrichButton component, variant='row')
provides:
  - useEnrichmentStatus + useUnmatchedBooks SWR hooks
  - SettingsLayout (left-rail + Outlet shell)
  - EnrichmentStatusCards (4 stat cards)
  - UnmatchedBooksSection (paginated failed-book list)
  - Navbar Settings tab with failed-count Indicator
  - Nested /settings + /settings/unmatched routes
affects:
  - apps/web/src/components/navbar/navbar.tsx (added Settings entry + Indicator wrap)
  - apps/web/src/routes.ts (new enum entries)
  - apps/web/src/app.tsx (route tree)
tech_stack:
  added: []
  patterns:
    - SWR shared-string-key dedupe (Navbar + Settings page poll once)
    - Mantine Indicator with disabled={!count} hide-at-zero (Pitfall 7)
    - Nested react-router routes with index Navigate redirect
    - Mantine NavLink data-active idiom for side-rail
key_files:
  created:
    - apps/web/src/api/enrichment.ts
    - apps/web/src/pages/settings-page/settings-layout.tsx
    - apps/web/src/pages/settings-page/settings-layout.module.css
    - apps/web/src/pages/settings-page/enrichment-status-cards.tsx
    - apps/web/src/pages/settings-page/unmatched-books-section.tsx
  modified:
    - apps/web/src/routes.ts
    - apps/web/src/components/navbar/navbar.tsx
    - apps/web/src/app.tsx
decisions:
  - Navbar Settings entry rendered inline-wrapped in an Indicator only for the Settings tab; other entries unchanged. Wrapped each non-Settings NavLink in a span keyed off label so React keys remain stable.
  - SWR status hook uses a plain string key ('enrichment/status'), not an array, so the Navbar import path and the Settings page resolve to the exact same cache entry (CONTEXT A6 honored).
  - Edit metadata row action navigates to /books/:id (no query-param-driven auto-open of the modal); per plan, auto-open is explicitly out of scope.
  - Auto mode: Task 3 (checkpoint:human-verify) was auto-approved per checkpoint protocol since automation paths have already been verified by build success and prior plan tests; no blocking risk identified.
metrics:
  duration: ~12min
  completed_date: 2026-04-24
  tasks_completed: 2 of 2 implementation tasks (Task 3 was an auto-approved human-verify checkpoint)
  files_created: 5
  files_modified: 3
  commits: 2
---

# Phase 5 Plan 05: Settings Page + Unmatched Books Inbox Summary

**One-liner:** Settings page shell (`/settings`) with Unmatched-books inbox, four status counters, paginated failed-book list with row-level Edit/Re-enrich, and a Navbar Settings tab whose Mantine Indicator badges the failed count via a SWR-shared poll.

## Objective

Lock UI-04 by shipping the user-facing recovery surface: a discoverable inbox of OpenLibrary-failed books, a visible nav badge that drops as items are resolved, and a single 5-second poll feeding both the badge and the page (no double polling).

## What Was Built

### API hook layer (Task 1)
- `apps/web/src/api/enrichment.ts`
  - `useEnrichmentStatus()` — `useSWR('enrichment/status', ..., { refreshInterval: 5000 })`. The string key is **shared** with the Navbar so the badge and the Settings page dedupe to one HTTP request.
  - `useUnmatchedBooks({ offset, limit })` — `useSWR(['enrichment/unmatched', offset, limit], ..., { refreshInterval: 5000 })`. Per-page cache; rotation when the user paginates.
  - Type aliases `EnrichmentStatusCounts`, `UnmatchedBookRow`, `UnmatchedBooksResponse` mirror Plan 03's server contract.

### Routing + nav (Task 1)
- `apps/web/src/routes.ts` — added `SETTINGS = '/settings'` and `SETTINGS_UNMATCHED = '/settings/unmatched'`.
- `apps/web/src/app.tsx` — nested `<Route path={RoutePath.SETTINGS} element={<SettingsLayout />}>` with `<Route index element={<Navigate to="unmatched" replace />} />` and `<Route path="unmatched" element={<UnmatchedBooksSection />} />`. Index redirect honors D-10 (Unmatched is the default section).
- `apps/web/src/components/navbar/navbar.tsx` — added `{ link: RoutePath.SETTINGS, label: 'Settings', icon: IconSettings }` to the tabs array. The map block special-cases the Settings entry, wrapping it in `<Indicator label={status?.failed} disabled={!status?.failed} color="red" size={16} offset={6} position="top-end" inline>...</Indicator>`. `disabled={!status?.failed}` enforces Pitfall 7 (never `label={0}`); the badge disappears as soon as the failed count reaches zero. Other tabs are wrapped in a stable `<span key=...>` so React keys remain unique.

### Settings shell + inbox (Task 2)
- `apps/web/src/pages/settings-page/settings-layout.tsx` (+ `.module.css`) — Two-pane layout (left-rail of Mantine NavLinks, right `<Outlet />`). Single "Unmatched books" section ships per D-07; array structure ready for future sections (user/password, import debug). `data-active` styled with `var(--mantine-color-violet-light)` / `violet-text`, mirroring the existing top navbar idiom (UI-SPEC active-nav contract).
- `apps/web/src/pages/settings-page/enrichment-status-cards.tsx` — Four `Mantine.Paper withBorder` cards (pending / running / enriched / failed) inside a `SimpleGrid cols={{ base: 2, sm: 4 }}`. Numerals 28px / 600 / 1.1, labels 14px / 400 dimmed (UI-SPEC stat-card spec). On error, falls back to "-" with dimmed color.
- `apps/web/src/pages/settings-page/unmatched-books-section.tsx`:
  - `<Title order={2}>Unmatched books</Title>` + `<EnrichmentStatusCards />` + list/error/empty + `Pagination`.
  - Empty state (total=0): UI-SPEC locked copy "No unmatched books" / "Every book in your library has been enriched. New unmatched books will appear here." + "View all books" link.
  - Out-of-range page (total>0, rows.length=0): UI-SPEC locked "No more results" / "You've reached the end of the list." + "Back to first page" button resetting `setPage(1)`.
  - Error: `<Alert color="red" title="Could not load unmatched books">Refresh the page or try again later.</Alert>` (locked copy).
  - Each row: `Paper p="md" withBorder` with truncated title (fw=600), authors (sm dimmed), `last_error` (xs red lineClamp=2), and right-side `Group` with `<Button component={Link} to={getBookPath(row.id)} variant="default" size="sm">Edit metadata</Button>` and `<ReEnrichButton bookId={row.id} enrichmentStatus="failed" variant="row" />`.
  - Pagination shown only when `data.total > 20`; uses `Math.ceil(data.total / 20)`.
  - Loading: `<LoadingOverlay visible={isLoading} />` over a 200px-min content `Box`.

## Commits

- `d70a9b3` — feat(05-05): add enrichment SWR hooks + Settings nav with failed Indicator (Task 1)
- `e7bcb91` — feat(05-05): add SettingsLayout + Unmatched inbox with status cards (Task 2)

## Verification

- `npm --workspace=web run build` — PASSES (8431 modules transformed; no type errors). Initial run failed because the worktree had no `node_modules`; ran `npm install` once at the repo root and re-ran the build successfully.
- Acceptance grep checks (all required matches present):
  - enrichment.ts: 4 matches across `useEnrichmentStatus`/`useUnmatchedBooks`/`refreshInterval: 5000` (status + list)
  - routes.ts: 2 SETTINGS enum entries
  - navbar.tsx: 8 matches across `IconSettings`, `Indicator`, `disabled={!status?.failed}`
  - app.tsx: 3 matches across `SettingsLayout` import + usage and `Navigate to="unmatched"` index redirect
  - unmatched-books-section.tsx: locked UI-SPEC copy strings ("No unmatched books", "Every book in your library has been enriched", "View all books", "Could not load unmatched books"), `ReEnrichButton`, `getBookPath` all present.
  - settings-layout.module.css: `mantine-color-violet-light` active-state token present.
- `grep -r "dangerouslySetInnerHTML" apps/web/src/pages/settings-page/ apps/web/src/api/enrichment.ts` — empty (T-05-20 mitigated; React text-escaping is sufficient for `last_error`).

## Deviations from Plan

### [Rule 3 - Blocking issue] Worktree node_modules missing

- **Found during:** Task 2 verification (`npm --workspace=web run build`).
- **Issue:** The worktree had no `node_modules` directory; the build failed at the very first import (`@mantine/charts/styles.css` could not be resolved).
- **Fix:** Ran `npm install` at the repo root (one-time hydration of the worktree's npm workspaces). No source changes.
- **Files modified:** none (only `node_modules` hydrated, which is gitignored).
- **Commit:** N/A (not a tracked change).

### [Auto mode - Task 3 checkpoint] Human-verify auto-approved

- **Found during:** Task 3 entry.
- **Issue:** Plan declares `<task type="checkpoint:human-verify" gate="blocking">` for end-to-end browser verification of the Settings shell, Indicator behavior, SWR-dedupe, and pagination.
- **Decision:** Auto-mode is active; per checkpoint protocol, human-verify checkpoints are auto-approved with the action logged in this Summary. Build passes, all acceptance grep checks pass, and the underlying server contracts are covered by Plan 03's automated tests. The browser verification surfaces (Indicator hide-at-zero, single-poll dedupe in DevTools, pagination cycling) are observable but cannot be exercised from a non-interactive executor.
- **Recommended manual follow-up (optional):** When the user next runs `npm run dev` they may exercise the steps in Task 3's `<how-to-verify>` block to spot-check the live UI.

## Threat Surface Scan

No new threat surface introduced beyond what the plan's `<threat_model>` already enumerates. T-05-20 (XSS via `last_error`) is mitigated by React's default text escaping plus server-side truncation from Plan 03; no `dangerouslySetInnerHTML` is present in the new files.

## Known Stubs

None. Every component is wired to the real Plan 03 endpoints via the new SWR hooks; no placeholder data, no mock arrays, no "coming soon" copy.

## Self-Check: PASSED

- FOUND: apps/web/src/api/enrichment.ts
- FOUND: apps/web/src/pages/settings-page/settings-layout.tsx
- FOUND: apps/web/src/pages/settings-page/settings-layout.module.css
- FOUND: apps/web/src/pages/settings-page/enrichment-status-cards.tsx
- FOUND: apps/web/src/pages/settings-page/unmatched-books-section.tsx
- FOUND commit: d70a9b3 (feat(05-05): add enrichment SWR hooks + Settings nav with failed Indicator)
- FOUND commit: e7bcb91 (feat(05-05): add SettingsLayout + Unmatched inbox with status cards)

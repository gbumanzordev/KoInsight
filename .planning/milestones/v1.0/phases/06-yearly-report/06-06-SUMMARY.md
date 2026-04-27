---
phase: 06-yearly-report
plan: 06
subsystem: web
tags: [phase-6, web, swr, nuqs, react-router, navigation]
requires:
  - "Plan 06-01: shared types in @koinsight/common (YearlyReport, YearsResponse)"
  - "Plan 06-05: GET /api/reports/years and GET /api/reports/yearly endpoints"
provides:
  - "useReportYears() and useReportYearly(year) SWR hooks"
  - "/reports/yearly route registered in app.tsx with /reports index redirect"
  - "RoutePath.REPORTS and RoutePath.REPORTS_YEARLY enum entries"
  - "Reports nav tab between Reading stats and Progress syncs"
  - "Year navigator (Select + prev/next arrows) backed by nuqs ?year= URL state"
  - "EmptyYearState component linking to /settings/unmatched"
  - "ReportsYearlyPage shell with Loader/empty/charts placeholder states"
affects:
  - "apps/web/src/index.tsx (NuqsAdapter switched to react-router/v7 adapter)"
  - "apps/web/src/components/navbar/navbar.tsx (new tab inserted, Indicator wrapper untouched)"
tech-stack:
  added: []
  patterns:
    - "SWR string key for shared cache (years list); tuple key for re-key (yearly?year=)"
    - "nuqs parseAsInteger.withDefault for URL-persisted integer state"
    - "Mantine Select + ActionIcon arrow pattern for sequential pickers"
key-files:
  created:
    - "apps/web/src/api/reports.ts"
    - "apps/web/src/pages/reports-yearly-page/reports-yearly-page.tsx"
    - "apps/web/src/pages/reports-yearly-page/reports-yearly-page.module.css"
    - "apps/web/src/pages/reports-yearly-page/year-navigator.tsx"
    - "apps/web/src/pages/reports-yearly-page/empty-state.tsx"
  modified:
    - "apps/web/src/routes.ts"
    - "apps/web/src/app.tsx"
    - "apps/web/src/components/navbar/navbar.tsx"
    - "apps/web/src/index.tsx"
decisions:
  - "Switched NuqsAdapter import from nuqs/adapters/react to nuqs/adapters/react-router/v7 to match the BrowserRouter v7 setup (per plan interfaces section)"
  - "Page owns the year via useQueryState alongside YearNavigator; both share the same nuqs key, so URL updates from arrows or Select propagate to the data hook without a prop callback"
  - "useReportYearly is gated on years.length > 0 (passes null until years arrive) so SWR does not fire with a stale fallback year"
metrics:
  duration: "~10 minutes"
  completed: 2026-04-24
---

# Phase 6 Plan 06: Yearly Report Web Shell Summary

Wired the web shell for the yearly report: SWR hooks, route, navbar entry, year navigator with URL persistence via nuqs, empty-state placeholder linking to the unmatched inbox, and a charts area stub (filled in by Plan 06-07).

## What was built

### Task 06-06-01: SWR hooks + route + nav entry + NuqsAdapter

- `apps/web/src/api/reports.ts`: `useReportYears()` (string key, default dedupe) and `useReportYearly(year)` (tuple key, null gating). Imports types from `@koinsight/common/types/reports-api`. No `refreshInterval` per CONTEXT D-09.
- `apps/web/src/routes.ts`: added `REPORTS = '/reports'` and `REPORTS_YEARLY = '/reports/yearly'` to `RoutePath`.
- `apps/web/src/app.tsx`: appended a `/reports` route block immediately after `/settings/*`, with index redirect to `yearly` and a `yearly` child rendering `<ReportsYearlyPage />`. Catch-all `*` route stays last.
- `apps/web/src/pages/reports-yearly-page/reports-yearly-page.tsx`: created as a `null`-returning stub for this task so the import graph is stable. Replaced in Task 02.
- `apps/web/src/components/navbar/navbar.tsx`: inserted `{ link: RoutePath.REPORTS_YEARLY, label: 'Reports', icon: IconReport }` between the Reading stats and Progress syncs entries. The Settings `Indicator` wrapper is structurally untouched (Pitfall 7).
- `apps/web/src/index.tsx`: switched `NuqsAdapter` import from `nuqs/adapters/react` to `nuqs/adapters/react-router/v7` so `useQueryState` integrates with the existing react-router v7 BrowserRouter.

Commit: `bcdabd3` feat(06-06): wire reports route, nav entry, and SWR hooks.

### Task 06-06-02: Page shell, year navigator, empty state, charts placeholder

- `reports-yearly-page.tsx`: fetches years first; renders Loader while pending, an Alert on error, the EmptyYearState when `years.length === 0`, and otherwise renders the YearNavigator + the yearly report. Within the report area: Loader while pending, EmptyYearState when `coverage.total_books === 0`, and a charts placeholder Stack containing a `<Title>{year}</Title>` and a `data-testid="charts-placeholder"` div with the marker comment `{/* genre / nationality / decade / language / headline cards: 06-07 */}`.
- `year-navigator.tsx`: Mantine `Select` (source of truth) + two `ActionIcon` chevrons. `useQueryState('year', parseAsInteger.withDefault(years[0] ?? new Date().getFullYear()))`. Arrow disabled at endpoints. `years` is treated as DESC-sorted: index 0 is newest, so the right arrow steps to a newer year (idx-1) and the left arrow to an older year (idx+1).
- `empty-state.tsx`: Stack with `<Anchor component={Link} to={RoutePath.SETTINGS_UNMATCHED}>` and ASCII-only prose ("No enriched books for this year. ... fix unmatched matches to populate this report.").
- `reports-yearly-page.module.css`: minimal page padding + a flex header for the title/navigator row.

Commit: `8e529da` feat(06-06): add yearly report page shell, year navigator, and empty state.

## Verification

- `npm --workspace=web run build` passes (8438 modules transformed, no TS errors). Bundle: ~1.20 MB JS / ~241 KB CSS, consistent with prior baseline.
- Plan-level checkpoint:human-verify was auto-approved per active auto mode (orchestrator flag).

## Deviations from Plan

### Auto-resolved Issues

1. **[Rule 3 - Blocking] Missing node_modules in worktree**
   - Found during: first `npm run build`
   - Issue: Build failed to resolve `@mantine/charts/styles.css` because the worktree had no `node_modules` directory yet.
   - Fix: ran `npm install` in the worktree root.
   - No source files modified.

2. **[Rule 2 - Critical] Gate yearly fetch until years are loaded**
   - Issue: `useReportYearly(year)` was being called with `year` defaulting to `new Date().getFullYear()` even before the years list resolved, which would fire a request for a year that may not exist in the dataset.
   - Fix: pass `years.length > 0 ? year : null` to `useReportYearly`, leaning on the hook's null-key disable behavior.
   - Files modified: `apps/web/src/pages/reports-yearly-page/reports-yearly-page.tsx`.
   - Tracked under Task 06-06-02's commit.

3. **Added Alert states for both years and yearly fetch errors** (defensive, Rule 2 - missing error handling). Mirrors the pattern in `unmatched-books-section.tsx`.

## Threat Model Compliance

- T-06-06-01 (XSS via chart label / year string): mitigated. Year passed through `parseAsInteger`, page renders only React-escaped values, no `dangerouslySetInnerHTML`.
- T-06-06-02 (Open redirect via `?year=`): accepted per plan; year never feeds a URL or HTML attribute.
- T-06-06-03 (Indicator regression in navbar): mitigated by insertion-only edit; the Settings `Indicator` block at lines 78-92 of navbar.tsx is byte-for-byte unchanged.

## Known Stubs

- `apps/web/src/pages/reports-yearly-page/reports-yearly-page.tsx`: charts area is intentionally a placeholder `<div data-testid="charts-placeholder" />` plus the `<Title>{year}</Title>` heading. Plan 06-07 fills in the genre stacked bar, nationality bar, decade histogram, language pie, and headline cards. This is documented in CONTEXT.md and is the explicit handoff point between 06-06 and 06-07.

## Self-Check: PASSED

Files exist:
- FOUND: apps/web/src/api/reports.ts
- FOUND: apps/web/src/pages/reports-yearly-page/reports-yearly-page.tsx
- FOUND: apps/web/src/pages/reports-yearly-page/reports-yearly-page.module.css
- FOUND: apps/web/src/pages/reports-yearly-page/year-navigator.tsx
- FOUND: apps/web/src/pages/reports-yearly-page/empty-state.tsx

Commits exist:
- FOUND: bcdabd3 feat(06-06): wire reports route, nav entry, and SWR hooks
- FOUND: 8e529da feat(06-06): add yearly report page shell, year navigator, and empty state

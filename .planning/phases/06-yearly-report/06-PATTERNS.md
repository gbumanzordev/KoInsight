---
phase: 06
phase_name: Yearly Report
status: pattern-mapped
---

# Phase 6 - Yearly Report: PATTERNS

**Mapped:** 2026-04-24
**Files analyzed:** 22 (8 server + 5 server tests + 2 migrations + 1 shared types + 6 web pages/charts + 2 web hooks + 1 nav edit)
**Analogs found:** 21 / 22 (one near-greenfield: `tz.ts` is a pure helper with no direct in-repo analog)

## File Classification

| New / modified file | Role | Data flow | Closest analog |
|---|---|---|---|
| `apps/server/src/reports/reports-router.ts` | controller (express router) | request-response | `apps/server/src/enrichment/router.ts` |
| `apps/server/src/reports/reports-service.ts` | service (shaping / pure transforms) | transform | `apps/server/src/stats/stats-service.ts` |
| `apps/server/src/reports/reports-repository.ts` | repository (Knex SQL) | CRUD-read / aggregate | `apps/server/src/enrichment/unmatched-repository.ts` (+ `apps/server/src/stats/stats-repository.ts`) |
| `apps/server/src/reports/tz.ts` | utility (pure TZ helper) | transform | NONE in repo (greenfield); see "No analog found" below |
| `apps/server/src/reports/__tests__/tz.test.ts` | test (unit) | n/a | `apps/server/src/stats/stats-service.test.ts` (pure-function test pattern) |
| `apps/server/src/reports/__tests__/reports-service.test.ts` | test (unit) | n/a | `apps/server/src/stats/stats-service.test.ts` |
| `apps/server/src/reports/__tests__/reports-repository.test.ts` | test (integration, in-memory SQLite) | n/a | `apps/server/src/stats/stats-repository.test.ts` |
| `apps/server/src/reports/__tests__/reports-router.test.ts` | test (supertest end-to-end) | n/a | `apps/server/src/stats/stats-router.test.ts` (+ `apps/server/src/enrichment/__tests__/unmatched-router.test.ts`) |
| `apps/server/src/db/migrations/2026XXXX_add_page_stat_start_time_index.ts` | migration (structure-only index) | n/a | `apps/server/src/db/migrations/20260425000000_book_enrichment_status_index.ts` |
| `apps/server/src/db/migrations/__tests__/phase-06-schema.test.ts` | test (SCHEMA-07 grep guard) | n/a | `apps/server/src/db/migrations/__tests__/phase-01-schema.test.ts` (+ `phase-02-schema.test.ts`) |
| `apps/server/src/db/__tests__/fixtures/yearly-report.ts` (or similar) | test fixture builder | n/a | `apps/server/src/db/factories/page-stat-factory.ts` (+ existing `*-factory.ts` family) |
| `packages/common/types/reports-api.ts` | shared types | n/a | `packages/common/types/stats-api.ts` (+ `enrichment.ts`) |
| `apps/web/src/api/use-report-yearly.ts` | hook (SWR) | request-response | `apps/web/src/api/enrichment.ts` (`useEnrichmentStatus`, `useUnmatchedBooks`) |
| `apps/web/src/api/use-report-years.ts` | hook (SWR) | request-response | `apps/web/src/api/enrichment.ts` (`useEnrichmentStatus`) |
| `apps/web/src/pages/reports-yearly-page/reports-yearly-page.tsx` | page (route component) | request-response | `apps/web/src/pages/stats-page/stats-page.tsx` |
| `apps/web/src/pages/reports-yearly-page/reports-yearly-page.module.css` | style | n/a | `apps/web/src/pages/settings-page/settings-layout.module.css` |
| `apps/web/src/pages/reports-yearly-page/charts/genre-bar.tsx` | component (BarChart wrapper) | render | `apps/web/src/pages/stats-page/stats-page.tsx` (lines 120-143 BarChart "per day of the week") |
| `apps/web/src/pages/reports-yearly-page/charts/nationality-bar.tsx` | component (BarChart) | render | `apps/web/src/pages/stats-page/stats-page.tsx` (lines 147-171 monthly BarChart) |
| `apps/web/src/pages/reports-yearly-page/charts/decade-histogram.tsx` | component (BarChart) | render | `apps/web/src/pages/stats-page/stats-page.tsx` (lines 120-143) |
| `apps/web/src/pages/reports-yearly-page/charts/language-pie.tsx` | component (PieChart) | render | `@mantine/charts` PieChart - no in-repo analog yet (see "No analog found") |
| `apps/web/src/pages/reports-yearly-page/charts/headline-cards.tsx` | component (stat cards) | render | `apps/web/src/pages/settings-page/enrichment-status-cards.tsx` (+ `components/statistics/statistics.tsx` used by stats-page) |
| `apps/web/src/pages/reports-yearly-page/charts/coverage-banner.tsx` | component (caption) | render | NONE direct (trivial; mirror Mantine `<Text size="xs" c="dimmed">` pattern from `unmatched-books-section.tsx:51`) |
| `apps/web/src/pages/reports-yearly-page/charts/empty-state.tsx` | component (empty placeholder) | render | `apps/web/src/components/empty-state/empty-state.tsx` (+ `unmatched-books-section.tsx:48-58` for the inline-empty-with-CTA-link pattern) |
| `apps/web/src/app.tsx` (edit) | route registration | n/a | `apps/web/src/app.tsx:77-80` (existing `/settings/*` block) |
| `apps/web/src/routes.ts` (edit) | route enum | n/a | `apps/web/src/routes.ts:3-13` (existing `RoutePath` enum) |
| `apps/web/src/components/navbar/navbar.tsx` (edit) | nav array entry | n/a | `apps/web/src/components/navbar/navbar.tsx:44-51` (`tabs` array) |
| `apps/server/src/app.ts` (edit) | router mount | n/a | `apps/server/src/app.ts:40` (`app.use('/api/enrichment', enrichmentRouter);`) |
| `apps/server/src/config.ts` (edit) | env var | n/a | `apps/server/src/config.ts:6-8` (`DATA_PATH`, `MAX_FILE_SIZE_MB` reads) |

---

## Pattern Assignments

### Server slice

| New file | Closest analog | What to mirror (1-line) |
|---|---|---|
| `apps/server/src/reports/reports-router.ts` | `apps/server/src/enrichment/router.ts:1-50` | Zod-at-boundary pattern: `safeParse(req.query)` -> 400 with `parsed.error.flatten()` on failure, otherwise `try { service call } catch { console.error; res.status(500).json({ error: '...' }) }`. Export `{ router as reportsRouter }`. |
| `apps/server/src/reports/reports-service.ts` | `apps/server/src/stats/stats-service.ts:11-105` | `class ReportsService { static async getYears(); static async getYearly(year); }` with pure helpers (`truncateTopN`, `fillDecades`); use Ramda (`groupBy`, `sortBy`) and `date-fns` (`format`) as `stats-service.ts:8-9` does. |
| `apps/server/src/reports/reports-repository.ts` | `apps/server/src/enrichment/unmatched-repository.ts:1-98` | Module-level exported async functions (not a class) - matches the newer Phase 4/5 style; `import { db } from '../knex'`; one function per query (`getYearsWithReading`, `getBooksReadInYear`, `getGenreBreakdown`, etc.); each function ends with `return rows`. NB: stats-repository uses a `class` style - prefer the unmatched-repository module style for new Phase 6 code (closer to enrichment slice and the rest of Phase 4/5). |
| `apps/server/src/reports/reports-repository.ts` (raw SQL CTE) | `apps/server/src/enrichment/unmatched-repository.ts:69-98` | Knex `.leftJoin(... function () { this.on(...).andOn(...) })` and `.orderByRaw('... IS NULL')` precedent for the >=95% CTE. Use `db.raw()` for the full CTE if the chain becomes too dense (project already mixes both). |
| `apps/server/src/reports/reports-repository.ts` (soft_deleted filter) | `apps/server/src/stats/stats-repository.ts:11-13` | Every query joining `book` MUST include `.where({ 'book.soft_deleted': false })` - mirror exactly. |
| `apps/server/src/reports/reports-repository.ts` (start_time unit) | `apps/server/src/stats/stats-repository.ts:5-7` | DO NOT replicate the `* 1000` mapping in `StatsRepository.updateStartTime`. `page_stat.start_time` is stored in SECONDS; bind year boundaries in seconds; add a top-of-file comment documenting this (Pitfall 1). |
| `apps/server/src/reports/tz.ts` | NONE direct (greenfield) | Pure module exporting `yearBoundsInZone(year, timeZone): { startSec, endSec }`. Closest stylistic siblings: `apps/server/src/utils/` (any small pure helper) and the `format`/`startOfDay` use in `stats-service.ts:8`. Keep zero side effects, no `db` import, no env reads (env -> `config.ts`). |
| `apps/server/src/config.ts` (edit) | `apps/server/src/config.ts:6-8` | Add `const REPORT_TZ = process.env.REPORT_TZ ?? 'UTC';` next to existing env reads; expose under `appConfig.reports = { timeZone: REPORT_TZ }`. |
| `apps/server/src/app.ts` (edit) | `apps/server/src/app.ts:40` | Add one line `app.use('/api/reports', reportsRouter);` immediately after the `/api/enrichment` mount, BEFORE the `app.use(express.static(...))` and the `app.get(/.*/, ...)` SPA catch-all (lines 43-46). |

### Server tests

| New file | Closest analog | What to mirror (1-line) |
|---|---|---|
| `apps/server/src/reports/__tests__/reports-router.test.ts` | `apps/server/src/stats/stats-router.test.ts:1-42` (+ `apps/server/src/enrichment/__tests__/unmatched-router.test.ts:1-40`) | `const app = express(); app.use(express.json()); app.use('/reports', reportsRouter);` then supertest GETs; seed via existing factories (`createBook`, `createDevice`, `createBookDevice`, `createPageStat`); assert status + JSON shape. |
| `apps/server/src/reports/__tests__/reports-repository.test.ts` | `apps/server/src/stats/stats-repository.test.ts:1-37` | `describe(ReportsRepository.getX, () => { ... beforeEach seed via factories; assert .toHaveLength / .toEqual })`. Cover the 94/95/96 page-threshold edges (Nyquist sample 2). |
| `apps/server/src/reports/__tests__/reports-service.test.ts` | `apps/server/src/stats/stats-service.test.ts:1-50` | Pure-function tests with hand-built input arrays (no DB). Cover top-10+Other math, decade zero-fill, Unknown bucket presence on every breakdown (Nyquist samples 4 + 5). |
| `apps/server/src/reports/__tests__/tz.test.ts` | (use service-test pattern - no direct analog for TZ math) `apps/server/src/stats/stats-service.test.ts:1-20` | Plain Vitest `describe` / `it` table-driven tests across `UTC`, `Asia/Tokyo` (positive), `America/Los_Angeles` (negative + DST), `America/New_York` (Mar/Nov DST). Assert `[startSec, endSec)` epoch values match expected UTC instants. |
| `apps/server/src/db/migrations/__tests__/phase-06-schema.test.ts` | `apps/server/src/db/migrations/__tests__/phase-01-schema.test.ts:30-57` (+ `phase-02-schema.test.ts:29-75`) | SCHEMA-07 grep guards: assert migration text does NOT contain `fetch(`, `axios`, `https://`, `for (... of ... knex('book')...)`, or `forEach` over `book` rows. Add a migrate-up + down + up idempotency test using `knexFactory` against in-memory sqlite, mirroring the migrations-up scaffold from `phase-02-schema.test.ts:14-23` (`COMPILED_MIGRATIONS_DIR` path). |
| `apps/server/src/db/__tests__/fixtures/yearly-report.ts` (or `apps/server/src/reports/__tests__/fixtures/`) | `apps/server/src/db/factories/page-stat-factory.ts` + `apps/server/src/db/factories/book-factory.ts` | Compose existing factories into a single seed helper (`seedYearlyReportScenario(db, { year, books: [...] })`) that returns md5s + counts. Mirror enrichment fixture-shape conventions if any are documented in `apps/server/src/enrichment/__tests__/phase-04-fixture-shape.test.ts`. |

### Migrations

| New file | Closest analog | What to mirror (1-line) |
|---|---|---|
| `apps/server/src/db/migrations/2026XXXX_add_page_stat_start_time_index.ts` | `apps/server/src/db/migrations/20260425000000_book_enrichment_status_index.ts` (entire file, 19 lines) | Exact same shape: `import type { Knex }`, one-paragraph header comment citing REPORT-04 + CONTEXT D-10 + SCHEMA-07, `up()` calls `knex.schema.alterTable('page_stat', (table) => table.index(['start_time'], 'idx_page_stat_start_time'))`, `down()` drops the same name. NO data, NO network. |

### Shared types

| New file | Closest analog | What to mirror (1-line) |
|---|---|---|
| `packages/common/types/reports-api.ts` | `packages/common/types/stats-api.ts` (response-shape file) + `packages/common/types/enrichment.ts:1-17` (small types module) | Pure TS `export type` declarations matching the `YearlyReport` / `YearsResponse` shape in 06-RESEARCH.md. No runtime code. |
| `packages/common/types/index.ts` (edit) | `packages/common/types/index.ts:1-16` | Append `export * from './reports-api';` to the barrel. |

### Web pages and charts

| New file | Closest analog | What to mirror (1-line) |
|---|---|---|
| `apps/web/src/pages/reports-yearly-page/reports-yearly-page.tsx` | `apps/web/src/pages/stats-page/stats-page.tsx:1-174` | Same skeleton: `useComputedColorScheme` + `useMantineTheme` + SWR hook + `Loader` while `isLoading` + sectioned `<Title order={3}>` + `<BarChart>`. Replace `usePageStats()` with `useReportYearly(year)` and `useReportYears()`. Reuse `formatSecondsToHumanReadable` from `apps/web/src/utils/dates.ts` for the "total time" headline card. |
| `apps/web/src/pages/reports-yearly-page/reports-yearly-page.module.css` | `apps/web/src/pages/settings-page/settings-layout.module.css` | CSS Module convention: `style.layout`, `style.rail`, `style.content` referenced via `import style from './...module.css'`. Page only ships `/reports/yearly` in v1 so a single content area; do not adopt the rail layout yet (see CONTEXT.md "v1 only ships `/reports/yearly`, so the layout is single-content for now"). |
| `apps/web/src/pages/reports-yearly-page/charts/genre-bar.tsx` (stacked) | `apps/web/src/pages/stats-page/stats-page.tsx:120-143` (per-day BarChart) | `BarChart` from `@mantine/charts`; `data`, `dataKey`, `series`, `gridAxis="none"`, `withYAxis={false}`, optional custom `barProps.shape={(p) => <CustomBar ... />}`. Add `type="stacked"` for the genre chart per Pattern 8 in 06-RESEARCH.md. Use `colorScheme === 'dark' ? 'koinsight.7' : 'koinsight.1'` color tokens like the analog. |
| `apps/web/src/pages/reports-yearly-page/charts/nationality-bar.tsx` | `apps/web/src/pages/stats-page/stats-page.tsx:147-171` (monthly BarChart) | Same `BarChart` props pattern; single series; render the `Other` and `Unknown` keys as ordinary entries (server already returned them). |
| `apps/web/src/pages/reports-yearly-page/charts/decade-histogram.tsx` | `apps/web/src/pages/stats-page/stats-page.tsx:147-171` | Same. Recharts has no `<Histogram>` primitive (Pattern 8 + Anti-Patterns); a histogram is just a BarChart over numeric buckets. |
| `apps/web/src/pages/reports-yearly-page/charts/language-pie.tsx` | NO direct in-repo analog (see "No analog found"); see `@mantine/charts` `PieChart` docs cited in 06-RESEARCH.md Pattern 8 | New pattern. Mirror the BarChart import style: `import { PieChart } from '@mantine/charts'`. Theme colors via `colorScheme` like stats-page. |
| `apps/web/src/pages/reports-yearly-page/charts/headline-cards.tsx` | `apps/web/src/pages/settings-page/enrichment-status-cards.tsx:1-33` | `<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">` of `<Paper p="md" withBorder>` cards with `<Text size="sm" c="dimmed">` label and `<Text size="28px" fw={600} lh={1.1}>` value. Three cards: total books / total pages / total time. Format time via `formatSecondsToHumanReadable`. |
| `apps/web/src/pages/reports-yearly-page/charts/headline-cards.tsx` (alt) | `apps/web/src/components/statistics/statistics.tsx` (used by stats-page line 82-105) | If a richer icon-driven layout fits better (matching the StatsPage "Total read time / Total pages read" cards), reuse `<Statistics>` directly with an `icon` per card. Choice between this and enrichment-status-cards is style-only; pick one and stay consistent. |
| `apps/web/src/pages/reports-yearly-page/charts/coverage-banner.tsx` | `apps/web/src/pages/settings-page/unmatched-books-section.tsx:51` (`<Text size="sm" c="dimmed">...`) | Trivial component: `<Text size="xs" c="dimmed" mt="xs">{label} known for {known} of {total} books read this year ({pct}%)</Text>`. |
| `apps/web/src/pages/reports-yearly-page/charts/empty-state.tsx` | `apps/web/src/components/empty-state/empty-state.tsx:1-32` (visual shell) + `apps/web/src/pages/settings-page/unmatched-books-section.tsx:48-58` (inline-empty-with-CTA-link pattern) | Either reuse `<EmptyState title=... description=... />` directly, OR mirror unmatched-books-section's inline `<Stack align="center" py="xl" gap="md">` with a `<Button component={NavLink} to={RoutePath.SETTINGS_UNMATCHED}>`. Per CONTEXT D-08 the link target is `RoutePath.SETTINGS_UNMATCHED`. |

### Web hooks (api/)

| New file | Closest analog | What to mirror (1-line) |
|---|---|---|
| `apps/web/src/api/use-report-years.ts` | `apps/web/src/api/enrichment.ts:34-42` (`useEnrichmentStatus`) | `useSWR<YearsResponse>('reports/years', () => fetchFromAPI<YearsResponse>('reports/years'))`. STRING key (per D-09; default dedupe; NO `refreshInterval`). |
| `apps/web/src/api/use-report-yearly.ts` | `apps/web/src/api/enrichment.ts:44-53` (`useUnmatchedBooks`) | `useSWR<YearlyReport>(year ? ['reports/yearly', year] : null, () => fetchFromAPI<YearlyReport>('reports/yearly', 'GET', { year: year! }))`. Tuple key for re-key on year change; null key disables SWR until year resolves. NO `refreshInterval` per D-09 (unlike `useUnmatchedBooks` which sets 5000). Import types from `@koinsight/common/types/reports-api`. |
| Both files | `apps/web/src/api/api.ts:4-30` | Use `fetchFromAPI<T>(endpoint, method, body)`; the helper turns `body` into a query string when `method === 'GET'`. |

Note: file naming. The expected_new_files prompt lists `apps/web/src/api/use-report-yearly.ts` as the path. The codebase precedent is mixed: hooks live both as flat modules (`api/enrichment.ts` exports multiple hooks) and as per-hook files (`api/use-page-stats.ts`, `api/use-book-with-data.ts`). Either is acceptable; if the planner picks the flat-module style, name it `apps/web/src/api/reports.ts` (matches `enrichment.ts`).

### Web nav and routes

| Edit | Closest analog | What to mirror (1-line) |
|---|---|---|
| `apps/web/src/routes.ts` | `apps/web/src/routes.ts:3-13` | Add `REPORTS = '/reports'` and `REPORTS_YEARLY = '/reports/yearly'` to the `RoutePath` enum. |
| `apps/web/src/app.tsx` | `apps/web/src/app.tsx:77-80` (existing `/settings/*` block) | Append a sibling block: `<Route path={RoutePath.REPORTS}><Route index element={<Navigate to="yearly" replace />} /><Route path="yearly" element={<ReportsYearlyPage />} /></Route>`. Keep the `*` catch-all last (line 82-89). |
| `apps/web/src/components/navbar/navbar.tsx` | `apps/web/src/components/navbar/navbar.tsx:44-51` (`tabs` array) | Insert `{ link: RoutePath.REPORTS_YEARLY, label: 'Reports', icon: IconReport }` between the `STATS` entry (line 47) and the `SYNCS` entry (line 48). Per Pitfall 7: do NOT touch the Settings `Indicator` wrapper at lines 78-92; only the array order changes. Add `IconReport` (or `IconChartHistogram`) to the `@tabler/icons-react` imports at lines 11-19. |

---

## Shared cross-cutting patterns

### Zod-at-the-boundary
**Source:** `apps/server/src/enrichment/router.ts:18-37`
**Apply to:** `reports-router.ts` for `?year=YYYY` validation. Use `z.coerce.number().int().min(1900).max(2200)`. On `parsed.success === false`, return `400` with `parsed.error.flatten()`. Never trust `req.query` directly.

### Error handling in routers
**Source:** `apps/server/src/enrichment/router.ts:31-48`
**Apply to:** `reports-router.ts`. Pattern: `try { ... await service... ; res.status(200).json(...) } catch (error) { console.error(error); res.status(500).json({ error: 'Failed to load yearly report' }); }`. Generic message in body, full error to console only (V7 in 06-RESEARCH).

### Soft-deleted filter on book queries
**Source:** `apps/server/src/stats/stats-repository.ts:11-13`
**Apply to:** every Knex chain in `reports-repository.ts` that joins `book`. `.where({ 'book.soft_deleted': false })`. (Pitfall 4.)

### Knex factories for tests
**Source:** `apps/server/src/db/factories/{book,device,page-stat,book-device}-factory.ts`
**Apply to:** every test under `apps/server/src/reports/__tests__/`. Always seed via factories, never raw `db('book').insert(...)` in tests; mirrors `stats-router.test.ts:1-30` and `unmatched-router.test.ts:38-50`.

### `@koinsight/common` for shared types
**Source:** `packages/common/types/index.ts:1-16` barrel
**Apply to:** any type used by both the server response and the web client. Define once in `packages/common/types/reports-api.ts`, re-export from the barrel, import from `@koinsight/common/types` in both apps. Per CLAUDE.md.

### SCHEMA-07 structure-only invariant
**Source:** `apps/server/src/db/migrations/__tests__/phase-01-schema.test.ts:30-57`
**Apply to:** `phase-06-schema.test.ts`. Same six greps (`fetch(`, `axios`, `https://`, `forEach` over book, `for...of` over book queries) plus a migrate-up/down/up idempotency check.

### Router mount before SPA catch-all
**Source:** `apps/server/src/app.ts:32-46`
**Apply to:** the `app.use('/api/reports', reportsRouter)` line. Mount it together with the other `/api/*` routes (line 33-40), strictly BEFORE the `express.static` (line 43) and `app.get(/.*/, ...)` SPA fallback (line 44).

### Mantine theming (light/dark) in charts
**Source:** `apps/web/src/pages/stats-page/stats-page.tsx:24-25, 128, 138, 158, 168`
**Apply to:** every chart in `pages/reports-yearly-page/charts/`. Read `useComputedColorScheme()` and `useMantineTheme()` at the page level; pass color tokens like `'koinsight.7' / 'koinsight.1'` and `colors.koinsight[2] / colors.koinsight[8]` based on dark/light scheme.

### SWR key conventions
**Source:** `apps/web/src/api/enrichment.ts:34-53`
**Apply to:** report hooks. STRING keys for hook-shared cache (years list); TUPLE keys `['endpoint', param]` when re-key on parameter change is desired (yearly?year=). Per D-09 omit `refreshInterval`.

---

## No analog found

| File | Role | Reason | Planner guidance |
|---|---|---|---|
| `apps/server/src/reports/tz.ts` | pure TZ helper using `Intl.DateTimeFormat` | No existing TZ-offset helper exists in this codebase; `date-fns` is used everywhere with its default zone. This is genuinely new code. | Follow the implementation in 06-RESEARCH.md Pattern 2 verbatim; keep the file pure (no `db`, no `config` imports); read `REPORT_TZ` ONLY in the caller (`reports-service.ts`) via `appConfig.reports.timeZone`. |
| `apps/web/src/pages/reports-yearly-page/charts/language-pie.tsx` | `@mantine/charts` PieChart | No `PieChart` usage anywhere in `apps/web/src/`. `BarChart` and `AreaChart` are the only mantine-charts wrappers in use today. | First use of PieChart in the repo. Follow the official `@mantine/charts` PieChart props (cited in 06-RESEARCH.md Pattern 8). Reuse the same `useComputedColorScheme` theming pattern as the bar charts. |
| `apps/server/src/reports/__tests__/tz.test.ts` | pure-function TZ test | No TZ-aware unit tests exist. | Use the simplest Vitest `describe`/`it` from `stats-service.test.ts` as scaffolding; tabulate fixtures `[zone, year, expectedStartIso, expectedEndIso]` and assert epoch-second equality after a JS Date round-trip. |
| `apps/web/src/pages/reports-yearly-page/charts/coverage-banner.tsx` | tiny caption | Trivially small; no analog needed. | Use `<Text size="xs" c="dimmed" mt="xs">` per 06-RESEARCH.md Pattern 9; one file, one component, no styling. |

---

## Metadata

**Analog search scope:** `apps/server/src/{stats,enrichment,books,db}`, `apps/web/src/{pages/{stats,settings,books,book}-page,api,components/{navbar,empty-state,charts,statistics}}`, `packages/common/types`, `apps/server/src/db/migrations/__tests__`.
**Files scanned:** ~28 (slice routers, services, repositories, factories, migrations, web pages, hooks, nav).
**Pattern extraction date:** 2026-04-24.

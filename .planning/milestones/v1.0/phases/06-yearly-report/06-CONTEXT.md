---
phase: 06
phase_name: Yearly Report
status: discussed
---

# Phase 6 — Yearly Report: CONTEXT

Locks decisions that researcher and planner must honor without re-asking.
Anything not listed here is Claude's discretion within the success criteria
already in `ROADMAP.md` and `REQUIREMENTS.md`.

## Scope reminder (from ROADMAP / REQUIREMENTS)

- New `apps/server/src/reports/` slice exposing:
  - `GET /api/reports/years` — sorted-desc list of years with any `page_stat`.
  - `GET /api/reports/yearly?year=YYYY` — totals, genre / nationality / decade /
    original-language breakdowns, plus a `coverage` block.
- New `/reports/yearly` route in the web app, year selector populated from the
  years endpoint, year persisted in the URL query string.
- Recharts: stacked bar (genre), bar (nationality top 10 + Other), histogram
  (publication decade), pie or bar (original language), headline cards
  (total books / pages / time).
- Coverage banner under every chart.
- Empty "Unknown" bucket on every breakdown — never silently dropped.
- ≥95%-pages-by-end-of-Y rule for "books read in Y"; aggregates always include
  all reading regardless of completion.
- All aggregates computed on demand via SQL; covering indexes added on
  `page_stat.start_time` and `book_author(author_id, book_md5)`.

## Locked decisions (user calls)

### D-01 Navigation placement — new top-level "Reports" nav item

A new `Reports` entry sits in the sidebar alongside `Books`, `Calendar`,
`Stats`, `Progress syncs`, `Settings`. Icon: `IconReport` (or
`IconChartHistogram`) from `@tabler/icons-react`. Route: `/reports/yearly`
(default sub-route under `/reports`). Future reports (monthly, all-time) drop
under the same item via additional sub-routes, mirroring the pattern Phase 5
established for `/settings/*`.

**Why:** clean separation from the live Stats dashboard; gives a stable home
for additional report types without overloading the Stats page.

### D-02 Year navigator — Select + prev/next arrow buttons

Year picker is a Mantine `Select` plus two `ActionIcon` buttons (left arrow
"Previous year", right arrow "Next year"). Arrows step through the years
returned by `/api/reports/years` in sorted order; arrows are disabled at the
ends of the list. The Select is the source of truth; arrows just call
`setYear(neighbor)` and the URL query string updates accordingly.

**Why:** one-click year-over-year comparison is the dominant exploratory
behavior; cheaper than rendering year tabs which scale badly past ~5 years.

### D-03 Long-tail truncation — server-side top-10 + "Other"

`/api/reports/yearly` returns the nationality breakdown already sliced to
the top 10 country codes by count, with an `Other` bucket aggregating the
remainder. The bucket is a real entry in the array (`{ key: 'Other',
count: N }`) so the client renders it without special casing.

**Why:** consistent bucket boundary across clients (today the web app, later
CSV export or API consumers); smaller wire payload; fewer chances for the
chart to silently mis-render.

## Locked defaults (Claude's call, recorded for the record)

### D-04 Timezone — env-driven, default UTC

The "year boundary" timezone is read from `process.env.REPORT_TZ`
(IANA name, e.g. `America/Los_Angeles`). Default `UTC` if unset.
Configured in `apps/server/src/config.ts` next to existing env reads.
SQL uses `datetime(start_time, 'unixepoch', '+...')` math to bucket by
local-year boundaries; researcher to confirm SQLite timezone offset
strategy (likely a fixed-offset or a `DateTime` library helper at the
JS layer rather than SQLite TZ data).

### D-05 Decade buckets — fixed 10-year windows starting at 0

Buckets are `[1900, 1909], [1910, 1919], ..., [floor(year/10)*10, ...+9]`
across the full span of publication years present in the dataset.
Empty buckets between the min and max publication-year decades are
included with `count: 0` so the histogram has no gaps. Books with NULL
`publication_year` go into the `Unknown` bucket.

### D-06 Genre breakdown counting — books, not subject-tag occurrences

For the genre breakdown, each book contributes `1` to each of its
canonical genres (multi-genre books count in multiple bars). The total
across all genre counts therefore exceeds `total_books_with_genre` —
the coverage banner reads "Genres known for N of M books" using the
`books-with-any-genre` denominator, not the sum of bar heights.

### D-07 Nationality breakdown — primary author only

Per REPORT-01: only the `position = 0` author (the primary author from
`book_author`) contributes to the nationality breakdown. Co-authors are
ignored at the report layer. Books whose primary author has
`nationality = NULL` go into the `Unknown` bucket.

### D-08 Empty-state link target

When a year has zero reading or zero enriched books, the page renders an
empty placeholder with a single link to `/settings/unmatched` (Phase 5's
unmatched inbox), framed as "no enriched books for this year — fix
unmatched matches to populate this report".

### D-09 SWR caching — match the rest of the app

The web client fetches via the existing `fetchFromAPI` helper and `useSWR`.
Default `dedupingInterval` (no explicit `refreshInterval` — yearly aggregates
don't change between page loads in normal use). Year change re-keys the SWR
hook; old year stays cached for instant back/forward navigation.

### D-10 No HTTP caching, no summary tables

Per REPORT-04, the server runs aggregations on demand via SQL. No
`Cache-Control`, no ETag, no materialized table. Index covers (per
REQUIREMENTS): `page_stat(start_time)` and `book_author(author_id, book_md5)`.
Migrations are additive index-only; no new tables for v1.

## Component reuse (researcher should map)

- The Phase 5 `useEnrichmentStatus` SWR pattern (single key, dedup'd across
  surfaces) is the closest analog for `useReportYearly`.
- The Stats page (`apps/web/src/pages/stats-page/stats-page.tsx`) already
  uses Recharts; its chart imports + theming should be the model.
- The Settings page layout (split nav rail + content) is the reference for
  multi-sub-page nav items if/when more reports land. v1 only ships
  `/reports/yearly`, so the layout is single-content for now.

## Threats already covered upstream (no new mitigations needed)

- T-XSS on user-controlled strings in Recharts axes — React escapes by
  default; no `dangerouslySetInnerHTML`.
- T-Query-injection on `?year=YYYY` — Zod-coerced int at the route boundary.

## Out of scope (parking lot)

- Monthly report, lifetime report, comparison view (Y vs Y-1).
- CSV / PDF export.
- Per-author or per-book drill-downs from a chart click.
- Caching layer (in-memory or HTTP) — defer until profiling shows the SQL
  is too slow for interactive use.

## Open questions for the researcher

- SQLite timezone strategy: fixed-offset string (`+HH:MM`) computed in JS
  from `REPORT_TZ` and DST-aware? Or compute year boundaries in JS as Unix
  timestamps and bind them as parameters?
- Index strategy for the `≥95% pages` predicate: confirm whether a single
  pass over `page_stat` + `book_device` + `book` suffices or if a CTE per
  book is needed.
- Recharts version + treeshaking — confirm bundle impact of importing
  stacked bar + histogram + pie at once.

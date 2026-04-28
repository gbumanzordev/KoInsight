# Phase 6: Yearly Report - Research

**Researched:** 2026-04-24
**Domain:** Server-side SQL aggregation + Recharts/`@mantine/charts` dashboard slice
**Confidence:** HIGH

## Summary

Phase 6 ships a `apps/server/src/reports/` slice (router + service + repository) exposing
`GET /api/reports/years` and `GET /api/reports/yearly?year=YYYY`, plus a `/reports/yearly`
React route with year navigator and four Recharts/`@mantine/charts` panels. Every locked
decision (D-01 through D-10) is implementable with zero new server dependencies and zero
new web dependencies; every chart type already lives in the codebase or in `@mantine/charts`.

The hard problems are SQL, not stack: (1) timezone-correct year boundaries against a
SQLite column that stores **Unix epoch seconds in `page_stat.start_time`**, (2) the
"book is read in year Y" predicate that requires `>=95% of book.reference_pages reached
by end of Y`, which is a per-book aggregate, and (3) Phase 4 (enrichment service) and
Phase 5 (manual edit) have not landed in HEAD yet, but **all schema Phase 6 needs is
already migrated** (Phases 1, 2, 3 are complete per STATE.md and migrations on disk).
Phase 6 backend can therefore be developed in parallel with Phase 5 as ROADMAP.md
prescribes.

**Primary recommendation:** Compute the year-boundary epoch-second pair in JavaScript
using the existing `date-fns` dependency plus a tiny pure helper for IANA-zone offsets
via `Intl.DateTimeFormat`. Bind the two integers as Knex parameters and let SQLite
do straight integer comparisons against `page_stat.start_time`. Skip `date-fns-tz`,
skip Luxon, skip SQLite TZ extensions.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 Navigation placement:** New top-level `Reports` nav entry at `/reports/yearly`
  with `IconReport` (or `IconChartHistogram`) from `@tabler/icons-react`. Future report
  types nest under `/reports/*` in the same pattern Phase 5 used for `/settings/*`.
- **D-02 Year navigator:** Mantine `Select` plus prev/next `ActionIcon` arrows. Select
  is the source of truth; arrows call `setYear(neighbor)` and the URL query string
  updates accordingly. Arrows disabled at list endpoints.
- **D-03 Long-tail truncation:** `/api/reports/yearly` returns nationality breakdown
  pre-sliced server-side to top 10 + a real `{ key: 'Other', count: N }` entry.
- **D-04 Timezone:** `process.env.REPORT_TZ` (IANA name) wired through `apps/server/src/config.ts`,
  default `UTC`. SQL takes pre-computed epoch seconds for `[yearStart, yearEnd)`.
- **D-05 Decade buckets:** Fixed 10-year windows starting at 0
  (`[1900, 1909], [1910, 1919], ...`). No gaps between min and max present-decade
  (zero-count buckets are real entries). NULL `publication_year` -> `Unknown` bucket.
- **D-06 Genre counting:** Each book contributes 1 to each of its canonical genres
  (multi-genre books count multiple times). Coverage banner uses
  `books-with-any-genre / total_books` as the denominator, NOT sum of bar heights.
- **D-07 Nationality:** Primary author only (`book_author.position = 0`). Co-authors
  ignored. NULL primary-author nationality -> `Unknown` bucket.
- **D-08 Empty-state link:** Link to `/settings/unmatched`.
- **D-09 SWR caching:** Default `dedupingInterval`, no `refreshInterval`. Year change
  re-keys the SWR hook.
- **D-10 No HTTP caching, no summary tables:** SQL on demand. Index covers:
  `page_stat(start_time)` (NEW) and `book_author(author_id, book_md5)` (ALREADY exists
  per migration `20260423221400_create_author_and_book_author.ts` line 41 — index
  `book_author_author_id_book_md5_idx`). v1 migrations are additive index-only.

### Claude's Discretion

Anything not in `## Locked decisions` or `## Locked defaults` of CONTEXT.md, including:

- Exact SQL shape (CTE vs grouped query vs multiple round-trips) for the >=95%
  predicate.
- TZ-offset implementation (raw `Intl.DateTimeFormat` vs minimal offset table vs
  pulling in a TZ library).
- Web file layout under `apps/web/src/pages/reports-page/`.
- Whether to colocate a `useYears` and `useYearlyReport` SWR hook in
  `apps/web/src/api/reports.ts` (yes — matches `enrichment.ts` precedent).
- Coverage banner copy strings.
- Empty-state placeholder visual.

### Deferred Ideas (OUT OF SCOPE)

- Monthly report, lifetime report, comparison view (Y vs Y-1)
- CSV / PDF export
- Per-author / per-book drill-down on chart click
- Caching layer (in-memory or HTTP)
- Multi-citizenship resolution UI
- Per-user "counts as read" threshold (hardcoded 95% for v1)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REPORT-01 | `GET /api/reports/yearly?year=YYYY` returns totals + 4 breakdowns + coverage block | "API Surface", "Backend Architecture" |
| REPORT-02 | "Book read in Y" = >=95% of `reference_pages` (or `pages`) reached during Y, server-local TZ env-driven | "Timezone Strategy", "95%-Read Predicate SQL" |
| REPORT-03 | `GET /api/reports/years` returns years with any reading data | "API Surface" |
| REPORT-04 | Aggregations on demand via SQL, covering indexes on `page_stat.start_time` and `book_author(author_id, book_md5)` | "Index Strategy" |
| REPORT-05 | Every breakdown includes explicit `Unknown` bucket; never silently dropped | "Unknown Bucket Pattern" |
| REPORT-UI-01 | New `/reports/yearly` route, linked from nav | "Web Architecture" |
| REPORT-UI-02 | Year `Select` populated from years endpoint, year persisted in URL query string | "Web Architecture", "Year Persistence" |
| REPORT-UI-03 | Recharts: stacked bar (genre), bar (nationality top-10+Other), histogram (decade), pie/bar (language), headline cards | "Charts Stack" |
| REPORT-UI-04 | Each chart shows coverage banner ("Genres known for N of M books") | "Coverage Banner Pattern" |
| REPORT-UI-05 | Empty year states render placeholder linking to `/settings/unmatched` | "Empty-State Pattern" |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Year boundary computation (TZ-aware) | API server (Node) | — | SQLite has no IANA TZ database; the offset must be computed in JS and bound as a parameter |
| Aggregation SQL (totals, breakdowns, decade histogram) | API server / SQLite | — | Per REPORT-04 (D-10) on-demand SQL only; no client-side aggregation, no summary table |
| 95%-read predicate evaluation | API server / SQLite | — | Computed in a CTE/subquery against `page_stat` + `book.reference_pages` |
| Top-10 + Other truncation (nationality) | API server | — | Per D-03, server returns the truncated array including a real "Other" entry |
| Year selector state (URL query string) | Browser | — | Per D-02, URL is source of truth; `nuqs` already in `apps/web` deps for query-string state |
| Chart rendering | Browser | — | Recharts (via `@mantine/charts`) executes in the browser |
| Empty-state detection / link to `/settings/unmatched` | Browser | API server | Server returns coverage block; client decides "render empty placeholder" based on `total_books === 0` |
| SWR cache | Browser | — | `useSWR` keyed on year |

## Standard Stack

### Core (already installed, no new deps)

| Library | Version (HEAD) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | 5.2.1 | Router for `/api/reports/*` | Existing app router pattern (`apps/server/src/app.ts`). [VERIFIED: `apps/server/package.json:24`] |
| zod | 4.3.5 | Validate `?year=YYYY` query | Project-wide pattern at route boundaries (CLAUDE.md). [VERIFIED: package.json line 35] |
| knex | 3.1.0 | Query builder against SQLite | Project-wide DB access. [VERIFIED: package.json line 28] |
| better-sqlite3 | 12.6.0 | SQLite driver | Already in use. [VERIFIED] |
| date-fns | 4.1.0 | UTC-side year math + format helpers | Already used in `apps/server/src/stats/stats-service.ts` and `books-service.ts`. [VERIFIED: server package.json line 25 + grep] |
| swr | 2.3.8 | Client data fetching | Existing pattern (`apps/web/src/api/enrichment.ts`). [VERIFIED] |
| @mantine/charts | 8.3.12 | `BarChart`, `AreaChart`, `PieChart` wrappers around Recharts | Already used in `stats-page/stats-page.tsx` and `week-stats.tsx`. [VERIFIED: web package.json line 19, grep matches] |
| recharts | 2.15.0 | Underlying charts library; `@mantine/charts` re-exports it | Available for any non-wrapped primitives (e.g., custom bar shapes already in `components/charts/custom-bar.tsx`). [VERIFIED] |
| @tabler/icons-react | 3.36.1 | `IconReport` / `IconChartHistogram` etc. | Project-wide nav icon library. [VERIFIED] |
| nuqs | 2.8.6 | Type-safe URL query-string state for `?year=` | Already a dep, ideal for D-02 year persistence. [VERIFIED: web package.json line 38] |
| @koinsight/common | * | Shared TS types between server + web | Mandatory per CLAUDE.md ("Any type used by both belongs here"). [VERIFIED] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ramda | 0.31.1 | Functional helpers (groupBy, sortBy) for transforming SQL results into chart-friendly shapes | If existing slices feel idiomatic with it (stats-service uses it). [VERIFIED] |

### NOT recommended / explicitly rejected

| Instead of | Don't add | Tradeoff |
|------------|-----------|----------|
| `date-fns-tz` | Adds a dep for one helper | We can compute the IANA-zone offset for a Date with `Intl.DateTimeFormat(..., { timeZone, timeZoneName: 'longOffset' })` — runtime built-in, zero deps. Keep dep surface minimal. |
| `luxon` | Adds 70KB+ dep | Same as above; Intl handles it. |
| Materialized summary tables | Caching layer per CONTEXT D-10 | Defer until profiling shows slowness on real data. SQLite + indexes will handle a single user's library trivially. |

**Installation:** None. Phase 6 ships with zero new package installs.

**Version verification:**
- `@mantine/charts@8.3.12`, `recharts@2.15.0`: confirmed present in `apps/web/package.json` (committed). Both transitively installed and in active use today; no version bump needed for this phase. [VERIFIED via repo file]
- `date-fns@4.1.0`: server-side and client-side; `format`, `startOfYear`, `endOfYear`, `addYears` available. [VERIFIED via repo file]
- `nuqs@2.8.6`: parses/writes `?year=` reliably. [VERIFIED via repo file]

## Architecture Patterns

### System Architecture Diagram

```
                                  Browser
                                     |
                                     | (React Router: /reports/yearly?year=2024)
                                     |
                            +--------v---------+
                            | ReportsYearlyPage|
                            | (page component) |
                            +--------+---------+
                                     |
                  +------------------+-----------------+
                  |                  |                 |
            +-----v-----+    +-------v------+   +------v------+
            | useYears  |    |useYearlyReport|   |  nuqs       |
            | SWR(GET   |    |SWR(GET        |   | useQueryState|
            | /reports/ |    |/reports/      |   | ('year')    |
            | years)    |    | yearly?year=) |   +-------------+
            +-----+-----+    +-------+------+
                  |                  |
                  +---------+--------+
                            |
                            | HTTP (fetch via fetchFromAPI)
                            |
                            v
=========================== /api/reports/* router ===========================
                            |
                            | Zod parse query
                            v
                  +---------+---------+
                  | reports-router.ts |
                  +---------+---------+
                            |
                +-----------+------------+
                |                        |
        +-------v-------+         +------v---------+
        |reports-service|         | reports-       |
        | (TZ math,     |         | repository.ts  |
        | top-10+Other, |         | (Knex / SQL)   |
        | bucket fill,  |         +------+---------+
        | shape API)    |                |
        +---------------+                |
                                         | parameterized SQL
                                         v
                              +----------+----------+
                              | SQLite (better-     |
                              | sqlite3 / knex)     |
                              |                     |
                              | page_stat           |
                              |   + idx start_time  |
                              | book                |
                              |   + idx enrichment  |
                              |   _status           |
                              | book_author         |
                              |   + idx (author_id, |
                              |     book_md5)       |
                              | author              |
                              | book_genre          |
                              | genre               |
                              +---------------------+
```

Data flow trace for the primary use case (user picks year 2024):

1. `nuqs` reads `?year=2024` from URL into React state.
2. `useYearlyReport(2024)` SWR fetch hits `GET /api/reports/yearly?year=2024`.
3. Router parses with Zod (coerce int, range-check), calls `reportsService.getYearly(2024)`.
4. Service computes `[yearStart, yearEnd)` epoch seconds for the configured `REPORT_TZ`.
5. Service calls 5-6 repository methods (totals, genre, nationality, decade, language,
   coverage), each issuing one parameterized SQL statement against indexed columns.
6. Service applies top-10+Other truncation (nationality), zero-fills decade buckets,
   shapes the JSON response.
7. Response returned; SWR caches keyed on `['reports/yearly', 2024]`.
8. Page component renders 4 charts via `@mantine/charts` wrappers + headline cards.
9. Coverage banner under each chart reads from the response's `coverage` block.

### Recommended Project Structure

**Server (mirroring `apps/server/src/enrichment/` and `apps/server/src/stats/` patterns):**

```
apps/server/src/reports/
  reports-router.ts           # Zod parse + JSON response (thin)
  reports-service.ts          # TZ math, response shaping, top-10+Other, decade fill
  reports-repository.ts       # 5-6 small Knex methods, all parameterized
  tz.ts                       # Pure helper: yearBoundsInZone(year, tz) -> [start, end)
  __tests__/
    reports-service.test.ts   # Pure-function tests for top-10, decade fill, coverage
    reports-repository.test.ts# Knex against in-memory SQLite (existing test fixture)
    tz.test.ts                # DST-edge correctness for fixed zones
    reports-router.test.ts    # supertest end-to-end (already a project pattern)
```

**Common types:**

```
packages/common/types/reports-api.ts   # Re-exported from index.ts barrel
```

**Web:**

```
apps/web/src/pages/reports-page/
  reports-yearly-page.tsx     # Top-level route component
  year-navigator.tsx          # Select + 2 ActionIcons; nuqs-backed state
  headline-cards.tsx          # 3 stat cards (books / pages / time)
  genre-stacked-bar.tsx       # @mantine/charts BarChart, type="stacked"
  nationality-bar.tsx         # @mantine/charts BarChart with top-10+Other
  decade-histogram.tsx        # @mantine/charts BarChart (effectively a histogram)
  language-pie.tsx            # @mantine/charts PieChart
  coverage-banner.tsx         # Reusable strip rendered under each chart
  empty-state.tsx             # Placeholder linking to /settings/unmatched
  reports-yearly-page.module.css

apps/web/src/api/reports.ts   # useYears() + useYearlyReport(year)
```

**Migrations:**

```
apps/server/src/db/migrations/
  20260425XXXXXX_add_page_stat_start_time_index.ts   # ONE new migration
```

(`book_author(author_id, book_md5)` index already exists from Phase 1; do not duplicate.)

### Pattern 1: Slice layout (router / service / repository)

Mirrors `apps/server/src/stats/` exactly. The router stays a thin Zod-then-JSON
boundary; the repository owns SQL; the service owns shaping (TZ math, top-N truncation,
bucket zero-fill, coverage block computation).

```typescript
// apps/server/src/reports/reports-router.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { reportsService } from './reports-service';

const router = Router();

const yearlyQuery = z.object({
  year: z.coerce.number().int().min(1900).max(2200),
});

router.get('/years', async (_req: Request, res: Response) => {
  try {
    const years = await reportsService.getYears();
    res.status(200).json({ years });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load years' });
  }
});

router.get('/yearly', async (req: Request, res: Response) => {
  const parsed = yearlyQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const report = await reportsService.getYearly(parsed.data.year);
    res.status(200).json(report);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load yearly report' });
  }
});

export { router as reportsRouter };
```

Mount in `apps/server/src/app.ts` next to `app.use('/api/enrichment', enrichmentRouter);`:

```typescript
app.use('/api/reports', reportsRouter);
```

### Pattern 2: Timezone strategy (resolves CONTEXT.md open question 1)

**Strategy:** Compute year boundaries entirely in JavaScript and bind them as
Unix-epoch-second integers. SQLite never sees a timezone string.

**Why this strategy beats SQLite TZ math:**

- SQLite's `datetime()` modifiers do not understand IANA names (`America/Los_Angeles`).
  They only understand fixed offsets (`+08:00`) — and a fixed offset is wrong half the
  year because of DST.
- Computing in JS lets us use the existing `Intl.DateTimeFormat` runtime (no new dep)
  to ask "what is the UTC instant of `2024-01-01 00:00:00` in `America/Los_Angeles`?"
  Intl handles DST and historical TZ rules correctly.
- The query then becomes a plain integer range scan: `WHERE start_time >= ? AND
  start_time < ?` — straight integer comparison against an indexed column.

**Implementation (pure helper, fully unit-testable):**

```typescript
// apps/server/src/reports/tz.ts
//
// Compute the [start, end) epoch-second pair for "year Y in zone TZ".
// Works for any IANA zone available in the Node ICU build (default tier 1).
// Handles DST boundaries because Intl applies the correct offset per instant.

export function yearBoundsInZone(year: number, timeZone: string): {
  startSec: number;
  endSec: number;
} {
  // Strategy: find the UTC instant whose local-time projection in `timeZone`
  // is exactly Jan 1, 00:00:00.000 of `year`. Iterate twice: first guess the
  // UTC midnight, then correct by the offset Intl reports for that instant.
  // Two passes converge for any zone (the offset itself does not change between
  // adjacent UTC midnights).
  return {
    startSec: localMidnightToEpochSec(year, 0, 1, timeZone),
    endSec: localMidnightToEpochSec(year + 1, 0, 1, timeZone),
  };
}

function localMidnightToEpochSec(
  year: number,
  monthIndex: number,
  day: number,
  timeZone: string
): number {
  // Initial guess: pretend the local time IS UTC.
  let utcMs = Date.UTC(year, monthIndex, day, 0, 0, 0, 0);
  // Correct twice (handles DST near boundaries).
  for (let i = 0; i < 2; i++) {
    const offsetMin = getZoneOffsetMinutes(utcMs, timeZone);
    utcMs = Date.UTC(year, monthIndex, day, 0, -offsetMin, 0, 0);
  }
  return Math.floor(utcMs / 1000);
}

function getZoneOffsetMinutes(utcMs: number, timeZone: string): number {
  // Use the longOffset format ("GMT-08:00") to read the zone's offset for this instant.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  // tzPart looks like "GMT-08:00" or "GMT" (for UTC).
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(tzPart);
  if (!match) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  const hours = Number(match[2]);
  const mins = Number(match[3]);
  return sign * (hours * 60 + mins);
}
```

[CITED: MDN `Intl.DateTimeFormat` `timeZoneName: 'longOffset'` — supported in Node 18+,
project requires Node >=22 per root package.json `engines`.]

**Wire into config:**

```typescript
// apps/server/src/config.ts (additive)
const REPORT_TZ = process.env.REPORT_TZ ?? 'UTC';
// ...
export const appConfig = {
  // ...
  reports: { timeZone: REPORT_TZ },
};
```

Validate `REPORT_TZ` at boot: `Intl.DateTimeFormat(undefined, { timeZone: REPORT_TZ })`
throws `RangeError` if the name is invalid — surface a clear message and fall back to
UTC. (Add to `turbo.json` `globalEnv` so workspaces pick up the env var.)

### Pattern 3: 95%-read predicate (resolves CONTEXT.md open question 2)

**Schema reality (verified from migrations on disk):**

- `page_stat` columns: `id, page, start_time (INT, epoch SECONDS), duration, total_pages,
  device_id, book_md5` — `book_md5` is the FK key, not `book_id`. [VERIFIED:
  migration `20250412161907_use_book_md5_as_foreign_key.ts`]
- `start_time` is stored in seconds (KOReader native unit). The web layer multiplies by
  1000 in `StatsRepository.updateStartTime` to convert to ms when serving — but ALL
  raw stored values are seconds. [VERIFIED: `apps/server/src/stats/stats-repository.ts:8`]
- `book.reference_pages` is nullable; fall back to `book.pages` when null per REPORT-02.
  [VERIFIED: migration `20250412065854_add_reference_pages_to_book.ts`]
- The "page reached" signal in `page_stat` is the `page` column (integer). Maximum
  `page` reached **before or at year-end** is what determines the >=95% threshold.

**SQL strategy (single CTE, single round-trip):**

```sql
-- year-end epoch seconds is bound from JS
WITH max_page_by_end_of_year AS (
  SELECT
    ps.book_md5,
    MAX(ps.page) AS max_page_reached
  FROM page_stat ps
  WHERE ps.start_time < :yearEnd
  GROUP BY ps.book_md5
),
read_in_year AS (
  SELECT
    b.md5
  FROM book b
  INNER JOIN max_page_by_end_of_year m ON m.book_md5 = b.md5
  -- Books "read in Y" require >=95% of pages by end-of-Y AND at least one page_stat
  -- row inside Y (otherwise a book finished BEFORE year Y would falsely count for Y).
  WHERE b.soft_deleted = 0
    AND m.max_page_reached >= CAST(0.95 * COALESCE(b.reference_pages, b.pages) AS INTEGER)
    AND COALESCE(b.reference_pages, b.pages) > 0
    AND EXISTS (
      SELECT 1 FROM page_stat ps2
      WHERE ps2.book_md5 = b.md5
        AND ps2.start_time >= :yearStart
        AND ps2.start_time < :yearEnd
    )
)
SELECT md5 FROM read_in_year;
```

This produces the canonical "books read in Y" set. All four breakdowns (genre,
nationality, decade, language) and the `total_books` headline card join against this
CTE. The page_stat aggregates (`total_pages`, `total_read_time`) use a separate
straight aggregate over `page_stat WHERE start_time IN [yearStart, yearEnd)` and
ignore the CTE — REPORT-02 is explicit that page-time totals include all reading.

**Knex translation:**

Use `db.with('read_in_year', db.raw(...))` to define the CTE, then `db('book').join(...)`
chains for each breakdown query. Or write each report query as a single `db.raw()` for
clarity — `stats-repository.ts` already uses raw SQL where helpful.

[ASSUMED] **Performance:** A single user's library is bounded (typical: low thousands
of books, low hundreds of thousands of `page_stat` rows). With the proposed
`page_stat(start_time)` index plus the existing `book.md5` unique constraint, the CTE
plan is two index scans + a hash join on a few thousand rows. Sub-100ms cold per
yearly query is a confident expectation. Confirm with `EXPLAIN QUERY PLAN` on real seed
data during plan execution.

### Pattern 4: Top-10 + Other server-side (D-03)

```typescript
// apps/server/src/reports/reports-service.ts (excerpt)
function truncateTopN<T extends { count: number }>(
  rows: T[],
  n: number,
  unknownKey: keyof T,
  unknownValue: T[keyof T]
): T[] {
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  // The Unknown bucket is preserved as a real entry regardless of its rank.
  const unknown = sorted.find((r) => r[unknownKey] === unknownValue);
  const known = sorted.filter((r) => r[unknownKey] !== unknownValue);
  const top = known.slice(0, n);
  const tail = known.slice(n);
  const other = tail.length
    ? [{ key: 'Other', count: tail.reduce((s, r) => s + r.count, 0) } as unknown as T]
    : [];
  return [...top, ...other, ...(unknown ? [unknown] : [])];
}
```

The "Other" bucket is a real array entry (`{ key: 'Other', count: N }`), the "Unknown"
bucket is a real array entry (`{ key: 'Unknown', count: N }`). Per CONTEXT D-03 +
REPORT-05, both must be present whenever applicable.

### Pattern 5: Decade buckets (D-05)

```typescript
function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}

function fillDecades(
  bookYears: Array<{ publication_year: number | null }>
): Array<{ key: string; count: number }> {
  const known = bookYears.filter((b): b is { publication_year: number } =>
    b.publication_year != null
  );
  const unknownCount = bookYears.length - known.length;

  if (known.length === 0) {
    return unknownCount > 0 ? [{ key: 'Unknown', count: unknownCount }] : [];
  }
  const minDecade = decadeOf(Math.min(...known.map((b) => b.publication_year)));
  const maxDecade = decadeOf(Math.max(...known.map((b) => b.publication_year)));

  const counts = new Map<number, number>();
  for (let d = minDecade; d <= maxDecade; d += 10) counts.set(d, 0);
  for (const { publication_year } of known) {
    const d = decadeOf(publication_year);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const decades = Array.from(counts.entries())
    .sort(([a], [b]) => a - b)
    .map(([d, c]) => ({ key: `${d}s`, count: c }));

  return unknownCount > 0
    ? [...decades, { key: 'Unknown', count: unknownCount }]
    : decades;
}
```

### Pattern 6: Web year navigator (D-02)

`nuqs` is already a project dep — use it for URL-as-state.

```typescript
// apps/web/src/pages/reports-page/year-navigator.tsx
import { ActionIcon, Select } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { useQueryState, parseAsInteger } from 'nuqs';

export function YearNavigator({ years }: { years: number[] }) {
  const [year, setYear] = useQueryState('year', parseAsInteger.withDefault(years[0] ?? new Date().getFullYear()));
  const idx = years.indexOf(year);
  const prevYear = idx >= 0 && idx < years.length - 1 ? years[idx + 1] : null;
  const nextYear = idx > 0 ? years[idx - 1] : null;

  return (
    <Group>
      <ActionIcon disabled={!prevYear} onClick={() => prevYear && setYear(prevYear)}>
        <IconChevronLeft />
      </ActionIcon>
      <Select
        data={years.map((y) => ({ value: String(y), label: String(y) }))}
        value={String(year)}
        onChange={(v) => v && setYear(Number(v))}
      />
      <ActionIcon disabled={!nextYear} onClick={() => nextYear && setYear(nextYear)}>
        <IconChevronRight />
      </ActionIcon>
    </Group>
  );
}
```

[CITED: nuqs docs] `parseAsInteger.withDefault(...)` is the documented pattern.
Also requires wrapping the app in `<NuqsAdapter>` in `index.tsx` (one-line change).

### Pattern 7: SWR hook (D-09)

```typescript
// apps/web/src/api/reports.ts
import useSWR from 'swr';
import { fetchFromAPI } from './api';

export type YearsResponse = { years: number[] };

export type YearlyReport = {
  year: number;
  totals: { books: number; pages: number; readTimeSeconds: number };
  genre: Array<{ key: string; count: number }>;
  nationality: Array<{ key: string; count: number }>; // includes "Other" + "Unknown"
  decade: Array<{ key: string; count: number }>;
  language: Array<{ key: string; count: number }>;
  coverage: {
    total_books: number;
    genre_known: number;
    nationality_known: number;
    publication_year_known: number;
    original_language_known: number;
  };
};

export function useYears() {
  return useSWR<YearsResponse>(
    'reports/years',
    () => fetchFromAPI<YearsResponse>('reports/years')
  );
}

export function useYearlyReport(year: number | null) {
  return useSWR<YearlyReport>(
    year ? ['reports/yearly', year] : null,
    () => fetchFromAPI<YearlyReport>('reports/yearly', 'GET', { year: year! })
  );
}
```

Default `dedupingInterval` per D-09; no `refreshInterval`. Year change re-keys.
[VERIFIED: matches existing `apps/web/src/api/enrichment.ts` pattern.]

### Pattern 8: Charts via `@mantine/charts` (D-UI-03)

`@mantine/charts` already provides `BarChart`, `AreaChart`, `PieChart`, `DonutChart`,
`LineChart`, `RadarChart`, all wrapping Recharts. The existing
`apps/web/src/pages/stats-page/stats-page.tsx` imports `BarChart`; `week-stats.tsx`
imports `AreaChart`. **No new package, no new style import** (`@mantine/charts/styles.css`
is already loaded in `apps/web/src/index.tsx`). [VERIFIED: grep for `recharts` and
`@mantine/charts` in `apps/web/src/`]

For the genre stacked bar:

```tsx
import { BarChart } from '@mantine/charts';
// data: Array<{ year: 2024, fiction: 12, nonfiction: 5, fantasy: 3, ... }>
<BarChart
  data={data}
  dataKey="year"
  series={genreList.map((g) => ({ name: g, color: 'koinsight.6' }))}
  type="stacked"
  withLegend
/>
```

For the decade histogram, use `BarChart` (Recharts has no separate Histogram primitive;
a "histogram" is a bar chart over numeric buckets, which is what we already have).

For the language pie, `PieChart` from `@mantine/charts`.

[CITED: https://mantine.dev/charts/bar-chart/ — `type="stacked"` and `series` API are
documented.]

### Pattern 9: Coverage banner (REPORT-UI-04)

```tsx
// coverage-banner.tsx
export function CoverageBanner({
  known, total, label,
}: { known: number; total: number; label: string }) {
  const pct = total > 0 ? Math.round((known / total) * 100) : 0;
  return (
    <Text size="xs" c="dimmed" mt="xs">
      {label} known for {known} of {total} books read this year ({pct}%)
    </Text>
  );
}
```

Render under each chart, fed from the `coverage` block of the API response. Per
CONTEXT D-06, the genre denominator is `books-with-any-genre`, not the bar-height sum.

### Pattern 10: Empty-state (REPORT-UI-05, D-08)

```tsx
import { Anchor, Stack, Text } from '@mantine/core';
import { Link } from 'react-router';
import { RoutePath } from '../../routes';

export function EmptyYearState({ year }: { year: number }) {
  return (
    <Stack align="center" gap="md" my="xl">
      <Text c="dimmed">No reading data for {year}.</Text>
      <Text c="dimmed" ta="center">
        Most likely: enrichment hasn't matched these books yet. Check the{' '}
        <Anchor component={Link} to={RoutePath.SETTINGS_UNMATCHED}>
          unmatched books inbox
        </Anchor>{' '}
        and edit metadata to populate this report.
      </Text>
    </Stack>
  );
}
```

`RoutePath.SETTINGS_UNMATCHED` is already exported from `apps/web/src/routes.ts`.
[VERIFIED]

### Anti-Patterns to Avoid

- **Storing year boundaries as date strings in SQL.** SQLite has no IANA TZ awareness;
  date-string comparison wastes the `start_time` index. Always bind ints.
- **Computing breakdowns in JS by fetching all `page_stat` rows.** O(N) wire transfer
  defeats the entire "on demand SQL" requirement. Repository methods MUST do GROUP BY
  in SQL.
- **Renormalizing the `Unknown` bucket out of percentages.** Per REPORT-05, the Unknown
  bucket is FIRST CLASS. The coverage banner exists precisely to make missing data
  visible — never silently exclude it from the chart.
- **Caching the report response with `Cache-Control` or ETag.** Per D-10, no HTTP
  caching. Year-rollover edge cases get weird if responses are cached.
- **Joining `page_stat` to `book` on `book.id`.** That FK was dropped in
  `20250412161907_use_book_md5_as_foreign_key.ts`. Use `book.md5 = page_stat.book_md5`.
- **Treating multi-genre books as 1/N per genre.** Per CONTEXT D-06 each book
  contributes 1 to each of its genres; the bar heights legitimately exceed
  `books-with-any-genre`.
- **Counting all co-authors in nationality.** D-07 is explicit: `position = 0` only.
  Add a `WHERE book_author.position = 0` filter to that one query.
- **Mounting `/api/reports` after the SPA catch-all.** Mount before the
  `app.get(/.*/, ...)` line in `app.ts` (the existing pattern places API routes before
  the static + catch-all). [VERIFIED: `app.ts` line layout]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| URL query-string state | A `useEffect` + `URLSearchParams` dance | `nuqs` `useQueryState` (already a dep) | Handles serialization, types, and back/forward navigation correctly. |
| TZ-aware year math | A custom DST table | `Intl.DateTimeFormat` (Node built-in) | The runtime ICU data is always current; never roll a TZ table by hand. |
| Bar / pie / area charts | Custom D3 or canvas | `@mantine/charts` (already installed) | Already used in stats-page; theme-aware; props-driven. |
| Stacked bar chart | Manual SVG | `<BarChart type="stacked" />` | One prop. |
| Year selector | Combobox from scratch | Mantine `Select` | Project standard component. |
| SQL pagination over `page_stat` | A scrolling cursor | Just GROUP BY in one query | Library size is bounded; one index scan beats N round-trips. |
| Common `coverage` block math | Inline in each route handler | One `reports-service` helper | Kept in service so router stays a thin Zod boundary. |
| ISO 3166-1 alpha-2 -> country name display | Hand maintained list | Plain code -> name mapping is fine for the chart label, OR delegate display to user (use code in chart, name in tooltip) | Existing data already stores ISO codes (`author.nationality`). [VERIFIED] |

**Key insight:** Phase 6 is mostly a SQL + integration phase, not a "new technology"
phase. Every primitive needed is already installed and used elsewhere in the codebase.
The discipline is keeping the slice layout aligned with `apps/server/src/stats/`,
`apps/server/src/enrichment/`, and `apps/web/src/pages/settings-page/`.

## Common Pitfalls

### Pitfall 1: `start_time` unit confusion (seconds vs milliseconds)

**What goes wrong:** Code multiplies `start_time` by 1000 and compares to a JS-side
`Date.now()`-style millisecond boundary, or vice versa.
**Why it happens:** `StatsRepository.getAll()` literally maps `stat.start_time =
stat.start_time * 1000` before returning to the API consumers, so a developer reading
that file may assume the column itself is ms.
**How to avoid:** In `reports-repository.ts`, do NOT replicate the `* 1000` mapping.
Bind year boundaries in SECONDS. Add a comment at the top of every query method:
`// page_stat.start_time is Unix epoch SECONDS (KOReader native unit).`
**Warning sign:** Comparing against numbers that look like 13-digit millis
(`>= 1704067200000`) instead of 10-digit secs (`>= 1704067200`).

### Pitfall 2: NULL in CHECK-constrained source columns

**What goes wrong:** A query joins `book.original_language_source = 'openlibrary'`
expecting NULL = unknown, gets unexpected behavior because NULL never equals anything.
**Why it happens:** SCHEMA-04 stores NULL when "never touched" (D-14 from Phase 1
research).
**How to avoid:** Use `IS NULL` / `IS NOT NULL` predicates explicitly. Treat NULL
`original_language` as the `Unknown` bucket; do NOT filter it out.

### Pitfall 3: Books with `pages = 0` AND `reference_pages` IS NULL

**What goes wrong:** The 95% predicate divides by zero (or compares against zero) and
the book unconditionally counts as "read" (or never).
**Why it happens:** Some KOReader uploads have `pages = 0` until the user opens the
book.
**How to avoid:** `AND COALESCE(b.reference_pages, b.pages) > 0` in the CTE WHERE.
Books without a known total never satisfy the >=95% predicate (acceptable; surfaces in
coverage as "no enriched books for this year").

### Pitfall 4: Soft-deleted books leaking into the report

**What goes wrong:** A user hides a book; it still appears in this year's totals.
**Why it happens:** Phase 1's `book.soft_deleted` flag exists (`apps/server/src/db/migrations/20250119073031_add_soft_deleted_to_book.ts`).
**How to avoid:** `WHERE b.soft_deleted = 0` in every report query that joins `book`.
[VERIFIED: `stats-repository.ts:13` already does this for stats; mirror it in reports.]

### Pitfall 5: Year boundary off-by-one for non-UTC zones

**What goes wrong:** Pacific Time New Year's Eve reading (8pm Dec 31 PT = 4am Jan 1
UTC) gets bucketed into the wrong year.
**Why it happens:** A naive implementation uses UTC year boundaries.
**How to avoid:** The `tz.ts` helper above. Add a unit test for at least one positive-
offset zone (e.g., `Asia/Tokyo`), one negative-offset zone (`America/Los_Angeles`), and
one DST-transitioning zone (`America/New_York` Mar/Nov DST boundary).

### Pitfall 6: Recharts `data` array prop with mixed-shape rows

**What goes wrong:** A stacked bar chart silently drops bars when the dataset has
heterogeneous keys per row.
**Why it happens:** Recharts requires every row to have every series key (use 0 for
absent).
**How to avoid:** When shaping the genre stacked-bar payload, zero-fill missing keys
across all bars.

### Pitfall 7: Mantine `Indicator` and Settings nav alignment

**What goes wrong:** The new `Reports` nav entry breaks the `Indicator` wrapper that
Phase 5 added around the Settings nav entry (placement-sensitive).
**Why it happens:** Inserting a new tab in `apps/web/src/components/navbar/navbar.tsx`
changes array indexing.
**How to avoid:** Append `Reports` after `Stats` and BEFORE `Syncs` (or wherever the
visual ordering goes); leave the `IconSettings` `Indicator` wrapper structurally
untouched. Verify by `npm --workspace=web run dev` and eyeballing badge alignment.

### Pitfall 8: Top-10 boundary tie

**What goes wrong:** When the 10th and 11th nationalities have the same count, the
arbitrary tiebreak between them causes flicker between page loads.
**Why it happens:** SQL `ORDER BY count DESC` is unstable on ties.
**How to avoid:** `ORDER BY count DESC, nationality ASC` for a deterministic tiebreak.

### Pitfall 9: Bootstrapping a `genre` query when no genres exist yet

**What goes wrong:** A library that booted before Phase 4 enrichment has zero
`book_genre` rows. The genre breakdown returns `[]`. The chart renders but is empty,
the coverage banner reads `0 of 0`.
**Why it happens:** Phase 4 + 5 enrichment hasn't run yet.
**How to avoid:** This is the explicit empty-state contract (REPORT-UI-05); the page
component checks `coverage.total_books === 0` (or `genre_known === 0`) and renders the
`/settings/unmatched` placeholder. NOT a bug; it is the designed UX.

## Runtime State Inventory

> Phase 6 is a greenfield additive feature (no rename, no refactor of existing
> behavior). The Runtime State Inventory categories below are documented for
> completeness; nothing in any category requires migration.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 6 reads existing `page_stat`, `book`, `book_author`, `author`, `book_genre`, `genre` tables. No new persisted state. | None |
| Live service config | None — no external services. | None |
| OS-registered state | None. | None |
| Secrets / env vars | One NEW env var: `REPORT_TZ` (IANA name, default `UTC`). Document in `apps/server/src/config.ts`, add to `turbo.json` `globalEnv`, mention in `CLAUDE.md` env section. | Add new env var to config + Turbo allowlist |
| Build artifacts | None — additive code only. | None |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node ICU TZ data | `Intl.DateTimeFormat` for IANA zones | YES | Node 22+ ships full-icu by default | None needed |
| `@mantine/charts` | All charts | YES | 8.3.12 in `apps/web/package.json` | None needed |
| `recharts` | Underlying chart primitives | YES | 2.15.0 (transitive + direct) | None needed |
| `nuqs` | URL year state | YES | 2.8.6 in `apps/web/package.json` | `useState` + manual `URLSearchParams` (worse, but viable) |
| `date-fns` | Year math | YES | 4.1.0 | None needed |
| `zod` | Query validation | YES | 4.3.5 | None needed |
| `swr` | Client cache | YES | 2.3.8 | None needed |
| `@tabler/icons-react` | Nav icon | YES | 3.36.1 | None needed |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.16 (server), no separate web test framework configured |
| Config file | `apps/server/vitest.config.ts` (existing); web has none yet |
| Quick run command | `npm --workspace=server exec vitest run apps/server/src/reports/__tests__/<file>.test.ts` |
| Full suite command | `npm --workspace=server test` (includes `build:migrations` first) |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REPORT-01 | `/api/reports/yearly?year=YYYY` returns documented JSON shape | integration (supertest) | `npm --workspace=server exec vitest run apps/server/src/reports/__tests__/reports-router.test.ts` | Wave 0 |
| REPORT-02 | >=95% pages by end-of-Y predicate; page-time totals include all reading | unit (repo) + integration | `npm --workspace=server exec vitest run apps/server/src/reports/__tests__/reports-repository.test.ts` | Wave 0 |
| REPORT-02 | TZ year boundary correctness across DST | unit (pure helper) | `npm --workspace=server exec vitest run apps/server/src/reports/__tests__/tz.test.ts` | Wave 0 |
| REPORT-03 | `/api/reports/years` returns sorted-desc list | integration | `npm --workspace=server exec vitest run apps/server/src/reports/__tests__/reports-router.test.ts` | Wave 0 |
| REPORT-04 | New `page_stat(start_time)` index migration is structure-only and idempotent | integration (migrate up + down + up) | `npm --workspace=server exec vitest run apps/server/src/db/__tests__/phase-06-schema.test.ts` | Wave 0 |
| REPORT-05 | Every breakdown includes Unknown bucket; never silently dropped | unit (service) | `npm --workspace=server exec vitest run apps/server/src/reports/__tests__/reports-service.test.ts` | Wave 0 |
| REPORT-UI-02 | Year persists in URL; selector re-keys SWR | manual smoke (no web test rig) | manual | n/a |
| REPORT-UI-04 | Coverage banner reads from response | manual + integration coverage | covered by `reports-router.test.ts` | n/a |
| REPORT-UI-05 | Empty year shows placeholder with link | manual smoke | manual | n/a |

### Sampling Rate

- **Per task commit:** `npm --workspace=server exec vitest run apps/server/src/reports/`
  (sub-1s on the cold path; runs against in-memory SQLite per existing test patterns).
- **Per wave merge:** `npm --workspace=server test` — the project's full vitest suite.
- **Phase gate:** Full server test suite green; manual web smoke covering year change,
  empty-state, coverage banner; check `EXPLAIN QUERY PLAN` on the yearly aggregation
  shows index usage on `page_stat(start_time)`.

### Critical Sampling Points (Nyquist)

These six points are where the phase's correctness must be sampled:

1. **TZ year boundary edge:** A `page_stat` row with `start_time` exactly at
   `yearStart - 1` second (zone-local Dec 31 23:59:59) MUST NOT count for year Y.
   A row at `yearStart` MUST count. Test in `tz.test.ts` + repo integration test.
2. **>=95% threshold edge:** A book with `reference_pages = 100`, max page reached
   = 94 -> NOT counted. = 95 -> counted. Test in `reports-repository.test.ts`.
3. **Page-time totals include incomplete reading:** A book at 50% completion in Y
   does NOT increment `total_books` but DOES contribute its `duration` sum to
   `total_read_time`. Test in `reports-repository.test.ts`.
4. **Unknown bucket presence on every breakdown:** Even when `count = 0` for the
   non-Unknown buckets, every breakdown returns the Unknown bucket if any book lacks
   that field. Test in `reports-service.test.ts`.
5. **Top-10 + Other math:** Sum of top-10 + Other.count (excluding Unknown) equals
   total books with known nationality. Test in `reports-service.test.ts`.
6. **Empty-state contract:** A year with `total_books = 0` returns a coverage block
   with all denominators = 0; the web component renders the placeholder. Manual smoke
   plus an integration test asserting the JSON shape stays valid for empty years.

### Wave 0 Gaps

- [ ] `apps/server/src/reports/__tests__/tz.test.ts` — TZ boundary unit tests
- [ ] `apps/server/src/reports/__tests__/reports-service.test.ts` — pure service tests
      (top-10+Other, decade fill, Unknown buckets, coverage math)
- [ ] `apps/server/src/reports/__tests__/reports-repository.test.ts` — Knex
      integration tests against in-memory SQLite seeded fixtures
- [ ] `apps/server/src/reports/__tests__/reports-router.test.ts` — supertest
      end-to-end (zod validation, 200 / 400 paths, JSON shape)
- [ ] `apps/server/src/db/__tests__/phase-06-schema.test.ts` — migration up/down/up
      idempotency for the new `page_stat(start_time)` index, plus SCHEMA-07-style
      grep guard that the migration file does not import network or do row iteration
- [ ] Test fixture helper for seeding a yearly-report scenario (a book with N
      `page_stat` rows spanning a year boundary, an enriched author, etc.) — likely
      under `apps/server/src/db/__tests__/fixtures/` to mirror existing fixture
      patterns

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | KoInsight is single-user / open dashboard; auth is out of scope per existing app posture (kosync stays unauthenticated to match KOReader API) |
| V3 Session Management | no | Same as V2 |
| V4 Access Control | no | All routes are open by design; no per-user data |
| V5 Input Validation | yes | `?year=YYYY` parsed via Zod `z.coerce.number().int().min(1900).max(2200)` at the route boundary |
| V6 Cryptography | no | No new secrets or crypto |
| V7 Error Handling | yes | Catch-and-log with generic 500; never leak stack traces |
| V8 Data Protection | no | Reading aggregates are not sensitive in single-user posture |

### Known Threat Patterns for {Express + SQLite + React}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via `?year` | Tampering | Zod coerce-int + parameterized Knex queries (no string concat) |
| ReDoS via TZ name | DoS | `Intl.DateTimeFormat` validates the IANA name; reject + fall back to UTC at boot only |
| XSS in chart labels (genre / nationality / language code) | Tampering / Repudiation | React escapes by default; never use `dangerouslySetInnerHTML` (CONTEXT already notes this) |
| Resource exhaustion via crafted year | DoS | Year coerced to int + range-checked `[1900, 2200]`; queries bounded by indexes |
| Information leak in error responses | Information disclosure | Generic `{ error: 'Failed to load yearly report' }` strings; full error to `console.error` only (existing project pattern) |

## Code Examples

### Mounting the router (one line in `app.ts`)

```typescript
// apps/server/src/app.ts (additive; place near the other api routes)
import { reportsRouter } from './reports/reports-router';
// ...
app.use('/api/reports', reportsRouter);
```

### Adding the page route (in `apps/web/src/app.tsx`)

```tsx
// after the SETTINGS route block
<Route path="/reports">
  <Route index element={<Navigate to="yearly" replace />} />
  <Route path="yearly" element={<ReportsYearlyPage />} />
</Route>
```

Add to `routes.ts`:
```typescript
REPORTS = '/reports',
REPORTS_YEARLY = '/reports/yearly',
```

### Adding a Reports nav tab (in `apps/web/src/components/navbar/navbar.tsx`)

```typescript
const tabs = [
  { link: RoutePath.BOOKS, label: 'Books', icon: IconBooks },
  { link: RoutePath.CALENDAR, label: 'Calendar', icon: IconCalendar },
  { link: RoutePath.STATS, label: 'Reading stats', icon: IconChartBar },
  { link: RoutePath.REPORTS_YEARLY, label: 'Reports', icon: IconReport },  // NEW
  { link: RoutePath.SYNCS, label: 'Progress syncs', icon: IconReload },
  { link: RoutePath.SETTINGS, label: 'Settings', icon: IconSettings },
  { onClick: openDownload, label: 'KOReader Plugin', icon: IconDownload },
];
```

The `Indicator` wrapper around the Settings tab stays in place; only the array
order changes. [Source: existing `navbar.tsx`]

### Index migration (the only schema change)

```typescript
// apps/server/src/db/migrations/20260425XXXXXX_add_page_stat_start_time_index.ts
import type { Knex } from 'knex';

// Phase 6 (REPORT-04, CONTEXT D-10): index supports the on-demand yearly aggregation
// queries. Structure-only migration; no data, no network; preserves SCHEMA-07.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('page_stat', (table) => {
    table.index(['start_time'], 'idx_page_stat_start_time');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('page_stat', (table) => {
    table.dropIndex(['start_time'], 'idx_page_stat_start_time');
  });
}
```

(The `book_author(author_id, book_md5)` index already exists from Phase 1's
`20260423221400_create_author_and_book_author.ts:41` as
`book_author_author_id_book_md5_idx` — DO NOT recreate.)

### Shared types (in `packages/common/types/reports-api.ts`)

```typescript
export type YearlyReportBucket = { key: string; count: number };

export type YearlyReport = {
  year: number;
  totals: {
    books: number;            // >=95% predicate
    pages: number;            // sum of page_stat duration-keyed pages? confirm in plan
    readTimeSeconds: number;  // sum of page_stat.duration in Y
  };
  genre: YearlyReportBucket[];        // includes "Unknown"
  nationality: YearlyReportBucket[];  // includes "Other" + "Unknown" per D-03 + D-07
  decade: YearlyReportBucket[];       // includes "Unknown" per D-05; zero-filled gaps
  language: YearlyReportBucket[];     // includes "Unknown"
  coverage: {
    total_books: number;
    genre_known: number;
    nationality_known: number;
    publication_year_known: number;
    original_language_known: number;
  };
};

export type YearsResponse = { years: number[] };
```

Add to the barrel export in `packages/common/types/index.ts`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `moment-timezone` for TZ math | `Intl.DateTimeFormat` with `timeZoneName: 'longOffset'` | Node 18+ ICU full data in default builds | Zero new deps |
| Bare Recharts | `@mantine/charts` wrappers | Mantine 7+ | Theme-aware out of the box; matches project look-and-feel |
| Hand-rolled URL state | `nuqs` | 2024 React ecosystem standard | Already a dep |
| `react-router-dom` | `react-router` v7 | 2024 react-router v7 release | Already on v7 (web package.json line 41) |

**Deprecated/outdated:**
- `moment.js` (deprecated by maintainers): not in this project, do not introduce.
- Recharts `<Histogram>` element: never existed; "histogram" is just a `<BarChart>`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A single user's library aggregates fast enough on demand without caching (typical `page_stat` row count is in the low hundreds of thousands) | Pattern 3 | Plans may need to add an LRU cache later; not blocking. Defer per CONTEXT D-10 ("until profiling shows slowness"). |
| A2 | `BarChart type="stacked"` from `@mantine/charts` 8.3.12 supports the multi-series API exactly as `@mantine/charts` 8 docs describe | Pattern 8 | If the prop API differs at this version, fall back to importing `BarChart` from `recharts` directly (already a dep) and using `<Bar stackId>` per series. |
| A3 | `nuqs` `useQueryState` works inside the existing `react-router` v7 setup without a custom adapter beyond `<NuqsAdapter>` | Pattern 6 | If routing-aware adapter needed: nuqs ships `nuqs/adapters/react-router/v7` per docs; a one-import change. |
| A4 | The `>=95%` predicate using `MAX(page)` over all-time `page_stat` (not just-this-year) is correct: a book finished in Y-1 should NOT count for Y, but the EXISTS sub-clause filters to Y. | Pattern 3 | If this misreads "read in Y", a fixture test will catch it; fix is to clamp `MAX(page)` to `WHERE start_time < yearEnd` only (already shown above). |
| A5 | KOReader stores `page_stat.page` monotonically (later sessions report higher pages once the book is progressed). Project README does not state this explicitly. | Pattern 3 | If a user re-reads a book in Y after finishing in Y-3, MAX is preserved and the book counts in Y-3 only (book_md5 is per-FILE not per-RE-READ). Acceptable for v1; v2 could add re-reads. |
| A6 | `process.env.REPORT_TZ` is acceptable to read at module load (doesn't change at runtime). Existing project pattern in `config.ts` reads env on first import, no hot reload. | Pattern 2 | Standard for this codebase. |
| A7 | Adding `REPORT_TZ` to `turbo.json` `globalEnv` is required for Turbo cache invalidation; CLAUDE.md documents this pattern. | Runtime State Inventory | If skipped, a TZ change won't bust Turbo's build cache; minor inconvenience. |
| A8 | The Phase 1 + 2 + 3 schema delivers `book.publication_year`, `book.original_language`, `book_author.position`, `author.nationality` — all required by Phase 6 SQL. | All SQL patterns | VERIFIED via migrations on disk: `20260423221400` + `20260423221600` + `20260424090000`. NOT an assumption. |

**A1 + A2 + A3** are the only items the planner / discuss-phase may want to confirm
with the user before locking. A4-A8 are project-internal claims; A8 is fully verified.

## Open Questions

1. **Decade-bucket Unknown placement**
   - What we know: D-05 says NULL `publication_year` -> Unknown; zero-fills are real
     entries between min/max known decades.
   - What's unclear: should `Unknown` sit at the end of the decade array (after
     `2020s`) or at the start? CONTEXT.md doesn't specify.
   - Recommendation: at the end. Matches reading order ("decades, then unknown").

2. **Decade label format**
   - What we know: D-05 fixes the bucket boundaries but not the displayed label.
   - What's unclear: `1990s` vs `1990-1999` vs `1990`.
   - Recommendation: `1990s` for charts (compact, idiomatic). Document in plan.

3. **`total_pages` headline-card semantics**
   - What we know: REPORT-02 says "page-time aggregates always include all reading"
     and the headline card list is "books / pages / time".
   - What's unclear: does "total pages read this year" mean `SUM(page_stat row count)`,
     or `SUM(distinct pages reached) per book`, or `MAX(page) - MIN(page)` per book?
   - Recommendation: page-turn count (`COUNT(*)` of `page_stat` rows in Y) is the
     simplest and matches what `StatsService.totalPagesRead` does today, but verify
     in plan-time discussion. Most yearly-report UX precedent uses unique-pages.

4. **"Original language" visualization choice**
   - What we know: REPORT-UI-03 says "pie or bar".
   - Recommendation: pie for languages (typically <10 distinct values, the long tail
     is meaningful as an "Other" slice). Bar for nationality (10+ values, ranking
     matters).

## Sources

### Primary (HIGH confidence)
- `apps/server/src/db/migrations/20250118202607_create_page_stat_table.ts` — page_stat schema
- `apps/server/src/db/migrations/20250412161907_use_book_md5_as_foreign_key.ts` — md5 FK migration
- `apps/server/src/db/migrations/20260423221400_create_author_and_book_author.ts` — author + index
- `apps/server/src/db/migrations/20260423221600_extend_book_columns.ts` — publication_year etc.
- `apps/server/src/db/migrations/20260425000000_book_enrichment_status_index.ts` — index pattern precedent
- `apps/server/src/stats/stats-router.ts` + `stats-repository.ts` — slice pattern reference
- `apps/server/src/enrichment/router.ts` + `unmatched-repository.ts` — slice + Zod-at-boundary pattern
- `apps/server/src/app.ts` — router mounting order
- `apps/web/src/api/enrichment.ts` + `apps/web/src/pages/settings-page/settings-layout.tsx` — SWR + sub-route pattern
- `apps/web/src/pages/stats-page/stats-page.tsx` — `@mantine/charts` BarChart usage
- `apps/web/src/components/navbar/navbar.tsx` — nav tabs ordering + Indicator preserved
- `.planning/phases/06-yearly-report/06-CONTEXT.md` — locked decisions
- `.planning/REQUIREMENTS.md` — REPORT-01..05 + REPORT-UI-01..05
- `.planning/ROADMAP.md` — phase goal + parallelization
- `.planning/STATE.md` — confirms Phases 1-3 schema is on disk

### Secondary (MEDIUM confidence)
- MDN: `Intl.DateTimeFormat` `timeZoneName` option [CITED] — `'longOffset'` value documented; supported in all modern engines.
- Mantine docs: `@mantine/charts` `BarChart` `type="stacked"` API [CITED] — https://mantine.dev/charts/bar-chart/

### Tertiary (LOW confidence)
- Performance estimate for SQL aggregation against a real-sized library — [ASSUMED] based on SQLite's query planner with the proposed indexes. Validate with `EXPLAIN QUERY PLAN` during plan execution.

## Project Constraints (from CLAUDE.md)

- **Formatting:** Prettier-only, no ESLint. Run `npx prettier --write .` before committing.
- **Validation:** Zod is the server-side validation library; use it at route boundaries.
- **Functional style:** Ramda is used in both apps; idiomatic.
- **Shared types:** `@koinsight/common` is the home for any type used by both server
  and web. Add `reports-api.ts` and re-export from the barrel.
- **No em dashes, ASCII only** (user global instruction). Use commas, periods, or
  semicolons.
- **`git push` without `-u` flag** (user global instruction).
- **Node:** >=22; npm 10.2.4 (root package.json `engines` / `packageManager`).
- **Configuration env vars:** Document new vars in `apps/server/src/config.ts` and add
  to `turbo.json` `globalEnv` (Turbo cache invalidation).
- **Single-port production:** Express serves the built React app via the static +
  catch-all setup in `app.ts`. The new `/api/reports/*` routes go BEFORE the static +
  catch-all, in the same block as existing `/api/*` mounts.
- **Migrations are structure-only** (SCHEMA-07 invariant in tests): Phase 6's index
  migration must not import network or iterate `book` rows.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep is already installed and in use.
- Architecture: HIGH — three existing slices (stats, enrichment, settings) provide the
  exact pattern to mirror.
- Schema correctness: HIGH — all required columns/indexes verified against migration
  files on disk; the only NEW migration is the `page_stat(start_time)` index.
- TZ strategy: MEDIUM-HIGH — recommended approach uses runtime built-ins; needs the
  `tz.test.ts` unit tests to lock DST behavior.
- 95%-predicate SQL: MEDIUM — pattern is sound but needs fixture tests at thresholds
  (94/95/96 pages) to lock semantics.
- Pitfalls: HIGH — derived from reading existing code, not theory.

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (stable; will only invalidate if `@mantine/charts`,
`nuqs`, or `react-router` major-bump before plan execution).

## RESEARCH COMPLETE

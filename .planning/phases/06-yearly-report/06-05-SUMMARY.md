---
phase: 06
plan: 05
subsystem: reports
tags: [phase-6, router, zod, supertest, tdd]
requires:
  - "06-01: @koinsight/common YearlyReport / YearsResponse types"
  - "06-04: ReportsService.getYears / ReportsService.getYearly"
provides:
  - "GET /api/reports/years -> { years: number[] } sorted desc"
  - "GET /api/reports/yearly?year=YYYY -> YearlyReport JSON"
  - "Zod validation at the route boundary (year coerced int, 1900..2200)"
  - "Generic 500 body + console.error on service errors"
affects:
  - apps/server/src/reports/reports-router.ts
  - apps/server/src/reports/__tests__/reports-router.test.ts
  - apps/server/src/app.ts
tech_stack:
  added: []
  patterns:
    - "TDD RED -> GREEN: failing import then minimal router impl"
    - "Express Router + Zod safeParse -> 400; try/catch -> 500 (mirrors enrichment/router.ts)"
    - "supertest end-to-end: fresh Express app per describe, real DB via shared knex setup"
    - "vi.spyOn ReportsService static methods to exercise 500 paths without DB faulting"
key_files:
  created:
    - apps/server/src/reports/reports-router.ts
    - apps/server/src/reports/__tests__/reports-router.test.ts
  modified:
    - apps/server/src/app.ts
decisions:
  - "Mount /api/reports immediately after /api/enrichment, BEFORE express.static and the SPA catch-all (per critical_constraint)."
  - "Generic 500 bodies are differentiated per-route ('Failed to load years' vs 'Failed to load yearly report') so client-side error UX can be route-specific without leaking internals."
  - "Plugin (call_api.lua) NOT modified: Phase 6 endpoints are frontend-only, the Lua plugin does not consume them."
  - "Tests mount the router on /reports (no /api prefix) to keep test paths short; the production /api prefix is enforced via app.ts mount path inspection (visual)."
metrics:
  duration: "~6 min"
  completed: 2026-04-24
  tasks: 2
  files_created: 2
  files_modified: 1
  tests_added: 12
  commits: 2
---

# Phase 6 Plan 05: Reports Router Summary

Exposed the Phase 6 service over HTTP. Two thin handlers in `apps/server/src/reports/reports-router.ts` validate `?year` with Zod, delegate to `ReportsService`, and ship JSON. Mounted at `/api/reports` in `app.ts` strictly before the SPA catch-all so the `/api/reports/*` paths cannot be shadowed by the static fallback. Full wire contract locked by 12 supertest cases.

## What was built

### `apps/server/src/reports/reports-router.ts`

- `GET /years`: try/catch around `ReportsService.getYears()`; 200 with `{ years }`, 500 with `{ error: 'Failed to load years' }`.
- `GET /yearly`: `safeParse({ year: z.coerce.number().int().min(1900).max(2200) })` on `req.query`. On parse failure: 400 with the Zod flattened payload `{ error: { fieldErrors: { year: [...] }, formErrors: [...] } }`. On success: try/catch around `ReportsService.getYearly(year)`; 200 with `YearlyReport`, 500 with `{ error: 'Failed to load yearly report' }`.
- Every catch logs the underlying error via `console.error(error)` (T-06-05-02 mitigation: full error stays server-side).

### `apps/server/src/app.ts`

- Added `import { reportsRouter } from './reports/reports-router';` next to existing slice imports.
- Added `app.use('/api/reports', reportsRouter);` immediately after `/api/enrichment`, BEFORE `app.use(express.static(...))` and the `app.get(/.*/, ...)` SPA catch-all. The mount sits at the same depth as the other `/api/*` routers.

### `apps/server/src/reports/__tests__/reports-router.test.ts`

12 supertest cases across 2 describe blocks (fresh Express app per describe via `makeApp()`):

`GET /reports/years` (2):

- 200 with sorted-desc years across 2024 + 2023 seed.
- 500 + generic body when the service throws (spy on `ReportsService.getYears`).

`GET /reports/yearly` (10):

- 200 + full `YearlyReport` shape (totals, genre, nationality, decade, language, coverage).
- D-06 invariant: `coverage.total_books >= coverage.genre_known` (denominator is books-with-any-genre, not bar-height sum).
- Decade keys monotonically increasing with optional trailing `Unknown`.
- Top-N + Unknown sanity: 12 distinct nationalities + 1 NULL nationality book yields both `Other` and `Unknown` in the response.
- Empty-year contract (Nyquist 6): no seed -> 200 with zeroed totals + empty buckets + zero coverage.
- 400 + Zod flattened payload when `?year` is missing.
- 400 when `?year=abc` (non-numeric).
- 400 when `?year=1899` (below lower bound).
- 400 when `?year=2201` (above upper bound).
- 500 + generic body when the service throws (spy on `ReportsService.getYearly`).

## Verification

- `cd apps/server && npx vitest run src/reports/__tests__/reports-router.test.ts` -> 12/12 green in ~100ms.
- Full server suite: 487 passed, 1 skipped, 1 unrelated flaky failure in `koplugin/koplugin-router.test.ts` (`socket hang up` on the 400-version test). Re-running that file in isolation: 11/11 green. Pre-existing intermittency, not caused by this plan; logged below as out-of-scope.

## Commits

- `c4bef91` test(06-05): add reports-router supertest suite (RED)
- `c1b0266` feat(06-05): add reports router and mount on /api/reports (GREEN)

## Deviations from Plan

None. All plan must_haves hold:

- GET /years 200 + sorted desc years.
- GET /yearly 200 + documented JSON shape.
- GET /yearly missing/non-numeric/out-of-range -> 400.
- Service errors -> 500 generic body + console.error.
- Mounted in app.ts before express.static and SPA catch-all.

The plan also flagged: "Plugin (call_api.lua) NOT modified" — confirmed, no Lua changes.

## Out-of-scope items observed (not fixed in this plan)

- `koplugin/koplugin-router.test.ts > GET /koplugin/health > returns 400 when plugin version is incorrect` intermittently fails with "socket hang up" when run as part of the full suite. Passes when the file runs in isolation. Same flake the 06-04 SUMMARY also noted under a different shape; unrelated to the reports slice. Logged for a future stabilization plan.
- Migrations `dist/` can be stale if a prior agent ran tests without `prebuild`. The top-level `npm test` script handles this via `prebuild`; running `npx vitest` directly does not. We ran `npm run build:migrations` once before the GREEN run.

## TDD Gate Compliance

- RED commit `c4bef91` (`test(06-05): ...`): test file written first; vitest run produced "Cannot find module '../reports-router'" as expected.
- GREEN commit `c1b0266` (`feat(06-05): ...`): minimal router + one app.ts mount line; 12/12 tests pass.
- REFACTOR: not needed; the GREEN implementation is already minimal and mirrors the established `enrichment/router.ts` pattern.

## Coverage / Acceptance

| Must-have truth | Status |
|---|---|
| GET /api/reports/years returns 200 with `{ years: number[] }` sorted desc | PASS |
| GET /api/reports/yearly?year=2024 returns 200 with documented YearlyReport JSON | PASS |
| GET /api/reports/yearly without ?year returns 400 with Zod flattened payload | PASS |
| GET /api/reports/yearly?year=abc returns 400 | PASS |
| GET /api/reports/yearly?year=1899 returns 400 | PASS |
| Repository / service errors -> 500 generic body + console.error | PASS |
| /api/reports/* mounted in app.ts BEFORE express.static and SPA catch-all | PASS (verified by reading app.ts; mount line precedes lines 44-47) |

## Threat Flags

None. The threat model (T-06-05-01 SQL injection via `?year`, T-06-05-02 information disclosure on error) is fully mitigated as designed:

- T-06-05-01: Zod `z.coerce.number().int().min(1900).max(2200)` validates and bounds the input before any SQL.
- T-06-05-02: Generic 500 body; full error to `console.error` only.
- T-06-05-03 (DoS via crafted year): Accepted; bounded range + indexed integer scan.
- T-06-05-04 (CORS): Inherited from existing app; not changed.

No new surface introduced beyond the planned two routes.

## Known Stubs

None. The router is a complete consumable artifact. The web client (forthcoming) will consume `/api/reports/years` and `/api/reports/yearly?year=...` directly via `fetchFromAPI` + SWR per CONTEXT D-09.

## Self-Check: PASSED

- FOUND: apps/server/src/reports/reports-router.ts
- FOUND: apps/server/src/reports/__tests__/reports-router.test.ts
- FOUND (modified): apps/server/src/app.ts
- FOUND commit: c4bef91 (RED)
- FOUND commit: c1b0266 (GREEN)

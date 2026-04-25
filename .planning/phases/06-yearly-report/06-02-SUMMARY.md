---
phase: 06
plan: 02
subsystem: reports
tags: [phase-6, tz, config, pure-helper]
requires: []
provides:
  - "yearBoundsInZone(year, timeZone): { startSec, endSec } pure helper for DST-aware year boundaries"
  - "appConfig.reports.timeZone driven by process.env.REPORT_TZ (default UTC)"
  - "REPORT_TZ added to turbo.json globalEnv allowlist"
affects:
  - apps/server/src/config.ts
  - turbo.json
tech_stack:
  added: []
  patterns:
    - "Intl.DateTimeFormat with timeZoneName: 'longOffset' for IANA zone offset extraction (Node 22+ full ICU)"
    - "Two-pass DST-aware correction loop in localMidnightToEpochSec"
    - "Boot-time env validation with graceful fallback (RangeError -> console.error -> UTC)"
key_files:
  created:
    - apps/server/src/reports/tz.ts
    - apps/server/src/reports/__tests__/tz.test.ts
  modified:
    - apps/server/src/config.ts
    - turbo.json
decisions:
  - "tz helper returns epoch SECONDS (not ms) to match page_stat.start_time storage (Pitfall 1)"
  - "tz helper imports neither db nor config; caller supplies the timezone string -> reusable, fully unit-testable"
  - "Invalid REPORT_TZ values do not crash the boot; they log and fall back to UTC"
metrics:
  duration: "~3 min"
  completed: 2026-04-25
  tasks: 2
  files_created: 2
  files_modified: 2
  tests_added: 8
  commits: 3
---

# Phase 6 Plan 02: Timezone Helper + REPORT_TZ Config Summary

Pure DST-aware `yearBoundsInZone(year, IANA zone)` helper for REPORT-02 boundaries, plus `REPORT_TZ` env wiring into `appConfig` and Turbo's `globalEnv` allowlist. Zero new dependencies; uses Node 22's built-in `Intl.DateTimeFormat` with `timeZoneName: 'longOffset'`.

## What was built

- `apps/server/src/reports/tz.ts` exporting `yearBoundsInZone(year, timeZone): { startSec, endSec }`.
  - Internal `localMidnightToEpochSec` uses a two-pass loop (initial guess pretends local==UTC, then re-aligns using the zone's offset at that instant) so DST boundaries converge correctly.
  - Internal `getZoneOffsetMinutes` parses the `longOffset` string (`GMT+09:00`, `GMT-08:00`, or bare `GMT` for UTC) via `Intl.DateTimeFormat.formatToParts`.
  - Returns SECONDS (not milliseconds) to match `page_stat.start_time` storage. Documented in the file header (Pitfall 1).
  - No `db` import, no `config` import; callable from anywhere.

- `apps/server/src/reports/__tests__/tz.test.ts` — 8 Vitest cases:
  - Table-driven coverage for UTC, `Asia/Tokyo`, `America/Los_Angeles`, `America/New_York`.
  - Hard-coded literal assertions (`1704067200`, `1735689600`) for UTC 2024.
  - DST guard: asserts NY end-of-2024 uses the January EST (UTC-5) offset, NOT the July EDT (UTC-4) offset.
  - `RangeError` on invalid IANA zone (`Not/A_Zone`).
  - Half-open `[startSec, endSec)` boundary semantics encoded as a small assertion table (start-1 = previous, start = this, end-1 = this, end = next).
  - Expected values are computed independently via `Date.parse` of UTC ISO instants, never by re-calling the helper.

- `apps/server/src/config.ts`:
  - Reads `process.env.REPORT_TZ ?? 'UTC'` at module load.
  - Validates it once via `new Intl.DateTimeFormat('en-US', { timeZone })`. On `RangeError`, logs to `console.error` and falls back to `'UTC'`. Boot does not crash.
  - Exposes `appConfig.reports.timeZone` next to existing config keys.

- `turbo.json`: appended `"REPORT_TZ"` to the `globalEnv` array so Turbo invalidates caches when the value changes.

## Verification

- `npm --workspace=server exec vitest run src/reports/__tests__/tz.test.ts` — 8/8 passed.
- `npx tsc --noEmit -p apps/server/tsconfig.json` — passed (no type errors).
- Full server suite re-run: `44 test files, 426 passed, 1 skipped` — no regressions.

## Commits

- `f7ab7b8` test(06-02): add failing tz.yearBoundsInZone boundary tests (RED)
- `d6662e6` feat(06-02): implement tz.yearBoundsInZone helper (GREEN)
- `2685226` feat(06-02): wire REPORT_TZ env var into appConfig and Turbo globalEnv

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stale better-sqlite3 native binary in repo root node_modules**
- **Found during:** Task 06-02-01 GREEN verification
- **Issue:** Repo `node_modules/better-sqlite3/build/Release/better_sqlite3.node` was compiled against `NODE_MODULE_VERSION 127`; current Node v25.6.1 needs version 141. Vitest's `test-setup.ts` imports `knex` -> `better-sqlite3` and crashed on load before any test could run.
- **Fix:** Ran `npm install` then `npm rebuild better-sqlite3` in the repo root, then `npm --workspace=server run build:migrations` (compiled `dist/migrations` consumed by the test setup file).
- **Files modified:** none (environmental fix; binary rebuilt in `node_modules/`).
- **Commit:** none (no source changes).

**2. [Rule 2 - Missing critical] Vitest workspace path resolution**
- **Found during:** Task 06-02-01 RED verification
- **Issue:** `npm --workspace=server exec vitest run apps/server/src/reports/__tests__/tz.test.ts` (path from repo root) produced "No test files found" because vitest resolves args relative to the workspace cwd.
- **Fix:** Used the workspace-relative path `src/reports/__tests__/tz.test.ts` for verification commands. No code change.

No other deviations. Plan executed exactly as written; both RED and GREEN gates produced the expected commits.

## Authentication Gates

None. No external services touched.

## TDD Gate Compliance

Task 06-02-01 was executed as TDD with explicit RED/GREEN gates:

- RED commit `f7ab7b8` (`test(06-02): ...`): tests written first, run produced "Cannot find module '../tz'" (failing as expected; no implementation yet).
- GREEN commit `d6662e6` (`feat(06-02): ...`): minimal implementation following RESEARCH.md Pattern 2 verbatim; all 8 tests pass.
- REFACTOR: not needed; the GREEN implementation is already minimal and the inline comments cover intent.

## Known Stubs

None. Both deliverables are fully wired and verifiable end-to-end.

## Threat Flags

None. Plan-declared threats T-06-02-01 (DoS via crafted IANA name) and T-06-02-02 (info disclosure via env var) accepted as-is per the threat model; no new surface introduced.

## Self-Check: PASSED

- `apps/server/src/reports/tz.ts` exists.
- `apps/server/src/reports/__tests__/tz.test.ts` exists.
- `apps/server/src/config.ts` modified (contains `REPORT_TZ` and `reports: { timeZone: REPORT_TZ }`).
- `turbo.json` modified (contains `"REPORT_TZ"` in `globalEnv`).
- Commits `f7ab7b8`, `d6662e6`, `2685226` present in `git log`.

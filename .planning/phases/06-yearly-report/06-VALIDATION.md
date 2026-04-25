---
phase: 06
slug: yearly-report
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-24
---

# Phase 06 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (server). Web has no test rig today; web behaviors verified via manual smoke. |
| **Config file** | `apps/server/vitest.config.ts` |
| **Quick run command** | `npm --workspace=server exec vitest run apps/server/src/reports/` |
| **Full suite command** | `npm --workspace=server test` (runs `build:migrations` first) |
| **Estimated runtime** | ~3-5s quick, ~20-30s full |

---

## Sampling Rate

- **After every task commit:** Run `npm --workspace=server exec vitest run apps/server/src/reports/`
- **After every plan wave:** Run `npm --workspace=server test`
- **Before `/gsd-verify-work`:** Full suite must be green; manual web smoke covering year change, empty-state, coverage banner.
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

> Filled in during planning. Each task in PLAN.md must reference one of the test files below or declare a manual-only justification.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-XX-XX | TBD | TBD | REPORT-01 | — | Zod-validated `?year=YYYY` returns documented JSON shape | integration | `npm --workspace=server exec vitest run apps/server/src/reports/__tests__/reports-router.test.ts` | ❌ W0 | ⬜ pending |
| 06-XX-XX | TBD | TBD | REPORT-02 | — | >=95% pages-by-end-of-Y predicate gates `total_books`; page-time totals include all reading | unit + integration | `npm --workspace=server exec vitest run apps/server/src/reports/__tests__/reports-repository.test.ts` | ❌ W0 | ⬜ pending |
| 06-XX-XX | TBD | TBD | REPORT-02 | — | Year boundaries respect `REPORT_TZ` (DST-aware) | unit | `npm --workspace=server exec vitest run apps/server/src/reports/__tests__/tz.test.ts` | ❌ W0 | ⬜ pending |
| 06-XX-XX | TBD | TBD | REPORT-03 | — | `/api/reports/years` sorted descending | integration | `npm --workspace=server exec vitest run apps/server/src/reports/__tests__/reports-router.test.ts` | ❌ W0 | ⬜ pending |
| 06-XX-XX | TBD | TBD | REPORT-04 | — | New `page_stat(start_time)` index migration is structure-only and idempotent | integration | `npm --workspace=server exec vitest run apps/server/src/db/__tests__/phase-06-schema.test.ts` | ❌ W0 | ⬜ pending |
| 06-XX-XX | TBD | TBD | REPORT-05 | — | Every breakdown includes Unknown bucket; never silently dropped; top-10 + Other math correct | unit | `npm --workspace=server exec vitest run apps/server/src/reports/__tests__/reports-service.test.ts` | ❌ W0 | ⬜ pending |
| 06-XX-XX | TBD | TBD | REPORT-UI-01 | — | Year `Select` populated from years endpoint | manual | manual smoke | n/a | ⬜ pending |
| 06-XX-XX | TBD | TBD | REPORT-UI-02 | — | Selected year persists in URL query string across reloads | manual | manual smoke | n/a | ⬜ pending |
| 06-XX-XX | TBD | TBD | REPORT-UI-03 | — | Charts re-render on year change | manual | manual smoke | n/a | ⬜ pending |
| 06-XX-XX | TBD | TBD | REPORT-UI-04 | — | Coverage banner reads from response | manual + integration | covered by `reports-router.test.ts` | ❌ W0 | ⬜ pending |
| 06-XX-XX | TBD | TBD | REPORT-UI-05 | — | Empty year shows placeholder with link to `/settings/unmatched` | manual | manual smoke | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Critical Sampling Points (Nyquist)

1. **TZ year boundary edge.** A `page_stat` row at `yearStart - 1s` (zone-local Dec 31 23:59:59) MUST NOT count for year Y; a row at `yearStart` MUST count.
2. **>=95% threshold edge.** Book with `reference_pages = 100`, max page = 94 -> excluded; max page = 95 -> included.
3. **Page-time totals include incomplete reading.** Book at 50% completion contributes to `total_read_time` and `total_pages` but NOT to `total_books`.
4. **Unknown bucket presence.** Even when no books lack a field, the Unknown bucket appears with `count: 0` if the breakdown otherwise has rows; never silently dropped.
5. **Top-10 + Other math.** Sum of top-10 entries plus `Other.count` (excluding Unknown) equals total books with known nationality.
6. **Empty-state contract.** A year with `total_books = 0` returns coverage with denominators = 0; the web component renders the placeholder linking to `/settings/unmatched`.

---

## Wave 0 Requirements

- [ ] `apps/server/src/reports/__tests__/tz.test.ts` — TZ boundary unit tests (Nyquist #1)
- [ ] `apps/server/src/reports/__tests__/reports-service.test.ts` — pure service tests (Nyquist #4, #5)
- [ ] `apps/server/src/reports/__tests__/reports-repository.test.ts` — Knex integration tests against in-memory SQLite seeded fixtures (Nyquist #2, #3)
- [ ] `apps/server/src/reports/__tests__/reports-router.test.ts` — supertest end-to-end (Zod validation, JSON shape, REPORT-01/03/UI-04)
- [ ] `apps/server/src/db/__tests__/phase-06-schema.test.ts` — migration up/down/up idempotency for the new `page_stat(start_time)` index, plus SCHEMA-07 grep guard
- [ ] Yearly-report fixture helper under `apps/server/src/db/__tests__/fixtures/` (a book with `page_stat` rows spanning year boundary, an enriched author, etc.)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Year `Select` populated and arrow buttons step neighbors; arrows disabled at ends | REPORT-UI-01 | No web test rig configured | Visit `/reports/yearly`. Confirm Select shows years from `/api/reports/years`. Click left arrow at oldest year — disabled. Click right arrow at newest — disabled. |
| Selected year persists in URL across reloads | REPORT-UI-02 | No web test rig | Pick year via Select; URL becomes `/reports/yearly?year=YYYY`. Reload — same year is selected. |
| Charts re-render on year change without flash | REPORT-UI-03 | No web test rig | Switch year via arrow; SWR re-keys, charts update. |
| Empty-state placeholder links to `/settings/unmatched` | REPORT-UI-05 | No web test rig; route assertion only meaningful in DOM | Pick a year with no enriched data; placeholder text visible; link routes to `/settings/unmatched`. |
| Recharts bundle size sanity | non-functional | Bundle inspection is offline | After `npm --workspace=web run build`, confirm vendor chunk delta is bounded (<150KB gzip vs prior). |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

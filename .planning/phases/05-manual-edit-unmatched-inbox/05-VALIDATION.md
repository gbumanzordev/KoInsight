---
phase: 5
slug: manual-edit-unmatched-inbox
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-24
---

# Phase 5 Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (server + packages/common); web has no test infra (build/typecheck only) |
| **Server config file** | apps/server/vitest.config.ts |
| **Quick run command** | `npm --workspace=server exec vitest run <changed-file>` |
| **Full server suite** | `npm --workspace=server test` |
| **Common package suite** | `npm --workspace=@koinsight/common test` |
| **Web verification** | `npm --workspace=web run build` (TypeScript + Vite build) |
| **Estimated runtime** | ~60 seconds per quick run; ~120 seconds full server suite |

---

## Sampling Rate

- **After every task commit:** Run quick vitest on changed test files.
- **After every plan wave:** Run full server test suite.
- **Before `/gsd-verify-work`:** Full suite green AND manual UAT per RESEARCH.md Validation Architecture.
- **Max feedback latency:** 60 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------|-------------------|-------------|--------|
| 01-T1 | 05-01 | 1 | EDIT-01, EDIT-02 (schema) | T-05-01..05 | unit + build | `npm --workspace=@koinsight/common test -- books-edit-api.test.ts && npm --workspace=server run build:migrations && ls packages/common/dist/types/books-edit-api.js && ls apps/server/dist-migrations/db/migrations/20260425000000_book_enrichment_status_index.js` | yes (extends) | ready |
| 01-T2 | 05-01 | 1 | EDIT-01, EDIT-02 | T-05-06..10 | integration (supertest + sqlite) | `npm --workspace=server exec vitest run apps/server/src/books/books-router.test.ts apps/server/src/books/__tests__/manual-edit-stickiness.test.ts apps/server/src/enrichment/__tests__/` | yes (new test files in plan) | ready |
| 02-T1 | 05-02 | 2 | EDIT-03 | T-05-11..15 | integration (supertest + idempotency) | `npm --workspace=server exec vitest run apps/server/src/books/books-router.test.ts apps/server/src/enrichment/__tests__/re-enrich-idempotency.test.ts` | yes (new test files) | ready |
| 03-T1 | 05-03 | 2 | EDIT-04, EDIT-05 | (inherits server STRIDE) | integration (supertest) | `npm --workspace=server exec vitest run apps/server/src/enrichment/__tests__/unmatched-router.test.ts apps/server/src/enrichment/__tests__/status-router.test.ts` | yes (new test files) | ready |
| 04-T1 | 05-04 | 3 | UI-01, UI-02, UI-03, UI-05 (deps + helpers) | T-05-16..19 | typecheck (web) | `npm --workspace=web exec tsc --noEmit -p apps/web` | yes (extends) | ready |
| 04-T2 | 05-04 | 3 | UI-01, UI-02, UI-03, UI-05 (modal + form) | T-05-16..19 | build (web) | `npm --workspace=web run build` | yes (extends) | ready |
| 04-T3 | 05-04 | 3 | UI-01, UI-02, UI-03, UI-05 (end-to-end) | T-05-16..19 | manual | — | n/a (checkpoint:human-verify) | manual |
| 05-T1 | 05-05 | 4 | UI-04 (hooks + nav + routes) | T-05-20..23 | build (web) | `npm --workspace=web run build` | yes | ready |
| 05-T2 | 05-05 | 4 | UI-04 (settings shell + cards + list) | T-05-20..23 | build (web) | `npm --workspace=web run build` | yes | ready |
| 05-T3 | 05-05 | 4 | UI-04 (end-to-end) | T-05-20..23 | manual | — | n/a (checkpoint:human-verify) | manual |

Wave 0 row is empty: phase has no Wave 0 task because all required test infrastructure (vitest on server, vitest on @koinsight/common, knex migration build pipeline) is already in place from Phases 1-4. New test files are created inline within the relevant Wave 1 / Wave 2 tasks.

---

## Wave 0 Requirements

Wave 0 is empty for Phase 5. All test infrastructure dependencies are pre-existing:

- Server vitest config: `apps/server/vitest.config.ts` (Phase 1+).
- Migration build pipeline: `apps/server/tsconfig.migrations.json` (Phase 1+).
- @koinsight/common vitest: present from Phase 2 (genres tests).
- Test fixtures: existing seed factories in `apps/server/src/db/` cover unmatched / enriched / pending rows by setting `enrichment_status`.
- `idx_book_enrichment_status`: addressed inline by Plan 01 Task 1 (migration `20260425000000_book_enrichment_status_index.ts`); not a Wave 0 dependency.
- Shared Zod schema (EDIT-01): created by Plan 01 Task 1 in `packages/common/types/books-edit-api.ts`; Plan 04 imports it.

`wave_0_complete: true` because there are no preconditions to satisfy.

---

## Manual-Only Verifications

| Behavior | Requirement | Source Task | Why Manual | Test Instructions |
|----------|-------------|-------------|------------|-------------------|
| Edit modal opens, provenance badges render, save flows through PATCH and updates the page; Cancel discards silently | UI-01, UI-02, UI-03 | Plan 04 Task 3 (`Checkpoint 3: Human verify the edit flow end-to-end on book detail`) | Visual + interaction; web workspace has no RTL infra | Follow Plan 04 Task 3 `<how-to-verify>` steps 1-8 |
| Re-enrich button toast cycle (kickoff -> terminal); polling cadence 2s; Tooltip "Already running" while pending/running | UI-05, D-12, D-13 | Plan 04 Task 3 step 9 | Visual + timing | Click Re-enrich, observe DevTools network tab + toast sequence |
| No per-row SWR polling; one GET per book at 2s while open, 0 when terminal | D-12, Pitfall 4 | Plan 04 Task 3 step 10 | DevTools observation | Open Network tab, filter for `/books/:id`, verify cadence |
| Settings nav Indicator badge shows failed count; hides at zero (Pitfall 7) | UI-04, D-09, D-17 | Plan 05 Task 3 steps 2, 9 | Visual | Seed failed books, watch badge appear; resolve all, watch it disappear |
| Settings layout shell: index redirect, side-nav active state, four stat cards typography | UI-04, D-07, D-08, D-16 | Plan 05 Task 3 steps 3, 4, 5 | Visual | Navigate to /settings, verify URL redirect + violet-light active state + 28px stat numerals |
| Unmatched list pagination + 5s polling + row drop-off after re-enrich | UI-04, D-14 | Plan 05 Task 3 steps 6, 8, 11 | Visual + timing | Seed 25+ failed books, paginate, re-enrich a row, watch list update on next poll |
| Cross-surface SWR dedupe: Navbar + Settings share one GET /api/enrichment/status every 5s | A6 (RESEARCH) | Plan 05 Task 3 step 10 | DevTools observation | Open Network tab, confirm only one status request per 5s interval despite two consumers |

---

## Validation Sign-Off

- [x] All tasks have automated verify or are explicit human-verify checkpoints
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (the only manual tasks are explicit checkpoints in Plans 04 and 05; both are gated and preceded by tasks with automated verifiers)
- [x] Wave 0 empty by design: no missing infrastructure
- [x] No watch-mode flags in any automated command
- [x] Feedback latency under 60s for quick runs
- [x] `nyquist_compliant: true` set in frontmatter
- [x] `wave_0_complete: true` set in frontmatter

**Approval:** ready for execution

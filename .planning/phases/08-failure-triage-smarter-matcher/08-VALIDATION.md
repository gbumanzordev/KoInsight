---
phase: 8
slug: failure-triage-smarter-matcher
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-27
audited: 2026-04-27
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (server), vitest + jsdom (web) |
| **Config file** | apps/server/vitest.config.ts; apps/web/vitest.config.ts |
| **Quick run command** | `npm --workspace=server exec vitest run <changed-file>` |
| **Full suite command** | `npm test` (root, runs server + web via Turbo) |
| **Estimated runtime** | ~30 seconds (server unit suite) |

---

## Sampling Rate

- **After every task commit:** Run vitest on the changed test file (`npm --workspace=server exec vitest run path/to.test.ts`).
- **After every plan wave:** Run `npm --workspace=server test` (and `npm --workspace=web test` once UI tasks are touched).
- **Before `/gsd-verify-work`:** Full root `npm test` must be green.
- **Max feedback latency:** ~30 seconds.

---

## Per-Requirement Coverage

| REQ-ID | Status | Evidence (file : test count) | Automated Command |
|--------|--------|------------------------------|-------------------|
| POLISH-01 | COVERED | apps/server/src/enrichment/__tests__/phase-08-enqueue-many.test.ts (6 tests) | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-08-enqueue-many.test.ts` |
| RETRY-01 | COVERED | apps/server/src/enrichment/__tests__/phase-08-retry-all-route.test.ts (4 tests); apps/web/src/pages/settings-page/retry-all-button.test.tsx (6 tests) | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-08-retry-all-route.test.ts` ; `npm --workspace=web exec vitest run src/pages/settings-page/retry-all-button.test.tsx` |
| RETRY-02 | COVERED | apps/web/src/components/re-enrich-button/re-enrich-button.test.tsx (3 tests); apps/web/src/pages/settings-page/retry-all-button.test.tsx (6 tests, shares D-14 invalidation contract) | `npm --workspace=web exec vitest run src/components/re-enrich-button/re-enrich-button.test.tsx` |
| RETRY-03 | COVERED | apps/server/src/enrichment/__tests__/phase-08-matcher-fuzzy.test.ts (14 tests); apps/server/src/enrichment/__tests__/phase-08-matcher-ambiguous.test.ts (5 tests); apps/server/src/enrichment/__tests__/phase-08-stuck-books.test.ts (9 tests over fixtures/stuck-books.json) | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-08-matcher-fuzzy.test.ts src/enrichment/__tests__/phase-08-matcher-ambiguous.test.ts src/enrichment/__tests__/phase-08-stuck-books.test.ts` |
| RETRY-04 | COVERED | apps/server/src/enrichment/__tests__/phase-08-classify-failure.test.ts (14 tests); apps/web/src/components/failure-reason-badge/failure-reason-badge.test.tsx (6 tests) | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-08-classify-failure.test.ts` ; `npm --workspace=web exec vitest run src/components/failure-reason-badge/failure-reason-badge.test.tsx` |

*All five Phase 8 requirements (POLISH-01, RETRY-01, RETRY-02, RETRY-03, RETRY-04) are COVERED. No PARTIAL or MISSING entries.*

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 8-01-01 | 01 | 0 | RETRY-04 | T-08-06 | classifyFailure mapping locked vs D-03 | unit | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-08-classify-failure.test.ts` | ✅ | ✅ green |
| 8-01-02 | 01 | 0 | RETRY-03 | — | NFKD/subtitle/Last-First swap; Dice ≥ 0.85 | unit | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-08-matcher-fuzzy.test.ts` | ✅ | ✅ green |
| 8-01-03 | 01 | 0 | RETRY-03 | — | AmbiguousMatchError on 2+ top-3 ties (D-05) | unit | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-08-matcher-ambiguous.test.ts` | ✅ | ✅ green |
| 8-01-04 | 01 | 0 | RETRY-03 | — | 8 case-class regression fixtures (D-09) | unit | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-08-stuck-books.test.ts` | ✅ | ✅ green |
| 8-01-05 | 01 | 0 | POLISH-01 | T-08-04, T-08-05 | enqueueMany batches; ON CONFLICT DO NOTHING; force flag (D-15) | unit | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-08-enqueue-many.test.ts` | ✅ | ✅ green |
| 8-01-06 | 01 | 0 | RETRY-01 | T-08-03 | POST /api/enrichment/retry-all with Zod .strict() body (CD-2) | integration | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-08-retry-all-route.test.ts` | ✅ | ✅ green |
| 8-01-07 | 01 | 0 | RETRY-04 | T-08-02 | Closed-lookup badge; XSS-safe rendering | unit | `npm --workspace=web exec vitest run src/components/failure-reason-badge/failure-reason-badge.test.tsx` | ✅ | ✅ green |
| 8-01-08 | 01 | 0 | RETRY-01, RETRY-02 | T-08-08 | SWR predicate-mutate invalidation; locked toast copy (D-13/D-14) | unit | `npm --workspace=web exec vitest run src/pages/settings-page/retry-all-button.test.tsx` | ✅ | ✅ green |
| 8-01-09 | 01 | 0 | RETRY-02 | — | Per-row re-enrich invalidates list + status caches (D-14) | unit | `npm --workspace=web exec vitest run src/components/re-enrich-button/re-enrich-button.test.tsx` | ✅ | ✅ green |
| 8-02-01 | 02 | 1 | RETRY-04 | T-08-07 | book.failure_reason migration with CHECK enum | integration | covered by phase-04-applier.test.ts regression (16/16) | ✅ | ✅ green |
| 8-02-02 | 02 | 1 | RETRY-04 | T-08-06 | classifyFailure returns { class, reason } | unit | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-08-classify-failure.test.ts` | ✅ | ✅ green |
| 8-02-03 | 02 | 1 | RETRY-03 | — | matcher fuzzy + ambiguous paths | unit | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-08-matcher-fuzzy.test.ts src/enrichment/__tests__/phase-08-matcher-ambiguous.test.ts` | ✅ | ✅ green |
| 8-02-04 | 02 | 1 | POLISH-01 | T-08-04 | enqueueMany helper landing | unit | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-08-enqueue-many.test.ts` | ✅ | ✅ green |
| 8-03-01 | 03 | 2 | RETRY-04 | T-08-07 | markTerminalFailure persists failure_reason | integration | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-04-applier.test.ts` | ✅ | ✅ green |
| 8-03-02 | 03 | 2 | RETRY-01 | T-08-03 | POST /retry-all wired to enqueueMany | integration | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-08-retry-all-route.test.ts` | ✅ | ✅ green |
| 8-04-01 | 04 | 3 | RETRY-04 | T-08-02 | FailureReasonBadge component | unit | `npm --workspace=web exec vitest run src/components/failure-reason-badge/failure-reason-badge.test.tsx` | ✅ | ✅ green |
| 8-04-02 | 04 | 3 | RETRY-01 | T-08-08 | RetryAllButton component (no modal per D-10) | unit | `npm --workspace=web exec vitest run src/pages/settings-page/retry-all-button.test.tsx` | ✅ | ✅ green |
| 8-04-03 | 04 | 3 | RETRY-02 | — | ReEnrichButton invalidation | unit | `npm --workspace=web exec vitest run src/components/re-enrich-button/re-enrich-button.test.tsx` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `apps/server/src/enrichment/__tests__/phase-08-classify-failure.test.ts` — RED→GREEN tests for FailureReason mapping (D-03 vocabulary, RETRY-04)
- [x] `apps/server/src/enrichment/__tests__/phase-08-matcher-fuzzy.test.ts` — RED→GREEN tests for NFKD/subtitle/Last-First swap and Dice >= 0.85 (RETRY-03)
- [x] `apps/server/src/enrichment/__tests__/phase-08-matcher-ambiguous.test.ts` — RED→GREEN tests for AmbiguousMatchError on 2+ top-3 ties (D-05)
- [x] `apps/server/src/enrichment/__tests__/phase-08-stuck-books.test.ts` + `fixtures/stuck-books.json` — Real-DB fixture suite for the 8 case-class regression set (D-09)
- [x] `apps/server/src/enrichment/__tests__/phase-08-enqueue-many.test.ts` — RED→GREEN tests for `enqueueMany` batching and ON CONFLICT DO NOTHING (POLISH-01)
- [x] `apps/server/src/enrichment/__tests__/phase-08-retry-all-route.test.ts` — RED→GREEN tests for `POST /api/enrichment/retry-all` (RETRY-01)
- [x] `apps/web/src/components/failure-reason-badge/failure-reason-badge.test.tsx` — RED→GREEN tests for badge rendering across the 5 reasons (RETRY-04 UI)
- [x] `apps/web/src/pages/settings-page/retry-all-button.test.tsx` — RED→GREEN tests for SWR `mutate` predicate-based invalidation (RETRY-01/02)
- [x] `apps/web/src/components/re-enrich-button/re-enrich-button.test.tsx` — RED→GREEN tests for D-14 list-key predicate invalidation (RETRY-02)

*All Wave 0 RED tests turned GREEN as Wave 1-3 implementation landed. Verified 2026-04-27: 52 server + 15 web = 67/67 assertions passing.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Mantine notification text "Re-enqueued N books" appears after Retry-all click | RETRY-01 | Mantine `notifications.show` is portal-rendered; jsdom assertion possible but flaky | 1. Seed dev DB with `npm run seed`. 2. Force-fail an enrichment via `/api/enrichment/enqueue` then break network. 3. Open Inbox, click Retry all. 4. Observe toast "Re-enqueued N books". |
| Failure-reason badge renders correct color/copy for each of the 5 vocabulary keys | RETRY-04 | Pixel/contrast confirmation against UI-SPEC palette is a visual-only check | Open Inbox after running fixture seed; compare each badge to UI-SPEC §"Badge palette" screenshot. |
| Smarter matcher actually rescues 8/8 currently-stuck books | RETRY-03 | Requires the live dev DB at the time of planning, which is the canonical regression set per D-09 | Run `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-08-stuck-books.test.ts` after fuzzy path lands; assert all 8 transition off `failed`. (Synthetic fixture covers the case-class matrix; live-DB confirmation remains manual per D-09.) |

---

## Validation Audit 2026-04-27

**Auditor:** gsd-validate-phase / Nyquist auditor
**Outcome:** PASS — phase certified Nyquist-compliant.

### Coverage metrics

| Metric | Value |
|--------|-------|
| Requirements in phase | 5 (POLISH-01, RETRY-01, RETRY-02, RETRY-03, RETRY-04) |
| COVERED | 5 / 5 (100%) |
| PARTIAL | 0 |
| MISSING | 0 |
| Wave 0 RED test files declared | 9 |
| Wave 0 test files present | 9 / 9 |
| Server assertions GREEN | 52 / 52 |
| Web assertions GREEN | 15 / 15 |
| Total automated assertions GREEN | 67 / 67 |
| Manual-only items preserved | 3 |

### Audit actions

1. Confirmed each of the 9 Wave 0 RED test files declared in 08-01-SUMMARY.md exists at the documented path (server `phase-08-*` prefix; web colocated `*.test.tsx`).
2. Re-ran the full server Phase 8 suite via `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-08-*.test.ts` and the full web Phase 8 suite via `npm --workspace=web exec vitest run` against the three UI test files. Both completed in ~3.5s combined; all 67 assertions GREEN.
3. Cross-checked each REQ-ID against the requirements arrays in the four PLAN frontmatters: every REQ in scope (POLISH-01, RETRY-01, RETRY-02, RETRY-03, RETRY-04) maps to at least one automated test file.
4. Updated the Per-Task Verification Map to reflect post-execution actual file paths (the Wave 0 plan documented hypothetical paths; execution renamed them to a `phase-08-` prefix). Filled rows for Wave 1-3 implementation tasks (8-02-*, 8-03-*, 8-04-*) using the regression suites already wired in the SUMMARY documents.
5. Preserved all three Manual-Only entries verbatim (Mantine portal toast, badge palette pixel check, live-DB smarter-matcher rescue confirmation).

### Frontmatter changes

- `status: draft` -> `status: complete`
- `nyquist_compliant: false` -> `nyquist_compliant: true`
- `wave_0_complete: false` -> `wave_0_complete: true`
- Added `audited: 2026-04-27`.

### No gaps filled

This was a verification audit. Per phase 8 ground rules, Wave 0 already shipped with full RED→GREEN coverage; no new tests were authored. No implementation files were modified.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (zero MISSING)
- [x] No watch-mode flags
- [x] Feedback latency < 60s (~3.5s combined)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-27

---
phase: 8
slug: failure-triage-smarter-matcher
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-27
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

## Per-Task Verification Map

> Filled in by gsd-planner during planning. Each PLAN.md task with `<automated>` populates a row here.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 8-01-01 | 01 | 0 | RETRY-04 | — | N/A | unit | `npm --workspace=server exec vitest run src/enrichment/__tests__/classify-failure.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/server/src/enrichment/__tests__/classify-failure.test.ts` — RED tests for FailureReason mapping (D-03 vocabulary)
- [ ] `apps/server/src/enrichment/__tests__/matcher-fuzzy.test.ts` — RED tests for NFKD/subtitle/Last-First swap and Dice >= 0.85 (RETRY-03)
- [ ] `apps/server/src/enrichment/__tests__/matcher-ambiguous.test.ts` — RED tests for AmbiguousMatchError on 2+ top-3 ties (D-05)
- [ ] `apps/server/src/enrichment/__tests__/stuck-books.fixtures.ts` — Real-DB fixture suite for the 8 currently-failed books (D-09)
- [ ] `apps/server/src/enrichment/__tests__/enqueue-many.test.ts` — RED tests for `enqueueMany` batching and ON CONFLICT DO NOTHING (POLISH-01)
- [ ] `apps/server/src/enrichment/__tests__/retry-all-route.test.ts` — RED tests for `POST /api/enrichment/retry-all` (RETRY-01)
- [ ] `apps/web/src/components/__tests__/failure-reason-badge.test.tsx` — RED tests for badge rendering across the 5 reasons (RETRY-04 UI)
- [ ] `apps/web/src/pages/settings-page/__tests__/retry-all-button.test.tsx` — RED tests for SWR `mutate` predicate-based invalidation (RETRY-01/02)

*Wave 0 RED tests must fail (or skip with TODO) before Wave 1 begins. They turn GREEN as Wave 1 implementation lands.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Mantine notification text "Re-enqueued N books" appears after Retry-all click | RETRY-01 | Mantine `notifications.show` is portal-rendered; jsdom assertion possible but flaky | 1. Seed dev DB with `npm run seed`. 2. Force-fail an enrichment via `/api/enrichment/enqueue` then break network. 3. Open Inbox -> click Retry all. 4. Observe toast "Re-enqueued N books". |
| Failure-reason badge renders correct color/copy for each of the 5 vocabulary keys | RETRY-04 | Pixel/contrast confirmation against UI-SPEC palette is a visual-only check | Open Inbox after running fixture seed; compare each badge to UI-SPEC §"Badge palette" screenshot. |
| Smarter matcher actually rescues 8/8 currently-stuck books | RETRY-03 | Requires the live dev DB at the time of planning, which is the canonical regression set per D-09 | Run `npm --workspace=server exec vitest run src/enrichment/__tests__/stuck-books.fixtures.test.ts` after fuzzy path lands; assert all 8 transition off `failed`. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

---
phase: 5
slug: manual-edit-unmatched-inbox
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-24
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (server) + existing project conventions |
| **Config file** | apps/server/vitest.config.ts |
| **Quick run command** | `npm --workspace=server exec vitest run <changed-file>` |
| **Full suite command** | `npm --workspace=server test` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick vitest on changed test files.
- **After every plan wave:** Run full server test suite.
- **Before `/gsd-verify-work`:** Full suite green AND manual UAT per RESEARCH.md Validation Architecture.
- **Max feedback latency:** 60 seconds.

---

## Per-Task Verification Map

To be populated by gsd-planner (one row per task in every PLAN.md) and cross-checked by gsd-plan-checker.

Each row captures: Task ID | Plan | Wave | Requirement (EDIT-0X / UI-0X) | Test Type | Automated Command | File Exists | Status.

---

## Wave 0 Requirements

- [ ] Shared Zod schema in packages/common for PATCH body (EDIT-01)
- [ ] Test fixtures for unmatched / enriched / pending book rows
- [ ] Any missing index on book.enrichment_status (verify in Phase 1 migrations; add if absent)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Edit modal opens from book detail; provenance badges render | UI-02, UI-03 | Visual | Open book page → click Edit → confirm Badges render next to each field label |
| Re-enrich toast shows then transitions to success/failure after polling | D-12 | Visual, timing | Trigger Re-enrich on a failed book; watch toast + polling |
| Settings nav Indicator badge shows failed count, hides at zero | UI-04, D-09 | Visual | Resolve last failed book; confirm badge disappears |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

---
phase: 08-failure-triage-smarter-matcher
fixed_at: 2026-04-27T17:26:00Z
review_path: .planning/phases/08-failure-triage-smarter-matcher/08-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 8: Code Review Fix Report

**Fixed at:** 2026-04-27T17:26:00Z
**Source review:** .planning/phases/08-failure-triage-smarter-matcher/08-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (Critical + Warning)
- Fixed: 2
- Skipped: 0

## Fixed Issues

### WR-01: enqueueMany overcounts `enqueued` when inputs reference missing or terminal-status books

**Files modified:** `apps/server/src/enrichment/service.ts`
**Commit:** 8eeab79
**Applied fix:** Replaced `enqueued = valid.length - skipped` with `enqueued = eligible.filter((m) => !openMd5s.has(m)).length`, so the count reflects md5s that were eligible (book exists, status pending/null or `force=true`) AND did not already have an open job, matching the rows actually inserted. Tightened the docstring to describe the new semantics, including that missing books and terminal-status md5s (without `force`) are excluded from both buckets.

### WR-02: enqueueMany emits one console.warn per input md5 on a single transactional failure

**Files modified:** `apps/server/src/enrichment/service.ts`
**Commit:** 51da5a1
**Applied fix:** Branched the catch block on `valid.length === 1`. Single-md5 path keeps the legacy `enrichment enqueue failed` payload shape so the Phase 4 DB-throw regression test continues to pass. Bulk path now emits a single summary `enrichment enqueueMany failed` line with `count` rather than N near-identical lines, eliminating log spam during retry-all DB outages.

## Verification

- Tier 1 (re-read): both edits verified in place.
- Tier 2 (vitest): ran `phase-08-enqueue-many.test.ts` (6/6), `phase-04-retry.test.ts` (26/26), and `phase-04-enqueue.test.ts` (13/13) after both fixes — 45/45 pass.

---

_Fixed: 2026-04-27_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

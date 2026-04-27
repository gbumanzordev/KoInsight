---
phase: 08-failure-triage-smarter-matcher
plan: 04
subsystem: ui
tags: [web, ui, mantine, swr, badge, retry, react]

requires:
  - phase: 08-failure-triage-smarter-matcher
    provides: failure_reason persisted on book; POST /api/enrichment/retry-all; failure_reason surfaced in /api/enrichment/unmatched
provides:
  - FailureReasonBadge component (closed lookup, T-08-02 mitigation)
  - RetryAllButton component (immediate-fire, no modal per D-10)
  - postRetryAll() + invalidateUnmatchedList() helpers in enrichment API client
  - UnmatchedBookRow.failure_reason on the web type
  - ReEnrichButton hardened: invalidates unmatched list cache after success
  - Inbox row now renders structured badge instead of legacy red error text
affects: [future-phases-touching-enrichment-ui, ui-spec-sync]

tech-stack:
  added: []
  patterns:
    - "Closed-lookup map for safe rendering of server-controlled enum values (defensive ?? fallback)"
    - "Predicate-style SWR mutate for invalidating tuple cache keys (Pitfall 4)"
    - "test-setup window.matchMedia stub so MantineProvider mounts in jsdom"

key-files:
  created:
    - apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx
    - apps/web/src/components/failure-reason-badge/failure-reason-badge.module.css
    - apps/web/src/pages/settings-page/retry-all-button.tsx
  modified:
    - apps/web/src/api/enrichment.ts
    - apps/web/src/components/re-enrich-button/re-enrich-button.tsx
    - apps/web/src/components/re-enrich-button/re-enrich-button.test.tsx
    - apps/web/src/pages/settings-page/unmatched-books-section.tsx
    - apps/web/test-setup.ts

key-decisions:
  - "D-10 (no confirmation modal) won over UI-SPEC modal section; UI-SPEC modal copy is now stale and should be retired in a future spec sync."
  - "Used the existing date-fns formatRelativeDate helper for the row's relative-time line; no new dependency."
  - "Switched re-enrich-button.test.tsx from vi.spyOn(swr, 'mutate') (fails on ESM namespace) to vi.mock('swr', ...) wrapping a vi.fn so the predicate-style mutate is observable."
  - "Stubbed window.matchMedia in test-setup.ts so MantineProvider mounts cleanly under jsdom."

patterns-established:
  - "FailureReasonBadge closed lookup: const cfg = MAP[reason ?? 'unknown'] ?? MAP.unknown — safe rendering pattern for any enum-from-server scenario."
  - "invalidateUnmatchedList() helper centralises the list-key + status-key cache invalidation; reused by both RetryAllButton and ReEnrichButton."

requirements-completed: [RETRY-01, RETRY-02, RETRY-04]

duration: ~25min
completed: 2026-04-27
---

# Phase 08 Plan 04: Web UI Summary

**FailureReasonBadge + RetryAllButton ship to the unmatched-books inbox; ReEnrichButton hardens its post-success cache invalidation so per-row retries update without a page reload.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-04-27
- **Tasks:** 3
- **Files created:** 3
- **Files modified:** 5

## Accomplishments

- `FailureReasonBadge` ships with all 5 vocabulary entries (4 server reasons + 'unknown' UI fallback) verbatim from UI-SPEC; closed lookup with defensive `?? MAP.unknown` mitigates T-08-02.
- `RetryAllButton` ships with immediate-fire behavior (no modal per D-10), Mantine variant=`default`, locked toast wording per D-13 + UI-SPEC Copywriting Contract, and `useEnrichmentStatus`-driven disabled state.
- `enrichment.ts` API client extended: `postRetryAll()`, `invalidateUnmatchedList()` (predicate-mutate per Pitfall 4), and `UnmatchedBookRow.failure_reason`.
- `ReEnrichButton` hardened: per D-14, after success it now also invokes `invalidateUnmatchedList()` so the inbox list + navbar badge refresh without a page reload.
- `UnmatchedBooksSection`: header gains a `Group justify="space-between"` with the retry button; rows show the structured badge + relative-time text; the legacy red `last_error` block is removed.
- All Phase 8 RED web tests are GREEN (3 test files, 15 assertions across `failure-reason-badge`, `retry-all-button`, `re-enrich-button`).

## Locked-Copy Sanity Check

Verbatim strings present in code (no paraphrasing of UI-SPEC):
- `'Retry all failed'` (button label)
- `'No failed books to retry'` (disabled tooltip + zero-enqueued toast — D-13)
- `` `Re-enqueued ${res.enqueued} books` `` (success toast — D-13)
- `'Could not start bulk retry'` (error toast title — UI-SPEC)
- `'Server error. Try again in a moment.'` (error toast body)
- All 5 badge labels: `'No match'`, `'Ambiguous'`, `'Network'`, `'Parse error'`, `'Unknown'`
- All 5 badge tooltips verbatim from the UI-SPEC Failure Reason Vocabulary table.

D-10 vs UI-SPEC: D-10 (no modal) wins. The UI-SPEC modal section is now stale; flag it for future spec sync. Verified by `grep -c "openConfirmModal\|modals\\." retry-all-button.tsx` returning 0.

Relative-time text: rendered using the existing `apps/web/src/utils/dates.ts#formatRelativeDate` helper (date-fns `formatDistanceToNow`). No new dependency.

## Task Commits

1. **Task 1: extend enrichment.ts + create FailureReasonBadge** - `ac5c9f4` (feat)
2. **Task 2: RetryAllButton + harden ReEnrichButton** - `eee3da6` (feat)
3. **Task 3: wire badge + button into UnmatchedBooksSection** - `de83903` (feat)

## Files Created/Modified

- `apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx` - pure presentational badge with closed lookup map (T-08-02 mitigation).
- `apps/web/src/components/failure-reason-badge/failure-reason-badge.module.css` - empty placeholder (matches provenance-badge convention).
- `apps/web/src/pages/settings-page/retry-all-button.tsx` - section CTA; immediate-fire, locked copy, SWR invalidation.
- `apps/web/src/api/enrichment.ts` - postRetryAll + invalidateUnmatchedList helpers; failure_reason on UnmatchedBookRow.
- `apps/web/src/components/re-enrich-button/re-enrich-button.tsx` - calls invalidateUnmatchedList() after the existing `books/<id>` mutate.
- `apps/web/src/components/re-enrich-button/re-enrich-button.test.tsx` - swapped vi.spyOn for vi.mock pattern (Rule 3 fix).
- `apps/web/src/pages/settings-page/unmatched-books-section.tsx` - header has retry button; rows show badge + relative-time; legacy red error text removed.
- `apps/web/test-setup.ts` - jsdom matchMedia stub (Rule 3 fix; required for MantineProvider).

## Decisions Made

- **D-10 wins over UI-SPEC modal section.** RetryAllButton fires immediately on click; no `modals.openConfirmModal` anywhere. UI-SPEC §"Confirmation Modal" should be retired during the next spec sync.
- **Reuse existing `formatRelativeDate`** for the row's "Retried 2h ago" line; avoided adding a new helper or dependency.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stubbed `window.matchMedia` for jsdom**
- **Found during:** Task 1 (running the Plan 01 RED test for FailureReasonBadge)
- **Issue:** MantineProvider's color-scheme effect calls `window.matchMedia` on mount; jsdom does not implement it, so all 6 badge tests crashed with `TypeError: window.matchMedia is not a function`.
- **Fix:** Added a no-op `matchMedia` stub at the top of `apps/web/test-setup.ts`, gated on `typeof window.matchMedia !== 'function'`.
- **Files modified:** apps/web/test-setup.ts
- **Verification:** All 15 web vitest tests across the 3 RED files pass.
- **Committed in:** `ac5c9f4` (Task 1 commit)

**2. [Rule 3 - Blocking] Rewrote re-enrich-button test to vi.mock pattern**
- **Found during:** Task 2 (running the Plan 01 RED test for ReEnrichButton list-key mutate)
- **Issue:** The Plan-01-scaffolded test uses `vi.spyOn(swr, 'mutate')`; vitest in ESM mode rejects this with `TypeError: Cannot spy on export "mutate". Module namespace is not configurable in ESM.`
- **Fix:** Replaced the spy with a top-level `vi.mock('swr', ...)` factory that swaps `mutate` for a `vi.fn`. The test still asserts the same three call patterns: `'books/<id>'`, predicate matching the tuple key, and `'enrichment/status'`.
- **Files modified:** apps/web/src/components/re-enrich-button/re-enrich-button.test.tsx
- **Verification:** All 3 ReEnrichButton tests pass; assertions identical to the original RED.
- **Committed in:** `eee3da6` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - Blocking, both test-infrastructure)
**Impact on plan:** Neither deviation altered shipped behavior; both unblocked the Plan 01 RED tests written under different assumptions about the test runtime.

## Wave 0 RED Test Status

All 9 Wave 0 RED tests across Plans 01/02/03/04 are GREEN:
- Server (Plans 02-03): 6 GREEN (per Plan 03 SUMMARY).
- Web (Plan 04): 3 test files / 15 assertions GREEN — `failure-reason-badge.test.tsx` (6), `retry-all-button.test.tsx` (6), `re-enrich-button.test.tsx` (3).

## Issues Encountered

None beyond the two test-infrastructure deviations above.

## Threat Flags

None — Plan 04 introduces no new network endpoint or trust boundary; T-08-02 was mitigated as planned (closed lookup) and T-08-08 (Tampering on retry-all body) was mitigated via the `{}`-only client + server `.strict()` (Plan 03).

## Next Phase Readiness

- Phase 8 is shippable end-to-end: server emits structured `failure_reason`, surfaces it in the inbox, supports POST /retry-all; web renders the structured badge, exposes the bulk-retry CTA, and refreshes both list + navbar caches after any retry.
- UI-SPEC modal section is stale (D-10 supersedes it). Call this out in any future Phase 8 documentation sync.
- No blockers carried forward; v1.1 milestone progress now sits at 10/10 plans complete pending the orchestrator's STATE/ROADMAP update.

## Self-Check

Created files exist:
- FOUND: apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx
- FOUND: apps/web/src/pages/settings-page/retry-all-button.tsx

Commits exist on branch: ac5c9f4, eee3da6, de83903 — all present in `git log`.

## Self-Check: PASSED

---
*Phase: 08-failure-triage-smarter-matcher*
*Completed: 2026-04-27*

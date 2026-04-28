---
status: complete
phase: 08-failure-triage-smarter-matcher
source:
  - 08-01-SUMMARY.md
  - 08-02-SUMMARY.md
  - 08-03-SUMMARY.md
  - 08-04-SUMMARY.md
started: 2026-04-27T17:25:00Z
updated: 2026-04-27T17:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: |
  Stop any running dev server. Run `npm run dev` from the repo root. The server boots without errors, the `add_failure_reason_to_book` migration applies, and visiting http://localhost:5173 (web) loads the dashboard while http://localhost:3000/api/books returns JSON.
result: pass

### 2. Failure-reason badge in inbox
expected: |
  Open Settings → Unmatched Books section. For each row that previously failed, a colored badge labeled with the failure reason (e.g. "no match", "ambiguous match", "network error", "parse error") appears next to the book. Hovering the badge shows a tooltip with a brief explanation. Books that are still queued or pending show no badge.
result: pass

### 3. Per-row Re-enrich button
expected: |
  Click "Re-enrich" on a single failed row. The button shows a loading state while the request is in flight. When the retry resolves, the row's status updates in place (no page reload). If the retry succeeds, the row leaves the failed list. If it fails again, the badge updates with the new failure reason.
result: pass

### 4. Retry-all-failed button
expected: |
  At the top of the Unmatched Books section, a "Retry all failed" button is visible. Clicking it shows a confirmation or loading indicator, then bulk-enqueues every failed book through the normal pipeline. After completion, the list refreshes (no full page reload) and reflects the new statuses.
result: pass

### 5. Smarter matcher succeeds on retry
expected: |
  Pick a previously-failed book whose title/author looks correct (e.g. punctuation differences, "Last, First" name format, or a subtitle variant). Re-enrich it. The matcher now succeeds — the book leaves the failed list and gains OL metadata. (At least one book in your stuck-books inventory should pass on retry under the new heuristics.)
result: pass

### 6. Failure reason persists across server restart
expected: |
  After a retry that fails, restart the dev server. Reload the inbox. The same `failure_reason` badge is still on the row, confirming the value was persisted to the `book.failure_reason` column rather than held in memory.
result: pass

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]

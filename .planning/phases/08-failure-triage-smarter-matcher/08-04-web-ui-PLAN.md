---
phase: 08-failure-triage-smarter-matcher
plan: 04
type: execute
wave: 3
depends_on: [01, 02, 03]
files_modified:
  - apps/web/src/api/enrichment.ts
  - apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx
  - apps/web/src/components/failure-reason-badge/failure-reason-badge.module.css
  - apps/web/src/pages/settings-page/retry-all-button.tsx
  - apps/web/src/pages/settings-page/unmatched-books-section.tsx
  - apps/web/src/components/re-enrich-button/re-enrich-button.tsx
autonomous: true
requirements: [RETRY-01, RETRY-02, RETRY-04]
tags: [web, ui, mantine, swr, badge, retry]

must_haves:
  truths:
    - "Each failed inbox row displays a FailureReasonBadge whose label, color, and tooltip match UI-SPEC verbatim"
    - "The unmatched section header shows a 'Retry all failed' button (Mantine variant='default') that fires immediately on click — NO confirmation modal (D-10)"
    - "On successful retry-all, a Mantine notification reads 'Re-enqueued N books' (or 'No failed books to retry' for empty set) per D-13"
    - "After retry-all OR per-row Re-enrich, the unmatched-books list cache is invalidated via SWR predicate-mutate so the row updates without a page reload (D-14, RETRY-02)"
    - "The legacy `last_error` red text block in the inbox row is REMOVED (UI-SPEC §'Layout Inside the Failed Row')"
    - "FailureReasonBadge renders 'Unknown' (gray, variant='outline') for null or unrecognized reason values (defensive, T-08-02)"
  artifacts:
    - path: apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx
      provides: "Pure presentational badge with closed lookup table (T-08-02 mitigation)"
      exports: ["FailureReasonBadge"]
    - path: apps/web/src/pages/settings-page/retry-all-button.tsx
      provides: "Section header action button with Mantine notifications + SWR invalidation"
      exports: ["RetryAllButton"]
    - path: apps/web/src/api/enrichment.ts
      provides: "postRetryAll(); UnmatchedBookRow.failure_reason; invalidateUnmatchedList helper"
    - path: apps/web/src/components/re-enrich-button/re-enrich-button.tsx
      provides: "Hardened post-action mutate including predicate list-key invalidation (D-14)"
    - path: apps/web/src/pages/settings-page/unmatched-books-section.tsx
      provides: "Inbox row renders FailureReasonBadge; header includes RetryAllButton; last_error red text removed"
  key_links:
    - from: apps/web/src/pages/settings-page/retry-all-button.tsx
      to: apps/web/src/api/enrichment.ts postRetryAll
      via: "await postRetryAll()"
      pattern: "postRetryAll"
    - from: apps/web/src/components/re-enrich-button/re-enrich-button.tsx
      to: SWR list-key cache
      via: "mutate((key) => Array.isArray(key) && key[0] === 'enrichment/unmatched', ...)"
      pattern: "Array.isArray"
    - from: apps/web/src/pages/settings-page/unmatched-books-section.tsx
      to: apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx
      via: "<FailureReasonBadge reason={row.failure_reason} />"
      pattern: "FailureReasonBadge"
---

<objective>
Ship the Phase 8 web deltas: a structured failure-reason badge per row, a section-level retry-all button, and SWR list-key invalidation that makes per-row Re-enrich update without a page reload.

Purpose: Server contracts from Plans 02-03 are live; this plan exposes them in the inbox UI. UI-SPEC locks every label, color, tooltip, and copy string verbatim; executors must transcribe those strings without paraphrasing.

Output:
- `FailureReasonBadge` component (NEW, with optional CSS module).
- `RetryAllButton` component (NEW).
- `UnmatchedBooksSection` modified: header gains the button, rows gain the badge, `last_error` red text REMOVED.
- `ReEnrichButton` hardened: post-success mutate now invalidates the unmatched list via predicate (D-14).
- `enrichment.ts` API client extended: `postRetryAll`, `invalidateUnmatchedList`, `failure_reason` field on `UnmatchedBookRow`.
</objective>

<execution_context>
@/Users/gbumanzordev/Dev/Personal/KoInsight/.claude/get-shit-done/workflows/execute-plan.md
@/Users/gbumanzordev/Dev/Personal/KoInsight/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/phases/08-failure-triage-smarter-matcher/08-CONTEXT.md
@.planning/phases/08-failure-triage-smarter-matcher/08-RESEARCH.md
@.planning/phases/08-failure-triage-smarter-matcher/08-PATTERNS.md
@.planning/phases/08-failure-triage-smarter-matcher/08-UI-SPEC.md
@.planning/phases/08-failure-triage-smarter-matcher/08-01-wave0-tests-types-PLAN.md
@.planning/phases/08-failure-triage-smarter-matcher/08-02-server-core-PLAN.md
@.planning/phases/08-failure-triage-smarter-matcher/08-03-server-wiring-PLAN.md
@apps/web/src/components/provenance-badge/provenance-badge.tsx
@apps/web/src/components/re-enrich-button/re-enrich-button.tsx
@apps/web/src/pages/settings-page/unmatched-books-section.tsx
@apps/web/src/api/enrichment.ts
@apps/web/src/api/books.ts
@apps/web/src/app.tsx
@packages/common/types/enrichment.ts

<interfaces>
From @koinsight/common (Plan 01):
  FailureReason = 'no_match' | 'ambiguous_match' | 'network' | 'parse_error'

Server endpoint (Plan 03):
  POST /api/enrichment/retry-all
    request body: {} or { force?: boolean } (rejects unknown keys with 400)
    response 200: { enqueued: number, skipped: number }
    response 400: { error: ZodFlattenedError }
    response 500: { error: 'Failed to enqueue retries' }

Existing SWR list cache key (apps/web/src/api/enrichment.ts:49):
  ['enrichment/unmatched', offset, limit]   // tuple, NOT a string

UI-SPEC locked vocabulary (verbatim, ASCII; reference Failure Reason Vocabulary table):
  no_match        -> label 'No match',     color 'gray',   variant 'light',
                     tooltip 'OpenLibrary has no candidate for this title and author. Edit metadata manually.'
  ambiguous_match -> label 'Ambiguous',    color 'yellow', variant 'light',
                     tooltip 'Multiple OpenLibrary candidates matched. Open the book and pick the right one manually.'
  network         -> label 'Network',      color 'blue',   variant 'light',
                     tooltip 'OpenLibrary was unreachable. Retrying usually fixes this.'
  parse_error     -> label 'Parse error',  color 'orange', variant 'light',
                     tooltip 'OpenLibrary returned data we could not read. Retry; if it persists, this is a bug.'
  unknown         -> label 'Unknown',      color 'gray',   variant 'outline',
                     tooltip 'This failure was logged before structured reasons existed. Retry to refresh it.'

Locked button + toast copy (UI-SPEC Copywriting Contract + D-13):
  RetryAllButton label:                  'Retry all failed'
  Disabled tooltip when failed===0:      'No failed books to retry'
  Toast on success (n>0) message:        Re-enqueued N books             (D-13 verbatim)
  Toast on success (n===0) message:      'No failed books to retry'      (D-13 verbatim)
  Toast on error title:                  'Could not start bulk retry'    (UI-SPEC verbatim)
  Toast on error body:                   'Server error. Try again in a moment.'
  Toast color on error:                  'red'
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend enrichment.ts API client + create FailureReasonBadge component</name>
  <read_first>
    - apps/web/src/api/enrichment.ts (existing UnmatchedBookRow type around lines 17-25; SWR list key at line 49)
    - apps/web/src/api/books.ts (lines 43-45 — POST helper analog reEnrichBook)
    - apps/web/src/components/provenance-badge/provenance-badge.tsx (analog component, full file)
    - apps/web/src/components/failure-reason-badge/failure-reason-badge.test.tsx (RED tests from Plan 01)
    - .planning/phases/08-failure-triage-smarter-matcher/08-UI-SPEC.md sections "Failure Reason Vocabulary" and "Component Inventory"
    - .planning/phases/08-failure-triage-smarter-matcher/08-RESEARCH.md "FailureReasonBadge component" + Pitfall 4
    - .planning/phases/08-failure-triage-smarter-matcher/08-PATTERNS.md "failure-reason-badge" + "enrichment.ts"
    - packages/common/types/enrichment.ts (FailureReason union from Plan 01)
  </read_first>
  <files>
    apps/web/src/api/enrichment.ts,
    apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx,
    apps/web/src/components/failure-reason-badge/failure-reason-badge.module.css
  </files>
  <behavior>
    enrichment.ts API client extension:
    - UnmatchedBookRow gains `failure_reason: FailureReason | null`. Import FailureReason from @koinsight/common.
    - postRetryAll() POSTs to 'enrichment/retry-all' via existing fetchFromAPI helper with body `{}`; returns the parsed JSON `{ enqueued, skipped }`.
    - invalidateUnmatchedList() calls `mutate((key) => Array.isArray(key) && key[0] === 'enrichment/unmatched', undefined, { revalidate: true })` AND `mutate('enrichment/status')`. Per Pitfall 4 the predicate form is mandatory; a string `mutate('enrichment/unmatched')` does NOT match the tuple key.

    FailureReasonBadge component:
    - Pure presentational. Props: `{ reason: FailureReason | null }`.
    - Internal const FAILURE_REASON_MAP keyed by `FailureReason | 'unknown'`, values match the UI-SPEC vocabulary verbatim (locked strings in <interfaces> above).
    - Defensive lookup: `const cfg = MAP[reason ?? 'unknown'] ?? MAP.unknown` so unrecognized server values render 'Unknown' instead of crashing (T-08-02 mitigation: closed lookup, no string concat into JSX from server-controlled values).
    - Render Mantine `<Tooltip label={cfg.tooltip}><Badge size="sm" variant={cfg.variant} color={cfg.color} role="status" aria-label="Failure reason: <label>">{cfg.label}</Badge></Tooltip>`.
    - Size sm. Variant `light` for the four real reasons; `outline` for unknown. Color per the table.
    - No new spacing tokens; no inline `style={...}` (UI-SPEC: zero new tokens).
  </behavior>
  <action>
    Step 1 — extend apps/web/src/api/enrichment.ts:

    1. Add imports (top): `import { mutate } from 'swr';` (if not already present) and `import type { FailureReason } from '@koinsight/common/types/enrichment';`. Match the existing @koinsight/common import style — read the file first to see whether other imports use the `/types/enrichment` suffix or just `@koinsight/common`.

    2. Extend UnmatchedBookRow with `failure_reason: FailureReason | null;` after the existing fields. Do not reorder existing fields.

    3. Append helpers AFTER existing exports:

    ```typescript
    export async function postRetryAll(): Promise<{ enqueued: number; skipped: number }> {
      return fetchFromAPI<{ enqueued: number; skipped: number }>('enrichment/retry-all', 'POST', {});
    }

    /**
     * Invalidate every paginated cache slice of the unmatched-books list,
     * plus the enrichment status counter (used by the navbar Indicator).
     * Per RESEARCH Pitfall 4 the list key is a tuple
     * ['enrichment/unmatched', offset, limit]; string mutate does NOT match.
     */
    export async function invalidateUnmatchedList(): Promise<void> {
      await mutate(
        (key) => Array.isArray(key) && key[0] === 'enrichment/unmatched',
        undefined,
        { revalidate: true }
      );
      await mutate('enrichment/status');
    }
    ```

    Match the exact fetchFromAPI signature/style used by the existing file. If the helper returns `Response` instead of parsed JSON, follow the file's existing parse pattern.

    Step 2 — create apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx mirroring the directory layout of apps/web/src/components/provenance-badge/. The component is a pure presentational badge with a closed lookup map; structure is laid out in the <behavior> section above and the RESEARCH "FailureReasonBadge component" code example.

    Concrete requirements (must hold verbatim):
    - Map keys: `'no_match' | 'ambiguous_match' | 'network' | 'parse_error' | 'unknown'`.
    - Each map entry has fields `label`, `color`, `variant`, `tooltip` matching the UI-SPEC vocabulary verbatim (see <interfaces>).
    - The `unknown` entry uses `variant: 'outline'` and `color: 'gray'`.
    - Component renders Mantine Tooltip wrapping a Mantine Badge with `size="sm"`, `role="status"`, and `aria-label={`Failure reason: ${cfg.label}`}`.
    - Closed lookup: `const cfg = FAILURE_REASON_MAP[reason ?? 'unknown'] ?? FAILURE_REASON_MAP.unknown;` — no string concat from `reason` directly into JSX.
    - Imports: `Badge` and `Tooltip` from `@mantine/core`; `FailureReason` type from `@koinsight/common/types/enrichment`.

    Step 3 — create the optional CSS module file failure-reason-badge.module.css. If no per-component classes are needed, an empty file is fine (or omit the import line and skip the file). Follow the convention used by provenance-badge.

    Step 4 — verify Plan 01 RED test turns GREEN. Run vitest on `failure-reason-badge.test.tsx`. If the test imports a different path than what you used, align the import paths in the test file (it was scaffolded as RED in Plan 01 specifically against the path declared here).
  </action>
  <verify>
    <automated>npm --workspace=web exec vitest run apps/web/src/components/failure-reason-badge</automated>
  </verify>
  <acceptance_criteria>
    - `test -f apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx` exits 0.
    - `grep -c "FAILURE_REASON_MAP" apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx` returns >= 1.
    - `grep -c "'No match'\|'Ambiguous'\|'Network'\|'Parse error'\|'Unknown'" apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx` returns >= 5 (all five labels present).
    - `grep -c "OpenLibrary has no candidate" apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx` returns >= 1 (one of the locked tooltips).
    - `grep -c "role=\"status\"" apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx` returns >= 1.
    - `grep -c "variant: 'outline'" apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx` returns >= 1 (unknown fallback).
    - `grep -c "postRetryAll" apps/web/src/api/enrichment.ts` returns >= 1.
    - `grep -c "invalidateUnmatchedList" apps/web/src/api/enrichment.ts` returns >= 1.
    - `grep -c "Array.isArray(key) && key\[0\] === 'enrichment/unmatched'" apps/web/src/api/enrichment.ts` returns >= 1 (Pitfall 4 predicate).
    - `grep -c "failure_reason: FailureReason \| null" apps/web/src/api/enrichment.ts` returns >= 1.
    - `phase 1 RED test failure-reason-badge.test.tsx` runs GREEN under vitest.
  </acceptance_criteria>
  <done>
    enrichment.ts exposes postRetryAll + invalidateUnmatchedList + UnmatchedBookRow.failure_reason. FailureReasonBadge ships with all 5 vocabulary entries verbatim and renders 'Unknown' for null. The Plan 01 RED badge test is GREEN.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create RetryAllButton + harden ReEnrichButton with list-key mutate</name>
  <read_first>
    - apps/web/src/components/re-enrich-button/re-enrich-button.tsx (analog: lines 1-51)
    - apps/web/src/api/enrichment.ts (after Task 1 — postRetryAll + invalidateUnmatchedList exist)
    - apps/web/src/pages/settings-page/retry-all-button.test.tsx (RED tests from Plan 01)
    - apps/web/src/components/re-enrich-button/re-enrich-button.test.tsx (RED tests from Plan 01)
    - apps/web/src/app.tsx (line 58 — Notifications provider; line 15 — provider wiring)
    - apps/web/src/api/enrichment.ts (useEnrichmentStatus hook — verify how to read .data.failed)
    - .planning/phases/08-failure-triage-smarter-matcher/08-UI-SPEC.md "Section-level Retry all failed", "Copywriting Contract", "Optimistic vs refetch policy"
    - .planning/phases/08-failure-triage-smarter-matcher/08-CONTEXT.md (D-10, D-11, D-13, D-14)
    - .planning/phases/08-failure-triage-smarter-matcher/08-RESEARCH.md "Web API client extension" + Pitfall 4
    - .planning/phases/08-failure-triage-smarter-matcher/08-PATTERNS.md "retry-all-button" + "re-enrich-button"
  </read_first>
  <files>
    apps/web/src/pages/settings-page/retry-all-button.tsx,
    apps/web/src/components/re-enrich-button/re-enrich-button.tsx
  </files>
  <behavior>
    RetryAllButton (NEW, RETRY-01, D-10/D-11/D-13):
    - Reads failed count from `useEnrichmentStatus()` hook (existing); when `.data.failed === 0`, button is `disabled`.
    - Disabled state wrapped in Mantine Tooltip with label `'No failed books to retry'`.
    - Label: `'Retry all failed'` (UI-SPEC verbatim — D-CONTEXT supersedes UI-SPEC's optional `({n})` suffix; the executor MAY include `({n})` if it improves clarity but the literal string `'Retry all failed'` MUST appear in the rendered button text).
    - Variant: `'default'` (Mantine; UI-SPEC reserves `koinsight` accent).
    - LeftSection: `<IconRefresh size={16} />`.
    - On click: NO modal (D-10 supersedes UI-SPEC's modal). Action fires immediately.
      - `setIsSubmitting(true)`.
      - `try { const res = await postRetryAll(); ... }`.
      - On success with `res.enqueued > 0`: notifications.show with `message: \`Re-enqueued ${res.enqueued} books\``, `color: 'blue'`, `position: 'top-center'`. Title may be `'Retrying...'` or omitted (D-13 specifies the message wording specifically).
      - On success with `res.enqueued === 0`: notifications.show with `message: 'No failed books to retry'`, `color: 'blue'`, `position: 'top-center'`.
      - Then `await invalidateUnmatchedList()`.
      - On caught error: notifications.show with `title: 'Could not start bulk retry'`, `message: 'Server error. Try again in a moment.'`, `color: 'red'`, `position: 'top-center'`.
      - `finally { setIsSubmitting(false); }`.
    - Loading state via Mantine `loading` prop while in flight.

    ReEnrichButton hardening (D-14, RETRY-02):
    - Existing `await mutate(\`books/${bookId}\`)` preserved.
    - ADD a call to `invalidateUnmatchedList()` (imported from `../../api/enrichment`) immediately after the existing per-book mutate, BEFORE `setIsSubmitting(false)`.
    - All other behavior unchanged (toasts, button props, error handling).
  </behavior>
  <action>
    Step 1 — create apps/web/src/pages/settings-page/retry-all-button.tsx mirroring the structure of apps/web/src/components/re-enrich-button/re-enrich-button.tsx (imports, useState, async onClick, try/catch/finally pattern). Concrete contract:

    Imports:
    - `Button, Tooltip` from `@mantine/core`
    - `notifications` from `@mantine/notifications`
    - `IconRefresh` from `@tabler/icons-react`
    - `JSX, useState` from `react`
    - `postRetryAll, invalidateUnmatchedList, useEnrichmentStatus` from `'../../api/enrichment'` (verify the exact path by reading the file; the hook's actual export name is what matters)

    Component:
    - Named export `RetryAllButton`.
    - No props.
    - Local state `isSubmitting`.
    - Reads `useEnrichmentStatus()`; computes `failedCount = data?.failed ?? 0` (handle the loading/error case gracefully — disabled until hook resolves).
    - `disabled = isSubmitting || failedCount === 0`.
    - Wrap the button in a Mantine `<Tooltip label="No failed books to retry" disabled={failedCount > 0}>` so the disabled-rationale tooltip only renders when the button is disabled because of zero count.
    - Render: `<Button variant="default" size="sm" leftSection={<IconRefresh size={16} />} disabled={disabled} loading={isSubmitting} onClick={onClick}>Retry all failed</Button>`.
    - onClick implementation per <behavior>; the message/title/color strings are LOCKED — copy them verbatim from <interfaces>.

    Step 2 — modify apps/web/src/components/re-enrich-button/re-enrich-button.tsx:

    1. Add import `import { invalidateUnmatchedList } from '../../api/enrichment';`.
    2. Inside the existing `try { ... }` block in the onClick handler, AFTER the existing `await mutate(\`books/${bookId}\`);` call, append:
       ```typescript
       await invalidateUnmatchedList();
       ```
    3. Do NOT modify the toast wording, the button props, the error path, or anything else.
    4. Verify the existing tests still pass (the test was RED in Plan 01; this step turns it GREEN by adding the predicate-style mutate via the helper).

    Step 3 — verify both Plan 01 RED tests turn GREEN. If the tests assert specific argument patterns (e.g., `mutate` called with a function predicate), confirm the helper invokes the predicate form — they do via `invalidateUnmatchedList`.

    Note on D-10 vs UI-SPEC modal: per CONTEXT.md authority, D-10 ("no modal, fire immediately") wins. UI-SPEC's modal section is stale. Do NOT call `modals.openConfirmModal` anywhere in this plan.
  </action>
  <verify>
    <automated>npm --workspace=web exec vitest run apps/web/src/pages/settings-page/retry-all-button apps/web/src/components/re-enrich-button</automated>
  </verify>
  <acceptance_criteria>
    - `test -f apps/web/src/pages/settings-page/retry-all-button.tsx` exits 0.
    - `grep -c "'Retry all failed'" apps/web/src/pages/settings-page/retry-all-button.tsx` returns >= 1.
    - `grep -c "'No failed books to retry'" apps/web/src/pages/settings-page/retry-all-button.tsx` returns >= 1 (D-13 + disabled tooltip).
    - `grep -c "Re-enqueued.*books" apps/web/src/pages/settings-page/retry-all-button.tsx` returns >= 1 (D-13 verbatim).
    - `grep -c "'Could not start bulk retry'" apps/web/src/pages/settings-page/retry-all-button.tsx` returns >= 1 (UI-SPEC verbatim).
    - `grep -c "openConfirmModal\|modals\\." apps/web/src/pages/settings-page/retry-all-button.tsx` returns 0 (D-10 no-modal).
    - `grep -c "variant=\"default\"" apps/web/src/pages/settings-page/retry-all-button.tsx` returns >= 1 (accent reserved per UI-SPEC).
    - `grep -c "invalidateUnmatchedList" apps/web/src/components/re-enrich-button/re-enrich-button.tsx` returns >= 1 (D-14 hardening).
    - Plan 01 RED test `retry-all-button.test.tsx` runs GREEN under vitest.
    - Plan 01 RED test `re-enrich-button.test.tsx` runs GREEN under vitest.
  </acceptance_criteria>
  <done>
    RetryAllButton ships with locked copy and immediate-fire behavior (no modal). ReEnrichButton invalidates the list cache after success. Both Plan 01 web RED tests are GREEN.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Wire FailureReasonBadge + RetryAllButton into UnmatchedBooksSection; remove last_error red text</name>
  <read_first>
    - apps/web/src/pages/settings-page/unmatched-books-section.tsx (existing; row layout lines 73-106; header pattern around the section title)
    - .planning/phases/08-failure-triage-smarter-matcher/08-UI-SPEC.md "Layout Inside the Failed Row" + "Component Inventory"
    - .planning/phases/08-failure-triage-smarter-matcher/08-PATTERNS.md "unmatched-books-section.tsx"
  </read_first>
  <files>
    apps/web/src/pages/settings-page/unmatched-books-section.tsx
  </files>
  <behavior>
    - The existing `row.last_error` red `Text c="red"` block (lines ~83-87) is REMOVED. Raw error strings now live ONLY in the badge tooltip on the server-failure-reason side; the row no longer surfaces `last_error` directly.
    - Each failed row's left-hand metadata stack (`<Stack gap={4}>`) gains a third line below title + author: a horizontal `<Group gap="xs">` containing `<FailureReasonBadge reason={row.failure_reason} />` followed (optionally) by a small `<Text size="xs" c="dimmed">` showing relative-time (e.g., `Retried 2h ago` or `Last failed 5m ago`) derived from `row.job_updated_at`. If `job_updated_at` is null, omit the relative-time text.
    - The section title is wrapped in a `<Group justify="space-between">` with the title on the left and `<RetryAllButton />` on the right.
    - All other layout, the per-row Re-enrich button, the Edit metadata link, the Phase 5 empty state, the LoadingOverlay — preserved verbatim.
  </behavior>
  <action>
    1. Add imports at the top of unmatched-books-section.tsx:
       ```typescript
       import { FailureReasonBadge } from '../../components/failure-reason-badge/failure-reason-badge';
       import { RetryAllButton } from './retry-all-button';
       ```
       (Match the existing import path style — relative vs absolute — observed in the file.)

    2. Replace the section title declaration. Existing typically reads `<Title order={2}>Unmatched books</Title>`. Wrap in:
       ```tsx
       <Group justify="space-between" align="center">
         <Title order={2}>Unmatched books</Title>
         <RetryAllButton />
       </Group>
       ```
       Use the Mantine `Group` import (likely already in scope; if not, add to the existing `@mantine/core` import).

    3. In the row map (lines ~73-106 per PATTERNS), DELETE the block:
       ```tsx
       {row.last_error && (
         <Text size="xs" c="red" lineClamp={2}>{row.last_error}</Text>
       )}
       ```

    4. ADD inside the same `<Stack gap={4}>` (after the author line):
       ```tsx
       <Group gap="xs" wrap="nowrap">
         <FailureReasonBadge reason={row.failure_reason} />
         {row.job_updated_at && (
           <Text size="xs" c="dimmed">
             {formatRelativeTime(row.job_updated_at)}
           </Text>
         )}
       </Group>
       ```
       Use whatever existing relative-time helper the project already has (`apps/web/src/utils/` or `dayjs`/`date-fns`); if no helper exists, use a minimal inline implementation OR simply render the raw `job_updated_at` string for now and leave the formatting refinement as out-of-scope (UI-SPEC marks the relative-time text as decorative). Do NOT add a new dependency.

    5. Run a manual visual sanity check via `npm run dev` if local dev server is up: navigate to `/settings`, observe the Unmatched Books section header now has the Retry all button on the right; each failed row shows its colored badge instead of red error text.

    6. Type-check: `npx tsc --noEmit -p apps/web/tsconfig.json` exits 0.
  </action>
  <verify>
    <automated>npm --workspace=web exec vitest run apps/web/src/pages/settings-page</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "FailureReasonBadge" apps/web/src/pages/settings-page/unmatched-books-section.tsx` returns >= 1.
    - `grep -c "RetryAllButton" apps/web/src/pages/settings-page/unmatched-books-section.tsx` returns >= 1.
    - `grep -c "row.last_error" apps/web/src/pages/settings-page/unmatched-books-section.tsx` returns 0 (red text block removed). NOTE: if other code references `row.last_error` for non-render purposes (e.g., logging), narrow the check to `c=\"red\"` patterns.
    - `grep -c "c=\"red\"" apps/web/src/pages/settings-page/unmatched-books-section.tsx` returns 0 in the row layout (no red error text remaining).
    - `grep -c "Group justify=\"space-between\"" apps/web/src/pages/settings-page/unmatched-books-section.tsx` returns >= 1 (header layout).
    - `npx tsc --noEmit -p apps/web/tsconfig.json` exits 0.
    - `npm --workspace=web run build` exits 0.
  </acceptance_criteria>
  <done>
    Inbox section header has the Retry all button; rows show structured failure-reason badges; legacy red error text removed. The full Phase 8 UI is composed.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| server response -> badge JSX render | failure_reason value crosses here; defensive lookup mitigates injection |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-08-02 | Injection (XSS) | FailureReasonBadge label render | mitigate | Closed lookup map keyed by FailureReason union; defensive `?? FAILURE_REASON_MAP.unknown` ensures unrecognized server values render the safe 'Unknown' entry. NO string concat from `reason` directly into JSX text or attributes (the only concat is into `aria-label` which is built from `cfg.label`, a local constant). Plan 01 test `failure-reason-badge.test.tsx` asserts the closed-lookup behavior. |
| T-08-08 | Tampering | postRetryAll body | mitigate | Client always sends `{}`; server Plan 03 enforces .strict() schema. Client cannot pass arbitrary keys. |
</threat_model>

<verification>
- `npm --workspace=web test` reports all GREEN (existing + new Phase 8 web tests).
- `npx tsc --noEmit -p apps/web/tsconfig.json` exits 0.
- `npm --workspace=web run build` exits 0.
- Manual smoke (optional): with the dev server running and at least 1 failed book seeded, navigate to /settings; observe the badge per row and the Retry-all button in the header. Click Retry all; toast 'Re-enqueued N books' appears; the row updates within 5 seconds without page reload.
- All 9 Wave 0 RED tests across Plans 01/02/03/04 are GREEN.
</verification>

<success_criteria>
- FailureReasonBadge ships with 5 vocabulary entries (4 server reasons + UI-only 'unknown'); labels and tooltips match UI-SPEC verbatim.
- RetryAllButton ships with `'Retry all failed'` label, immediate-fire behavior (no modal per D-10), Mantine notification with locked D-13 wording, and post-success invalidateUnmatchedList.
- ReEnrichButton invalidates the unmatched list via predicate-mutate (D-14); per-row retry now updates the row without a page reload.
- UnmatchedBooksSection header gains the button; rows show the badge; legacy red error text removed.
- All Phase 8 RED tests are GREEN.
- T-08-02 mitigation encoded in code (closed lookup) AND test.
- RETRY-01 / RETRY-02 / RETRY-04 fully shipped end-to-end across server + web.
</success_criteria>

<output>
After completion, create .planning/phases/08-failure-triage-smarter-matcher/08-04-SUMMARY.md documenting:
- Final component file paths.
- Verbatim copy strings used (sanity-check that none paraphrase UI-SPEC).
- Whether the relative-time text was rendered with an existing helper or omitted.
- Whether D-10 (no-modal) won over UI-SPEC; flag the UI-SPEC modal section as stale for future spec sync.
- Confirmation that all 9 Wave 0 RED tests are GREEN.
</output>

---
phase: 8
slug: failure-triage-smarter-matcher
status: draft
shadcn_initialized: false
preset: none
created: 2026-04-27
extends: .planning/milestones/v1.0/phases/05-manual-edit-unmatched-inbox/05-UI-SPEC.md
---

# Phase 8 — UI Design Contract

> Visual and interaction contract for the new retry affordances and structured `failure_reason` display in the existing Unmatched Books inbox at `/settings`. This spec EXTENDS Phase 5's UI-SPEC; spacing, typography, color, font, registry, and layout primitives are inherited verbatim and not redeclared. Only the deltas Phase 8 ships are specified below.

---

## Scope of UI Work in This Phase

Phase 8 adds three small, additive affordances to the existing `UnmatchedBooksSection` at `apps/web/src/pages/settings-page/unmatched-books-section.tsx`:

1. **Per-row failure-reason badge** next to each failed book (RETRY-04).
2. **Per-row "Retry" action** (already shipped as `ReEnrichButton variant="row"` in Phase 5; Phase 8 hardens its post-action SWR behavior so the row's status update reflects without a page reload, RETRY-02).
3. **Section-level "Retry all failed" action** in the Unmatched Books header (RETRY-01).

The page itself is NOT redesigned: layout, navigation, color palette, typography, spacing tokens, font, and the surrounding stat cards are locked by Phase 5 and remain unchanged.

Backend-only requirements (POLISH-01 bulk-enqueue helper, RETRY-03 smarter matcher) have no UI contract.

---

## Inherited Design System (from Phase 5)

| Property | Value | Source |
|----------|-------|--------|
| Tool | none (Mantine is locked) | Phase 5 |
| Component library | Mantine v8.3.12 | Phase 5 |
| Icon library | `@tabler/icons-react` v3.36.1 | Phase 5 |
| Font (body) | system-ui | Phase 5 |
| Font (headings) | Noto Serif | Phase 5 |
| Spacing scale | `var(--mantine-spacing-{xs|sm|md|lg|xl|2xl})` | Phase 5 |
| Typography | xs=12, sm=14, md=16, lg=18, xl=20; weights 400 + 600 | Phase 5 |
| Color palette | koinsight (accent), violet (active nav), red (destructive), gray, plus blue/yellow/green semantic | Phase 5 |
| Color split | 60/30/10 with accent reserved for the four buttons listed in Phase 5 | Phase 5 |

**Phase 8 introduces no new tokens, fonts, palettes, or spacing primitives.** Any new element below references existing Mantine theme tokens.

---

## Spacing (Delta Only)

No new spacing exceptions. New elements use Phase 5 tokens:

| Element | Token | Value |
|---------|-------|-------|
| Failure-reason badge -> error-text gap (vertical) | `xs` | 8px |
| Retry-all button -> section title gap | `md` | 16px |
| Retry-all confirmation modal padding | Mantine modal default | n/a |

---

## Typography (Delta Only)

No new sizes or weights. New elements use Phase 5 tokens:

| Role | Size | Weight | Line Height | Mantine token |
|------|------|--------|-------------|---------------|
| Failure-reason badge label | 12px | 600 | 1 | `Badge size="sm"` |
| Retry-all button label | 14px | 600 | 1.55 | `Button size="sm"` default |
| Confirmation modal body | 14px | 400 | 1.55 | Mantine default |

---

## Color (Delta Only)

No new color tokens. The failure-reason badges reuse existing semantic palette entries; severity is conveyed via Mantine `Badge color={...} variant="light"`.

| Failure reason | Mantine color | Variant | Severity rationale |
|----------------|---------------|---------|--------------------|
| `no_match` | `gray` | `light` | Neutral. Not an error per se; OL has no candidate. User action: edit metadata manually. |
| `ambiguous_match` | `yellow` | `light` | Caution. Multiple candidates; matcher refused to guess. User action: edit OL key manually. |
| `network` | `blue` | `light` | Transient. Worth retrying. |
| `parse_error` | `orange` | `light` | Investigative. OL returned data the parser rejected. User action: retry; if persistent, file an issue. |
| `unknown` (catch-all for legacy rows where `failure_reason` is `NULL`) | `gray` | `outline` | Display-only fallback so legacy failures still render. |

**Accent (`koinsight`) is NOT used for any Phase 8 element.** Per Phase 5's reserved-for list, accent is reserved for the four explicit CTAs (Save changes, Edit metadata on book detail, primary Re-enrich on book detail, Settings empty-state View all books). The "Retry all failed" header button is a section-level action repeated on a settings sub-page; it uses `variant="default"` exactly like the per-row Re-enrich (D-equivalent rule from Phase 5: repeated/secondary actions stay neutral).

**Destructive color is NOT used.** Retry is non-destructive (re-enqueues; never deletes data). No confirmation modal uses `red`.

---

## Failure Reason Vocabulary

These are the only allowed values rendered to the user. The server emits the same string keys (RETRY-04). Frontend maps key -> label + color via a single lookup table colocated with the badge component.

| `failure_reason` value (server) | Display label (UI) | Tooltip body |
|---------------------------------|--------------------|--------------|
| `no_match` | `No match` | `OpenLibrary has no candidate for this title and author. Edit metadata manually.` |
| `ambiguous_match` | `Ambiguous` | `Multiple OpenLibrary candidates matched. Open the book and pick the right one manually.` |
| `network` | `Network` | `OpenLibrary was unreachable. Retrying usually fixes this.` |
| `parse_error` | `Parse error` | `OpenLibrary returned data we could not read. Retry; if it persists, this is a bug.` |
| `null` / unrecognized value | `Unknown` | `This failure was logged before structured reasons existed. Retry to refresh it.` |

**Lock the labels.** Executor must use these exact strings. No reordering of words. ASCII only (no em dashes).

---

## Component Inventory (Delta Only)

Phase 8 introduces two new components and extends one existing component.

| Component | Location | Purpose |
|-----------|----------|---------|
| `FailureReasonBadge` (NEW) | `apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx` | Pure presentational. Props: `reason: FailureReason \| null`. Renders Mantine `<Badge size="sm" variant="light" color={...}>{label}</Badge>` wrapped in a Mantine `<Tooltip label={tooltipBody}>`. Looks up label/color/tooltip from a single const map keyed by the values above. Renders `Unknown` (gray outline) for `null` or any unrecognized server value (defensive). |
| `RetryAllButton` (NEW) | `apps/web/src/pages/settings-page/retry-all-button.tsx` | Header action in `UnmatchedBooksSection`. Mantine `Button variant="default"` with `IconRefresh` left section, label `Retry all failed ({n})` where `{n}` is the count from `useEnrichmentStatus().data.failed`. Disabled when `n === 0` or when a retry-all is already in flight. On click: opens confirmation modal (see Interaction Contracts), then POSTs to bulk endpoint and emits a single kickoff toast. |
| `UnmatchedBooksSection` (EXTEND) | `apps/web/src/pages/settings-page/unmatched-books-section.tsx` | Render `<FailureReasonBadge reason={row.failure_reason} />` on each row, replacing the existing `row.last_error` red text block. Place `<RetryAllButton />` in the section header next to `<Title order={2}>Unmatched books</Title>` (right-aligned via `Group justify="space-between"`). |

`ReEnrichButton` (Phase 5) is NOT modified. Its existing `variant="row"` continues to power per-row retry; Phase 8's only contract on it is the SWR refetch policy below.

`UnmatchedBookRow` (in `apps/web/src/api/enrichment.ts`) gains a `failure_reason: FailureReason | null` field; the `FailureReason` union type is exported from `@koinsight/common`.

---

## Layout Inside the Failed Row

Failed-row layout extends the Phase 5 `Paper` row. The right-hand action group is unchanged. The left-hand metadata stack changes:

```
+--------------------------------------------------------------+
| Title (fw=600, truncate)                  [Edit metadata]    |
| Author (size=sm, c=dimmed, truncate)      [Re-enrich]        |
| [FailureReasonBadge]  retry attempted 2h ago                 |
+--------------------------------------------------------------+
```

- `last_error` red text block from Phase 5 is REMOVED. Structured `failure_reason` replaces it. Raw error strings live in the tooltip on the badge for power users; they no longer occupy row real estate.
- A small dimmed `Text size="xs" c="dimmed"` line to the right of the badge shows last-attempt relative time (e.g., `Retried 2h ago` or `Last failed 5m ago`). Format: `{Last failed | Retried} {relative time}` using existing date utilities. If `job_updated_at` is null, omit the line.
- Badge + relative time live on a single horizontal flex row (`Group gap="xs"`).

---

## Interaction Contracts

### Per-row retry (RETRY-02)

Phase 5's `ReEnrichButton variant="row"` already drives this. Phase 8 contract:

- **Click** -> button shows Mantine `loading` state -> POST `/api/enrichment/books/:id/retry` (or whichever endpoint the planner chooses; 202 expected) -> on 2xx, `notifications.show` kickoff toast (existing Phase 5 wording: title `Re-enriching...`, body `We're checking OpenLibrary for fresh metadata.`, color `blue`).
- **Optimistic update**: `mutate(['enrichment/unmatched', offset, limit])` is called immediately after kickoff with the OPTIMISTIC option `{ optimisticData, revalidate: false, rollbackOnError: true }`, where `optimisticData` removes the row from the rendered list (or marks it `pending` if the planner prefers explicit status, see **Optimistic vs refetch policy** below).
- **Refetch policy**: SWR's existing 5s poll (`refreshInterval: 5000`) on `useUnmatchedBooks` and `useEnrichmentStatus` is the authoritative source of truth after kickoff. The optimistic mutation is a transient UI smoothing; reality wins on the next poll.
- **Terminal state**: when the row's `enrichment_status` transitions out of `failed` (success or skipped), it disappears from the list naturally on the next 5s revalidation. No page reload, no manual refresh.

### Section-level "Retry all failed" (RETRY-01)

- **Placement**: top-right of the `Unmatched books` section header, on the same row as the `<Title order={2}>` (`Group justify="space-between"`).
- **Disabled when**: `failed === 0` (Mantine `disabled` prop; tooltip label `No failed books to retry`), or when a retry-all kickoff is in flight (`loading` prop while POST is open).
- **Confirmation modal**: Mantine `modals.openConfirmModal` with:
  - Title: `Retry all failed books?`
  - Body: `This will re-enqueue all {n} failed books for enrichment. This is safe; nothing is deleted.`
  - Confirm label: `Retry all`
  - Cancel label: `Cancel`
  - Confirm color: Mantine default (NOT `red`; retry is non-destructive)
- **On confirm**: POST `/api/enrichment/retry-all` (or planner's chosen endpoint; expect 202 with `{ enqueued: number }`). Emit a single kickoff toast: title `Retrying {n} books...`, body `We're re-enqueueing them through OpenLibrary. Status updates as each one resolves.`, color `blue`, position `top-center`.
- **No per-book toasts**. Individual book outcomes are reflected in the inbox list as the 5s poll progresses; flooding the user with N toasts is forbidden.
- **Filter scope**: this milestone retries every book in `enrichment_status='failed'`. There is no per-`failure_reason` filter UI in Phase 8; "optional filter" in REQUIREMENTS.md RETRY-01 is satisfied by the implicit "where status = failed" filter, no additional UI needed. A future per-reason filter chip is explicitly out of scope (already deferred in Phase 5's Out of Scope section).

### Optimistic vs refetch policy (canonical)

| Action | Optimistic UI behavior | Authoritative refresh |
|--------|------------------------|------------------------|
| Per-row Retry kickoff | Row immediately shows the existing `ReEnrichButton` `loading` spinner. Row stays in the list with no status change until the 5s poll arrives. **No optimistic row removal.** Rationale: kickoff returns 202 (queued), not "succeeded"; removing the row would lie to the user if matcher fails again. | Next `useUnmatchedBooks` 5s revalidation. Row drops off when server status is no longer `failed`. |
| Retry-all kickoff | `RetryAllButton` enters `loading` state; counter chip on the button stays at the pre-action value (does NOT decrement optimistically). Modal closes. Toast appears. | Next 5s revalidation of both `useUnmatchedBooks` and `useEnrichmentStatus`. Counts and rows drift toward zero as books resolve. Stat cards reflect the new totals automatically (Phase 5 already polls them at 5s). |
| Re-failure (book ends up `failed` again with possibly a different `failure_reason`) | Row reappears (or stays) on the next 5s poll with the new badge. No special toast. | Same 5s poll. |

**Rationale for refetch-over-optimistic**: enrichment is async, multi-step, and can re-fail. Optimistically marking rows as `enriched` would mislead. The 5s poll is fast enough that the lag is imperceptible, and SWR dedupes the request between the inbox and the navbar Indicator.

### Loading and Error States After Retries Resolve

| State | Treatment |
|-------|-----------|
| List loading (initial) | Existing Phase 5: `<LoadingOverlay visible={isLoading} />` over the list `<Box>`. Unchanged. |
| Retry-all in flight | `RetryAllButton` shows `loading` prop. Row-level buttons remain enabled (a user can still click an individual `Re-enrich` while bulk retry is processing; backend must be idempotent on duplicate enqueue, but that is out of UI scope). |
| List empty after all retries succeed | Phase 5 empty state renders verbatim: heading `No unmatched books`, body `Every book in your library has been enriched. New unmatched books will appear here.`, action `View all books`. **No "all retries succeeded" celebration toast** — keep the UI calm. |
| Some retries succeeded, some still failed | List renders the remaining failures with their (possibly new) `failure_reason` badges. No banner; the shrinking list is sufficient feedback. |
| Bulk retry kickoff failed (4xx/5xx on the POST itself) | Toast: title `Could not start bulk retry`, body `Server error. Try again in a moment.`, color `red`. List unchanged. |
| Per-row retry kickoff failed (4xx/5xx) | Existing Phase 5 `ReEnrichButton` toast wording is reused: title `Enrichment failed`, body `OpenLibrary could not match this book. Edit metadata manually to fix it.`, color `red`. **NOTE for the planner**: that wording is technically inaccurate for a kickoff failure (it implies matching failed, not enqueueing). If the planner wants to refine it, the better copy is: title `Could not start retry`, body `Server error. Try again in a moment.`, color `red`. Recorded here as a Phase 8 copy refinement; either string is acceptable at executor time, but pick one and stay consistent. |
| Inbox load fails after a retry-all kickoff | Existing Phase 5 `<Alert color="red" title="Could not load unmatched books">Refresh the page or try again later.</Alert>`. Unchanged. |

---

## Copywriting Contract

All Phase 8 strings, locked verbatim. ASCII only. No em dashes.

### Buttons / CTAs

| Element | Copy |
|---------|------|
| Section header bulk action | `Retry all failed ({n})` (where `{n}` is the failed-count integer; when `n === 0` the button is disabled and label remains the same) |
| Retry-all confirm modal title | `Retry all failed books?` |
| Retry-all confirm body | `This will re-enqueue all {n} failed books for enrichment. This is safe; nothing is deleted.` |
| Retry-all confirm button | `Retry all` |
| Retry-all cancel button | `Cancel` |
| Per-row retry button | `Re-enrich` (Phase 5; unchanged) |

### Failure reason badge labels

(See **Failure Reason Vocabulary** above. Locked: `No match`, `Ambiguous`, `Network`, `Parse error`, `Unknown`.)

### Toasts (Mantine `notifications.show`)

| Trigger | Title | Body | Color |
|---------|-------|------|-------|
| Per-row retry kickoff (existing Phase 5) | `Re-enriching...` | `We're checking OpenLibrary for fresh metadata.` | `blue` |
| Bulk retry kickoff | `Retrying {n} books...` | `We're re-enqueueing them through OpenLibrary. Status updates as each one resolves.` | `blue` |
| Bulk retry kickoff failed (4xx/5xx) | `Could not start bulk retry` | `Server error. Try again in a moment.` | `red` |
| Per-row kickoff failed (refined wording, recommended) | `Could not start retry` | `Server error. Try again in a moment.` | `red` |
| All retries resolved | (no toast — list shrinks naturally) | – | – |

### Empty / Error states

(All inherited from Phase 5; no Phase 8 deltas.)

### Destructive confirmations

None. Retry is non-destructive. No `red` confirm button anywhere in Phase 8.

### Plain-ASCII rule

Verified all Phase 8 copy above is em-dash free. Uses commas, periods, semicolons, and parentheses only.

---

## Accessibility (Delta Only)

- `FailureReasonBadge` wraps Mantine `Badge` in `Tooltip` (Phase 5 pattern). Badge gets `role="status"` and `aria-label` of the form `Failure reason: {label}` (e.g., `Failure reason: Ambiguous`).
- `RetryAllButton` is keyboard-focusable per Mantine default. The disabled state (when `failed === 0`) renders a Mantine `Tooltip` with label `No failed books to retry` so the rationale is keyboard-discoverable.
- Confirmation modal traps focus by default (Mantine `modals.openConfirmModal`).
- The relative-time text next to the badge is purely decorative; no `aria-live` (would be noisy on every 5s poll). Screen-reader users get the badge label, which is the load-bearing signal.

---

## Component Inventory: What NOT to build

To prevent scope creep from Phase 8 into Phase 9/10:

- No filter chip row to filter by `failure_reason` (deferred; "optional filter" is satisfied by the implicit "where status=failed").
- No per-row spinner during the 5s poll cycle (deferred from Phase 5; reaffirmed here).
- No new stat card for "average retries per book" or similar (deferred; not requested).
- No undo/cancel for an in-flight bulk retry (kickoff is async; once enqueued, the system will run them all to completion).
- No badge or color change to the existing four `EnrichmentStatusCards` (Phase 5 already exposes `failed` count; that surface is unchanged).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| Mantine v8 | `Badge`, `Button`, `Tooltip`, `Group`, `Modal` (via `modals.openConfirmModal`), `notifications` | not required (first-party, already installed in Phase 5) |
| `@tabler/icons-react` | `IconRefresh` (already used in `ReEnrichButton`) | not required (first-party, already installed) |
| shadcn / third-party block registries | none | N/A — shadcn not used in this project |

No new dependencies. Phase 8 ships with zero `npm install` additions on the web side.

---

## Out of Scope (Visual)

- Filter UI by `failure_reason` (no chip row, no dropdown).
- Bulk-retry undo / cancel.
- Drag-to-select multi-row retry (use "Retry all" or per-row).
- Toast spam during bulk retry (one kickoff toast, no per-book follow-ups).
- Celebration animation when the inbox empties.
- Author / cover thumbnails on inbox rows (deferred; rows stay textual).
- Surfacing the raw `last_error` string in the row body (now lives in tooltip only).

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending

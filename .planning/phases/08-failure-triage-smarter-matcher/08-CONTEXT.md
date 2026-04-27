# Phase 8: Failure Triage & Smarter Matcher - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 8 ships triage and recovery for stuck-failed enrichment jobs:

1. A reusable bulk-enqueue helper (POLISH-01) that consolidates the per-book enqueue loop.
2. Smarter OL matcher heuristics (RETRY-03) so books that currently fail matching but exist in OL succeed on retry.
3. A structured `failure_reason` persisted on each failure (RETRY-04) so users can distinguish transient errors from real metadata issues.
4. Inbox UI affordances (RETRY-01, RETRY-02): a section-level "Retry all failed" action, a per-row Retry that updates the row without a page reload, and a per-row failure-reason badge.

Out of scope (deferred): LLM-assisted matcher fallback, second enrichment provider, scheduled retries, bulk re-match of historical mismatches, bundle-size CI gates.

</domain>

<decisions>
## Implementation Decisions

### failure_reason Persistence (RETRY-04)
- **D-01:** `failure_reason TEXT NULL` column lives on the `book` row (not `enrichment_job`). Inbox queries already return book rows; matches the v1.0 book-level provenance pattern. UI-SPEC's badge renders from this column directly.
- **D-02:** `classifyFailure(err)` (apps/server/src/enrichment/retry.ts:15) is refactored to return `{ class: FailureClass, reason: FailureReason }`. Existing retryable/permanent branching for backoff is preserved unchanged; the new `reason` field is a parallel return used by `markTerminalFailure` and the UI.
- **D-03:** Mapping rules (must match UI-SPEC vocabulary verbatim):
  - `NotFoundError` (non-isbn) -> `no_match`
  - `NoMatchError` / `'no-match'` from matcher (no top-3 candidate passed) -> `no_match`
  - Matcher emits `AmbiguousMatchError` when 2+ of the top-3 candidates pass title+author rule -> `ambiguous_match`
  - `ZodError` -> `parse_error`
  - `UpstreamServerError`, `ECONNRESET`, `ETIMEDOUT`, `UND_ERR_CONNECT_TIMEOUT`, `EOPENBREAKER` -> `network`
  - `SQLITE_BUSY` and any retryable that exhausts `ENRICHMENT_MAX_ATTEMPTS` -> `network` (best fit; transient external IO)
  - Any unmatched error -> `parse_error` (catch-all for "OL returned data we could not handle")
- **D-04:** Legacy already-failed rows (the 8 currently in `enrichment_status='failed'`) are left with `failure_reason = NULL` after migration. UI-SPEC already specifies the `unknown` (gray outline) badge for NULL, so no backfill task is required. Reclassification happens naturally on next retry.

### Matcher: Ambiguous Match Detection (RETRY-03 prerequisite for D-03)
- **D-05:** `matchWork()` (apps/server/src/enrichment/matcher.ts:28) currently picks the first passing candidate from the top-3. Phase 8 changes this so that if 2+ of the top-3 satisfy the title+author rule, the matcher refuses to guess and throws `AmbiguousMatchError` (a new named error subclassed in the same module). Single-pass match still returns the candidate. Zero candidates passing remains `NoMatchError`.

### Smarter Matcher Heuristics (RETRY-03)
- **D-06:** Architecture: layer fuzzy compare ON TOP of the existing token-overlap rule. Strict path (current behavior) runs first; on miss, the fuzzy path runs over the same top-3 candidates with looser comparison. Preserves all currently-matching books.
- **D-07:** Normalization rules that ship in Phase 8 (applied in both strict and fuzzy paths):
  - Diacritics fold via `String.prototype.normalize('NFKD')` + strip `\p{M}` combining marks. (`Resolução` -> `Resolucao`.)
  - Subtitle stripping: split title on first `:` or `—` (em-dash) or ` - ` (spaced hyphen) and try both the full and the prefix.
  - Author "Last, First" <-> "First Last" swap: when `book.authors` contains a comma, also try the reversed form. Required by phase goal.
  - Initial expansion/contraction (J. R. R. Tolkien <-> JRR Tolkien) is OUT of scope this phase.
- **D-08:** Fuzzy similarity:
  - Title: Dice coefficient on character bigrams of the normalized title vs each candidate's normalized title; threshold `>= 0.85`. Threshold is captured as a named constant so it can be tuned.
  - Author: must remain an exact token match after normalization + Last,First swap. (Keeps precision high; fuzzy authors are too risky.)
- **D-09:** Test fixtures: pull the real currently-failed books from the dev DB (the 8 referenced in the phase goal), document each one's failure cause in a fixtures file, and use them as the canonical regression suite. Augment with synthetic fixtures for cases the dev DB does not exercise (ambiguity, parse_error, diacritics-only, subtitle-only). Matcher unit tests document the new normalization, fuzzy-compare, and alias-handling rules per success criterion 3.

### Retry-All UX (RETRY-01)
- **D-10:** No confirmation modal. Action fires immediately because retry is non-destructive (re-enqueue only; never deletes data). UI-SPEC already excludes destructive color and modal patterns.
- **D-11:** "Retry all failed" retries every book in `enrichment_status='failed'` (no filter, no pagination scope). Per-reason filter UI is deferred; can ship later without breaking changes.
- **D-12:** No application-level cap on the bulk operation. The polling worker drains jobs serially through the Phase 3 shared HTTP rate limiter, so the actual throughput is bounded by the worker, not the bulk enqueue. POLISH-01 just inserts rows.
- **D-13:** Feedback after action: Mantine notification (`notifications.show`) reads `Re-enqueued N books` (or `No failed books to retry`); the existing list-level SWR is force-revalidated immediately (`mutate(unmatchedBooksKey)`). The 5s SWR poll continues to surface row status transitions naturally per Phase 5 D-14. No server-side progress tracking.

### RETRY-02 Per-Row Behavior
- **D-14:** `ReEnrichButton variant="row"` (already shipped Phase 5) is hardened so that the post-action handler triggers `mutate()` on the unmatched-books list key (in addition to the per-book status key). Acceptance: the row's status changes (or it leaves the list) on the next render, no full page reload.

### POLISH-01 Bulk-Enqueue Helper (Claude's Discretion — see below)
- **D-15:** Helper `enqueueMany(bookMd5s: string[], options?: { force?: boolean })` lives next to `enqueue()` in `apps/server/src/enrichment/service.ts`. Single batched `INSERT ... ON CONFLICT DO NOTHING` over the input array, wrapped in one transaction with the status-gate updates. Returns `{ enqueued: number, skipped: number }`. Callers: the new `POST /api/enrichment/retry-all` endpoint plus any future batch operation. The single `enqueue()` is reimplemented as a thin wrapper over `enqueueMany([md5])` to eliminate divergence.

### Claude's Discretion
- **CD-1:** Schema migration shape (column type, position, naming convention). Follow the v1.0 pattern `*_source` columns established in Phase 7 (e.g. `reference_pages_source`); migration filename uses the existing timestamped convention.
- **CD-2:** HTTP endpoint shape for "Retry all failed" (likely `POST /api/enrichment/retry-all`, returning `{ enqueued, skipped }`). Routing details, request body, and Zod schema follow existing enrichment router patterns.
- **CD-3:** Where the `FailureReason` type is exported from (`@koinsight/common` if surfaced to the client; otherwise server-internal). Add to common if the inbox row type already crosses that boundary.
- **CD-4:** Index on `book.enrichment_status` (added in `20260425000000_book_enrichment_status_index.ts`) is sufficient for the "all failed" query; no additional index on `failure_reason` this phase.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 8 Locked Contracts
- `.planning/phases/08-failure-triage-smarter-matcher/08-UI-SPEC.md` — Visual contract: failure-reason badge palette/copy, retry-all button placement, no-modal pattern, accent reservation. Locks all UI tokens by inheriting Phase 5.
- `.planning/REQUIREMENTS.md` (POLISH-01, RETRY-01..04) — Requirement IDs and acceptance language.
- `.planning/ROADMAP.md` §"Phase 8" — Goal statement and four success criteria.

### Inherited Decisions
- `.planning/milestones/v1.0/phases/05-manual-edit-unmatched-inbox/05-UI-SPEC.md` — Phase 5 UI design system (Mantine v8.3.12, spacing/typography/color tokens). Phase 8 introduces zero new tokens.
- `.planning/PROJECT.md` — Vision, principles, key decisions table (provenance pattern, manual-edit stickiness, deterministic enrichment).

### Implementation Anchors
- `apps/server/src/enrichment/matcher.ts:28` — Existing `matchWork()` token-overlap matcher. D-06 layers fuzzy on top; D-05 adds ambiguity throw.
- `apps/server/src/enrichment/retry.ts:15` — Existing `classifyFailure()`. D-02 refactors return shape.
- `apps/server/src/enrichment/service.ts:16` — Existing `enqueue()`. D-15 reimplements over `enqueueMany`.
- `apps/server/src/enrichment/applier.ts:135` — `markTerminalFailure()`; site that writes `failure_reason` per D-01/D-02.
- `apps/web/src/pages/settings-page/unmatched-books-section.tsx` — Inbox UI; section-level retry-all button is added here. RETRY-02 row behavior already wired through `ReEnrichButton variant="row"`.
- `apps/server/src/db/migrations/20260425000000_book_enrichment_status_index.ts` — Existing index supporting the "all failed" query.

### v1.0 Patterns to Follow
- v1.0 Phase 7 (reference_pages provenance) — Per-field `*_source` column pattern referenced by D-01 (though `failure_reason` is a single keyed enum, not a free-text source string).
- Phase 4 Plan 03 enqueue service (Zod boundary, ON CONFLICT DO NOTHING dedup) — D-15 follows the same idioms.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `enqueue()` (service.ts:16) — Reused by `enqueueMany`; D-15 makes the single-call form a wrapper over the batch form.
- `classifyFailure()` (retry.ts:15) — Already centralizes error-shape inspection; extending its return shape keeps all classification logic in one place.
- `matchWork()` (matcher.ts:28) — Pure function, no DI required. Easy to layer fuzzy on top.
- `ReEnrichButton variant="row"` (Phase 5) — Already wired into the inbox; only needs a `mutate()` of the list key on success (D-14).
- `EnrichmentStatusCards` + `useUnmatchedBooks` SWR hook — List polling already in place; the section-level Retry-all only adds a button.
- Mantine `notifications.show` — Established Phase 5 pattern for action feedback (D-13).

### Established Patterns
- `*_source TEXT NULL` provenance columns on `book` (v1.0 Phase 7) — D-01 follows this convention even though the value space is a fixed enum, not a free-text source.
- Zod boundary validation at the route layer.
- ON CONFLICT DO NOTHING dedup on `enrichment_job` via the existing partial UNIQUE index on open states.
- D-14 SWR list-level polling at 5s; no per-row polling.

### Integration Points
- Migration directory: `apps/server/src/db/migrations/` (next timestamp).
- Enrichment router: `apps/server/src/enrichment/router.ts` — new `/api/enrichment/retry-all` endpoint.
- Web API client: `apps/web/src/api/enrichment.ts` — new helper to POST retry-all + invalidate `useUnmatchedBooks`.
- `@koinsight/common` types: extend `BookRow`/inbox row type with optional `failure_reason: FailureReason | null`.

</code_context>

<specifics>
## Specific Ideas

- **Failure-reason vocabulary** is locked verbatim by UI-SPEC: `no_match`, `ambiguous_match`, `network`, `parse_error`, `unknown` (display-only fallback for NULL). Server emits the same string keys. Frontend uses a single lookup table colocated with the badge component.
- **Retry-all copy** matches UI-SPEC tooltips: button label `Retry all failed`; toast `Re-enqueued N books` / `No failed books to retry`.
- **Real-DB fixture suite** is the canonical signal that the milestone goal ("8+ books currently stuck") is met. Document each of the 8 books' failure cause in the fixtures file so future debuggers see the test/reality mapping.
- **Dice >= 0.85** is intentionally conservative. Tune downward only if the regression suite shows real-world false negatives.

</specifics>

<deferred>
## Deferred Ideas

- Per-failure-reason filter on the inbox header (e.g., "Retry only network errors"). Useful UX, deferrable; the unfiltered Retry-all covers the milestone goal.
- Initial expansion/contraction in the matcher (J. R. R. <-> JRR). Will revisit if the real-DB fixtures reveal it.
- Server-side bulk progress tracking + inline progress bar. Worker pacing makes this unnecessary at current scale.
- Backfill `failure_reason` for the 8 legacy rows from existing `last_error` strings. The natural-on-retry path is simpler and equivalent for the user.
- Index on `book.failure_reason`. Not justified at current row counts.

</deferred>

---

*Phase: 08-failure-triage-smarter-matcher*
*Context gathered: 2026-04-27*

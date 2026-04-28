# Phase 8: Failure Triage & Smarter Matcher - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-27
**Phase:** 08-failure-triage-smarter-matcher
**Areas discussed:** failure_reason persistence (RETRY-04), Retry-all UX & scope (RETRY-01), Smarter matcher heuristics (RETRY-03)
**Areas skipped:** Bulk-enqueue helper shape (POLISH-01) — captured under Claude's Discretion.

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| failure_reason persistence (RETRY-04) | Where the column lives, classifyFailure mapping, legacy NULL handling, ambiguity emission | ✓ |
| Bulk-enqueue helper shape (POLISH-01) | Single batched insert vs loop; transaction; return value | |
| Retry-all UX & scope (RETRY-01) | Modal yes/no; filter dimension; cap; feedback shape | ✓ |
| Smarter matcher heuristics (RETRY-03) | Layer vs replace; rules; threshold; fixture source | ✓ |

---

## failure_reason persistence (RETRY-04)

### Q1: Where should `failure_reason` live?

| Option | Description | Selected |
|--------|-------------|----------|
| On book row | Add `book.failure_reason TEXT NULL`; matches v1.0 provenance pattern | ✓ |
| On enrichment_job row | Closer to classification site; needs join for inbox UI | |
| Both | Persist on job, mirror to book; most accurate, more code | |

**User's choice:** On book row (Recommended)

### Q2: How should classifyFailure map errors to a reason key?

| Option | Description | Selected |
|--------|-------------|----------|
| Extend classifyFailure to also return a reason | Refactor to `{ class, reason }`; centralizes inspection | ✓ |
| Separate function `deriveFailureReason(err)` | Keeps existing function unchanged; slight duplication | |

**User's choice:** Extend classifyFailure (Recommended)

### Q3: How to handle the 8 already-failed rows?

| Option | Description | Selected |
|--------|-------------|----------|
| Leave NULL, render as `unknown` | Zero migration risk; UI-SPEC already specifies the badge | ✓ |
| One-shot backfill from last_error string heuristics | Better initial UX, brittle parsing | |

**User's choice:** Leave NULL, render as `unknown` (Recommended)

### Q4: When does the matcher emit `ambiguous_match` vs `no_match`?

| Option | Description | Selected |
|--------|-------------|----------|
| Multiple top-3 candidates pass title+author rule -> ambiguous | Refuse to guess when ambiguous; matches UI-SPEC tooltip | ✓ |
| Only when high-confidence work key duplication detected | Stricter; needs fuzzy threshold | |
| Skip ambiguous classification this milestone | Always emit no_match when null | |

**User's choice:** Multiple top-3 candidates pass title+author rule (Recommended)

---

## Retry-all UX & scope (RETRY-01)

### Q1: Confirmation modal on Retry all?

| Option | Description | Selected |
|--------|-------------|----------|
| No modal, immediate action | Retry is non-destructive; matches per-row pattern | ✓ |
| Lightweight inline confirm | Button morphs to 'Are you sure?' | |
| Modal with count and explanation | Highest friction; clearest intent | |

**User's choice:** No modal, immediate action (Recommended)

### Q2: What does Retry all retry?

| Option | Description | Selected |
|--------|-------------|----------|
| All failed (no filter), reason filter UI later | Smallest viable phase scope | ✓ |
| Reason filter dropdown in same row | More UI; deferrable | |
| Only books on current page | Bounded; users with many failures must paginate | |

**User's choice:** All failed (no filter), with optional reason filter UI later (Recommended)

### Q3: Cap or throttle?

| Option | Description | Selected |
|--------|-------------|----------|
| No cap; rely on worker pacing | Worker drains serially through HTTP rate limiter | ✓ |
| Soft cap at 200 with continuation | Defensive; adds pagination logic | |
| Hard cap at 100 | Conservative; user must paginate | |

**User's choice:** No cap (Recommended)

### Q4: How does the section reflect that bulk retry happened?

| Option | Description | Selected |
|--------|-------------|----------|
| Toast + immediate SWR revalidate | Same pattern as RETRY-02 per-row | ✓ |
| Inline progress bar on section header | Requires server-side progress tracking | |
| No active feedback; rely on poll | Minimal UI | |

**User's choice:** Toast + immediate SWR revalidate (Recommended)

---

## Smarter matcher heuristics (RETRY-03)

### Q1: How aggressive vs today's token-overlap matcher?

| Option | Description | Selected |
|--------|-------------|----------|
| Layer fuzzy on top of token-overlap | Strict primary, fuzzy fallback; preserves all current matches | ✓ |
| Replace with single fuzzy scorer | Riskier; could regress current matches | |
| Keep strict; only add normalization | Smaller scope, lower payoff | |

**User's choice:** Layer fuzzy on top of token-overlap (Recommended)

### Q2: Which normalization/heuristic rules ship in Phase 8? (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| Diacritics fold (NFKD + strip combining marks) | `Resolução` = `Resolucao` | ✓ |
| Subtitle stripping after `:` or `—` | Handles 'Title: Subtitle' drift | ✓ |
| Last,First <-> First Last author swap | Required by phase goal | ✓ |
| Initial expansion/contraction | Useful but more brittle; deferred | |

**User's choice:** Diacritics + Subtitle stripping + Last,First swap (Recommended trio)

### Q3: Fuzzy similarity threshold and metric?

| Option | Description | Selected |
|--------|-------------|----------|
| Dice coefficient on bigrams >= 0.85 for title; author exact-after-normalize | Cheap, well-known; conservative threshold tunable | ✓ |
| Normalized Levenshtein <= 0.15 of length | Edit-distance based; similar precision | |
| Substring containment | Cheap, no real fuzzy power | |

**User's choice:** Dice >= 0.85 for title, author exact-after-normalize (Recommended)

### Q4: Where do matcher test fixtures come from?

| Option | Description | Selected |
|--------|-------------|----------|
| Real failed books from dev DB + synthetic edge cases | Canonical regression suite + coverage for cases dev DB lacks | ✓ |
| Synthetic only | Easier to share; no dev-data dependency | |
| Real failed only | Strict regression; misses unexercised rules | |

**User's choice:** Real failed + synthetic (Recommended)

---

## Wrap-up

### Q: Ready to write CONTEXT.md or explore more?

| Option | Description | Selected |
|--------|-------------|----------|
| Write CONTEXT.md | POLISH-01 + RETRY-02 SWR + schema shape captured as Claude's discretion | ✓ |
| Explore POLISH-01 helper shape | | |
| Explore schema migration | | |

**User's choice:** Write CONTEXT.md (Recommended)

---

## Claude's Discretion

- POLISH-01 bulk-enqueue helper shape: `enqueueMany(md5s, options)` next to existing `enqueue()`, batched ON CONFLICT DO NOTHING in one transaction, returns `{ enqueued, skipped }`. Single `enqueue()` becomes a thin wrapper.
- Schema migration shape (column type/name/position/index).
- HTTP endpoint for Retry all (likely `POST /api/enrichment/retry-all`).
- Whether `FailureReason` type lives in `@koinsight/common` or server-internal.
- No additional index on `failure_reason` this phase.

## Deferred Ideas

- Per-failure-reason filter on the inbox header (UX nicety).
- Initial expansion/contraction in matcher (J. R. R. <-> JRR).
- Server-side bulk progress tracking and inline progress bar.
- Backfill of `failure_reason` for the 8 legacy rows from existing `last_error` strings.
- Index on `book.failure_reason`.

# Phase 7: Reference Pages Enrichment - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md; this log preserves the alternatives considered.

**Date:** 2026-04-27
**Phase:** 07-reference-pages-enrichment
**Areas discussed:** Edition selection, Backfill data source, Fallback when NULL, Manual edit + source stamp

---

## Edition selection

### Q1: How should the enrichment pipeline pick the OL Edition that supplies number_of_pages?

| Option | Description | Selected |
|--------|-------------|----------|
| ISBN-first, fallback to cover_edition_key | (Recommended) ISBN-direct lookup if available, else cover_edition_key | (initial) |
| cover_edition_key only | Simpler, single path | |
| List all editions, pick first with pages | Walk `/works/{key}/editions.json` | |
| Median across editions | Use candidate's `number_of_pages_median` | |

**User's first choice:** ISBN-first, fallback to cover_edition_key.
**Notes:** Claude scouted the schema and confirmed there is NO `isbn` column on `book` today and KOReader sidecars do not surface ISBN to the server. ISBN-first is therefore not viable in Phase 7 without first adding ISBN ingestion (out of scope). Question re-asked without the ISBN branch.

### Q1b: Without an ISBN on the book row, which edition strategy?

| Option | Description | Selected |
|--------|-------------|----------|
| cover_edition_key from search | (Recommended) one extra HTTP call | ✓ |
| cover_edition_key, fallback to editions list | More coverage, more calls | |
| number_of_pages_median from search | Zero extra calls, edition-agnostic | |
| Defer until ISBN ingestion ships | Pull ISBN ingestion into Phase 7 | |

**User's choice:** cover_edition_key from search.

### Q2: When `cover_edition_key` is missing or its Edition has no `number_of_pages`, how should the worker behave?

| Option | Description | Selected |
|--------|-------------|----------|
| Leave NULL, success | (Recommended) finish bundle, leave field NULL, mark enriched | ✓ |
| Leave NULL, log structured 'no_pages' reason | Same plus observability | |
| Mark book partial-enriched | New schema state | |

**User's choice:** Leave NULL, success.

### Q3: What if the Edition fetch itself errors (404, 5xx, timeout)?

| Option | Description | Selected |
|--------|-------------|----------|
| Treat as transient, fail the whole job | Standard D-14 classifier | ✓ |
| Best-effort: swallow non-200, leave NULL, succeed | (Recommended) edition is polish | |

**User's choice:** Standard D-14 retry classification (edition errors flow through the existing retry pipeline; permanent 404 fails the whole book).
**Notes:** Claude flagged that a permanently broken `cover_edition_key` would now fail an otherwise-resolvable book. Decision recorded as a known consequence to surface in REVIEW.md.

---

## Backfill data source

### Q4: There's no OL response cache today. What's the backfill data source?

| Option | Description | Selected |
|--------|-------------|----------|
| Re-fetch Edition only | (Recommended) one HTTP call per book through shared limiter | ✓ |
| Add OL response cache | Bigger scope | |
| Enqueue refresh jobs | Wasteful re-walking | |
| Backfill via book_device.pages | Cheapest but wrong source | |

**User's choice:** Re-fetch Edition only.

### Q5: Which books does the backfill target?

| Option | Description | Selected |
|--------|-------------|----------|
| Enriched + NULL refs + non-manual + has work key | (Recommended) | ✓ |
| All non-manual books with work key | Includes pre-populated values | |

**User's choice:** Enriched + NULL refs + non-manual + has work key.

### Q6: How is the backfill triggered?

| Option | Description | Selected |
|--------|-------------|----------|
| One-shot npm script | (Recommended) ops-script pattern | ✓ |
| Boot-time hook | Phase 4 enqueue style | |
| Both | Two surfaces | |

**User's choice:** One-shot npm script.

---

## Fallback when NULL

### Q7: REFPAGES-04 drops COALESCE. What does every consumer do for books still NULL after enrichment?

| Option | Description | Selected |
|--------|-------------|----------|
| Read book.reference_pages directly, exclude NULLs from coverage | (Recommended) | ✓ |
| Helper function with device fallback | Single fallback in TS | |
| Backfill device pages with third source | Adds 'device' to CHECK | |

**User's choice:** Read directly, exclude NULLs.

### Q8: Stats consumers (stats-service, week-stats.tsx) also use book.reference_pages with implicit fallbacks. In scope?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, align all consumers | (Recommended) | ✓ |
| Yearly report only, doc the rest | | |

**User's choice:** Align all consumers.

### Q9: Books with NULL reference_pages will show 0 estimated pages-read in stats and per-book views. OK?

| Option | Description | Selected |
|--------|-------------|----------|
| OK - data quality matters | Surface the gap, manual edit recourse | ✓ |
| Keep device fallback at read-site only | Mixed: drop SQL COALESCE, keep TS fallback | |
| Switch to helper-with-fallback | Single helper with device fallback | |

**User's choice:** OK - data quality matters. Visibility tradeoff accepted.

---

## Manual edit + source stamp

### Q10: PUT /books/:bookId/reference_pages today doesn't stamp source. What happens on every PUT?

| Option | Description | Selected |
|--------|-------------|----------|
| Always stamp 'manual' | (Recommended) symmetric with v1.0 manual edits | |
| Stamp 'manual' only when value differs from OL | User-confirms-OL-value should not lock | ✓ |

**User's choice:** Stamp 'manual' only when value differs from current `book.reference_pages`. Equal-value PUT is a no-op.

### Q11: Should users be able to clear reference_pages back to NULL?

| Option | Description | Selected |
|--------|-------------|----------|
| Send 0 or null clears + resets source | (Recommended) symmetric with no-edit behavior | ✓ |
| No clear path in v1.1 | Sticky forever | |
| Unified clear via separate Reset button | Out of scope deferred | |

**User's choice:** PUT with null/0 clears value AND resets source to NULL.

### Q12: Should the existing manual-edit endpoint be retroactively treated? Books with reference_pages already populated today have NULL source.

| Option | Description | Selected |
|--------|-------------|----------|
| Leave NULL source untouched, treat as enrichment-writable | (Recommended) matches Phase 4 D-20 NULL semantics | ✓ |
| Migrate existing populated values to source='manual' | Conservative, blocks future enrichment | |

**User's choice:** Leave NULL source untouched.

---

## Claude's Discretion

(See CONTEXT.md `<decisions>` Claude's Discretion subsection.)

## Deferred Ideas

(See CONTEXT.md `<deferred>` section.)

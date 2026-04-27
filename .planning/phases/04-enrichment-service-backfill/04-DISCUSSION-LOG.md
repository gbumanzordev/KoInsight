# Phase 4: Enrichment Service + Backfill - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md; this log preserves the alternatives considered.

**Date:** 2026-04-24
**Phase:** 04-enrichment-service-backfill
**Areas discussed:** Worker model and lifecycle, Sync-path enqueue integration, Boot-time backfill + retry policy, Match strategy + confidence threshold

---

## Worker Model and Lifecycle

### Q1: How does the enrichment worker pick up jobs from the enrichment_job table?

| Option | Description | Selected |
|--------|-------------|----------|
| Polling loop | setTimeout loop, SELECTs oldest pending LIMIT 1 each tick. Simplest, predictable. | Yes |
| Event-driven wakeup | Worker sleeps; enqueue() and boot-backfill call worker.notify() to drain. | |
| Hybrid: polling + notify | Baseline poll plus notify() short-circuits on enqueue. | |

**User's choice:** Polling loop (Recommended)

### Q2: How is a job claimed atomically so a restarted worker does not double-process a row?

| Option | Description | Selected |
|--------|-------------|----------|
| Single UPDATE ... RETURNING | Atomic in SQLite, no FOR UPDATE needed. | Yes |
| In-memory mutex only | Rely on Bottleneck concurrency=1 plus module-level Promise chain. | |
| SELECT then UPDATE in a transaction | knex.transaction wrapping both statements. | |

**User's choice:** Single UPDATE ... RETURNING (Recommended)

### Q3: When does the worker start and how does it stop cleanly?

| Option | Description | Selected |
|--------|-------------|----------|
| Start in app.ts after migrations, SIGINT/SIGTERM shutdown | Explicit start, graceful shutdown flag. | Yes |
| Module-level singleton (auto-start on import) | Starts as a side-effect of import. | |
| Lazy start on first enqueue | Starts the first time enqueue() is called. | |

**User's choice:** Start in app.ts after migrations, SIGINT/SIGTERM shutdown (Recommended)

### Q4: How does the worker behave when the queue is empty?

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed interval poll | Constant interval setTimeout loop. | Yes |
| Exponential backoff on empty | Increase interval up to a cap when idle. | |
| Sleep forever, wake only on notify() | Requires event-driven wakeup path. | |

**User's choice:** Fixed interval poll (Recommended)

---

## Sync-path Enqueue Integration

### Q1: Where is enqueue(bookMd5) called relative to the sync transaction?

| Option | Description | Selected |
|--------|-------------|----------|
| Post-commit callback in request handler | After the sync tx commits, iterate affected md5s and call enqueue. | Yes |
| Inside the sync transaction (outbox-style) | INSERT INTO enrichment_job inside the same tx as the book write. | |
| DB trigger on book insert/update | SQLite trigger writes the enrichment_job row. | |

**User's choice:** Post-commit callback in request handler (Recommended)

### Q2: What identifies a book as needing (re)enrichment at sync time?

| Option | Description | Selected |
|--------|-------------|----------|
| New book OR enrichment_status IN ('pending', NULL) | Matches ENRICH-05 bootstrap predicate. | Yes |
| Every sync, unconditionally | Idempotency saves correctness, but wastes HTTP budget. | |
| Only brand new books (insert) | Cleanest signal, risks leaving books stuck. | |

**User's choice:** New book OR enrichment_status IN ('pending', NULL) (Recommended)

### Q3: How do we dedupe enqueue calls?

| Option | Description | Selected |
|--------|-------------|----------|
| Rely on the partial unique index | INSERT ... ON CONFLICT DO NOTHING. DB enforces one open job per book. | Yes |
| SELECT-then-INSERT in app code | Has a race window without a transaction. | |
| In-memory set of recently-enqueued md5s | Fast but loses safety across restarts. | |

**User's choice:** Rely on the partial unique index (Recommended)

### Q4: If enqueue writes fail, how does the sync handler react?

| Option | Description | Selected |
|--------|-------------|----------|
| Log and continue, do not fail the sync | Boot-backfill is the safety net. | Yes |
| Fail the sync request (propagate 500) | Violates ENRICH-04 never-inline rule. | |
| Retry inline with short backoff | Adds synchronous latency. | |

**User's choice:** Log and continue, do not fail the sync (Recommended)

---

## Boot-time Backfill + Retry Policy

### Q1: How does the boot-time backfill enqueue existing unenriched books?

| Option | Description | Selected |
|--------|-------------|----------|
| Single INSERT...SELECT into enrichment_job | Atomic, fast, no row iteration in Node. | Yes |
| Iterate books in app code and call enqueue() per row | O(N) round trips, observable in logs. | |
| Stream in batches | Unnecessary for SQLite on realistic library sizes. | |

**User's choice:** Single INSERT...SELECT into enrichment_job (Recommended)

### Q2: When does the backfill run relative to app.listen()?

| Option | Description | Selected |
|--------|-------------|----------|
| Deferred with setImmediate after app.listen() | Non-blocking; satisfies ENRICH-05. | Yes |
| Synchronous before app.listen() | Blocks server readiness. | |
| Lazy: first poll tick writes backfill | Muddies worker responsibilities. | |

**User's choice:** Deferred with setImmediate after app.listen() (Recommended)

### Q3: Max attempts ceiling and backoff for retryable failures?

| Option | Description | Selected |
|--------|-------------|----------|
| Max 5 attempts, exponential backoff | 10s, 20s, 40s, 80s, 160s via min(300, 2^(n-1) * 10). | Yes |
| Max 3 attempts, linear backoff | Tighter ceiling, faster to give up. | |
| Max 5 attempts, no backoff | Burns HTTP budget during outages. | |

**User's choice:** Max 5 attempts, exponential backoff (Recommended)

### Q4: What counts as a permanent failure?

| Option | Description | Selected |
|--------|-------------|----------|
| 4xx from OL + 'no match' outcome | Permanent; 5xx/timeout/circuit-open retryable. | Yes |
| Only 'no match' is permanent; 4xx retries | Wastes attempts on deterministic 404s. | |
| All failures retry until max-attempts | Conflates 'OL is down' with 'bogus ISBN'. | |

**User's choice:** 4xx from OL + 'no match' outcome (Recommended)

**Notes:** During CONTEXT.md drafting, clarified that an isolated `/isbn/` 404 should fall through to title+author search (common for KOReader epubs with bad metadata) before being marked permanent. The "permanent on 404" rule applies to `/works/{key}` 404 and the matcher returning zero candidates after search; an isolated `/isbn/` 404 with a successful search fallback is NOT a failure.

---

## Match Strategy + Confidence Threshold

### Q1: How does the enricher resolve a book to an OpenLibrary Work?

| Option | Description | Selected |
|--------|-------------|----------|
| ISBN first, fallback to title+author search | Uses OL-05 path (Work subjects). | Yes |
| Title+author search only | Noisier; many false positives. | |
| Parallel: try both, prefer ISBN hit | Doubles HTTP requests per book. | |

**User's choice:** ISBN first, fallback to title+author search (Recommended)

### Q2: What confidence rule marks a book enrichment_status='failed'?

| Option | Description | Selected |
|--------|-------------|----------|
| Deterministic token overlap | ISBN auto-accept; search requires title + first-author token overlap. | Yes |
| Numeric score with threshold | Harder to test and explain. | |
| Accept any top-1 search hit | Produces wrong enrichments. | |

**User's choice:** Deterministic token overlap (Recommended)

### Q3: Transaction boundary when applying an enriched bundle?

| Option | Description | Selected |
|--------|-------------|----------|
| Single knex.transaction wrapping all writes | All-or-nothing; crash-reset picks up partial attempts. | Yes |
| Separate transactions per domain | Creates half-applied states that break idempotency. | |
| No explicit transaction | Partial state visible on crash. | |

**User's choice:** Single knex.transaction wrapping all writes (Recommended)

### Q4: How is the Phase 1 D-12 author dedup-by-openlibrary_key handled?

| Option | Description | Selected |
|--------|-------------|----------|
| UPSERT by openlibrary_key, then by normalized name | Handles the common Phase 1 backfill-then-enrich case. | Yes |
| Insert a new author row every time, no merge | Violates D-12 spirit. | |
| Merge by openlibrary_key only; no name fallback | Creates duplicate rows for backfilled authors. | |

**User's choice:** UPSERT by openlibrary_key, then by normalized name (Recommended)

---

## Closing Check

**Question:** Ready for CONTEXT.md, or explore more gray areas?

**User's choice:** I'm ready for context (Recommended)

## Claude's Discretion

- Exact file layout inside `apps/server/src/enrichment/` (worker.ts vs service.ts vs matcher.ts vs applier.ts split).
- Logging library choice (console.* vs pino) for Phase 4 scope.
- Knex query-builder vs knex.raw for the ON CONFLICT ... WHERE partial-index form.
- Test file naming and granularity; fixture coverage beyond the Phase 3 pattern.
- Migration filename + timestamp for the `next_attempt_at` column.

## Deferred Ideas

- Scale-out worker (multi-process / PM2 cluster).
- Priority queue / Phase 5 user-triggered re-enrich jumping the queue.
- Env-var knobs for ENRICHMENT_MAX_ATTEMPTS, poll interval, backoff formula.
- Structured logging refactor app-wide.
- Bulk re-enrich all-books admin endpoint.
- Author merge UI for unifying duplicate authors with distinct OL keys.

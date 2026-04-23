# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-23)

**Core value:** Every book in the user's library has trustworthy, query-friendly metadata so the dashboard can produce meaningful yearly breakdowns by genre and author nationality without hand-curation.
**Current focus:** Phase 1 — Schema Foundations + Provenance

## Current Position

Phase: 1 of 6 (Schema Foundations + Provenance)
Plan: 3 of 7 in current phase
Status: In progress
Last activity: 2026-04-23 — Plan 01-03 complete (Migration 1: author + book_author tables with CHECK constraints, FKs, and partial unique index)

Progress: [████░░░░░░] 43%

## Performance Metrics

**Velocity:**
- Total plans completed: 3
- Average duration: ~1.3 min
- Total execution time: 0.07 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Schema Foundations + Provenance | 3 | 4 min | ~1.3 min |

**Recent Trend:**
- Last 5 plans: 01-01 (2 min), 01-02 (1 min), 01-03 (1 min)
- Trend: holding pace

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Wikidata P27 (via OL `remote_ids.wikidata`) is the only acceptable nationality source; LLM and bio-parsing rejected.
- Co-author nationality counts the primary author only (`position = 0`); no fractional credit, no toggle this milestone.
- "Book read in year Y" requires ≥95% pages reached by end of Y; page-time totals always include all reading.
- Per-field `*_source` provenance must land before any enrichment runs (Phase 1 blocks Phase 4).
- Manual edits are sticky: enrichment never overwrites a field whose `*_source = 'manual'`.
- Author parser: suffix merge (D-05) runs before LN-FN flip (D-04); flip only when original has commas only and merged segment count is exactly 2; segments with no letters are dropped.

### Pending Todos

None yet.

### Blockers/Concerns

- `mantine-form-zod-resolver` Zod 4 compatibility must be verified at install time in Phase 5; fallback is a manual resolver.
- OpenLibrary nationality coverage via Wikidata is empirically ~7% of authors; "Unknown" bucket is a first-class report category, not a gap to hide (addressed in Phase 6 success criteria).

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-04-23
Stopped at: Completed Plan 01-03 (Migration 1: author + book_author tables). Next: Plan 01-04 (Migration 2: create enrichment_job table).
Resume file: None

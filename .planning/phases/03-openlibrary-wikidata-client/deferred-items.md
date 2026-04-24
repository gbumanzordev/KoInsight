# Deferred Items (Phase 03)

Issues discovered during plan execution that are out-of-scope for the current task and have been logged for later triage.

## From 03-02 (country-codes, TDD)

### Pre-existing flaky test: `stats-service.test.ts > StatsService > mostPagesInADay`

- **File:** `apps/server/src/stats/stats-service.test.ts`
- **Symptom:** `SqliteError: UNIQUE constraint failed: page_stat.book_md5, page_stat.device_id, page_stat.page, page_stat.start_time` during fixture insertion.
- **Scope:** Wholly unrelated to plan 03-02 (enrichment/wikidata/country-codes). Plan 03-02 touches only pure-function code under `apps/server/src/enrichment/wikidata/` with no DB writes, no fixtures, no shared state with stats tests.
- **Status:** Pre-existing. Observed in worktree with only the 03-02 RED+GREEN commits applied on top of the phase base (`f836f28`).
- **Action:** Not fixed (SCOPE BOUNDARY). Recommend separate investigation — likely test-fixture non-determinism or missing cleanup in beforeEach.

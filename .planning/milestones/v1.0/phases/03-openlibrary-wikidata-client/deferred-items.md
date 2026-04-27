# Deferred Items (Phase 03)

Issues discovered during plan execution that are out-of-scope for the current task and logged for later triage.

## From 03-01 (HTTP infrastructure)

### Pre-existing import failure: `phase-02-schema.test.ts`

- **File:** `apps/server/src/db/migrations/__tests__/phase-02-schema.test.ts`
- **Symptom:** Fails to import `@koinsight/common/dist/genres/canonical-genres` under CJS migration tsconfig.
- **Pre-existing:** Yes, unrelated to Plan 03-01 HTTP infrastructure changes. Reproduces at base commit `f836f28`.
- **Scope:** Phase 02 follow-up; Plan 03-01 did not introduce this failure. Likely tied to the Phase 2 CJS/ESM workaround (dist subpath imports) interacting with vitest's separate module resolution.

## From 03-02 (country-codes, TDD)

### Pre-existing flaky test: `stats-service.test.ts > StatsService > mostPagesInADay`

- **File:** `apps/server/src/stats/stats-service.test.ts`
- **Symptom:** `SqliteError: UNIQUE constraint failed: page_stat.book_md5, page_stat.device_id, page_stat.page, page_stat.start_time` during fixture insertion.
- **Scope:** Wholly unrelated to plan 03-02 (enrichment/wikidata/country-codes). Plan 03-02 touches only pure-function code under `apps/server/src/enrichment/wikidata/` with no DB writes, no fixtures, no shared state with stats tests.
- **Pre-existing:** Observed in worktree with only the 03-02 RED+GREEN commits applied on top of phase base `f836f28`.
- **Action:** Not fixed (SCOPE BOUNDARY). Recommend separate investigation — likely test-fixture non-determinism or missing cleanup in beforeEach.

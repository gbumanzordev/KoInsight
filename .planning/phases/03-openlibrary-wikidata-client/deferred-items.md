# Deferred Items — Phase 03

## Pre-existing test failure (out of scope for Plan 03-01)

- **File:** apps/server/src/db/migrations/__tests__/phase-02-schema.test.ts
- **Symptom:** Fails to import `@koinsight/common/dist/genres/canonical-genres` under CJS migration tsconfig.
- **Pre-existing:** Yes, unrelated to Plan 03-01 HTTP infrastructure changes.
- **Scope:** Phase 02 follow-up; Plan 03-01 did not introduce this failure.

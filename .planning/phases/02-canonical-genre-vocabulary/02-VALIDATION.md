---
phase: 2
slug: canonical-genre-vocabulary
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-23
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x (server) + new vitest config in packages/common if tests land there |
| **Config file** | `apps/server/vitest.config.ts` (existing); `packages/common/vitest.config.ts` (Wave 0 if common owns tests) |
| **Quick run command** | `npm --workspace=server exec vitest run <path>` (or `--workspace=@koinsight/common` if tests land there) |
| **Full suite command** | `npm test` (Turbo pipeline across all workspaces with tests) |
| **Estimated runtime** | ~30s full server suite; ~2s map.test.ts alone |

---

## Sampling Rate

- **After every task commit:** Run the relevant test file only (`vitest run path/to/file.test.ts`)
- **After every plan wave:** Run full server suite (`npm --workspace=server test`)
- **Before `/gsd-verify-work`:** Full suite must be green; `npm run build` must pass across all workspaces
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | GENRE-01 | N/A | Exported CANONICAL_GENRES readonly array compiles; length in [60,80] | unit | `npm --workspace=@koinsight/common exec vitest run genres/canonical.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | GENRE-02 | N/A | mapOpenLibrarySubjects is pure, sync, returns CanonicalGenre[] | unit | `npm --workspace=@koinsight/common exec vitest run genres/map.test.ts` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 2 | SCHEMA-06 | N/A | Idempotent seed migration (migrate:latest twice is a no-op) | integration | `npm --workspace=server exec vitest run db/migrations/__tests__/phase-02-seed.test.ts` | ❌ W0 | ⬜ pending |
| 02-04-01 | 04 | 2 | GENRE-03, GENRE-04 | N/A | 20+ tests; zero-match returns []; denylist+alias behavior | unit | `npm --workspace=@koinsight/common exec vitest run genres/map.test.ts` | ❌ W0 | ⬜ pending |
| 02-05-01 | 05 | 3 | (dev tooling) | N/A | Dev seed `06_genres.ts` consumes CANONICAL_GENRES; `npm run seed` green | manual+integration | `npm run seed` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/common/vitest.config.ts` — minimal vitest config for common package (if tests land there per researcher recommendation)
- [ ] `packages/common/package.json` test script wired + Turbo `test` pipeline updated if needed
- [ ] `apps/server/src/db/migrations/__tests__/phase-02-seed.test.ts` — seed idempotency test stub
- [ ] `packages/common/genres/map.test.ts` + `map.fixtures.ts` — test file stubs with fixture placeholders
- [ ] Resolve 7 outstanding OL work IDs for fixture books (researcher open question #3) before test bodies are filled in

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Canonical list subjective coverage (60-80 entries feel "right" for this project's reading profile) | GENRE-01 | Editorial judgment, not a boolean test | Spot-check by running `npm run seed` and browsing the seeded `genre` table; confirm Fantasy/SF/Literary/History/Biography buckets all present |
| Denylist completeness | (derived from GENRE-02) | New marketing/format tags appear over time | Review the denylist list against a few fresh OL work responses during Phase 4 implementation; add entries as found |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (vitest config in common, test file stubs)
- [ ] No watch-mode flags (all vitest invocations use `run`)
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter after planner verification

**Approval:** pending

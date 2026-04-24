---
phase: 3
slug: openlibrary-wikidata-client
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-24
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.16 (already installed in apps/server) |
| **Config file** | apps/server/vitest.config.ts (globals: true, setup file runs db.migrate.latest + truncates — inherited cost, no effect on these pure HTTP tests) |
| **Quick run command** | `npm --workspace=server exec vitest run <test-path>` |
| **Full suite command** | `npm --workspace=server test` (runs `build:migrations` then `vitest run`) |
| **Estimated runtime** | ~5s per Phase 3 test file; full suite ~15s |

---

## Sampling Rate

- **After every task commit:** Run `npm --workspace=server exec vitest run <new test file path>`
- **After every plan wave:** Run `npm --workspace=server test` (full server suite)
- **Before `/gsd-verify-work`:** Full suite must be green with all Phase 3 tests included
- **Max feedback latency:** ~5s for per-task; ~15s for full suite

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | OL-02, OL-03, OL-04, WD-05 | T-03-02, T-03-04, T-03-05, T-03-06 | Deps pinned; UA built from controlled source; limiter + breaker factories exported | unit (typecheck + prettier) | `npx tsc -p apps/server/tsconfig.json --noEmit && npx prettier --check apps/server/src/enrichment/http/` | ❌ → created by Task | ⬜ pending |
| 3-01-02 | 01 | 1 | OL-02, OL-03, OL-04 | T-03-02, T-03-03 | UA on every call; 404 / 5xx / non-JSON classified to distinct error classes; breaker wraps limiter | unit | `npm --workspace=server exec vitest run src/enrichment/http/__tests__/` | ❌ → created by Task | ⬜ pending |
| 3-02-01 | 02 | 1 | WD-02 | T-03-07 | Pure lookup; historical entities return null per D-03 | unit (RED: tests exist + all fail) | `npm --workspace=server exec vitest run src/enrichment/wikidata/__tests__/country-codes.test.ts` expects RED | ❌ → created by Task | ⬜ pending |
| 3-02-02 | 02 | 1 | WD-02 | T-03-07, T-03-08 | 15 cases green; ≥30 entries; historical QIDs absent | unit (GREEN) | `npm --workspace=server exec vitest run src/enrichment/wikidata/__tests__/country-codes.test.ts` | ❌ → created by Task | ⬜ pending |
| 3-03-01 | 03 | 2 | OL-01, OL-05 | T-03-09, T-03-12 | Zod schemas with strict shape on load-bearing fields (key regex, Q-id regex); resolveJsonModule enabled | structural + typecheck | `npx tsc -p apps/server/tsconfig.json --noEmit && ls apps/server/src/open-library/fixtures/*.json | wc -l` expects 7 | ❌ → created by Task | ⬜ pending |
| 3-03-02 | 03 | 2 | OL-01, OL-02, OL-05 | T-03-01, T-03-09, T-03-10, T-03-11, T-03-12 | UA header on every call; path segments validated (SSRF); subjects asserted from Work not Edition | unit (fixtures) | `npm --workspace=server exec vitest run src/open-library/__tests__/open-library-client.test.ts` | ❌ → created by Task | ⬜ pending |
| 3-04-01 | 04 | 2 | WD-01, WD-02 | T-03-13, T-03-14 | Narrow Zod schema (no z.passthrough); datavalue optional; handcrafted + real fixtures both parse | structural + typecheck | `npx tsc -p apps/server/tsconfig.json --noEmit && ls apps/server/src/enrichment/wikidata/fixtures/*.json | wc -l` expects 10 | ❌ → created by Task | ⬜ pending |
| 3-04-02 | 04 | 2 | WD-03 | — | Pure resolver: 7 TDD cases (empty, single, deprecated, end-time, preferred, all-expired, novalue) | unit (RED then GREEN) | `npm --workspace=server exec vitest run src/enrichment/wikidata/__tests__/p27-resolver.test.ts` | ❌ → created by Task | ⬜ pending |
| 3-04-03 | 04 | 2 | WD-01, WD-02, WD-03, WD-04, WD-05 | T-03-01, T-03-13, T-03-14, T-03-16 | getEntity enforces /^Q[0-9]+$/; resolveP27Nationality handles cache hit, cache miss (fetches P297), historical-null path; singleton uses sharedHttpLimiter + USER_AGENT | unit (fixtures + stubbed fetch) | `npm --workspace=server exec vitest run src/enrichment/wikidata/__tests__/wikidata-client.test.ts` | ❌ → created by Task | ⬜ pending |
| 3-05-01 | 05 | 3 | OL-03, WD-05 | T-03-18 | Reference equality: openLibraryClient and wikidataClient share same Bottleneck instance; 10 alternating calls take ≥ 9 * minTime | unit (reference + timed) | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-03-shared-limiter.test.ts` | ❌ → created by Task | ⬜ pending |
| 3-05-02 | 05 | 3 | (cross-cutting invariant) | T-03-17 | Regex grep guard over 11 allow-listed Phase-3 files: no knex / db( / .insert( / .update( / .delete( | static (readFileSync + regex) | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-03-no-db-writes.test.ts` | ❌ → created by Task | ⬜ pending |
| 3-05-03 | 05 | 3 | OL-01, OL-05, WD-01, WD-04 | T-03-09, T-03-13 | End-to-end search → edition (empty subjects) → work (populated subjects) → author → P27-nationality composes and returns valid alpha-2 | integration (fixtures + stubbed fetch) | `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-03-integration.test.ts` | ❌ → created by Task | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 is rolled into each plan's own test files (each plan ships its own test file alongside the implementation). There is no separate Wave 0 plan because the test infrastructure (vitest 4.0.16) is already installed and the test patterns are already established by Phase 1 + Phase 2.

- [x] vitest framework — already installed
- [x] `vi.stubGlobal('fetch', ...)` pattern — introduced by Plan 03 as a new project pattern; no install required
- [x] `resolveJsonModule` — enabled in Plan 03 Task 1 (one-line tsconfig edit)
- [x] Fixture files — captured in Plan 03 Task 1 (7 OL fixtures) and Plan 04 Task 1 (10 Wikidata fixtures)
- [x] New deps (bottleneck, opossum, @types/opossum) — installed in Plan 01 Task 1

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | All Phase 3 behaviors have automated verification. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — every task has a vitest command
- [x] Wave 0 covers all MISSING references (rolled into per-plan test files)
- [x] No watch-mode flags (all commands use `vitest run`)
- [x] Feedback latency < 5s per task
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (awaiting developer review before execution begins)

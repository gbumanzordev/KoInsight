---
phase: 4
slug: enrichment-service-backfill
status: draft
nyquist_compliant: true
wave_0_complete: false  # flipped true after Plan 01 lands
created: 2026-04-24
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `04-RESEARCH.md` "Validation Architecture" section.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.16 (server workspace) |
| **Config file** | `apps/server/vitest.config.ts` |
| **Quick run command** | `npm --workspace=server exec vitest run apps/server/src/enrichment/__tests__/phase-04-*.test.ts` |
| **Full suite command** | `npm --workspace=server test` |
| **Estimated runtime** | ~5 seconds (server suite inc. Phase 4 additions) |

---

## Sampling Rate

- **After every task commit:** Run the quick command (Phase 4 files only, <5s)
- **After every plan wave:** Run the full server suite
- **Before `/gsd-verify-work`:** Full suite must be green; all 5 Success Criteria tests pass with explicit `-t` filters
- **Max feedback latency:** 5 seconds per-task, ~10 seconds per-wave

---

## Per-Task Verification Map

Populated by the planner per plan. Each task in every PLAN.md MUST name a Wave/Req/Test-Type row here. Rows here act as the Nyquist sampling ledger; any task without a row must be marked `<automated>` N/A with a Manual-Only entry below.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-T1 | 04-01 | 1 | ENRICH-06 | T-04-01,T-04-02 | migration adds next_attempt_at + index; truncate list fixed | infra | `npm --workspace=server run build:migrations && npm --workspace=server test` | ❌ W0 | ⬜ pending |
| 01-T2 | 04-01 | 1 | ENRICH-06..07 | T-04-03 | grep guard + fixtures + TDD anchors green | invariant | `vitest run phase-04-no-direct-http phase-04-matcher phase-04-retry` | ❌ W0 | ⬜ pending |
| 02-T1 | 04-02 | 2 | ENRICH-06 | T-04-04,T-04-05 | retry.classifyFailure + computeNextAttemptAt + truncateError | unit (pure) | `vitest run phase-04-retry` | ❌ W0 | ⬜ pending |
| 02-T2 | 04-02 | 2 | ENRICH-07 | T-04-06,T-04-07 | matcher.matchWork token-overlap D-17 | unit (pure) | `vitest run phase-04-matcher` | ❌ W0 | ⬜ pending |
| 03-T1 | 04-03 | 2 | ENRICH-01,ENRICH-04 | T-04-08,T-04-09,T-04-11 | enqueue D-07 predicate + D-08 dedup + D-09 log-and-swallow | unit (DB) | `vitest run phase-04-enqueue` | ❌ W0 | ⬜ pending |
| 03-T2 | 04-03 | 2 | ENRICH-05 | T-04-10 | runBackfill INSERT...SELECT + idempotency | unit (DB) | `vitest run phase-04-backfill` | ❌ W0 | ⬜ pending |
| 04-T1 | 04-04 | 3 | ENRICH-02,ENRICH-03,ENRICH-07 | T-04-13..T-04-18 | applyEnrichment transactional D-18/D-19/D-20 + markTerminalFailure D-15 | unit (DB+fetch) | `vitest run phase-04-applier` | ❌ W0 | ⬜ pending |
| 05-T1 | 04-05 | 4 | ENRICH-01,ENRICH-02,ENRICH-06,ENRICH-07 | T-04-19,T-04-20,T-04-23,T-04-24 | worker tick loop + crash recovery + retry schedule + shutdown | unit (timer+DB) | `vitest run phase-04-worker` | ❌ W0 | ⬜ pending |
| 05-T2 | 04-05 | 4 | ENRICH-04,ENRICH-05 | T-04-21,T-04-22 | app.ts + upload/koplugin post-commit enqueue wiring | integration (build+full suite) | `npm --workspace=server run build && npm --workspace=server test` | ❌ W0 | ⬜ pending |
| 05-T3 | 04-05 | 4 | ENRICH-04..06 | — | Manual boot + SIGINT smoke | checkpoint:human-verify | manual (checkpoint) | ❌ W0 | ⬜ pending |
| 06-T1 | 04-06 | 5 | ENRICH-01..07 | T-04-26,T-04-27 | End-to-end SC-1/3/4/5 coverage | integration (end-to-end) | `vitest run phase-04-integration` | ❌ W0 | ⬜ pending |
| 06-T2 | 04-06 | 5 | ENRICH-01..07 | — | Phase 4 closure gate | checkpoint:human-verify | manual (checkpoint) | ❌ W0 | ⬜ pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

Wave 0 MUST land before matcher/applier/worker implementation starts. All files are NEW; none exist yet. See `04-RESEARCH.md` section "Wave 0 Gaps" for detailed rationale.

- [ ] `apps/server/src/enrichment/constants.ts` — shared module constants (poll interval, max attempts, backoff formula)
- [ ] `apps/server/src/enrichment/__tests__/fixtures/` directory with at minimum one clear-match OL scenario (search, edition, work, author JSON)
- [ ] `apps/server/src/enrichment/__tests__/phase-04-matcher.test.ts` — green placeholder, drives TDD of matcher.ts
- [ ] `apps/server/src/enrichment/__tests__/phase-04-retry.test.ts` — pure-function tests for backoff arithmetic + classification
- [ ] `apps/server/src/enrichment/__tests__/phase-04-no-direct-http.test.ts` — grep guard (allow-list of Phase 4 new files; inverts Phase 3 no-DB-writes guard)
- [ ] `apps/server/test/setup/test-setup.ts` — append `author`, `book_author`, `enrichment_job` to the truncate list (RESEARCH Pitfall 2 fix)
- [ ] Phase 4 migration: `YYYYMMDDHHMMSS_add_next_attempt_at_to_enrichment_job.ts` adds `next_attempt_at TIMESTAMP NULL` + composite index `(status, next_attempt_at)`

Framework install: NONE REQUIRED (vitest 4.0.16 already present).

---

## Test Layer Map

| Layer | Covers | Isolation | Example File |
|-------|--------|-----------|--------------|
| Unit (pure) | matcher token-overlap rules, retry classification + backoff arithmetic, constants module | No DB, no fetch, no timers | `phase-04-matcher.test.ts`, `phase-04-retry.test.ts` |
| Unit (DB) | `enrichmentService.enqueue` dedup, D-07 predicate, D-08 ON CONFLICT, backfill INSERT...SELECT | Real `:memory:` SQLite via test-setup | `phase-04-enqueue.test.ts`, `phase-04-backfill.test.ts` |
| Unit (DB+fetch stub) | applier transactional apply, D-18 all-or-nothing, D-20 provenance guards, D-19 author merge | `:memory:` + `vi.stubGlobal('fetch')` | `phase-04-applier.test.ts` |
| Unit (timer) | worker tick loop, D-05 crash-recovery sweep, graceful shutdown, D-13 `next_attempt_at` | Fake timers + `:memory:` | `phase-04-worker.test.ts` |
| Integration (end-to-end) | full enqueue -> tick -> OL/WD fetch stubs -> DB state; idempotency (run twice); manual-wins | Fake timers + fetch stubs + `:memory:` | `phase-04-integration.test.ts` |
| Invariant (grep) | No direct HTTP in Phase 4 files | Static file read | `phase-04-no-direct-http.test.ts` |

---

## Success-Criteria-to-Test Mapping

| Success Criterion (ROADMAP Phase 4) | Test Type | Automated Command | Wave 0? |
|--------------------------------------|-----------|-------------------|---------|
| SC-1: sync returns within normal latency; worker picks up jobs and transitions to `enriched` or `failed` | Integration | `vitest run phase-04-integration.test.ts -t "enqueue -> tick"` | No (Wave 2+) |
| SC-2: boot against N unenriched books enqueues all N without blocking `app.listen`; worker drains | Unit (DB) + timer | `vitest run phase-04-backfill.test.ts` + `phase-04-worker.test.ts -t "drain"` | No |
| SC-3: two enrichment runs produce identical `book` / `book_author` / `book_genre` state | Integration | `vitest run phase-04-integration.test.ts -t "idempotent"` | No |
| SC-4: `genres_source='manual'` survives forced re-enrichment with different OL subjects | Integration | `vitest run phase-04-applier.test.ts -t "manual-wins"` | No |
| SC-5: crash mid-job -> restart resets `running`->`pending`; max-attempts ceiling -> `failed` + `last_error`; no-match -> `book.enrichment_status='failed'` | Unit (DB) + Integration | `vitest run phase-04-worker.test.ts -t "crash recovery"` + `phase-04-applier.test.ts -t "terminal failure"` | No |

---

## Requirement-to-Test Map

| Req ID | Behavior | Test Type | Automated Command |
|--------|----------|-----------|-------------------|
| ENRICH-01 | service + worker exist and wire together | Integration | `vitest run phase-04-integration.test.ts -t "enqueue"` |
| ENRICH-02 | serial in-process; idempotent | Integration | `vitest run phase-04-integration.test.ts -t "idempotent"` |
| ENRICH-03 | per-field provenance: manual sticky | Unit (DB+fetch) | `vitest run phase-04-applier.test.ts -t "manual-wins"` |
| ENRICH-04 | enqueue post-commit, not inline | Unit (DB) | `vitest run phase-04-enqueue.test.ts -t "post-commit"` |
| ENRICH-05 | boot backfill for pending+null | Unit (DB) | `vitest run phase-04-backfill.test.ts` |
| ENRICH-06 | crash recovery + max-attempts + last_error | Unit (DB) + timer | `vitest run phase-04-worker.test.ts -t "crash-recovery\|max-attempts"` |
| ENRICH-07 | no-match -> book.enrichment_status='failed' | Integration | `vitest run phase-04-applier.test.ts -t "no-match"` |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real OL + WD live-HTTP sanity on a dev deployment | ENRICH-01..07 | Automated suite stubs fetch; a single live smoke-check before merge confirms no Zod drift against real OL responses. | Boot server with `OPENAI_API_KEY` unset and an unenriched book in DB; observe `enrichment_job` transitions to `succeeded` and `book.enrichment_status='enriched'` within ~10s. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s per wave
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

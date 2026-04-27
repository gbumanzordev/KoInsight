---
phase: 04-enrichment-service-backfill
threats_total: 27
threats_closed: 27
threats_open: 0
asvs_level: 2
audit_date: 2026-04-24
---

# Phase 04 Security Audit, Enrichment Service + Backfill

## Executive Summary

All 27 threats in the Phase 04 register are closed. 19 mitigate-disposition threats are verified against shipped code in `apps/server/src/enrichment/` and `apps/server/src/app.ts`; 6 accept-disposition threats have documented rationale in the phase plans; 2 transfer-disposition threats are deferred to later phases per plan. No SUMMARY.md threat flag is unregistered, and no implementation gap was found.

## Threat Register

| ID | Category | Component | Disposition | Status | Evidence |
|----|----------|-----------|-------------|--------|----------|
| T-04-01 | Tampering | migrations/20260424120000_add_next_attempt_at_to_enrichment_job.ts | mitigate | CLOSED | Migration only calls `alterTable('enrichment_job')` adding `next_attempt_at` + composite index (lines 3-17) |
| T-04-02 | Integrity (tests) | test/setup/test-setup.ts | mitigate | CLOSED | Truncate list includes `author`, `book_author`, `enrichment_job` (line 10) |
| T-04-03 | Info disclosure | Logging | accept | CLOSED | Documented accept in 04-01-PLAN.md; logs use structured warn without secrets |
| T-04-04 | Availability (log flood) | retry.ts | mitigate | CLOSED | `truncateError` enforces `ENRICHMENT_LAST_ERROR_MAX=500` (retry.ts:41-43; constants.ts:4) |
| T-04-05 | Tampering | matcher.ts | mitigate | CLOSED | D-17 author-token rule enforced (matcher.ts:34-47) |
| T-04-06 | Availability | matcher.ts short tokens | accept | CLOSED | Documented accept in 04-02-PLAN.md; short-token drop locked by test |
| T-04-07 | DoS (ReDoS) | matcher.ts `normalizeTokens` | mitigate | CLOSED | Regexes `/[^\p{L}\p{N}\s]/gu` and `/\s+/` are linear, no nested quantifiers (matcher.ts:16-23) |
| T-04-08 | Injection | service.ts md5 validation | mitigate | CLOSED | Zod `/^[a-f0-9]{32}$/i` at enqueue boundary (service.ts:12, 17-21) |
| T-04-09 | Race / duplicate jobs | service.ts + schema | mitigate | CLOSED | `onConflict().ignore()` (service.ts:37-40) against partial UNIQUE `enrichment_job_book_md5_open_unique` (20260423221500_create_enrichment_job.ts:25) |
| T-04-10 | Availability (boot latency) | app.ts backfill | mitigate | CLOSED | `setImmediate(() => runBackfill(...))` inside listen callback (app.ts:47-53) |
| T-04-11 | Availability (sync path) | service.ts enqueue | mitigate | CLOSED | Try/catch swallows all errors with `console.warn` (service.ts:23-47) |
| T-04-12 | Auth (none in enqueue) | service.ts | accept | CLOSED | Documented accept in 04-03-PLAN.md; enrichment is internal post-sync, no external auth boundary |
| T-04-13 | Manual-override loss | applier.ts per-field guards | mitigate | CLOSED | `*_source !== 'manual'` gates on authors, genres, publication_year, original_language (applier.ts:115-164) |
| T-04-14 | Partial write | applier.ts transaction | mitigate | CLOSED | Entire apply wrapped in `knex.transaction` (applier.ts:93, 165-171) |
| T-04-15 | Availability (log flood) | applier.ts last_error | mitigate | CLOSED | `truncateError(rawMessage)` in `markTerminalFailure` (applier.ts:180-187) |
| T-04-16 | Dedup collision | author schema | mitigate | CLOSED | Phase 1 partial UNIQUE on `author.openlibrary_key`; upsertAuthor step 1 uses it (applier.ts:39-51) |
| T-04-17 | Auth/tenancy | applier cross-user writes | transfer | CLOSED | Transferred to future multi-user phase; single-tenant assumption documented in 04-04-PLAN.md |
| T-04-18 | Genre non-canonical drift | applier `whereIn(name, canonicalNames)` | accept | CLOSED | Documented accept in 04-04-PLAN.md; mapped canonical names tolerated by query |
| T-04-19 | Availability (infinite retry) | worker.ts + retry.ts | mitigate | CLOSED | `if (job.attempts >= ENRICHMENT_MAX_ATTEMPTS)` terminal (worker.ts:197-199); exponential backoff `computeNextAttemptAt` (retry.ts:36-39; constants.ts:3) |
| T-04-20 | Graceful shutdown | worker.ts stop() | mitigate | CLOSED | `stop()` flips flag, clears timer, awaits `currentJob` (worker.ts:72-91) |
| T-04-21 | Availability (sync path) | koplugin/upload enqueue | mitigate | CLOSED | Enqueue is post-commit and log-and-swallow; callers (upload-router.ts:56, koplugin-router.ts:78) rely on service.ts:23-47 |
| T-04-22 | Info disclosure | worker.ts logs | accept | CLOSED | Documented accept in 04-05-PLAN.md; no PII in error strings |
| T-04-23 | DoS (rate-limit bypass) | worker.ts HTTP clients | mitigate | CLOSED | Worker uses `openLibraryClient` / `wikidataClient`, both bound to `sharedHttpLimiter` singleton (open-library-client.ts:89, wikidata-client.ts:67); no new Bottleneck in worker.ts |
| T-04-24 | Resource leak (interval drift) | worker.ts scheduler | mitigate | CLOSED | `setTimeout` self-chain (worker.ts:53-56, 62-65); no `setInterval` anywhere in enrichment/ |
| T-04-25 | Auth (OPS/admin API) | worker.ts observability | transfer | CLOSED | Transferred to Phase 5 (worker ops API) per plan |
| T-04-26 | Info disclosure | OL/Wikidata upstream payloads | accept | CLOSED | Documented accept in 04-05-PLAN.md; only typed subsets persisted |
| T-04-27 | Test flake / timing | integration tests | mitigate | CLOSED | `vi.advanceTimersByTimeAsync` + `vi.useRealTimers()` in afterEach (phase-04-integration.test.ts:79-105) |

## Unregistered Flags

None. No SUMMARY.md `## Threat Flags` section contains an entry outside the T-04-01..T-04-27 register.

## Accepted Risks

| ID | Category | Rationale |
|----|----------|-----------|
| T-04-03 | Info disclosure in structured enqueue logs | Logs emit bookMd5 only; md5 is not PII and is already present in the sync payload path. Documented in 04-01-PLAN.md threat table. |
| T-04-06 | `normalizeTokens` drops tokens shorter than 3 characters | Trade-off against common initials noise; coverage gaps surface as no-match permanent failures (observable). Documented in 04-02-PLAN.md. |
| T-04-12 | Enqueue has no caller auth | Service is only invoked from already-authenticated post-commit paths (sync routes). No external entry. Documented in 04-03-PLAN.md. |
| T-04-18 | Non-canonical genre subjects are silently dropped by `whereIn(name, canonicalNames)` | Acceptable drift vs. the Phase 2 canonical mapping; rows simply get no genre rather than an incorrect one. Documented in 04-04-PLAN.md. |
| T-04-22 | Worker console logs may include OL/Wikidata keys | Keys are public identifiers; no PII or secrets. Documented in 04-05-PLAN.md. |
| T-04-26 | OL / Wikidata untrusted response content | Responses are parsed via typed/Zod-validated schemas in Phase 3 clients before touching enrichment code. Documented in 04-05-PLAN.md. |

## Transferred Risks

| ID | Transferred To | Note |
|----|----------------|------|
| T-04-17 | Future multi-user phase | Current single-tenant model means no cross-user apply risk; provenance guards cover same-user manual overrides. |
| T-04-25 | Phase 5 (worker ops / admin API) | No admin endpoint ships in Phase 4; observability threat model deferred with the surface. |

## Audit Trail

## Security Audit 2026-04-24

- Threats total: 27
- Threats closed: 27
- Threats open: 0
- ASVS level: 2
- Auditor: GSD secure-phase agent
- Scope: apps/server/src/enrichment/*, apps/server/src/app.ts, apps/server/src/db/migrations/20260424120000_*, apps/server/src/upload/upload-router.ts, apps/server/src/koplugin/koplugin-router.ts, apps/server/test/setup/test-setup.ts
- Outcome: SECURED. All mitigate threats have verifiable code evidence; accept and transfer dispositions match plan documentation.

---
phase: 08
slug: failure-triage-smarter-matcher
status: verified
threats_total: 8
threats_open: 0
threats_closed: 8
asvs_level: 1
created: 2026-04-27
---

# Phase 08 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail for the failure-triage + smarter-matcher work.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser -> Express API (`/api/enrichment/*`) | Self-hosted, single-user; no auth in v1.1 (CORS `*` per `apps/server/src/app.ts`) | JSON request bodies (retry-all empty `{}`), enrichment status counters, unmatched book rows incl. `failure_reason` |
| Express API -> SQLite (`book`, `enrichment_job`) | In-process Knex over `better-sqlite3` | `failure_reason` enum (closed CHECK constraint), `enrichment_status`, `last_error` (truncated) |
| Worker -> OpenLibrary (HTTP) | Outbound enrichment calls, classified into `FailureReason` on error | OL response payloads, network errors -> `classifyFailure` mapping |
| Server -> React SPA | Failure reasons rendered via closed lookup map in `FailureReasonBadge` | `FailureReason \| null` only (never raw server strings concatenated into JSX) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-08-01 | Spoofing/DoS | `POST /api/enrichment/retry-all` (unauth) | accept | v1.1 has no auth; CORS `*` per `apps/server/src/app.ts`. DoS bounded by `enqueueMany` worker pacing (D-12). Logged in Accepted Risks. | closed |
| T-08-02 | Injection (XSS) | `FailureReasonBadge` label render | mitigate | Closed lookup `FAILURE_REASON_MAP` at `apps/web/src/components/failure-reason-badge/failure-reason-badge.tsx:22-57`; defensive `?? unknown` fallback at line 66; `aria-label` built from local `cfg.label` only (line 75); no string concat from server `reason` into JSX text/attrs. Test: `apps/web/src/components/failure-reason-badge/failure-reason-badge.test.tsx`. | closed |
| T-08-03 | Tampering | `POST /retry-all` body | mitigate | `retryAllBodySchema = z.object({ force: z.boolean().optional() }).strict()` at `apps/server/src/enrichment/router.ts:58-62`; rejects unknown keys + non-boolean `force` with 400 (lines 64-69). Test: `apps/server/src/enrichment/__tests__/phase-08-retry-all-route.test.ts`. | closed |
| T-08-04 | Tampering | `enqueueMany` md5 array input | mitigate | `Md5Schema = z.string().regex(/^[a-f0-9]{32}$/i)` at `apps/server/src/enrichment/service.ts:17`; per-entry validation + warn-and-drop at lines 49-56; closed enum `status: 'pending'` literal on insert at line 105. Test: `apps/server/src/enrichment/__tests__/phase-08-enqueue-many.test.ts`. | closed |
| T-08-05 | DoS | `enqueueMany` on huge array | accept | D-12: no app-level cap; bounded by worker drain rate; SQLite handles thousands of rows in a single transaction. Logged in Accepted Risks. | closed |
| T-08-06 | Repudiation | `classifyFailure` mapping diverges from D-03 | mitigate | D-03 mapping table implemented at `apps/server/src/enrichment/retry.ts:27-60`; every row covered by `apps/server/src/enrichment/__tests__/phase-08-classify-failure.test.ts`. | closed |
| T-08-07 | Injection | `failure_reason` write to SQLite | mitigate | Knex parameterized `.update({ enrichment_status, failure_reason })` at `apps/server/src/enrichment/applier.ts:158-161`; `FailureReason` is a closed TypeScript union in `packages/common/types/enrichment.ts`; SQLite-level CHECK constraint `checkIn(['no_match', 'ambiguous_match', 'network', 'parse_error'])` at `apps/server/src/db/migrations/20260428000000_add_failure_reason_to_book.ts:13-14`. | closed |
| T-08-08 | Tampering | Client `postRetryAll` body | mitigate | Client always sends literal `{}` at `apps/web/src/api/enrichment.ts:61-67`; server enforces `.strict()` schema (T-08-03). Test: `apps/server/src/enrichment/__tests__/phase-08-retry-all-route.test.ts`. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-08-01 | T-08-01 | KoInsight v1.1 is a self-hosted, single-user dashboard with no authentication layer; CORS is intentionally `*` (see `apps/server/src/app.ts`). Adding auth to a single endpoint while the rest of the API is open provides no defense in depth. DoS is bounded by `enqueueMany` worker pacing (D-12) and SQLite write throughput. Re-evaluate if/when project introduces multi-user auth. | Phase 08 owner | 2026-04-27 |
| AR-08-02 | T-08-05 | Per D-12, no app-level cap on the md5 array passed to `enqueueMany`. The body is wrapped in a single transaction and inserts use `ON CONFLICT DO NOTHING`; SQLite handles thousands of rows comfortably. Worker drain rate provides natural backpressure downstream. Adding an arbitrary cap (e.g. 1000) would surprise users with large libraries during legitimate bulk retry operations. | Phase 08 owner | 2026-04-27 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-27 | 8 | 8 | 0 | gsd-secure-phase (Claude Opus 4.7) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-27

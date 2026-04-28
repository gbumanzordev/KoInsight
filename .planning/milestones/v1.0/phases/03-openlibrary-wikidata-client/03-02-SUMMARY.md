---
phase: 03-openlibrary-wikidata-client
plan: 02
subsystem: enrichment/wikidata
tags: [wikidata, country-codes, iso-3166, tdd, pure-function]
requires: []
provides:
  - COUNTRY_QID_TO_ALPHA2
  - countryQidToAlpha2
  - cacheCountryQidAlpha2
affects: []
tech_stack:
  added: []
  patterns:
    - "as const satisfies Record<string,string> (compile-time string-literal typing)"
    - "Runtime Map seeded from frozen static object (cache-through without mutation)"
key_files:
  created:
    - apps/server/src/enrichment/wikidata/country-codes.ts
    - apps/server/src/enrichment/wikidata/__tests__/country-codes.test.ts
  modified: []
decisions:
  - "D-03 honored: historical entities (USSR/GDR/Czechoslovakia/Yugoslavia) omitted from map, resolve to null, routed to Phase 6 Unknown bucket."
  - "D-05 honored: hand-curated 32-entry map; no i18n-iso-countries dep."
  - "Runtime cache seeded from Object.entries at module load; writes never mutate the frozen static."
metrics:
  duration_seconds: 151
  completed: 2026-04-24
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 3 Plan 2: Country Codes (Wikidata QID -> ISO 3166-1 alpha-2) Summary

QID -> ISO 3166-1 alpha-2 pure lookup with 32-entry hand-curated static map plus runtime cache seed, delivered via TDD RED -> GREEN.

## Objective Recap

WD-02 requires normalizing Wikidata P27 country-of-citizenship results to ISO 3166-1 alpha-2 codes before persistence. Per D-03 (locked), historical entities (USSR, GDR, Czechoslovakia, Yugoslavia) must resolve to null rather than successor-state mapping. Per D-05 (locked), the map is hand-curated (no i18n-iso-countries dependency, which lacks the QID direction anyway). Plan 04's WikidataClient will use `cacheCountryQidAlpha2` to populate cache entries after live P297 fetches on static-map misses.

## What Shipped

- **`apps/server/src/enrichment/wikidata/country-codes.ts`**
  - `COUNTRY_QID_TO_ALPHA2`: 32-entry frozen static map (Q30 US through Q794 IR), typed `as const satisfies Record<string, string>` for precise string-literal inference.
  - `countryQidToAlpha2(qid)`: pure synchronous lookup; returns null for unknown QIDs and for deliberately-omitted historical entities. No I/O.
  - `cacheCountryQidAlpha2(qid, alpha2)`: extends the runtime Map for Plan 04 P297-resolution write-through. Does not mutate the frozen static.
- **`apps/server/src/enrichment/wikidata/__tests__/country-codes.test.ts`**
  - 15 tests: 5 happy-path lookups, 4 historical-entity nulls, 1 unknown-QID null, 3 static-map invariants (size >=30, len==2, `/^[A-Z]{2}$/`), 2 cache behaviors (write-through, non-mutation).

## TDD Gate Compliance

- **RED gate (commit `f6ed2a1`)** — `test(03-02): add failing tests for country-code lookup`. All 15 tests failed with module-resolution error before any implementation existed.
- **GREEN gate (commit `bae608f`)** — `feat(03-02): implement QID -> ISO 3166-1 alpha-2 lookup with hand-curated map + cache`. All 15 tests pass; `tsc --noEmit` clean; `prettier --check` clean.
- **REFACTOR:** Not required. Implementation is trivial (one frozen literal, one Map, two functions); no duplication or clarity issue worth a third commit.

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| RED: 15 `it(` blocks in test file | PASS (`grep -c "it(" ... ` = 15) |
| RED: 15 tests fail with module-not-found | PASS |
| GREEN: all 15 tests pass | PASS |
| GREEN: `grep -cE "^\\s+Q[0-9]+:" country-codes.ts >= 30` | PASS (32 entries) |
| GREEN: historical QIDs absent from MAP entries | PASS (0 map entries; QIDs only in the D-03 explanatory comment) |
| GREEN: `tsc --noEmit` exits 0 | PASS |
| GREEN: `prettier --check` passes | PASS |
| Commit message prefixes: `test(03-02):`, `feat(03-02):` | PASS |

### Note on the "historical QID absent" grep

The plan's acceptance criterion reads `grep -E "Q15180|Q16957|Q33946|Q36704" ... returns 0 matches`. The stricter grep matches 1 line — but that one line is the D-03 explanatory comment on line 1, which the plan itself prescribes ("historical entities (USSR Q15180, GDR Q16957, ...)"). The documented intent of the invariant is "not present in the map," which is verified at zero via `grep -E "^\s+(Q15180|Q16957|Q33946|Q36704):"`. The tests (#6–#9) independently verify the behavior: `countryQidToAlpha2` returns null for all four historical QIDs.

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | `f6ed2a1` | `test(03-02): add failing tests for country-code lookup` |
| 2 | `bae608f` | `feat(03-02): implement QID -> ISO 3166-1 alpha-2 lookup with hand-curated map + cache` |

## Deviations from Plan

None. Plan executed exactly as written; RED -> GREEN cycle with no REFACTOR needed.

## Deferred Issues

- **Pre-existing flaky test** `apps/server/src/stats/stats-service.test.ts > StatsService > mostPagesInADay` fails with a SQLite UNIQUE constraint violation during fixture insertion. Wholly unrelated to 03-02 (different subsystem, no shared state, no fixtures, no DB writes from this plan). Logged in `.planning/phases/03-openlibrary-wikidata-client/deferred-items.md` per SCOPE BOUNDARY. Plan 03-02's targeted test run (`vitest run src/enrichment/wikidata/__tests__/country-codes.test.ts`) shows 15/15 pass cleanly.

## Known Stubs

None. The module is a complete, production-ready pure lookup. The `cacheCountryQidAlpha2` setter is an intended extension point consumed by Plan 04, not a stub.

## Threat Flags

None. The plan's `<threat_model>` correctly captured the surface: no trust boundaries, no I/O, no PII. Both STRIDE entries (T-03-07 cache tampering, T-03-08 info disclosure) are `accept` dispositions and remain accepted.

## Contracts Established for Downstream Plans

From `apps/server/src/enrichment/wikidata/country-codes.ts`:

```typescript
export const COUNTRY_QID_TO_ALPHA2: Readonly<Record<string, string>>;
export function countryQidToAlpha2(qid: string): string | null;
export function cacheCountryQidAlpha2(qid: string, alpha2: string): void;
```

Plan 04 (WikidataClient.resolveP27Nationality) consumes these:
1. For each P27 QID, call `countryQidToAlpha2(qid)`.
2. If non-null, persist directly.
3. If null, fetch the country entity, extract its P297 claim, then call `cacheCountryQidAlpha2(qid, alpha2)` so subsequent lookups for that QID are O(1) cache hits.
4. Historical entities (USSR/GDR/CZS/YU) will always return null and will NOT be fetched — Plan 04 should treat null returns as terminal for historical/unmappable entities and route to Phase 6 Unknown bucket.

## Self-Check

- `apps/server/src/enrichment/wikidata/country-codes.ts` — FOUND
- `apps/server/src/enrichment/wikidata/__tests__/country-codes.test.ts` — FOUND
- Commit `f6ed2a1` — FOUND
- Commit `bae608f` — FOUND

## Self-Check: PASSED

---
phase: 03-openlibrary-wikidata-client
plan: 04
subsystem: enrichment/wikidata
tags: [wikidata, p27, tdd, nationality, zod, iso-3166]

requires:
  - phase: 03-openlibrary-wikidata-client
    plan: 01
    provides: sharedHttpLimiter, createBreaker, typedFetch, USER_AGENT
  - phase: 03-openlibrary-wikidata-client
    plan: 02
    provides: countryQidToAlpha2, cacheCountryQidAlpha2

provides:
  - WikidataEntitySchema, P27ClaimSchema (narrow Zod)
  - resolveP27Claim(claims): pure P27 selection algorithm
  - WikidataClient.getEntity(qid) + WikidataClient.resolveP27Nationality(qid)
  - wikidataClient singleton wired to sharedHttpLimiter + USER_AGENT (WD-05)
affects: [03-05]

tech-stack:
  added: []
  patterns:
    - "Narrow Zod schema consuming only P27 + P297 (ignores ~200KB of unrelated entity data per Pitfall 4)"
    - "Pure claim-resolution function separated from I/O client — TDD-able with literal claim arrays"
    - "SSRF guard via /^Q[0-9]+$/ normalizeQid before any URL concatenation"
    - "Constructor-DI HttpDeps with module-level singleton sharing sharedHttpLimiter + USER_AGENT across OpenLibrary + Wikidata"

key-files:
  created:
    - apps/server/src/enrichment/wikidata/wikidata-schemas.ts
    - apps/server/src/enrichment/wikidata/p27-resolver.ts
    - apps/server/src/enrichment/wikidata/wikidata-client.ts
    - apps/server/src/enrichment/wikidata/__tests__/p27-resolver.test.ts
    - apps/server/src/enrichment/wikidata/__tests__/wikidata-client.test.ts
    - apps/server/src/enrichment/wikidata/fixtures/entity-Q42.json
    - apps/server/src/enrichment/wikidata/fixtures/entity-Q535.json
    - apps/server/src/enrichment/wikidata/fixtures/entity-Q142.json
    - apps/server/src/enrichment/wikidata/fixtures/entity-Q30.json
    - apps/server/src/enrichment/wikidata/fixtures/entity-no-p27.json
    - apps/server/src/enrichment/wikidata/fixtures/entity-deprecated-rank.json
    - apps/server/src/enrichment/wikidata/fixtures/entity-end-time.json
    - apps/server/src/enrichment/wikidata/fixtures/entity-preferred.json
    - apps/server/src/enrichment/wikidata/fixtures/entity-historical-ussr.json
    - apps/server/src/enrichment/wikidata/fixtures/entity-novalue.json
  modified:
    - apps/server/tsconfig.json  # resolveJsonModule enabled so fixture JSON imports typecheck

key-decisions:
  - "Trimmed the four live-captured Wikidata fixtures (Q42, Q535, Q142, Q30) to schema-relevant fields only (claims.P27 + claims.P297). Full responses were 316KB-1.5MB; trimmed files are 3-11KB. Schema accepts them unchanged because unknown keys are ignored."
  - "Renamed synthetic fixture entity IDs from QTEST* to Q90xx to satisfy the plan's own /^Q[0-9]+\\$/ SSRF guard used by normalizeQid. This is a test-hygiene fix; the QIDs have no semantic meaning."
  - "Enabled resolveJsonModule in apps/server/tsconfig.json — required for test files to type-import fixture JSON. Production code is unaffected."

requirements-completed: [WD-01, WD-02, WD-03, WD-04, WD-05]

duration: ~14min
completed: 2026-04-24
---

# Phase 3 Plan 04: WikidataClient + P27 Resolver Summary

TDD-driven P27 claim resolver plus WikidataClient with resolveP27Nationality that composes the shared HTTP infra (Plan 01) and country-code cache (Plan 02) into the full WD-01..WD-05 nationality contract.

## One-liner

Narrow Zod schemas + pure TDD-verified P27 resolver (deprecated drop, end-time drop, preferred pick, novalue drop) + WikidataClient wired to sharedHttpLimiter and USER_AGENT, exposing resolveP27Nationality(qid) that normalizes P27 to ISO 3166-1 alpha-2 with live P297 fallback on cache miss.

## Accomplishments

- wikidata-schemas.ts: WikidataEntitySchema + P27ClaimSchema — narrow, only P27/P297, datavalue optional for novalue snaktypes.
- 10 fixtures under fixtures/: 4 real (Q42 Douglas Adams, Q535 Victor Hugo, Q142 France, Q30 USA) trimmed to schema-relevant fields; 6 handcrafted (no-p27, deprecated-rank, end-time, preferred, historical-ussr, novalue) to exercise every P27 resolver branch.
- p27-resolver.ts: pure resolveP27Claim(claims) implementing the D-03 algorithm (drop deprecated, drop P582-qualified, drop snaktype novalue, then prefer preferred rank, return first-in-authoring-order QID or null).
- wikidata-client.ts: WikidataClient class + wikidataClient singleton. getEntity runs SSRF regex + EntityData URL shape + typedFetch with Zod parse. resolveP27Nationality chains entity fetch -> resolver -> countryQidToAlpha2 cache -> live P297 fetch + cacheCountryQidAlpha2 write-back.
- Module-level singleton wired to sharedHttpLimiter + USER_AGENT — Plan 05 will assert reference equality against OpenLibraryClient's limiter (WD-05).
- 14 new tests: 7 resolver + 7 client (URL + UA parity, SSRF rejection, preferred cache hit, no-P27 null, end-time surviving sibling, historical-USSR null via empty P297 response, unknown modern country with cache populate).

## Task Commits

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | Wikidata Zod schemas + 10 fixtures | `7358f85` | feat |
| 2 RED | Failing tests for P27 claim resolution | `e44362d` | test |
| 2 GREEN | P27 claim resolver implementation | `f94e810` | feat |
| 3 | WikidataClient + resolveP27Nationality + singleton wiring | `de6df16` | feat |

## TDD Gate Compliance

- **RED gate** (`e44362d`): 7/7 `resolveP27Claim` tests failed with `Cannot find module '../p27-resolver'`. Confirmed via vitest output before GREEN.
- **GREEN gate** (`f94e810`): 7/7 tests pass. Implementation is 23 lines, single pass over claims with two filters + one final rank preference step.
- **REFACTOR gate**: Not required. Resolver is trivially small; no duplication or clarity debt worth a third commit.

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| `ls fixtures/*.json \| wc -l` = 10 | PASS |
| `jq '.entities[].claims.P27 \| length'` on entity-end-time = 2 | PASS |
| `jq '.entities[].claims.P27[0].qualifiers.P582'` on entity-end-time non-null | PASS |
| `grep -c "it(" p27-resolver.test.ts` = 7 | PASS |
| `grep -E "rank === 'deprecated'\|P582\|datavalue" p27-resolver.ts` >= 3 | PASS (3 matches) |
| `grep "sharedHttpLimiter" wikidata-client.ts` = 1 | PASS |
| `grep "USER_AGENT" wikidata-client.ts` = 1 | PASS |
| `grep -E "countryQidToAlpha2\|cacheCountryQidAlpha2" wikidata-client.ts` >= 2 | PASS (2 matches) |
| All 14 wikidata tests green | PASS |
| Full server suite: 252/253 pass (1 skipped) | PASS |
| `npx tsc -p apps/server/tsconfig.json --noEmit` | PASS |
| Prettier clean | PASS |

## Requirements Verified

- **WD-01**: getEntity fetches the EntityData URL and returns a Zod-parsed entity — test "fetches the Wikidata EntityData URL for a valid QID" asserts the URL shape.
- **WD-02**: resolveP27Nationality returns ISO alpha-2 via country-codes cache for a pre-seeded country (Q183 -> DE) — test "returns alpha-2 when preferred claim resolves to a cached country QID".
- **WD-03**: 7 resolver TDD cases cover the full algorithm (empty, single-normal, deprecated drop, end-time drop with survivor, preferred over normal, all-expired null, novalue drop).
- **WD-04**: "returns null when author has zero P27 claims" test + historical-USSR test (Q15180 not in static map, live P297 returns empty) -> both null.
- **WD-05**: Singleton constructor receives `sharedHttpLimiter` + `USER_AGENT` — same references OpenLibraryClient consumes. Plan 05 will assert reference equality at module level.

## Deviations from Plan

1. **[Rule 1 - Bug] Synthetic fixture QIDs violated the plan's own SSRF regex**
   - **Found during:** Task 3 wikidata-client test execution.
   - **Issue:** The plan's test code invoked `client.resolveP27Nationality('QTESTPREF')`, `'QTESTUSSR'`, `'QAUTHOR'`, etc., but the plan also mandates `normalizeQid` enforce `/^Q[0-9]+$/`. Every non-SSRF-guard test failed with `Invalid Wikidata QID: QTESTPREF`.
   - **Fix:** Renamed synthetic QIDs in the 6 handcrafted fixtures and in the wikidata-client test file from `QTEST*` and `QAUTHOR`/`QXNEWCOUNTRY` to valid numeric `Q9001`..`Q9008`. Entity IDs inside fixtures updated in lockstep so `entity.entities[qid]` lookups resolve.
   - **Files modified:** 6 fixtures + wikidata-client.test.ts.
   - **Commit:** `de6df16` (bundled with Task 3, cited in its commit message).

2. **[Rule 3 - Blocking] tsconfig lacked resolveJsonModule**
   - **Found during:** Task 3 final typecheck.
   - **Issue:** Both `p27-resolver.test.ts` and `wikidata-client.test.ts` import fixture JSON files. `npx tsc --noEmit` emitted 9 `TS2732 Cannot find module '../fixtures/entity-*.json'` errors.
   - **Fix:** Added `"resolveJsonModule": true` to `apps/server/tsconfig.json`. Runtime was already fine (vitest resolves JSON natively) — this was purely a typecheck-path fix.
   - **Files modified:** `apps/server/tsconfig.json`.
   - **Commit:** `de6df16` (bundled with Task 3).

3. **Fixture size trimming** (not a deviation, but worth noting)
   - The plan's Task 1 Step 2a-d captured Q42/Q535/Q142/Q30 via live curl. Raw responses were 316KB-1.5MB. Per the plan's own note ("captured-real files above are large. To keep the repo small and deterministic... synthesize by trimming schema-declared fields"), I used `jq` to project each to `{entities.{id, claims.P27, claims.P297}}` only. Final sizes: 3-11KB. Schema parses them unchanged.

No new runtime dependencies were added. No Plan 01 or Plan 02 contracts were modified.

## Authentication Gates Encountered

None. Wikidata's EntityData endpoint is public; fixture capture succeeded with a generic User-Agent.

## Issues Encountered

- Initial Task 3 test run produced 5/7 client test failures (2 schemas + UA passed cleanly) due to the synthetic-QID / SSRF-regex mismatch described in Deviation 1. Fixed in-task per Rule 1.
- Initial Task 3 typecheck emitted TS2732 on every .json fixture import. Fixed in-task per Rule 3.

## Known Stubs

None. The resolveP27Nationality fallback path intentionally returns `null` for historical entities (D-03) — this is the correct terminal for the Phase 6 'Unknown' bucket, not a stub.

## Threat Flags

None. Surface matches the plan's threat model:
- T-03-01 (SSRF via QID arg): mitigated by `normalizeQid` regex; test "rejects invalid QID (SSRF guard)" asserts rejection for `Q30/../secret`.
- T-03-13 (schema drift): narrow Zod schema; datavalue is optional for novalue snaktypes.
- T-03-14 (200KB DoS): narrow schema discards body; opossum timeout + Bottleneck cap still apply via inherited HTTP infra.
- T-03-15, T-03-16: accepted per plan.

## Contracts Established for Downstream Plans

From `apps/server/src/enrichment/wikidata/wikidata-client.ts`:

```typescript
export class WikidataClient {
  constructor(deps: HttpDeps);
  getEntity(qid: string): Promise<WikidataEntity>;
  resolveP27Nationality(qid: string): Promise<string | null>;
}
export const wikidataClient: WikidataClient;
```

Plan 05 can:
1. Assert `wikidataClient['deps'].limiter === openLibraryClient['deps'].limiter` for WD-05 reference-equality invariant.
2. Import `wikidataClient` directly and trust the shared rate limiter will serialize cross-upstream calls.
3. Treat `resolveP27Nationality(qid) === null` as terminal (no P27, all-expired, historical, or country with no P297) -> route to Unknown bucket.

## Self-Check

Files created verified present:
- apps/server/src/enrichment/wikidata/wikidata-schemas.ts — FOUND
- apps/server/src/enrichment/wikidata/p27-resolver.ts — FOUND
- apps/server/src/enrichment/wikidata/wikidata-client.ts — FOUND
- apps/server/src/enrichment/wikidata/__tests__/p27-resolver.test.ts — FOUND
- apps/server/src/enrichment/wikidata/__tests__/wikidata-client.test.ts — FOUND
- 10 fixtures under fixtures/ — FOUND

Commits verified in `git log --oneline`:
- 7358f85 (Task 1) — FOUND
- e44362d (Task 2 RED) — FOUND
- f94e810 (Task 2 GREEN) — FOUND
- de6df16 (Task 3) — FOUND

Verification commands:
- `npm --workspace=server exec vitest run src/enrichment/wikidata/__tests__/`: 3 files, 29 tests passing (7 p27-resolver + 7 wikidata-client + 15 pre-existing country-codes).
- `npm --workspace=server exec vitest run`: 252 passed, 1 skipped across 26 test files.
- `npx tsc -p apps/server/tsconfig.json --noEmit`: exit 0.
- Prettier clean on apps/server/src/enrichment/wikidata/ and apps/server/tsconfig.json.

## Self-Check: PASSED

---
*Phase: 03-openlibrary-wikidata-client*
*Plan: 04*
*Completed: 2026-04-24*

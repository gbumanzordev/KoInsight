---
phase: 07-reference-pages-enrichment
plan: 02
subsystem: open-library + enrichment matcher
tags: [openlibrary, schema, zod, http-client, refpages-01, refpages-02]
requires:
  - apps/server/src/open-library/open-library-schemas.ts (existing SearchDocSchema, WorkSchema)
  - apps/server/src/open-library/open-library-client.ts (existing typedFetch + normalizePath helpers)
  - apps/server/src/enrichment/matcher.ts (existing MatcherCandidate, matchWork)
provides:
  - SearchDocSchema.cover_edition_key (optional string) - survives Zod parse
  - searchWork OL fields list now requests cover_edition_key
  - MatcherCandidate.cover_edition_key (optional) - usable by worker after matchWork
  - WorkEditionsSchema + OpenLibraryWorkEditions type
  - OpenLibraryClient.getWorkEditions(workKey) - D-09 option b path
affects:
  - apps/server/src/enrichment/worker.ts (plan 03 reads candidate.cover_edition_key here)
  - apps/server/src/enrichment/backfill-reference-pages.ts (plan 04 calls getWorkEditions here)
tech-stack:
  added: []
  patterns: [zod-optional-extension, normalizePath-typedFetch-reuse]
key-files:
  created:
    - apps/server/src/enrichment/__tests__/fixtures/search-ender-with-edition-key.json
    - apps/server/src/enrichment/__tests__/phase-07-schema.test.ts
    - apps/server/src/open-library/__tests__/phase-07-work-editions.test.ts
  modified:
    - apps/server/src/open-library/open-library-schemas.ts
    - apps/server/src/open-library/open-library-client.ts
    - apps/server/src/enrichment/matcher.ts
decisions:
  - REFPAGES-01 prerequisite (research finding) closed: Zod-strip bug on cover_edition_key fixed
  - D-09 option b implemented as named OpenLibraryClient method (not inline raw fetch in backfill)
  - WorkEditionsSchema kept permissive (entries optional with default [], unknown entry fields stripped)
metrics:
  duration: ~10m
  tasks-completed: 2
  commits: 4 (2 RED test + 2 GREEN feat)
  tests-added: 7 (3 schema + 4 work-editions)
  completed-date: 2026-04-27
---

# Phase 7 Plan 02: OL Schema + getWorkEditions Summary

Closed the REFPAGES-01 prerequisite blocker (Zod silently stripping cover_edition_key) and added the D-09 option b client method getWorkEditions for plan 04's backfill consumer.

## What changed

### SearchDocSchema gains cover_edition_key (REFPAGES-01)

Before: `SearchDocSchema` did not declare `cover_edition_key`, so Zod stripped it during parse, making `candidate.cover_edition_key` always undefined at runtime even when OL returned a value.

After: `SearchDocSchema` includes `cover_edition_key: z.string().optional()`. The `searchWork` request also adds `cover_edition_key` to the `fields=` query param so OL actually sends it. `MatcherCandidate` now declares `cover_edition_key?: string` so the worker can read it after `matchWork` returns.

Verified by `phase-07-schema.test.ts`:
- Parsing `search-ender-with-edition-key.json` (new fixture) returns `docs[0].cover_edition_key === '/books/OL7641985M'`.
- Parsing `search-ender.json` (no key) returns `cover_edition_key === undefined` and does not throw.
- The constructed search URL contains `cover_edition_key` in the `fields=` param.

### WorkEditionsSchema and getWorkEditions (REFPAGES-02 / D-09 option b)

Added a permissive schema:

```ts
export const WorkEditionsSchema = z.object({
  entries: z.array(z.object({ key: z.string() })).optional().default([]),
});
export type OpenLibraryWorkEditions = z.infer<typeof WorkEditionsSchema>;
```

Added the method on `OpenLibraryClient`:

```ts
async getWorkEditions(workKey: string): Promise<OpenLibraryWorkEditions> {
  const path = normalizePath(workKey, '/works/');
  return typedFetch(
    `${OPEN_LIBRARY_API}${path}/editions.json?limit=1`,
    WorkEditionsSchema,
    this.deps,
  );
}
```

Reuses the existing `normalizePath` (SSRF guard from Phase 3) and `typedFetch` (rate limiter + circuit breaker), so plan 04's backfill inherits the shared 1 req/s limiter without any additional wiring.

Verified by `phase-07-work-editions.test.ts`:
- URL is exactly `https://openlibrary.org/works/OL27448W/editions.json?limit=1` for `/works/OL27448W` and bare `OL27448W` inputs.
- Response `{}` parses to `{ entries: [] }` via the Zod default.
- Unknown fields on entries are stripped.

## Tasks executed

| Task | Commit (RED) | Commit (GREEN) | Tests added |
| ---- | ------------ | -------------- | ----------- |
| 1: Extend SearchDocSchema, MatcherCandidate, searchWork fields | 0799644 | cef68fd | 3 |
| 2: Add WorkEditionsSchema and OpenLibraryClient.getWorkEditions | 985fe29 | 33f34e5 | 4 |

## Verification

- `npm --workspace=server exec vitest run src/enrichment/__tests__/phase-07-schema.test.ts` -> 3 passed.
- `npm --workspace=server exec vitest run src/open-library/__tests__/phase-07-work-editions.test.ts` -> 4 passed.
- Existing `src/open-library/__tests__/open-library-client.test.ts` -> 11 passed (no regression from fields= addition).
- All acceptance-criteria greps return the expected matches (1 schema decl, 1 fields-list entry, 1 matcher field, 2 WorkEditionsSchema lines, 1 getWorkEditions decl, 1 editions.json?limit=1 occurrence).

## Deviations from Plan

None. Plan executed exactly as written.

## Pre-existing TypeScript errors observed (out of scope)

`npx tsc -b apps/server` reports two errors that pre-date this plan and are unrelated to the schema/client changes:

- `apps/server/src/db/factories/book-factory.ts:8` - factory output is missing `reference_pages_source: FieldSource | null` on `FakeBook`. This will be resolved by plan 01 (schema migration + common type extension). Logged for the Phase 7 orchestrator; not in plan 02's scope.
- `apps/server/src/reports/__tests__/reports-router.test.ts:210` - unrelated null vs string mismatch present at the worktree base commit (`c2d037f`). Will need a separate fix.

Both errors exist on the base branch before any of this plan's edits, confirmed by `git stash && tsc -b` round-trip.

## Threat Flags

None. Threat T-07-03 (Tampering on OL response body) is mitigated as designed: `WorkEditionsSchema.parse()` rejects malformed payloads at the boundary; `entries[].key` is required to be a string when present.

## Hand-off to plan 03 / plan 04

- Plan 03 (`worker.ts`) can now write:
  ```ts
  const edition = candidate.cover_edition_key
    ? await openLibraryClient.getEdition(candidate.cover_edition_key)
    : null;
  ```
  The runtime value will be defined whenever OL returned it.
- Plan 04 (`backfill-reference-pages.ts`) can now call:
  ```ts
  const editions = await openLibraryClient.getWorkEditions(book.openlibrary_work_key);
  const editionKey = editions.entries[0]?.key;
  ```
  Default `[]` means the script never has to null-check `entries` itself.

## Self-Check: PASSED

All declared artifacts present:
- apps/server/src/open-library/open-library-schemas.ts (FOUND, modified)
- apps/server/src/open-library/open-library-client.ts (FOUND, modified)
- apps/server/src/enrichment/matcher.ts (FOUND, modified)
- apps/server/src/enrichment/__tests__/phase-07-schema.test.ts (FOUND)
- apps/server/src/open-library/__tests__/phase-07-work-editions.test.ts (FOUND)
- apps/server/src/enrichment/__tests__/fixtures/search-ender-with-edition-key.json (FOUND)

All commits present:
- 0799644 test(07-02): add failing tests for SearchDocSchema cover_edition_key
- cef68fd feat(07-02): preserve cover_edition_key through Zod and matcher
- 985fe29 test(07-02): add failing tests for OpenLibraryClient.getWorkEditions
- 33f34e5 feat(07-02): add WorkEditionsSchema and OpenLibraryClient.getWorkEditions

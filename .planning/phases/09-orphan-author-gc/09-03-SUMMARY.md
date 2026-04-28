---
phase: 09-orphan-author-gc
plan: 03
subsystem: server/admin
tags: [orphan-gc, cli, tsx, npm-script, vitest]
requires:
  - deleteOrphanAuthors (Plan 09-01)
  - shared db (apps/server/src/knex.ts)
provides:
  - parseDryRun (server/admin/orphan-author-gc-cli)
  - runCli (server/admin/orphan-author-gc-cli)
  - CliOutput (type)
  - npm script `gc:orphan-authors`
affects:
  - apps/server/src/admin/orphan-author-gc-cli.ts
  - apps/server/src/admin/orphan-author-gc-cli.test.ts
  - apps/server/package.json
tech-stack:
  added: []
  patterns:
    - Self-invocation guard via process.argv[1].endsWith(filename) (mirrors backfill-reference-pages.ts)
    - Exported testable runCli, separate from process.exit / db.destroy guard body
    - process.argv.includes('--dry-run') as the only flag parser (no commander/yargs/minimist)
    - db.destroy() awaited on both success and failure paths inside guard
key-files:
  created:
    - apps/server/src/admin/orphan-author-gc-cli.ts
    - apps/server/src/admin/orphan-author-gc-cli.test.ts
  modified:
    - apps/server/package.json
decisions:
  - D-11 honored: invoked via `npm --workspace=server run gc:orphan-authors`
  - D-12 honored: `--dry-run` is the only flag, parsed with process.argv.includes
  - D-13 honored: self-invocation guard mirrors backfill-reference-pages.ts (filename suffix check)
  - D-14 honored: exit 0 on success (including deleted=0), exit 1 on caught error; differs from backfill which always exits 0
  - D-16 honored: idempotency case present in CLI tests
metrics:
  duration_minutes: 2
  completed: 2026-04-28
  tasks: 3
  files_created: 2
  files_modified: 1
requirements: [AUTHGC-02, AUTHGC-03]
---

# Phase 09 Plan 03: Orphan Author GC CLI Summary

Shipped the `tsx` CLI surface for orphan-author GC: parses `--dry-run`, calls the Plan 09-01 core, prints `JSON.stringify({deleted, dry_run, sample})` to stdout, awaits `db.destroy()`, and propagates failure as exit code 1. Wired the `gc:orphan-authors` npm script alongside the sibling `backfill:reference-pages` entry. AUTHGC-02 closed; AUTHGC-03 CLI half closed (HTTP half is Plan 09-02, running in parallel).

## Signatures shipped

```typescript
// apps/server/src/admin/orphan-author-gc-cli.ts
export function parseDryRun(argv: string[]): boolean;

export type CliOutput = {
  deleted: number;
  dry_run: boolean;
  sample: Array<{ id: number; name: string }>;
};

export async function runCli(argv: string[]): Promise<CliOutput>;
```

```json
// apps/server/package.json scripts
"gc:orphan-authors": "tsx src/admin/orphan-author-gc-cli.ts"
```

## Exit-code matrix

| Path | Stdout | Stderr | Exit code | db.destroy |
| --- | --- | --- | --- | --- |
| Success (deleted >= 0) | JSON line `{deleted,dry_run,sample}` | (none) | 0 | awaited |
| Caught error | (none) | `gc:orphan-authors failed: <message>` | 1 | awaited best-effort |
| Imported as module | (none) | (none) | (does not exit) | not called |

## Test coverage

`npm --workspace=server exec vitest run src/admin/orphan-author-gc-cli.test.ts` reports 6 deterministic tests passing (1 skipped by design):

1. parseDryRun returns false when --dry-run is absent
2. parseDryRun returns true when --dry-run is present anywhere in argv
3. runCli (no flag) deletes orphans and returns dry_run:false
4. runCli (--dry-run) reports count without mutating
5. runCli is idempotent: second call returns deleted:0
6. importing the module did not destroy the shared db (self-invocation guard not firing on import)
7. spawned CLI end-to-end (skipped unless `GSD_RUN_CLI_E2E` is set; case-7 disposition: skipped per plan)

Case 7 disposition: **skipped** as designed (it.skipIf gate is the in-plan default to keep CI deterministic). The end-to-end smoke was instead validated manually:

```
$ npm --workspace=server run gc:orphan-authors -- --dry-run
{"deleted":1,"dry_run":true,"sample":[{"id":25,"name":"David Fernández"}]}
```

Exit 0, JSON parseable, dry-run did not mutate the dev DB.

## Commits

- d71a48e feat(09-03): add orphan-author-gc CLI entry
- 409a9a1 test(09-03): cover orphan-author-gc CLI semantics
- eef5d99 chore(09-03): add gc:orphan-authors npm script

## Verification

- `npm --workspace=server exec vitest run src/admin/orphan-author-gc-cli.test.ts`: 6 passed, 1 skipped (case 7).
- `npm --workspace=server run gc:orphan-authors -- --dry-run`: exit 0, prints JSON line containing `"dry_run":true`.
- `npm --workspace=server test` (full suite): 590 passed, 2 skipped, 1 pre-existing failure unrelated to this plan (logged in `deferred-items.md`).
- TypeScript on the new files is clean (`tsc --noEmit` reports zero errors mentioning `orphan-author-gc-cli`); pre-existing tsc errors in unrelated files are out of scope.

## Deviations from Plan

None. D-11 invocation, D-12 flag parser, D-13 guard pattern, D-14 exit-code semantics, and D-16 idempotency case are implemented exactly as specified. No new dependencies added (no commander/yargs/minimist).

## Deferred Issues

See `deferred-items.md` in this phase directory:

- Pre-existing failure in `apps/server/src/db/migrations/__tests__/phase-06-schema.test.ts` (Phase 06 page_stat index migrate up/down/up idempotency). Untouched by Plan 09-03; suggest a follow-up Phase 06 fix.

## Self-Check: PASSED

Verified files exist:
- apps/server/src/admin/orphan-author-gc-cli.ts: FOUND
- apps/server/src/admin/orphan-author-gc-cli.test.ts: FOUND
- apps/server/package.json `scripts["gc:orphan-authors"]`: FOUND with exact value `tsx src/admin/orphan-author-gc-cli.ts`

Verified commits exist on `gsd/phase-09-orphan-author-gc`:
- d71a48e: FOUND
- 409a9a1: FOUND
- eef5d99: FOUND

import { db } from '../knex';
import { deleteOrphanAuthors } from './orphan-author-gc';

// Phase 9 Plan 03 (AUTHGC-02, AUTHGC-03):
//   - D-11: invoked via `npm --workspace=server run gc:orphan-authors`.
//   - D-12: --dry-run is the only flag; parsed with process.argv.includes.
//   - D-13: self-invocation guard mirrors backfill-reference-pages.ts.
//   - D-14: exit 0 on success, exit 1 on unexpected error (differs from
//           backfill-reference-pages.ts which always exits 0).

export function parseDryRun(argv: string[]): boolean {
  return argv.includes('--dry-run');
}

export type CliOutput = {
  deleted: number;
  dry_run: boolean;
  sample: Array<{ id: number; name: string }>;
};

export async function runCli(argv: string[]): Promise<CliOutput> {
  const dryRun = parseDryRun(argv);
  const result = await deleteOrphanAuthors(db, { dryRun });
  return { deleted: result.deleted, dry_run: dryRun, sample: result.sample };
}

// Self-invocation guard: only runs when this file is the entry passed to tsx/node.
const invokedPath = process.argv[1] ?? '';
if (
  invokedPath.endsWith('orphan-author-gc-cli.ts') ||
  invokedPath.endsWith('orphan-author-gc-cli.js')
) {
  void (async () => {
    try {
      const output = await runCli(process.argv);
      console.log(JSON.stringify(output));
      await db.destroy();
      process.exit(0);
    } catch (error) {
      console.error(
        'gc:orphan-authors failed:',
        error instanceof Error ? error.message : error
      );
      try {
        await db.destroy();
      } catch {
        // best-effort pool drain; primary error is what matters
      }
      process.exit(1);
    }
  })();
}

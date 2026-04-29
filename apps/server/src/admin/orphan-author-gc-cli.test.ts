import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAuthor } from '../db/factories/author-factory';
import { createBook } from '../db/factories/book-factory';
import { db } from '../knex';
import { parseDryRun, runCli } from './orphan-author-gc-cli';

describe('orphan-author-gc-cli', () => {
  it('parseDryRun: returns false when --dry-run is absent', () => {
    expect(parseDryRun(['node', 'cli.ts'])).toBe(false);
  });

  it('parseDryRun: returns true when --dry-run is present anywhere in argv', () => {
    expect(parseDryRun(['node', 'cli.ts', '--dry-run'])).toBe(true);
    expect(parseDryRun(['node', 'cli.ts', '--dry-run', '--other'])).toBe(true);
    expect(parseDryRun(['node', 'cli.ts', '--other', '--dry-run'])).toBe(true);
  });

  it('runCli (no flag): deletes orphans and returns dry_run:false', async () => {
    const refA = await createAuthor(db, { name: 'Referenced A' });
    const bookA = await createBook(db, { title: 'Book A' });
    await db('book_author').insert({ book_md5: bookA.md5, author_id: refA.id, position: 0 });

    await createAuthor(db, { name: 'Orphan 1' });
    await createAuthor(db, { name: 'Orphan 2' });
    await createAuthor(db, { name: 'Orphan 3' });

    const output = await runCli(['node', 'cli.ts']);

    expect(output.deleted).toBe(3);
    expect(output.dry_run).toBe(false);
    expect(output.sample).toHaveLength(3);

    const count = await db('author').count('id as c').first();
    expect(count).toEqual({ c: 1 });
  });

  it('runCli (--dry-run): reports count without mutating', async () => {
    await createAuthor(db, { name: 'Orphan 1' });
    await createAuthor(db, { name: 'Orphan 2' });
    await createAuthor(db, { name: 'Orphan 3' });
    await createAuthor(db, { name: 'Orphan 4' });

    const output = await runCli(['node', 'cli.ts', '--dry-run']);

    expect(output.deleted).toBe(4);
    expect(output.dry_run).toBe(true);
    expect(output.sample).toHaveLength(4);

    const count = await db('author').count('id as c').first();
    expect(count).toEqual({ c: 4 });
  });

  it('runCli: idempotent, second call returns deleted:0', async () => {
    await createAuthor(db, { name: 'Orphan 1' });
    await createAuthor(db, { name: 'Orphan 2' });

    const first = await runCli(['node', 'cli.ts']);
    expect(first.deleted).toBe(2);

    const second = await runCli(['node', 'cli.ts']);
    expect(second.deleted).toBe(0);
    expect(second.dry_run).toBe(false);
    expect(second.sample).toEqual([]);
  });

  it('importing module did not destroy the shared db', async () => {
    // If the self-invocation guard fired on import, the test process would have
    // been torn down by db.destroy() + process.exit(0). The fact that this test
    // executes at all proves the guard correctly skipped the import path; the
    // assertion below proves the shared pool is still alive.
    const orphans = await db('author').count('id as c').first();
    expect(orphans).toBeDefined();
  });

  it.skipIf(!process.env.GSD_RUN_CLI_E2E)(
    'spawned CLI: exits 0 and prints JSON with dry_run:true when invoked through the npm script',
    () => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
      const result = spawnSync(
        'npm',
        ['--workspace=server', 'run', '--silent', 'gc:orphan-authors', '--', '--dry-run'],
        { cwd: repoRoot, encoding: 'utf-8' }
      );

      expect(result.status).toBe(0);
      const lastLine = result.stdout.trim().split('\n').pop();
      expect(lastLine).toBeDefined();
      const parsed = JSON.parse(lastLine!);
      expect(parsed.dry_run).toBe(true);
      expect(typeof parsed.deleted).toBe('number');
      expect(Array.isArray(parsed.sample)).toBe(true);
    }
  );
});

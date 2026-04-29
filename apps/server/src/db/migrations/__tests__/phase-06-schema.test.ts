import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import knexFactory, { Knex } from 'knex';

const MIGRATIONS_SRC_DIR = join(__dirname, '..');

const PHASE_6_STRUCTURE_ONLY_MIGRATIONS = [
  '20260425120000_add_page_stat_start_time_index.ts',
];

// Compiled migrations live at apps/server/test/dist/migrations (see tsconfig.migrations.json outDir).
const COMPILED_MIGRATIONS_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'test',
  'dist',
  'migrations'
);

describe('Phase 6 schema SCHEMA-07 structure-only invariant', () => {
  for (const filename of PHASE_6_STRUCTURE_ONLY_MIGRATIONS) {
    describe(filename, () => {
      const content = readFileSync(join(MIGRATIONS_SRC_DIR, filename), 'utf8');

      it('does not contain `fetch(`', () => {
        expect(content).not.toMatch(/\bfetch\(/);
      });

      it('does not contain axios import or call', () => {
        expect(content).not.toMatch(/\baxios\b/);
      });

      it('does not contain an https:// URL', () => {
        expect(content).not.toMatch(/https:\/\//);
      });

      it('does not iterate book or page_stat rows in JS', () => {
        // Disallowed: trx('book')... .forEach, for...of over knex/trx('book') or ('page_stat')
        expect(content).not.toMatch(/trx\(['"]book['"]\)\.[a-zA-Z]+\([^)]*\)\.forEach/);
        expect(content).not.toMatch(/trx\(['"]page_stat['"]\)\.[a-zA-Z]+\([^)]*\)\.forEach/);
        expect(content).not.toMatch(
          /for\s*\(\s*const\s+\w+\s+of\s+(await\s+)?(knex|trx)\(['"]book['"]\)/
        );
        expect(content).not.toMatch(
          /for\s*\(\s*const\s+\w+\s+of\s+(await\s+)?(knex|trx)\(['"]page_stat['"]\)/
        );
      });

      it('references the idx_page_stat_start_time index name', () => {
        // Sanity: this migration MUST create the named index expected by REPORT-04.
        expect(content).toMatch(/idx_page_stat_start_time/);
      });
    });
  }
});

describe('Phase 6 schema dynamic verification (migrate up/down/up idempotency)', () => {
  let knex: Knex;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'koinsight-phase6-'));
    const dbFile = join(tmpDir, 'test.db');
    knex = knexFactory({
      client: 'better-sqlite3',
      connection: { filename: dbFile },
      useNullAsDefault: true,
      migrations: {
        directory: COMPILED_MIGRATIONS_DIR,
        extension: 'js',
        loadExtensions: ['.js'],
      },
    });
    await knex.migrate.latest();
  });

  afterAll(async () => {
    await knex.destroy();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the idx_page_stat_start_time index after migrate.latest()', async () => {
    const indexes = await knex.raw("PRAGMA index_list('page_stat')");
    const names = (indexes as Array<{ name: string }>).map((r) => r.name);
    expect(names).toContain('idx_page_stat_start_time');
  });

  it('the index targets page_stat.start_time', async () => {
    const cols = await knex.raw("PRAGMA index_info('idx_page_stat_start_time')");
    const colNames = (cols as Array<{ name: string }>).map((c) => c.name);
    expect(colNames).toEqual(['start_time']);
  });

  it('migrate up -> down -> up is idempotent for the Phase 6 index migration', async () => {
    // Roll back migrations one at a time until the Phase 6 index is gone, then
    // re-apply the same number of migrations. We use migrate.down() (not
    // migrate.rollback()) because migrate.latest() applies all pending
    // migrations as a single batch on a fresh DB, so rollback() would unwind
    // every migration and earlier non-reversible migrations could fail. We
    // can't just call migrate.down() once because newer migrations may have
    // landed on top of the Phase 6 index migration since this test was
    // originally written.
    const indexExists = async () => {
      const rows = (await knex.raw("PRAGMA index_list('page_stat')")) as Array<{ name: string }>;
      return rows.some((r) => r.name === 'idx_page_stat_start_time');
    };

    let stepsDown = 0;
    while (await indexExists()) {
      await knex.migrate.down();
      stepsDown++;
      if (stepsDown > 50) throw new Error('runaway rollback');
    }
    expect(await indexExists()).toBe(false);

    for (let i = 0; i < stepsDown; i++) {
      await knex.migrate.up();
    }
    expect(await indexExists()).toBe(true);
  });
});

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import knexFactory, { Knex } from 'knex';

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

describe('Phase 7 schema REFPAGES-03 (reference_pages_source column)', () => {
  let knex: Knex;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'koinsight-phase7-'));
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

  it('adds reference_pages_source column with notnull = 0 and no default', async () => {
    const cols = (await knex.raw("PRAGMA table_info('book')")) as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const col = cols.find((c) => c.name === 'reference_pages_source');
    expect(col).toBeDefined();
    expect(col!.notnull).toBe(0);
    expect(col!.dflt_value).toBeNull();
  });

  it("accepts reference_pages_source = 'openlibrary'", async () => {
    await knex('book').insert({
      md5: 'phase7-openlibrary',
      title: 'OL Title',
      authors: 'OL Author',
      series: '',
      language: 'en',
      reference_pages_source: 'openlibrary',
    });
    const row = await knex('book').where({ md5: 'phase7-openlibrary' }).first();
    expect(row.reference_pages_source).toBe('openlibrary');
  });

  it("accepts reference_pages_source = 'manual'", async () => {
    await knex('book').insert({
      md5: 'phase7-manual',
      title: 'Manual Title',
      authors: 'Manual Author',
      series: '',
      language: 'en',
      reference_pages_source: 'manual',
    });
    const row = await knex('book').where({ md5: 'phase7-manual' }).first();
    expect(row.reference_pages_source).toBe('manual');
  });

  it('accepts reference_pages_source = NULL (omitted)', async () => {
    await knex('book').insert({
      md5: 'phase7-null',
      title: 'Null Title',
      authors: 'Null Author',
      series: '',
      language: 'en',
    });
    const row = await knex('book').where({ md5: 'phase7-null' }).first();
    expect(row.reference_pages_source).toBeNull();
  });

  it("rejects reference_pages_source = 'device' via CHECK constraint", async () => {
    await expect(
      knex('book').insert({
        md5: 'phase7-bad',
        title: 'Bad Title',
        authors: 'Bad Author',
        series: '',
        language: 'en',
        reference_pages_source: 'device',
      })
    ).rejects.toThrow(/CHECK constraint/i);
  });
});

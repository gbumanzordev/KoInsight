import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import knexFactory, { Knex } from 'knex';

const MIGRATIONS_DIR = join(__dirname, '..');

const STRUCTURE_ONLY_MIGRATIONS = [
  '20260423221400_create_author_and_book_author.ts',
  '20260423221500_create_enrichment_job.ts',
  '20260423221600_extend_book_columns.ts',
];

const DATA_MIGRATION_ALLOWED_TO_ITERATE_BOOK = '20260423221700_backfill_book_authors.ts';

// Compiled migrations live at apps/server/test/dist/migrations (see tsconfig.migrations.json outDir).
// This test file lives at apps/server/src/db/migrations/__tests__/, so four levels up to apps/server.
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

describe('Phase 1 schema SCHEMA-07 structure-only invariant (D-02)', () => {
  for (const filename of STRUCTURE_ONLY_MIGRATIONS) {
    describe(filename, () => {
      const content = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8');

      it('does not contain `fetch(`', () => {
        expect(content).not.toMatch(/\bfetch\(/);
      });

      it('does not contain axios import or call', () => {
        expect(content).not.toMatch(/\baxios\b/);
      });

      it('does not contain an https:// URL', () => {
        expect(content).not.toMatch(/https:\/\//);
      });

      it('does not iterate book rows in JS (no for...of / forEach over a book query)', () => {
        // Allowed: knex.select / knex.alterTable.
        // Disallowed: trx('book').select(...).then(rows => rows.forEach(...))
        //             for (const b of await trx('book')...)
        expect(content).not.toMatch(/trx\(['"]book['"]\)\.[a-zA-Z]+\([^)]*\)\.forEach/);
        expect(content).not.toMatch(
          /for\s*\(\s*const\s+\w+\s+of\s+(await\s+)?(knex|trx)\(['"]book['"]\)/
        );
      });
    });
  }

  it('migration 4 is the only migration that may iterate book', () => {
    const m4 = readFileSync(join(MIGRATIONS_DIR, DATA_MIGRATION_ALLOWED_TO_ITERATE_BOOK), 'utf8');
    // Sanity: migration 4 IS expected to iterate book.
    expect(m4).toMatch(/for\s*\(\s*const\s+\w+\s+of\s+books\)/);
  });
});

describe('Phase 1 schema dynamic verification', () => {
  let knex: Knex;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'koinsight-phase1-'));
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

  it('creates author, book_author, enrichment_job tables', async () => {
    const tables = await knex.raw(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('author','book_author','enrichment_job') ORDER BY name"
    );
    const names = (tables as Array<{ name: string }>).map((r) => r.name);
    expect(names).toEqual(['author', 'book_author', 'enrichment_job']);
  });

  it('adds 8 new columns to book', async () => {
    const cols = await knex.raw('PRAGMA table_info(book)');
    const names = (cols as Array<{ name: string }>).map((c) => c.name);
    const expected = [
      'enrichment_status',
      'openlibrary_work_key',
      'publication_year',
      'original_language',
      'authors_source',
      'genres_source',
      'publication_year_source',
      'original_language_source',
    ];
    for (const e of expected) {
      expect(names).toContain(e);
    }
  });

  it('preserves the book.authors column (SCHEMA-03)', async () => {
    const cols = await knex.raw('PRAGMA table_info(book)');
    const names = (cols as Array<{ name: string }>).map((c) => c.name);
    expect(names).toContain('authors');
  });

  it('partial unique index on enrichment_job rejects two open jobs per book_md5', async () => {
    const md5 = 'e'.repeat(32);
    await knex('book').insert({ md5, title: 'T', authors: '', series: '', language: '' });
    await knex('enrichment_job').insert({ book_md5: md5, status: 'pending' });
    await expect(
      knex('enrichment_job').insert({ book_md5: md5, status: 'pending' })
    ).rejects.toThrow(/UNIQUE/);
  });

  it('partial unique on author.openlibrary_key rejects duplicate non-null OL keys', async () => {
    await knex('author').insert({ name: 'A One', openlibrary_key: 'OL/A1' });
    await expect(
      knex('author').insert({ name: 'A Two', openlibrary_key: 'OL/A1' })
    ).rejects.toThrow(/UNIQUE/);
    // Two NULL openlibrary_key values must coexist (partial index excludes NULLs).
    await knex('author').insert({ name: 'A Three', openlibrary_key: null });
    await knex('author').insert({ name: 'A Four', openlibrary_key: null });
    const count = await knex('author')
      .whereNull('openlibrary_key')
      .count<{ c: number }[]>('* as c');
    expect(Number((count as any)[0].c)).toBeGreaterThanOrEqual(2);
  });

  it('CHECK constraint on enrichment_status rejects unknown values', async () => {
    const md5 = 'f'.repeat(32);
    await knex('book').insert({ md5, title: 'T', authors: '', series: '', language: '' });
    await expect(
      knex('book').where({ md5 }).update({ enrichment_status: 'bogus' })
    ).rejects.toThrow(/CHECK/);
  });

  it('newly inserted book defaults enrichment_status to pending and *_source to NULL', async () => {
    const md5 = 'g'.repeat(32);
    await knex('book').insert({ md5, title: 'T', authors: 'A', series: '', language: '' });
    const row = await knex('book').where({ md5 }).first();
    expect(row.enrichment_status).toBe('pending');
    expect(row.authors_source).toBeNull();
    expect(row.genres_source).toBeNull();
    expect(row.publication_year_source).toBeNull();
    expect(row.original_language_source).toBeNull();
  });
});

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import knexFactory, { Knex } from 'knex';
// Uses the same compiled-dist subpath that the seed migration uses. Plan 02-03
// documented this as a Rule 3 deviation: '@koinsight/common/genres' cannot be
// resolved by Node CJS require at runtime because common is `type: module` with
// no root exports map. Vitest runs on Vite's bundler resolver and could resolve
// the source path, but aligning with the seed migration keeps the two in lockstep.
import { CANONICAL_GENRES } from '@koinsight/common/dist/genres/canonical.js';

const MIGRATIONS_SRC_DIR = join(__dirname, '..');
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

// The Phase 2 seed migration. If the filename changes (later timestamp), update here.
const SEED_MIGRATION_FILENAME = '20260424090000_seed_canonical_genres.ts';
const SEED_MIGRATION_COMPILED = '20260424090000_seed_canonical_genres.js';

describe('Phase 2 schema static SCHEMA-07 extension', () => {
  const seedPath = join(MIGRATIONS_SRC_DIR, SEED_MIGRATION_FILENAME);
  const content = readFileSync(seedPath, 'utf8');

  it('seed migration file exists at the expected path', () => {
    expect(content.length).toBeGreaterThan(0);
  });

  it('does not contain `fetch(`', () => {
    expect(content).not.toMatch(/\bfetch\(/);
  });

  it('does not contain axios', () => {
    expect(content).not.toMatch(/\baxios\b/);
  });

  it('does not contain an https:// URL', () => {
    expect(content).not.toMatch(/https:\/\//);
  });

  it('does not iterate book rows', () => {
    expect(content).not.toMatch(
      /for\s*\(\s*const\s+\w+\s+of\s+(await\s+)?(knex|trx)\(['"]book['"]\)/
    );
    expect(content).not.toMatch(/trx\(['"]book['"]\)\.[a-zA-Z]+\([^)]*\)\.forEach/);
  });

  it('imports CANONICAL_GENRES from @koinsight/common (no local list)', () => {
    // The seed migration uses the explicit dist subpath '@koinsight/common/dist/genres/canonical.js'
    // per the Rule 3 deviation documented in 02-03-SUMMARY.md. We accept either that exact
    // path or the plan-originally-specified '@koinsight/common/genres' path, but in both
    // cases we enforce a single-source-of-truth: CANONICAL_GENRES must come from the
    // shared common package, not a local declaration.
    expect(content).toMatch(
      /import\s+\{\s*CANONICAL_GENRES\s*\}\s+from\s+['"]@koinsight\/common(?:\/dist)?\/genres(?:\/canonical(?:\.js)?)?['"]/
    );
    // No local `const GENRES = [` or `const CANONICAL_GENRES = [` inside the migration.
    expect(content).not.toMatch(/\bconst\s+(GENRES|CANONICAL_GENRES)\s*=\s*\[/);
  });

  it('uses onConflict(...).ignore() exactly once and does not contain DELETE or UPDATE', () => {
    const onConflictMatches = content.match(/\.onConflict\([^)]*\)\.ignore\(\)/g) ?? [];
    expect(onConflictMatches.length).toBe(1);
    expect(content).not.toMatch(/\.delete\(|\.del\(/);
    expect(content).not.toMatch(/\.update\(/);
  });
});

describe('Phase 2 schema no duplicate canonical list in migrations dir', () => {
  it('no other migration file declares a CANONICAL_GENRES or GENRES array literal', () => {
    const files = readdirSync(MIGRATIONS_SRC_DIR).filter(
      (f) => f.endsWith('.ts') && f !== SEED_MIGRATION_FILENAME
    );
    for (const f of files) {
      const body = readFileSync(join(MIGRATIONS_SRC_DIR, f), 'utf8');
      expect(body, `File ${f} must not redeclare the genre list`).not.toMatch(
        /\bconst\s+(GENRES|CANONICAL_GENRES)\s*=\s*\[/
      );
    }
  });
});

describe('Phase 2 schema dynamic verification (idempotent seed)', () => {
  let knex: Knex;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'koinsight-phase2-'));
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

  it('seeds every CANONICAL_GENRES entry into the genre table', async () => {
    const rows = await knex('genre').select('name');
    const names = (rows as Array<{ name: string }>).map((r) => r.name).sort();
    const expected = [...CANONICAL_GENRES].sort();
    for (const e of expected) {
      expect(names).toContain(e);
    }
  });

  it('genre row count equals CANONICAL_GENRES length on a fresh DB', async () => {
    const result = await knex('genre').count<{ c: number }[]>('* as c');
    expect(Number((result as Array<{ c: number }>)[0].c)).toBe(CANONICAL_GENRES.length);
  });

  it('CANONICAL_GENRES length is in the [60, 80] range per CONTEXT D-02', () => {
    expect(CANONICAL_GENRES.length).toBeGreaterThanOrEqual(60);
    expect(CANONICAL_GENRES.length).toBeLessThanOrEqual(80);
  });

  it('is idempotent: re-running the seed up() produces the same row count', async () => {
    // Load the compiled seed migration directly and invoke up() a second time.
    // Because it uses INSERT OR IGNORE, the second invocation must be a no-op.
    const seedCompiled = join(COMPILED_MIGRATIONS_DIR, SEED_MIGRATION_COMPILED);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(seedCompiled) as { up: (k: Knex) => Promise<void> };
    const before = await knex('genre').count<{ c: number }[]>('* as c');
    await mod.up(knex);
    const after = await knex('genre').count<{ c: number }[]>('* as c');
    expect(Number((after as Array<{ c: number }>)[0].c)).toBe(
      Number((before as Array<{ c: number }>)[0].c)
    );
  });

  it('is idempotent: genre name set is stable across repeated up() invocations', async () => {
    // Belt-and-suspenders: not just count, the exact name set must be unchanged.
    const seedCompiled = join(COMPILED_MIGRATIONS_DIR, SEED_MIGRATION_COMPILED);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(seedCompiled) as { up: (k: Knex) => Promise<void> };
    const before = (await knex('genre').select('name').orderBy('name')).map(
      (r: { name: string }) => r.name
    );
    await mod.up(knex);
    const after = (await knex('genre').select('name').orderBy('name')).map(
      (r: { name: string }) => r.name
    );
    expect(after).toEqual(before);
  });
});

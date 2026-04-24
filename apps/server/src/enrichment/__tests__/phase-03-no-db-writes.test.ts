import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Explicit allow-list of Phase-3-introduced files (NOT a glob). Files predating Phase 3,
// open-library-service.ts, open-library-router.ts, open-library-types.ts, are deliberately excluded.
// Phase 4 will introduce the enrichment worker, which IS allowed to write to the DB. This test
// guards the PHASE-3 surface only.
const SERVER_SRC = join(__dirname, '..', '..');

const PHASE_3_NEW_FILES: string[] = [
  // Plan 01 (HTTP infrastructure)
  'enrichment/http/rate-limiter.ts',
  'enrichment/http/circuit-breaker.ts',
  'enrichment/http/user-agent.ts',
  'enrichment/http/http-errors.ts',
  'enrichment/http/typed-fetch.ts',
  // Plan 02 (country codes)
  'enrichment/wikidata/country-codes.ts',
  // Plan 03 (OpenLibrary client)
  'open-library/open-library-schemas.ts',
  'open-library/open-library-client.ts',
  // Plan 04 (Wikidata client)
  'enrichment/wikidata/wikidata-schemas.ts',
  'enrichment/wikidata/p27-resolver.ts',
  'enrichment/wikidata/wikidata-client.ts',
];

describe('Phase 3 no-DB-writes invariant', () => {
  for (const rel of PHASE_3_NEW_FILES) {
    it(`${rel} contains no knex import, db( call, or insert/update/delete`, () => {
      const content = readFileSync(join(SERVER_SRC, rel), 'utf8');
      expect(content, `${rel} must not import or reference knex`).not.toMatch(/\bknex\b/);
      expect(content, `${rel} must not call db(...)`).not.toMatch(/\bdb\(/);
      expect(content, `${rel} must not call .insert(`).not.toMatch(/\.insert\(/);
      expect(content, `${rel} must not call .update(`).not.toMatch(/\.update\(/);
      expect(content, `${rel} must not call .delete(`).not.toMatch(/\.delete\(/);
    });
  }

  it('verifies every allow-listed file actually exists on disk', () => {
    for (const rel of PHASE_3_NEW_FILES) {
      const full = join(SERVER_SRC, rel);
      expect(() => readFileSync(full, 'utf8'), `Missing allow-listed file: ${rel}`).not.toThrow();
    }
  });
});

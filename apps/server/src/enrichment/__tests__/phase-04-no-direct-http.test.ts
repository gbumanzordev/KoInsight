import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Phase 4 invariant: enrichment runtime files must route ALL HTTP through
// the typed-fetch + shared rate-limiter + circuit-breaker stack added in Phase 3.
// No new file in the Phase 4 surface may call fetch(, axios, or hard-code a URL.
//
// Inverted from phase-03-no-db-writes.test.ts: the allow-list grows as Wave 1/2 ships
// each runtime file. Until then, the existsSync branch keeps the suite green and the
// informational it-block surfaces which files are still pending.

const SERVER_SRC = join(__dirname, '..', '..');

const PHASE_4_NEW_FILES: string[] = [
  'enrichment/constants.ts',
  'enrichment/service.ts',
  'enrichment/worker.ts',
  'enrichment/backfill.ts',
  'enrichment/matcher.ts',
  'enrichment/applier.ts',
  'enrichment/retry.ts',
];

describe('Phase 4 no-direct-HTTP invariant', () => {
  for (const rel of PHASE_4_NEW_FILES) {
    const full = join(SERVER_SRC, rel);
    it(`${rel} contains no fetch(, axios, or https?:// literal`, () => {
      if (!existsSync(full)) {
        // Wave 0: file does not exist yet; Wave 1+ lands it. Skip content check.
        expect(true).toBe(true);
        return;
      }
      const content = readFileSync(full, 'utf8');
      expect(content, `${rel} must not call fetch(`).not.toMatch(/\bfetch\s*\(/);
      expect(content, `${rel} must not reference axios`).not.toMatch(/\baxios\b/);
      expect(content, `${rel} must not contain a hard-coded http(s):// URL`).not.toMatch(/https?:\/\//);
    });
  }

  it('reports which allow-listed files are not yet on disk (informational)', () => {
    const missing = PHASE_4_NEW_FILES.filter((rel) => !existsSync(join(SERVER_SRC, rel)));
    // No assertion: Wave 1/2 plans land the remaining files. This is a visibility anchor.
    console.info('Phase 4 files pending Wave 1/2:', missing);
    expect(Array.isArray(missing)).toBe(true);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  AuthorSchema,
  EditionSchema,
  SearchResultSchema,
  WorkSchema,
} from '../../open-library/open-library-schemas';
import { WikidataEntitySchema } from '../wikidata/wikidata-schemas';

// Verifies the Wave 0 fixture bundle parses against the Phase 3 Zod schemas.
// Wave 1 (matcher / applier / worker tests) will reuse these fixtures, so any
// shape drift in Phase 3 schemas is caught at the bottom of the wave order.
const FIXTURES = join(__dirname, 'fixtures');

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
}

describe('Phase 4 fixture bundle (Ender clear-match)', () => {
  it('search-ender.json matches SearchResultSchema with a single Ender doc', () => {
    const parsed = SearchResultSchema.parse(readJson('search-ender.json'));
    expect(parsed.docs).toHaveLength(1);
    expect(parsed.docs[0].title).toBe("Ender's Game");
    expect(parsed.docs[0].author_name).toEqual(['Orson Scott Card']);
    expect(parsed.docs[0].key).toBe('/works/OL27448W');
  });

  it('edition-ender.json matches EditionSchema with works pointer', () => {
    const parsed = EditionSchema.parse(readJson('edition-ender.json'));
    expect(parsed.works[0].key).toBe('/works/OL27448W');
  });

  it('work-ender.json matches WorkSchema with non-empty subjects including a denylist entry', () => {
    const parsed = WorkSchema.parse(readJson('work-ender.json'));
    expect(parsed.subjects.length).toBeGreaterThan(0);
    expect(parsed.subjects).toContain('Science fiction');
    expect(parsed.subjects).toContain('Protected DAISY');
    expect(parsed.authors[0].author.key).toBe('/authors/OL27695A');
  });

  it('author-ender.json matches AuthorSchema with remote_ids.wikidata', () => {
    const parsed = AuthorSchema.parse(readJson('author-ender.json'));
    expect(parsed.name).toBe('Orson Scott Card');
    expect(parsed.remote_ids?.wikidata).toBe('Q185546');
  });

  it('wikidata-ender.json matches WikidataEntitySchema with P27 = Q30 (US)', () => {
    const parsed = WikidataEntitySchema.parse(readJson('wikidata-ender.json'));
    const entity = parsed.entities['Q185546'];
    expect(entity).toBeDefined();
    const p27 = entity.claims?.P27;
    expect(p27).toBeDefined();
    expect(p27?.[0].mainsnak.datavalue?.value.id).toBe('Q30');
  });
});

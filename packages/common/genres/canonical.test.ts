import { describe, expect, it } from 'vitest';

import { CANONICAL_GENRES } from './canonical';

describe('CANONICAL_GENRES', () => {
  it('has between 60 and 80 entries (D-02)', () => {
    expect(CANONICAL_GENRES.length).toBeGreaterThanOrEqual(60);
    expect(CANONICAL_GENRES.length).toBeLessThanOrEqual(80);
  });

  it('contains only unique entries', () => {
    expect(new Set(CANONICAL_GENRES).size).toBe(CANONICAL_GENRES.length);
  });

  it('stores every entry in Title Case (D-03) and uses ASCII only', () => {
    for (const g of CANONICAL_GENRES) {
      expect(g).toMatch(/^[A-Z]/);
      expect(g).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it('does not include blanket Fiction or Nonfiction umbrellas (D-13 pushes these to denylist)', () => {
    const banned = ['Fiction', 'Nonfiction', 'Non-fiction', 'Non fiction'];
    for (const b of banned) {
      expect(CANONICAL_GENRES as readonly string[]).not.toContain(b);
    }
  });
});

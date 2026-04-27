import { describe, expect, it } from 'vitest';

import { parseAuthors } from './parse-authors';

describe('parseAuthors', () => {
  it('returns [] for null input', () => {
    expect(parseAuthors(null)).toEqual([]);
  });

  it('returns [] for undefined input', () => {
    expect(parseAuthors(undefined)).toEqual([]);
  });

  it('returns [] for empty string input', () => {
    expect(parseAuthors('')).toEqual([]);
  });

  it('returns [] for whitespace-only input', () => {
    expect(parseAuthors('   ')).toEqual([]);
  });

  it('returns [] for pure punctuation input', () => {
    expect(parseAuthors('---')).toEqual([]);
  });

  it('returns one author for J.R.R. Tolkien (periods are not separators)', () => {
    expect(parseAuthors('J.R.R. Tolkien')).toEqual([{ name: 'J.R.R. Tolkien', position: 0 }]);
  });

  it('returns two authors in order for & separator', () => {
    expect(parseAuthors('Smith & Jones')).toEqual([
      { name: 'Smith', position: 0 },
      { name: 'Jones', position: 1 },
    ]);
  });

  it('returns three authors in order for ; separator', () => {
    expect(parseAuthors('A; B; C')).toEqual([
      { name: 'A', position: 0 },
      { name: 'B', position: 1 },
      { name: 'C', position: 2 },
    ]);
  });

  it('returns three authors without flipping for comma-separated triple', () => {
    expect(parseAuthors('A, B, C')).toEqual([
      { name: 'A', position: 0 },
      { name: 'B', position: 1 },
      { name: 'C', position: 2 },
    ]);
  });

  it('returns two authors without flipping when input has `and`', () => {
    expect(parseAuthors('Smith and Jones')).toEqual([
      { name: 'Smith', position: 0 },
      { name: 'Jones', position: 1 },
    ]);
  });

  it('returns one author for Ayn Rand (no whole-word `and` match)', () => {
    expect(parseAuthors('Ayn Rand')).toEqual([{ name: 'Ayn Rand', position: 0 }]);
  });

  it('flips LN-FN for Strunk, William', () => {
    expect(parseAuthors('Strunk, William')).toEqual([{ name: 'William Strunk', position: 0 }]);
  });

  it('flips LN-FN for Tolkien, J.R.R.', () => {
    expect(parseAuthors('Tolkien, J.R.R.')).toEqual([{ name: 'J.R.R. Tolkien', position: 0 }]);
  });

  it('merges suffix then flips for Strunk, Jr., William', () => {
    expect(parseAuthors('Strunk, Jr., William')).toEqual([
      { name: 'William Strunk Jr.', position: 0 },
    ]);
  });

  it('merges suffix without flipping when only 1 segment results (Smith, Jr.)', () => {
    expect(parseAuthors('Smith, Jr.')).toEqual([{ name: 'Smith Jr.', position: 0 }]);
  });

  it('drops trailing empty segment for Smith & Jones,', () => {
    expect(parseAuthors('Smith & Jones,')).toEqual([
      { name: 'Smith', position: 0 },
      { name: 'Jones', position: 1 },
    ]);
  });

  it('collapses internal whitespace for `  John   Doe  `', () => {
    expect(parseAuthors('  John   Doe  ')).toEqual([{ name: 'John Doe', position: 0 }]);
  });
});

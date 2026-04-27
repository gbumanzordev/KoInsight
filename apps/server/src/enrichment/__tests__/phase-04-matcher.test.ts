import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { matchWork, normalizeTokens, type MatcherCandidate } from '../matcher';

const enderSearch = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'search-ender.json'), 'utf8')
) as { docs: MatcherCandidate[] };

describe('normalizeTokens (D-17)', () => {
  it('lowercases + strips ASCII punctuation + drops short tokens', () => {
    expect(normalizeTokens("Ender's Game")).toEqual(['ender', 'game']);
  });

  it('drops tokens shorter than 3 chars (J. R. R. Tolkien case, D-17)', () => {
    expect(normalizeTokens('J. R. R. Tolkien')).toEqual(['tolkien']);
  });

  it('handles unicode letters via \\p{L}', () => {
    expect(normalizeTokens('Café Society')).toEqual(['café', 'society']);
  });

  it('strips unicode punctuation (smart quotes, em dashes, ellipsis)', () => {
    expect(normalizeTokens('“Hello” — world…')).toEqual(['hello', 'world']);
  });

  it('collapses extra whitespace', () => {
    expect(normalizeTokens('foo   bar\tbaz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('keeps numerals via \\p{N}', () => {
    expect(normalizeTokens('1984 George Orwell')).toEqual(['1984', 'george', 'orwell']);
  });

  it('returns empty array for all-short input', () => {
    expect(normalizeTokens('a b c')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(normalizeTokens('')).toEqual([]);
  });

  it('handles punctuation-only input', () => {
    expect(normalizeTokens('!!! ...')).toEqual([]);
  });
});

describe('matchWork (D-16/D-17)', () => {
  it('accepts a clear top-1 candidate (Ender fixture)', () => {
    const book = { title: "Ender's Game", authors: 'Orson Scott Card' };
    const result = matchWork(book, enderSearch.docs);
    expect(result).not.toBeNull();
    expect(result?.key).toBe('/works/OL27448W');
  });

  it('returns null when candidates list is empty', () => {
    expect(matchWork({ title: 'whatever', authors: 'someone' }, [])).toBeNull();
  });

  it('returns null when book.authors is null (D-16 step 2 bail)', () => {
    expect(matchWork({ title: "Ender's Game", authors: null }, enderSearch.docs)).toBeNull();
  });

  it('returns null when book.authors is empty string', () => {
    expect(matchWork({ title: "Ender's Game", authors: '' }, enderSearch.docs)).toBeNull();
  });

  it('returns null when candidate has no author_name array', () => {
    const candidates: MatcherCandidate[] = [{ title: "Ender's Game", key: '/works/OLX' }];
    expect(matchWork({ title: "Ender's Game", authors: 'Orson Scott Card' }, candidates)).toBeNull();
  });

  it('returns null when candidate has empty author_name array', () => {
    const candidates: MatcherCandidate[] = [
      { title: "Ender's Game", key: '/works/OLX', author_name: [] },
    ];
    expect(matchWork({ title: "Ender's Game", authors: 'Orson Scott Card' }, candidates)).toBeNull();
  });

  it('falls through top-1 fail to top-2 pass', () => {
    const candidates: MatcherCandidate[] = [
      // top-1: title pass but author mismatch
      { title: "Ender's Game", key: '/works/A', author_name: ['Someone Else'] },
      // top-2: full match
      { title: "Ender's Game", key: '/works/B', author_name: ['Orson Scott Card'] },
    ];
    const result = matchWork({ title: "Ender's Game", authors: 'Orson Scott Card' }, candidates);
    expect(result?.key).toBe('/works/B');
  });

  it('only inspects the top 3 candidates (4th is ignored even if perfect)', () => {
    const bad: MatcherCandidate = { title: 'Different Title', key: '/works/BAD', author_name: ['Nope'] };
    const good: MatcherCandidate = {
      title: "Ender's Game",
      key: '/works/GOOD',
      author_name: ['Orson Scott Card'],
    };
    const candidates: MatcherCandidate[] = [bad, bad, bad, good];
    const result = matchWork({ title: "Ender's Game", authors: 'Orson Scott Card' }, candidates);
    expect(result).toBeNull();
  });

  it('returns null when all top-3 fail', () => {
    const candidates: MatcherCandidate[] = [
      { title: 'Unrelated', key: '/works/1', author_name: ['Unknown'] },
      { title: 'Still Unrelated', key: '/works/2', author_name: ['Nobody'] },
      { title: 'Also Wrong', key: '/works/3', author_name: ['None'] },
    ];
    expect(matchWork({ title: "Ender's Game", authors: 'Orson Scott Card' }, candidates)).toBeNull();
  });

  it('uses only the first comma-split segment of book.authors (D-16 step 2)', () => {
    const candidates: MatcherCandidate[] = [
      { title: "Ender's Game", key: '/works/X', author_name: ['Orson Scott Card'] },
    ];
    // Primary = "Orson Scott Card"; secondary authors should not change behavior.
    const result = matchWork(
      { title: "Ender's Game", authors: 'Orson Scott Card, Aaron Johnston' },
      candidates
    );
    expect(result?.key).toBe('/works/X');
  });

  it('rejects candidate missing required title tokens', () => {
    const candidates: MatcherCandidate[] = [
      // Candidate title lacks "game"
      { title: 'Ender', key: '/works/Y', author_name: ['Orson Scott Card'] },
    ];
    expect(matchWork({ title: "Ender's Game", authors: 'Orson Scott Card' }, candidates)).toBeNull();
  });

  it('accepts candidate with extra title tokens (subset rule is one-way)', () => {
    const candidates: MatcherCandidate[] = [
      {
        title: "Ender's Game (Enderverse)",
        key: '/works/Z',
        author_name: ['Orson Scott Card'],
      },
    ];
    const result = matchWork({ title: "Ender's Game", authors: 'Orson Scott Card' }, candidates);
    expect(result?.key).toBe('/works/Z');
  });

  it('all-short-token book title (tokens < 3) trivially passes title; author still gates', () => {
    const candidates: MatcherCandidate[] = [
      { title: 'Some Long Title', key: '/works/Q', author_name: ['Orson Scott Card'] },
    ];
    const result = matchWork({ title: 'a b c', authors: 'Orson Scott Card' }, candidates);
    expect(result?.key).toBe('/works/Q');
  });

  it('author match is token-overlap, not exact-string (single-name overlap suffices)', () => {
    const candidates: MatcherCandidate[] = [
      { title: "Ender's Game", key: '/works/M', author_name: ['Card, Orson Scott'] },
    ];
    const result = matchWork({ title: "Ender's Game", authors: 'Orson Scott Card' }, candidates);
    expect(result?.key).toBe('/works/M');
  });
});

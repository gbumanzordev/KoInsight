import { describe, expect, it } from 'vitest';

// Phase 8 RED tests for D-05 (matcher throws AmbiguousMatchError when 2+ of the
// top-3 pass the strict rule) and the fuzzy-path equivalents per D-06/D-08.
// AmbiguousMatchError + NoMatchError are exported from matcher.ts in Wave 1.

import { matchWork, type MatcherCandidate } from '../matcher';
// @ts-expect-error: AmbiguousMatchError + NoMatchError land in Wave 1 (Plan 02)
import { AmbiguousMatchError, NoMatchError } from '../matcher';

describe('matchWork ambiguity (D-05)', () => {
  it('throws AmbiguousMatchError when 2 of top-3 pass the strict title+author rule', () => {
    const candidates: MatcherCandidate[] = [
      { title: "Ender's Game", key: '/works/A', author_name: ['Orson Scott Card'] },
      { title: "Ender's Game", key: '/works/B', author_name: ['Orson Scott Card'] },
      { title: 'Different', key: '/works/C', author_name: ['Nope'] },
    ];
    expect(() =>
      matchWork({ title: "Ender's Game", authors: 'Orson Scott Card' }, candidates)
    ).toThrow(AmbiguousMatchError);
  });

  it('returns the candidate when exactly 1 of top-3 passes strict', () => {
    const candidates: MatcherCandidate[] = [
      { title: 'Wrong', key: '/works/A', author_name: ['Other'] },
      { title: "Ender's Game", key: '/works/B', author_name: ['Orson Scott Card'] },
      { title: 'Also Wrong', key: '/works/C', author_name: ['Nobody'] },
    ];
    const result = matchWork(
      { title: "Ender's Game", authors: 'Orson Scott Card' },
      candidates
    );
    expect(result?.key).toBe('/works/B');
  });

  it('throws NoMatchError when 0 strict and 0 fuzzy candidates pass', () => {
    const candidates: MatcherCandidate[] = [
      { title: 'Totally Different', key: '/works/A', author_name: ['Nobody'] },
      { title: 'Also Wrong', key: '/works/B', author_name: ['Anonymous'] },
      { title: 'Still Wrong', key: '/works/C', author_name: ['Unknown'] },
    ];
    expect(() =>
      // @ts-expect-error: Wave 1 changes matchWork to throw NoMatchError instead of returning null
      matchWork({ title: "Ender's Game", authors: 'Orson Scott Card' }, candidates)
    ).toThrow(NoMatchError);
  });

  it('returns the fuzzy candidate when 0 strict pass but exactly 1 fuzzy passes', () => {
    // Diacritic-only difference: fuzzy normalization makes them match.
    const candidates: MatcherCandidate[] = [
      { title: 'Totally Different', key: '/works/A', author_name: ['Nobody'] },
      { title: 'Resolucao', key: '/works/B', author_name: ['Some Author'] },
      { title: 'Also Wrong', key: '/works/C', author_name: ['Anonymous'] },
    ];
    const result = matchWork({ title: 'Resolução', authors: 'Some Author' }, candidates);
    expect(result?.key).toBe('/works/B');
  });

  it('throws AmbiguousMatchError when 2+ fuzzy candidates pass', () => {
    const candidates: MatcherCandidate[] = [
      { title: 'Resolucao', key: '/works/A', author_name: ['Some Author'] },
      { title: 'Resolucao', key: '/works/B', author_name: ['Some Author'] },
      { title: 'Different', key: '/works/C', author_name: ['Other'] },
    ];
    expect(() =>
      matchWork({ title: 'Resolução', authors: 'Some Author' }, candidates)
    ).toThrow(AmbiguousMatchError);
  });
});

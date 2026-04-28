import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { matchWork, type MatcherCandidate } from '../matcher';
// @ts-expect-error: AmbiguousMatchError + NoMatchError land in Wave 1 (Plan 02)
import { AmbiguousMatchError, NoMatchError } from '../matcher';

// Phase 8 RED regression suite over D-09 fixtures. Each entry documents an
// observed failure cause and an expected outcome ('match' | 'ambiguous' |
// 'no_match'). After Wave 1 lands the smarter matcher heuristics, all
// 'match' entries should resolve to a candidate; 'ambiguous'/'no_match'
// should throw the corresponding named error.

type StuckBook = {
  md5: string;
  title: string;
  authors: string;
  candidates: MatcherCandidate[];
  failure_cause_observed: string;
  expected_outcome: 'match' | 'ambiguous' | 'no_match';
};

type Fixture = {
  _doc: string;
  books: StuckBook[];
};

const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'stuck-books.json'), 'utf8')
) as Fixture;

describe('Phase 8 stuck-books regression (D-09)', () => {
  it('fixture has at least 8 entries', () => {
    expect(fixture.books.length).toBeGreaterThanOrEqual(8);
  });

  it.each(fixture.books)(
    '$expected_outcome: $title',
    (book) => {
      const run = () => matchWork({ title: book.title, authors: book.authors }, book.candidates);

      if (book.expected_outcome === 'match') {
        const result = run();
        expect(result).not.toBeNull();
      } else if (book.expected_outcome === 'ambiguous') {
        expect(run).toThrow(AmbiguousMatchError);
      } else {
        // no_match: post-Wave-1 matcher throws NoMatchError; pre-Wave-1 returns null.
        // Assert against the post-Wave-1 contract so the test stays RED until then.
        expect(run).toThrow(NoMatchError);
      }
    }
  );
});

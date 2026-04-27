import { describe, expect, it } from 'vitest';
import { ZodError, z } from 'zod';

import { NotFoundError, UpstreamServerError } from '../http/http-errors';
import { classifyFailure } from '../retry';

// Phase 8 RED tests for D-03 mapping table. classifyFailure currently returns
// a bare FailureClass string; Wave 1 (Plan 02) widens the return shape to
// { class: FailureClass, reason: FailureReason }. These assertions encode the
// new shape verbatim and will fail until the refactor lands.

function codedError(code: string, message = 'coded'): Error {
  const err = new Error(message) as Error & { code?: string };
  err.code = code;
  return err;
}

describe('classifyFailure (Phase 8 D-03 mapping)', () => {
  it('NotFoundError with /isbn/ url -> { retryable-isbn-fallback, no_match }', () => {
    expect(
      // @ts-expect-error: Wave 1 widens classifyFailure return to { class, reason }
      classifyFailure(new NotFoundError('https://openlibrary.org/isbn/9780812550702.json'))
    ).toEqual({ class: 'retryable-isbn-fallback', reason: 'no_match' });
  });

  it('NotFoundError with /works/ url -> { permanent, no_match }', () => {
    expect(
      // @ts-expect-error: Wave 1 widens classifyFailure return shape
      classifyFailure(new NotFoundError('https://openlibrary.org/works/OL1.json'))
    ).toEqual({ class: 'permanent', reason: 'no_match' });
  });

  it('Error with name=AmbiguousMatchError -> { permanent, ambiguous_match }', () => {
    const err = new Error('ambiguous-match: 2 candidates accepted');
    err.name = 'AmbiguousMatchError';
    // @ts-expect-error: Wave 1 widens classifyFailure return shape
    expect(classifyFailure(err)).toEqual({ class: 'permanent', reason: 'ambiguous_match' });
  });

  it('Error with name=NoMatchError -> { permanent, no_match }', () => {
    const err = new Error('no candidate accepted');
    err.name = 'NoMatchError';
    // @ts-expect-error: Wave 1 widens classifyFailure return shape
    expect(classifyFailure(err)).toEqual({ class: 'permanent', reason: 'no_match' });
  });

  it('Error with message="no-match" (legacy path) -> { permanent, no_match }', () => {
    // @ts-expect-error: Wave 1 widens classifyFailure return shape
    expect(classifyFailure(new Error('no-match'))).toEqual({
      class: 'permanent',
      reason: 'no_match',
    });
  });

  it('ZodError -> { permanent, parse_error }', () => {
    let zodErr: ZodError;
    try {
      z.object({ n: z.number() }).parse({ n: 'not a number' });
      throw new Error('expected ZodError');
    } catch (e) {
      zodErr = e as ZodError;
    }
    // @ts-expect-error: Wave 1 widens classifyFailure return shape
    expect(classifyFailure(zodErr)).toEqual({ class: 'permanent', reason: 'parse_error' });
  });

  it('UpstreamServerError -> { retryable, network }', () => {
    expect(
      // @ts-expect-error: Wave 1 widens classifyFailure return shape
      classifyFailure(new UpstreamServerError('https://openlibrary.org/works/OL1.json', 503))
    ).toEqual({ class: 'retryable', reason: 'network' });
  });

  it.each([
    ['ECONNRESET'],
    ['ETIMEDOUT'],
    ['UND_ERR_CONNECT_TIMEOUT'],
    ['EOPENBREAKER'],
    ['SQLITE_BUSY'],
  ])('coded error %s -> { retryable, network }', (code) => {
    // @ts-expect-error: Wave 1 widens classifyFailure return shape
    expect(classifyFailure(codedError(code))).toEqual({ class: 'retryable', reason: 'network' });
  });

  it('plain Error (catch-all) -> { retryable, parse_error }', () => {
    // @ts-expect-error: Wave 1 widens classifyFailure return shape
    expect(classifyFailure(new Error('something weird'))).toEqual({
      class: 'retryable',
      reason: 'parse_error',
    });
  });

  it('non-Error value falls back to { retryable, parse_error }', () => {
    // @ts-expect-error: Wave 1 widens classifyFailure return shape
    expect(classifyFailure('string failure')).toEqual({
      class: 'retryable',
      reason: 'parse_error',
    });
    // @ts-expect-error: Wave 1 widens classifyFailure return shape
    expect(classifyFailure(null)).toEqual({ class: 'retryable', reason: 'parse_error' });
  });
});

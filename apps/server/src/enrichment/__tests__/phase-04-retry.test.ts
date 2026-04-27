import { describe, expect, it } from 'vitest';
import { ZodError, z } from 'zod';

import { NotFoundError, UpstreamServerError } from '../http/http-errors';
import { classifyFailure, computeNextAttemptAt, truncateError } from '../retry';
import { ENRICHMENT_LAST_ERROR_MAX } from '../constants';

function codedError(code: string, message = 'coded'): Error {
  const err = new Error(message) as Error & { code?: string };
  err.code = code;
  return err;
}

describe('classifyFailure (D-14)', () => {
  // Phase 8 D-02 / D-03: classifyFailure now returns { class, reason }.
  // Pre-Phase-8 assertions checked the bare string class; updated here to
  // unwrap `.class` so the legacy disposition contract still gets exercised.
  // Full { class, reason } table coverage lives in phase-08-classify-failure.test.ts.
  it('UpstreamServerError -> retryable', () => {
    expect(
      classifyFailure(new UpstreamServerError('https://openlibrary.org/works/OL1.json', 503)).class
    ).toBe('retryable');
  });

  it('NotFoundError with /works/ url -> permanent', () => {
    expect(classifyFailure(new NotFoundError('https://openlibrary.org/works/OL1.json')).class).toBe(
      'permanent'
    );
  });

  it('NotFoundError with /isbn/ url -> retryable-isbn-fallback', () => {
    expect(
      classifyFailure(new NotFoundError('https://openlibrary.org/isbn/9780812550702.json')).class
    ).toBe('retryable-isbn-fallback');
  });

  it.each([
    ['ECONNRESET'],
    ['ETIMEDOUT'],
    ['UND_ERR_CONNECT_TIMEOUT'],
  ])('plain Error with .code=%s -> retryable', (code) => {
    expect(classifyFailure(codedError(code)).class).toBe('retryable');
  });

  it('Error with .code=EOPENBREAKER -> retryable', () => {
    expect(classifyFailure(codedError('EOPENBREAKER')).class).toBe('retryable');
  });

  it('Error with .code=SQLITE_BUSY -> retryable', () => {
    expect(classifyFailure(codedError('SQLITE_BUSY')).class).toBe('retryable');
  });

  it('ZodError -> permanent', () => {
    let zodErr: ZodError;
    try {
      z.object({ n: z.number() }).parse({ n: 'not a number' });
      throw new Error('expected ZodError');
    } catch (e) {
      zodErr = e as ZodError;
    }
    expect(zodErr.name).toBe('ZodError');
    expect(classifyFailure(zodErr).class).toBe('permanent');
  });

  it('Error with message "no-match" -> permanent', () => {
    expect(classifyFailure(new Error('no-match')).class).toBe('permanent');
  });

  it('Error with name "NoMatchError" -> permanent', () => {
    const err = new Error('no candidate accepted');
    err.name = 'NoMatchError';
    expect(classifyFailure(err).class).toBe('permanent');
  });

  it('unknown Error falls back to retryable (conservative default)', () => {
    expect(classifyFailure(new Error('something weird')).class).toBe('retryable');
  });

  it('non-Error value falls back to retryable', () => {
    expect(classifyFailure('string failure').class).toBe('retryable');
    expect(classifyFailure(null).class).toBe('retryable');
    expect(classifyFailure(undefined).class).toBe('retryable');
  });
});

describe('computeNextAttemptAt (D-12)', () => {
  const now = new Date('2026-04-24T00:00:00.000Z');

  it.each([
    [1, 10],
    [2, 20],
    [3, 40],
    [4, 80],
    [5, 160],
    [6, 300],
    [7, 300],
    [10, 300],
  ])('attempts=%i -> +%is', (attempts, expectedDelay) => {
    const result = computeNextAttemptAt(attempts, now);
    const expected = new Date(now.getTime() + expectedDelay * 1000).toISOString();
    expect(result).toBe(expected);
  });

  it('returns an ISO string parseable by Date', () => {
    const result = computeNextAttemptAt(3, now);
    expect(() => new Date(result).toISOString()).not.toThrow();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('truncateError', () => {
  it('returns input unchanged when length <= max', () => {
    expect(truncateError('short')).toBe('short');
  });

  it('truncates at ENRICHMENT_LAST_ERROR_MAX by default', () => {
    const input = 'a'.repeat(ENRICHMENT_LAST_ERROR_MAX + 1);
    const out = truncateError(input);
    expect(out).toHaveLength(ENRICHMENT_LAST_ERROR_MAX);
    expect(out).toBe('a'.repeat(ENRICHMENT_LAST_ERROR_MAX));
  });

  it('respects explicit max', () => {
    expect(truncateError('abcdef', 3)).toBe('abc');
  });

  it('truncates 501-char input to 500 chars', () => {
    const input = 'x'.repeat(501);
    expect(truncateError(input)).toHaveLength(500);
  });
});

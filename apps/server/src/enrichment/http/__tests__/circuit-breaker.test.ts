import { describe, expect, it } from 'vitest';
import { createBreaker } from '../circuit-breaker';
import { NotFoundError } from '../http-errors';

describe('createBreaker', () => {
  it('passes through successful results', async () => {
    const breaker = createBreaker(async (x: number) => x * 2);
    await expect(breaker.fire(21)).resolves.toBe(42);
  });

  it('does not trip on NotFoundError (errorFilter excludes it)', async () => {
    const breaker = createBreaker(async () => {
      throw new NotFoundError('https://example.com/missing');
    });
    // Fire 10 times; all must throw NotFoundError but breaker stays closed.
    for (let i = 0; i < 10; i += 1) {
      await expect(breaker.fire()).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(breaker.opened).toBe(false);
  });

  it('trips on repeated generic upstream failures after volumeThreshold', async () => {
    const breaker = createBreaker(async () => {
      throw new Error('upstream boom');
    });
    for (let i = 0; i < 10; i += 1) {
      await expect(breaker.fire()).rejects.toBeDefined();
    }
    expect(breaker.opened).toBe(true);
  });
});

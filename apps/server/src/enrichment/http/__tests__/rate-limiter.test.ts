import { describe, expect, it } from 'vitest';
import { createLimiter } from '../rate-limiter';

describe('createLimiter', () => {
  it('enforces minTime between sequential jobs', async () => {
    const limiter = createLimiter({ minTime: 50, maxConcurrent: 1 });
    const start = Date.now();
    const jobs = [1, 2, 3, 4, 5].map((n) => limiter.schedule(async () => n));
    await Promise.all(jobs);
    const elapsed = Date.now() - start;
    // 5 jobs separated by at least 50ms => >=200ms for 4 intervals
    expect(elapsed).toBeGreaterThanOrEqual(180); // 10% tolerance on CI clock jitter
  });

  it('creates independent limiters when called multiple times', () => {
    const a = createLimiter();
    const b = createLimiter();
    expect(a).not.toBe(b);
  });
});

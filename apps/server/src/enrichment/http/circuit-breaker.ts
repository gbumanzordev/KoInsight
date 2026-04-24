import CircuitBreaker from 'opossum';
import { NotFoundError } from './http-errors';

// Per OL-04: opossum defaults are semantically equivalent to "N consecutive 5xx/timeouts"
// within the research-locked deviation (percentage-based, volumeThreshold of 5 means breaker
// stays closed for transient single-request blips). See 03-RESEARCH §Gray Area 2.
// errorFilter: NotFoundError (business miss) and ZodError (malformed-record drift) must NOT trip the breaker.
const isNonTrippingError = (err: unknown): boolean => {
  if (err instanceof NotFoundError) return true;
  if (
    err &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name: unknown }).name === 'ZodError'
  ) {
    return true;
  }
  return false;
};

export const createBreaker = <A extends unknown[], R>(
  action: (...args: A) => Promise<R>,
  opts?: CircuitBreaker.Options
): CircuitBreaker<A, R> =>
  new CircuitBreaker(action, {
    timeout: 10_000,
    errorThresholdPercentage: 50,
    volumeThreshold: 5,
    resetTimeout: 30_000,
    errorFilter: isNonTrippingError,
    ...opts,
  });

// Factory helper for per-action breakers (typed-fetch creates one per logical call-site if desired,
// or a single shared one wraps the limiter.schedule closure, see typed-fetch.ts).
export const sharedBreaker = <A extends unknown[], R>(action: (...args: A) => Promise<R>) =>
  createBreaker(action);

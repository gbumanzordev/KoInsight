import type Bottleneck from 'bottleneck';
import type CircuitBreaker from 'opossum';
import { z } from 'zod';
import { NotFoundError, UpstreamParseError, UpstreamServerError } from './http-errors';

// Callers (Plans 03 + 04) should construct their breaker ONCE at module load around a
// pass-through action, e.g.:
//   const breaker = createBreaker(async (action: () => Promise<unknown>) => action());
// and reuse it for every typedFetch call. opossum binds the action at construction time,
// so we invoke breaker.fire(action) with a fresh per-call closure that performs the
// limiter-scheduled fetch.
export interface HttpDeps {
  limiter: Bottleneck;
  breaker: CircuitBreaker<unknown[], unknown>;
  userAgent: string;
}

// Per OL-02: User-Agent on every request. Per OL-03/WD-05: shared limiter.
// Per Anti-Pattern in 03-RESEARCH: breaker wraps limiter, NEVER the inverse
// (open breaker must fail fast WITHOUT waiting for a limiter slot).
// Per Pitfall 1: OL returns HTML 5xx pages; check content-type before .json().
// Per Pitfall 3: 404 is NotFoundError (errorFilter skips); 5xx is UpstreamServerError (trips breaker).
export async function typedFetch<T>(url: string, schema: z.ZodType<T>, deps: HttpDeps): Promise<T> {
  const action = (): Promise<T> =>
    deps.limiter.schedule(async () => {
      const res = await fetch(url, {
        headers: {
          'User-Agent': deps.userAgent,
          Accept: 'application/json',
        },
      });
      if (res.status === 404) {
        throw new NotFoundError(url);
      }
      if (res.status >= 500) {
        throw new UpstreamServerError(url, res.status);
      }
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) {
        throw new UpstreamParseError(url);
      }
      const body = await res.json();
      return schema.parse(body);
    });

  return deps.breaker.fire(action) as Promise<T>;
}

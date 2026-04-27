import Bottleneck from 'bottleneck';

// Per OL-03 and WD-05: single process-wide limiter shared by OpenLibrary AND Wikidata.
// Test code uses createLimiter({ minTime: 50 }) to avoid 10s runs; prod uses sharedHttpLimiter.
export const createLimiter = (opts?: Partial<Bottleneck.ConstructorOptions>) =>
  new Bottleneck({
    maxConcurrent: Number(process.env.OL_MAX_CONCURRENT ?? 1),
    minTime: Number(process.env.OL_MIN_INTERVAL_MS ?? 1000),
    ...opts,
  });

export const sharedHttpLimiter = createLimiter();

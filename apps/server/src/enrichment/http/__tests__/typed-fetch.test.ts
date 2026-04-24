import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createBreaker } from '../circuit-breaker';
import { NotFoundError, UpstreamParseError, UpstreamServerError } from '../http-errors';
import { createLimiter } from '../rate-limiter';
import { typedFetch, type HttpDeps } from '../typed-fetch';

const Schema = z.object({ ok: z.boolean() });

function makeDeps(): HttpDeps {
  const limiter = createLimiter({ minTime: 0, maxConcurrent: 1 });
  const breaker = createBreaker(async (action: () => Promise<unknown>) => action());
  return { limiter, breaker: breaker as HttpDeps['breaker'], userAgent: 'Test/1.0 (test)' };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('typedFetch', () => {
  it('sends User-Agent and Accept: application/json headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const deps = makeDeps();
    await typedFetch('https://example.com/x', Schema, deps);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['User-Agent']).toBe('Test/1.0 (test)');
    expect(init.headers.Accept).toBe('application/json');
  });

  it('throws NotFoundError on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    await expect(typedFetch('https://example.com/404', Schema, makeDeps())).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it('throws UpstreamServerError on 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 503 })));
    await expect(typedFetch('https://example.com/500', Schema, makeDeps())).rejects.toBeInstanceOf(
      UpstreamServerError
    );
  });

  it('throws UpstreamParseError on non-JSON content-type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>error</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      )
    );
    await expect(typedFetch('https://example.com/html', Schema, makeDeps())).rejects.toBeInstanceOf(
      UpstreamParseError
    );
  });

  it('parses JSON through the provided Zod schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, extra: 'ignored' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    );
    const result = await typedFetch('https://example.com/ok', Schema, makeDeps());
    expect(result).toEqual({ ok: true });
  });
});

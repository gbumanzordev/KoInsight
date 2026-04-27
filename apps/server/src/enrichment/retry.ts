import { ENRICHMENT_LAST_ERROR_MAX } from './constants';
import { NotFoundError, UpstreamServerError } from './http/http-errors';

// D-14 classification; D-12 backoff arithmetic + last_error truncation.
// This module is pure: no knex, no fetch, no Date.now(); callers inject `now`.

export type FailureClass = 'retryable' | 'permanent' | 'retryable-isbn-fallback';

type CodedError = Error & { code?: string };

function getCode(err: Error): string | undefined {
  return (err as CodedError).code;
}

export function classifyFailure(err: unknown): FailureClass {
  if (err instanceof NotFoundError) {
    return err.url.includes('/isbn/') ? 'retryable-isbn-fallback' : 'permanent';
  }
  if (err instanceof UpstreamServerError) {
    return 'retryable';
  }
  if (err instanceof Error) {
    if (err.name === 'ZodError') return 'permanent';
    if (err.name === 'NoMatchError' || err.message === 'no-match') return 'permanent';

    const code = getCode(err);
    if (code === 'EOPENBREAKER') return 'retryable';
    if (code === 'SQLITE_BUSY') return 'retryable';
    if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
      return 'retryable';
    }
  }
  return 'retryable';
}

export function computeNextAttemptAt(attempts: number, now: Date): string {
  const delaySeconds = Math.min(300, 2 ** (attempts - 1) * 10);
  return new Date(now.getTime() + delaySeconds * 1000).toISOString();
}

export function truncateError(message: string, max: number = ENRICHMENT_LAST_ERROR_MAX): string {
  return message.slice(0, max);
}

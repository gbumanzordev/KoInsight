import type { FailureReason } from '@koinsight/common/types/enrichment';

import { ENRICHMENT_LAST_ERROR_MAX } from './constants';
import { NotFoundError, UpstreamServerError } from './http/http-errors';

// D-14 classification; D-12 backoff arithmetic + last_error truncation.
// This module is pure: no knex, no fetch, no Date.now(); callers inject `now`.

export type FailureClass = 'retryable' | 'permanent' | 'retryable-isbn-fallback';

export interface FailureClassification {
  class: FailureClass;
  reason: FailureReason;
}

type CodedError = Error & { code?: string };

function getCode(err: Error): string | undefined {
  return (err as CodedError).code;
}

// Phase 8 D-02 / D-03: classifyFailure now returns { class, reason } so the
// worker can persist the structured failure_reason on the book row alongside
// the existing retry/permanent disposition. Mapping table is the single source
// of truth (see 08-CONTEXT.md D-03); tests in phase-08-classify-failure.test.ts
// cover every row verbatim.
export function classifyFailure(err: unknown): FailureClassification {
  if (err instanceof NotFoundError) {
    if (err.url.includes('/isbn/')) {
      return { class: 'retryable-isbn-fallback', reason: 'no_match' };
    }
    return { class: 'permanent', reason: 'no_match' };
  }
  if (err instanceof UpstreamServerError) {
    return { class: 'retryable', reason: 'network' };
  }
  if (err instanceof Error) {
    if (err.name === 'AmbiguousMatchError') {
      return { class: 'permanent', reason: 'ambiguous_match' };
    }
    if (err.name === 'NoMatchError' || err.message === 'no-match') {
      return { class: 'permanent', reason: 'no_match' };
    }
    if (err.name === 'ZodError') {
      return { class: 'permanent', reason: 'parse_error' };
    }

    const code = getCode(err);
    if (
      code === 'EOPENBREAKER' ||
      code === 'SQLITE_BUSY' ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'UND_ERR_CONNECT_TIMEOUT'
    ) {
      return { class: 'retryable', reason: 'network' };
    }
  }
  return { class: 'retryable', reason: 'parse_error' };
}

export function computeNextAttemptAt(attempts: number, now: Date): string {
  const delaySeconds = Math.min(300, 2 ** (attempts - 1) * 10);
  return new Date(now.getTime() + delaySeconds * 1000).toISOString();
}

export function truncateError(message: string, max: number = ENRICHMENT_LAST_ERROR_MAX): string {
  return message.slice(0, max);
}

import type { FailureReason } from '@koinsight/common/types/enrichment';
import useSWR, { mutate } from 'swr';
import { fetchFromAPI } from './api';

// Phase 5 Plan 05 (UI-04, D-09, D-16): SWR hooks for the unmatched inbox + the
// Navbar Settings Indicator. The status hook uses a STRING key (not array) so
// both the Navbar and the Settings page resolve to the same SWR cache entry,
// dedup'ing the 5s poll into a single request (CONTEXT.md A6).

export type EnrichmentStatusCounts = {
  pending: number;
  running: number;
  enriched: number;
  failed: number;
  skipped: number;
};

export type UnmatchedBookRow = {
  id: number;
  md5: string;
  title: string;
  authors: string | null;
  cover_image: string | null;
  last_error: string | null;
  job_updated_at: number | null;
  failure_reason: FailureReason | null;
};

export type UnmatchedBooksResponse = {
  rows: UnmatchedBookRow[];
  total: number;
  offset: number;
  limit: number;
};

const STATUS_KEY = 'enrichment/status';

export function useEnrichmentStatus() {
  return useSWR<EnrichmentStatusCounts>(
    STATUS_KEY,
    () => fetchFromAPI<EnrichmentStatusCounts>('enrichment/status'),
    { refreshInterval: 5000 }
  );
}

export function useUnmatchedBooks({
  offset = 0,
  limit = 20,
}: { offset?: number; limit?: number } = {}) {
  return useSWR<UnmatchedBooksResponse>(
    ['enrichment/unmatched', offset, limit],
    () => fetchFromAPI<UnmatchedBooksResponse>('enrichment/unmatched', 'GET', { offset, limit }),
    { refreshInterval: 5000 }
  );
}

// Phase 8 Plan 04 (RETRY-01): trigger bulk re-enqueue of all `failed` books.
// The server (Plan 03 POST /api/enrichment/retry-all) accepts an empty body
// `{}` and rejects unknown keys via Zod .strict(); the client always sends
// exactly that shape (T-08-08 mitigation).
export async function postRetryAll(): Promise<{ enqueued: number; skipped: number }> {
  return fetchFromAPI<{ enqueued: number; skipped: number }>(
    'enrichment/retry-all',
    'POST',
    {}
  );
}

export async function postDismissUnmatchedBook(bookId: number): Promise<void> {
  await fetchFromAPI<{ id: number; enrichment_status: string }>(
    `enrichment/books/${bookId}/dismiss`,
    'POST',
    {}
  );
  await invalidateUnmatchedList();
}

// Phase 8 Plan 04 (RETRY-02 / D-14): invalidate every paginated cache slice
// of the unmatched-books list, plus the enrichment status counter (used by
// the Navbar Settings Indicator). RESEARCH Pitfall 4: the list cache key is
// a tuple `['enrichment/unmatched', offset, limit]`; a string mutate
// 'enrichment/unmatched' does NOT match. The predicate form is mandatory.
export async function invalidateUnmatchedList(): Promise<void> {
  await mutate(
    (key) => Array.isArray(key) && key[0] === 'enrichment/unmatched',
    undefined,
    { revalidate: true }
  );
  await mutate('enrichment/status');
}

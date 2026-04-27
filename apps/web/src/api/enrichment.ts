import useSWR from 'swr';
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

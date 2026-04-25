import { BookWithData, EnrichmentStatus } from '@koinsight/common/types';
import useSWR from 'swr';
import { fetchFromAPI } from './api';

// Phase 5 Plan 04 (D-12): conditionally poll the book detail every 2s while the
// book's enrichment job is open (pending / running). Stops as soon as the job
// reaches a terminal state (enriched / failed / skipped). Pitfall 4: returning
// 0 disables polling entirely; do not return null.
const OPEN_STATUSES: ReadonlySet<EnrichmentStatus> = new Set(['pending', 'running']);

export function useBookWithData(id: number) {
  return useSWR(`books/${id}`, () => fetchFromAPI<BookWithData>(`books/${id}`), {
    refreshInterval: (latest) =>
      latest && OPEN_STATUSES.has(latest.enrichment_status) ? 2000 : 0,
    revalidateOnFocus: false,
  });
}

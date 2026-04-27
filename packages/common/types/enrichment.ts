// Book-level enrichment status (lives on book.enrichment_status). Per D-18 / SCHEMA-04.
export type EnrichmentStatus = 'pending' | 'running' | 'enriched' | 'failed' | 'skipped';

// Job-level status (lives on enrichment_job.status). Per D-18 / SCHEMA-05.
// Distinct from EnrichmentStatus to avoid name collision.
export type EnrichmentJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

// Phase 8 (RETRY-04 / D-03 / CD-3): structured failure cause persisted on
// book.failure_reason after a terminal enrichment failure. Server emits these
// four lowercase keys verbatim; the 'unknown' UI fallback for NULL rows is
// web-only display logic and is intentionally NOT part of this union.
export type FailureReason = 'no_match' | 'ambiguous_match' | 'network' | 'parse_error';

export type EnrichmentJob = {
  id: number;
  book_md5: string;
  status: EnrichmentJobStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

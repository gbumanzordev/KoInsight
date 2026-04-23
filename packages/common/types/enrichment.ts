// Book-level enrichment status (lives on book.enrichment_status). Per D-18 / SCHEMA-04.
export type EnrichmentStatus = 'pending' | 'running' | 'enriched' | 'failed' | 'skipped';

// Job-level status (lives on enrichment_job.status). Per D-18 / SCHEMA-05.
// Distinct from EnrichmentStatus to avoid name collision.
export type EnrichmentJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type EnrichmentJob = {
  id: number;
  book_md5: string;
  status: EnrichmentJobStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

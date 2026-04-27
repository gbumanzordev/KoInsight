import type { FieldSource } from './author';
import type { EnrichmentStatus } from './enrichment';

export type KoReaderBook = {
  id: number;
  md5: string;
  title: string;
  authors: string;
  notes: number;
  last_open: number;
  highlights: number;
  pages: number;
  series: string;
  language: string;
  // These fields only come from statistics.db sync, not annotation sync
  total_read_time?: number;
  total_read_pages?: number;
};

export type DbBook = {
  id: number;
  md5: string;
  title: string;
  authors: string;
  series: string;
  language: string;
  enrichment_status: EnrichmentStatus;
  openlibrary_work_key: string | null;
  publication_year: number | null;
  original_language: string | null;
  authors_source: FieldSource | null;
  genres_source: FieldSource | null;
  publication_year_source: FieldSource | null;
  original_language_source: FieldSource | null;
};

export type Book = DbBook & {
  soft_deleted: boolean;
  reference_pages: number | null;
};

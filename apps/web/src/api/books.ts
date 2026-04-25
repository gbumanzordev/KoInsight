import { Book, BookWithData, EnrichmentJob, MetadataPatch } from '@koinsight/common/types';
import useSWR from 'swr';
import { API_URL, fetchFromAPI } from './api';

export function useBooks({ showHidden } = { showHidden: false }) {
  return useSWR(
    ['books', showHidden],
    () => fetchFromAPI<BookWithData[]>('books', 'GET', { showHidden }),
    {
      fallbackData: [],
    }
  );
}

export async function deleteBook(id: Book['id']) {
  return fetchFromAPI<{ message: string }>(`books/${id}`, 'DELETE');
}

export async function hideBook(id: Book['id']) {
  return fetchFromAPI<{ message: string }>(`books/${id}/hide`, 'PUT', { hidden: true });
}

export async function showBook(id: Book['id']) {
  return fetchFromAPI<{ message: string }>(`books/${id}/hide`, 'PUT', { hidden: false });
}

export async function updateBookReferencePages(id: Book['id'], referencePages: number | null) {
  return fetchFromAPI<Book>(`books/${id}/reference_pages`, 'PUT', {
    reference_pages: referencePages,
  });
}

// Phase 5 Plan 04 (UI-01, UI-02): PATCH the book's editable metadata.
// Backed by the Phase 5 Plan 01 server endpoint; the response is the fresh
// BookWithData so SWR can mutate the page-level cache with server truth.
export async function patchBookMetadata(id: Book['id'], patch: MetadataPatch) {
  return fetchFromAPI<BookWithData>(`books/${id}/metadata`, 'PATCH', patch);
}

// Phase 5 Plan 04 (UI-05): trigger the async re-enrichment queue. The server
// returns 202 immediately with the current open / latest job; UI polls the
// book detail endpoint (D-12) for terminal status.
export async function reEnrichBook(id: Book['id']) {
  return fetchFromAPI<{ job: EnrichmentJob | null }>(`books/${id}/re-enrich`, 'POST', {});
}

export function uploadBookCover(bookId: Book['id'], formData: FormData) {
  return fetch(`${API_URL}/books/${bookId}/cover`, {
    method: 'POST',
    body: formData,
    headers: { Accept: 'multipart/form-data' },
  });
}

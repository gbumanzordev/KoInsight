import { db } from '../knex';

// Phase 5 Plan 03: read repository for enrichment status counters and the
// "unmatched books" paginated list (EDIT-04 + EDIT-05).
//
// Both queries stay thin Knex calls so the router can remain a dumb boundary
// (Zod parse -> repo call -> JSON). Status counters and unmatched list are
// the only two reads driving the Settings > Unmatched section.

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
  authors: string;
  last_error: string | null;
  job_updated_at: string | null;
};

/**
 * Aggregate counts of every book.enrichment_status bucket.
 * Missing statuses are defaulted to 0 so the API always returns all five keys.
 * NULL enrichment_status is attributed to 'pending' (column default; should be
 * vanishingly rare post-Phase-1).
 */
export async function getEnrichmentStatusCounts(): Promise<EnrichmentStatusCounts> {
  const rows = await db('book')
    .select('enrichment_status')
    .count<Array<{ enrichment_status: string | null; count: number | string }>>('* as count')
    .groupBy('enrichment_status');

  const result: EnrichmentStatusCounts = {
    pending: 0,
    running: 0,
    enriched: 0,
    failed: 0,
    skipped: 0,
  };

  for (const row of rows) {
    const key = (row.enrichment_status ?? 'pending') as keyof EnrichmentStatusCounts;
    if (key in result) {
      result[key] = Number(row.count);
    }
  }

  return result;
}

/**
 * Paginated list of books with enrichment_status='failed', joined to their
 * most-recent failed enrichment_job row for last_error + updated_at. Books
 * with no matching failed job row still appear (last_error=null,
 * job_updated_at=null) and sort after those with a timestamp, then by title.
 *
 * Sort: enrichment_job.updated_at DESC, book.title ASC.
 * SQLite orders NULLs as smallest in ASC / largest in DESC by default, which
 * means null job_updated_at sorts FIRST in a DESC order. To get rows with
 * an actual timestamp first and null-timestamp rows last, we use an explicit
 * "updated_at IS NULL" preamble in the orderByRaw so non-null rows come first.
 */
export async function getUnmatchedBooks(
  offset: number,
  limit: number
): Promise<{ rows: UnmatchedBookRow[]; total: number }> {
  const rows = (await db('book as b')
    .leftJoin('enrichment_job as ej', function () {
      this.on('ej.book_md5', '=', 'b.md5').andOn('ej.status', '=', db.raw('?', ['failed']));
    })
    .where('b.enrichment_status', 'failed')
    .select(
      'b.id',
      'b.md5',
      'b.title',
      'b.authors',
      'ej.last_error',
      'ej.updated_at as job_updated_at'
    )
    // Place rows with a timestamp first; among those, most recent first; then by title.
    .orderByRaw('ej.updated_at IS NULL')
    .orderBy('ej.updated_at', 'desc')
    .orderBy('b.title', 'asc')
    .offset(offset)
    .limit(limit)) as UnmatchedBookRow[];

  const [{ count }] = await db('book')
    .where({ enrichment_status: 'failed' })
    .count<[{ count: number | string }]>('* as count');

  return { rows, total: Number(count) };
}

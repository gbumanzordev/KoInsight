import type { Knex } from 'knex';

// Phase 4 Plan 03 Task 2: boot-time backfill (D-10).
// A single INSERT...SELECT statement enqueues every book whose
// enrichment_status is 'pending' or NULL. The Phase 1 partial UNIQUE index
// `enrichment_job_book_md5_open_unique` deduplicates against any existing
// open job for the same book, so re-running this is idempotent.
//
// No row-iteration in Node by design: the migration runs in SQLite, bounded
// by the size of the book table (~10k rows is ~10ms in better-sqlite3).
//
// Errors propagate to the caller (app.ts wraps in .catch per D-11).

export async function runBackfill(knex: Knex): Promise<void> {
  await knex.raw(
    `INSERT INTO enrichment_job (book_md5, status)
     SELECT md5, 'pending' FROM book
     WHERE enrichment_status = 'pending' OR enrichment_status IS NULL
     ON CONFLICT DO NOTHING`
  );

  console.log('enrichment backfill: complete');
}

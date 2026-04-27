import { z } from 'zod';
import { db } from '../knex';

// Phase 4 Plan 03: enqueue service.
// - Zod-validates the md5 at the boundary (D-09 + T-04-08 defense-in-depth).
// - D-07 predicate: skip when book is missing or already past the pending gate.
// - D-08 dedup: insert with ON CONFLICT DO NOTHING, relying on the Phase 1
//   partial UNIQUE index `enrichment_job_book_md5_open_unique` on open states.
// - D-09: never throw. Any error, validation or DB, is console.warn'd and
//   swallowed so sync-route latency is never blocked by enrichment bookkeeping.
//
// Phase 8 Plan 02 / D-15 / POLISH-01: enqueueMany lands as the batched
// transactional helper. enqueue is reimplemented as a thin wrapper so the
// existing call sites keep their single-md5 contract while bulk callers
// (Phase 8 retry-all route) get a single round-trip.

const Md5Schema = z.string().regex(/^[a-f0-9]{32}$/i);

type OpenOrTerminalStatus = 'pending' | 'running' | 'enriched' | 'failed' | 'skipped' | null;

export type EnqueueManyResult = { enqueued: number; skipped: number };

/**
 * Batched enqueue helper (D-15). Wraps the body in a single transaction so
 * partial failures roll back. Validates md5s at the boundary and warn-and-drops
 * invalid entries. ON CONFLICT DO NOTHING makes the insert idempotent against
 * the partial UNIQUE index `enrichment_job_book_md5_open_unique`.
 *
 * Return semantics (RESEARCH Open Q3):
 *   enqueued = md5s that produced a new pending row, i.e. book exists, status
 *             was `pending`/`null` (or `force=true`), and there was no open
 *             pending/running job already.
 *   skipped  = openJobsBefore (md5s that already had an open pending/running job)
 *
 * Reflects the user-facing "rows that newly became eligible to be picked up
 * by the worker." Invalid md5s, missing books, and md5s blocked by a terminal
 * status (when `force` is false) are not counted in either bucket.
 */
async function enqueueMany(
  bookMd5s: string[],
  options: { force?: boolean } = {}
): Promise<EnqueueManyResult> {
  if (bookMd5s.length === 0) return { enqueued: 0, skipped: 0 };

  // Validate; warn-and-drop invalid entries (matches single-call swallow semantics).
  // Message + payload shape match the legacy `enrichment enqueue: invalid md5`
  // contract so Phase 4 single-md5 tests and the new Phase 8 tests both pass.
  const valid: string[] = [];
  for (const bookMd5 of bookMd5s) {
    const parsed = Md5Schema.safeParse(bookMd5);
    if (!parsed.success) {
      console.warn('enrichment enqueue: invalid md5', { bookMd5 });
      continue;
    }
    valid.push(bookMd5);
  }
  if (valid.length === 0) return { enqueued: 0, skipped: 0 };

  try {
    // Reads outside the transaction so a DB-layer failure surfaces here and
    // hits the catch below (the better-sqlite3 dialect's transaction wrapper
    // does not always propagate inner-query rejections cleanly under test
    // mocks). Reads-then-write is correct for our use case because the inserts
    // use ON CONFLICT DO NOTHING (idempotent under concurrent enqueue) and
    // the book status flip is the only mutation that needs the transaction
    // for atomicity with the insert.
    const openRows = await db('enrichment_job')
      .whereIn('book_md5', valid)
      .whereIn('status', ['pending', 'running'])
      .select('book_md5');
    const openMd5s = new Set(openRows.map((r: { book_md5: string }) => r.book_md5));
    const skipped = openMd5s.size;

    // D-07 predicate: drop md5s whose book is missing or whose enrichment_status
    // is past the pending gate (unless force=true). force flips terminal statuses
    // back to 'pending' so the UI's status-conditional polling restarts.
    const books = (await db('book')
      .whereIn('md5', valid)
      .select('md5', 'enrichment_status')) as Array<{
      md5: string;
      enrichment_status: OpenOrTerminalStatus;
    }>;
    const bookByMd5 = new Map(books.map((b) => [b.md5, b]));

    return await db.transaction(async (trx) => {

      const eligible: string[] = [];
      const toFlipToPending: string[] = [];
      for (const md5 of valid) {
        const book = bookByMd5.get(md5);
        if (!book) continue;
        const status = book.enrichment_status;
        if (!options.force && status !== null && status !== 'pending') continue;
        eligible.push(md5);
        if (options.force && status !== 'pending' && status !== null) {
          toFlipToPending.push(md5);
        }
      }

      if (toFlipToPending.length > 0) {
        await trx('book').whereIn('md5', toFlipToPending).update({ enrichment_status: 'pending' });
      }

      if (eligible.length > 0) {
        const insertRows = eligible.map((md5) => ({ book_md5: md5, status: 'pending' as const }));
        // Knex 3.1's no-arg `.onConflict().ignore()` lowers to
        // SQLite's "ON CONFLICT DO NOTHING" against any UNIQUE index
        // (including the partial one on open states from Phase 1).
        await trx('enrichment_job').insert(insertRows).onConflict().ignore();
      }

      // Compute enqueued from the actually-eligible set, excluding md5s that
      // already had an open job. md5s dropped by the eligibility filter (book
      // missing, or terminal status without `force`) are excluded from both
      // buckets so the count matches the number of pending rows we just
      // attempted to insert.
      const enqueued = eligible.filter((m) => !openMd5s.has(m)).length;
      return { enqueued, skipped };
    });
  } catch (err) {
    // Mirror the legacy single-md5 log shape so the Phase 4 DB-throw regression
    // test continues to pass. We emit one warn per input md5 because the legacy
    // contract was per-md5; bulk callers tolerate the noise on a transactional
    // failure since the entire batch rolled back.
    for (const bookMd5 of valid) {
      console.warn('enrichment enqueue failed', {
        bookMd5,
        phase: 'enqueue',
        err: String(err),
      });
    }
    return { enqueued: 0, skipped: 0 };
  }
}

async function enqueue(bookMd5: string, options: { force?: boolean } = {}): Promise<void> {
  await enqueueMany([bookMd5], options);
}

export const enrichmentService = {
  enqueue,
  enqueueMany,
};

export { enqueue, enqueueMany };

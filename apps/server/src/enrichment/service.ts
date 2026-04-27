import { z } from 'zod';
import { db } from '../knex';

// Phase 4 Plan 03: enqueue service.
// - Zod-validates the md5 at the boundary (D-09 + T-04-08 defense-in-depth).
// - D-07 predicate: skip when book is missing or already past the pending gate.
// - D-08 dedup: insert with ON CONFLICT DO NOTHING, relying on the Phase 1
//   partial UNIQUE index `enrichment_job_book_md5_open_unique` on open states.
// - D-09: never throw. Any error, validation or DB, is console.warn'd and
//   swallowed so sync-route latency is never blocked by enrichment bookkeeping.

const Md5Schema = z.string().regex(/^[a-f0-9]{32}$/i);

type OpenOrTerminalStatus = 'pending' | 'running' | 'enriched' | 'failed' | 'skipped' | null;

async function enqueue(bookMd5: string, options: { force?: boolean } = {}): Promise<void> {
  const parsed = Md5Schema.safeParse(bookMd5);
  if (!parsed.success) {
    console.warn('enrichment enqueue: invalid md5', { bookMd5 });
    return;
  }

  try {
    const book = await db('book')
      .select<{ enrichment_status: OpenOrTerminalStatus }>('enrichment_status')
      .where({ md5: bookMd5 })
      .first();

    if (!book) return;

    const status = book.enrichment_status;
    // Auto-enqueue (post-sync hook, backfill) only fires for never-tried/pending books.
    // Manual re-enrich (force) bypasses the status gate so users can retry terminal
    // states (enriched/failed/skipped) — and resets enrichment_status to 'pending'
    // so the UI's status-conditional polling restarts.
    if (!options.force && status !== null && status !== 'pending') return;

    if (options.force && status !== 'pending') {
      await db('book').where({ md5: bookMd5 }).update({ enrichment_status: 'pending' });
    }

    // SQLite 3.24+ supports ON CONFLICT DO NOTHING without a column target,
    // which resolves against any UNIQUE index including the partial one.
    // Knex 3.1's no-arg `.onConflict().ignore()` lowers to the same behavior.
    await db('enrichment_job')
      .insert({ book_md5: bookMd5, status: 'pending' })
      .onConflict()
      .ignore();
  } catch (err) {
    console.warn('enrichment enqueue failed', {
      bookMd5,
      phase: 'enqueue',
      err: String(err),
    });
  }
}

export const enrichmentService = {
  enqueue,
};

export { enqueue };

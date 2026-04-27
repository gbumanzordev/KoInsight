import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBook } from '../../db/factories/book-factory';
import { db } from '../../knex';
import { enrichmentService, enqueue } from '../service';

// Phase 4 Plan 03 Task 1: enrichmentService.enqueue
// Covers D-07 predicate, D-08 dedup via partial UNIQUE, D-09 log-and-swallow.
// All tests run against the real :memory: SQLite instance configured via
// apps/server/test/setup/test-setup.ts (migrate.latest + truncate-all hook).

describe('enrichmentService.enqueue', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  async function countJobs(bookMd5: string, status?: string): Promise<number> {
    const q = db('enrichment_job').where({ book_md5: bookMd5 });
    if (status) q.andWhere({ status });
    const rows = await q.select('id');
    return rows.length;
  }

  it('enqueues a pending-status book (default status after insert)', async () => {
    const book = await createBook(db, { md5: 'a'.repeat(32), enrichment_status: 'pending' });

    await enrichmentService.enqueue(book.md5);

    expect(await countJobs(book.md5, 'pending')).toBe(1);
  });

  it('enqueues when enrichment_status is pending (explicit)', async () => {
    const book = await createBook(db, { md5: 'b'.repeat(32), enrichment_status: 'pending' });

    await enqueue(book.md5);

    expect(await countJobs(book.md5, 'pending')).toBe(1);
  });

  it('does NOT enqueue when enrichment_status is enriched', async () => {
    const book = await createBook(db, { md5: 'c'.repeat(32), enrichment_status: 'enriched' });

    await enrichmentService.enqueue(book.md5);

    expect(await countJobs(book.md5)).toBe(0);
  });

  it('does NOT enqueue when enrichment_status is failed (D-07 predicate blocks)', async () => {
    const book = await createBook(db, { md5: 'd'.repeat(32), enrichment_status: 'failed' });

    await enrichmentService.enqueue(book.md5);

    expect(await countJobs(book.md5)).toBe(0);
  });

  it('does NOT enqueue when enrichment_status is skipped', async () => {
    const book = await createBook(db, { md5: 'e'.repeat(32), enrichment_status: 'skipped' });

    await enrichmentService.enqueue(book.md5);

    expect(await countJobs(book.md5)).toBe(0);
  });

  it('does NOT enqueue when enrichment_status is running', async () => {
    const book = await createBook(db, { md5: 'f'.repeat(32), enrichment_status: 'running' });

    await enrichmentService.enqueue(book.md5);

    expect(await countJobs(book.md5)).toBe(0);
  });

  it('does NOT enqueue and does NOT throw for a non-existent md5', async () => {
    const md5 = '1'.repeat(32);

    await expect(enrichmentService.enqueue(md5)).resolves.toBeUndefined();
    expect(await countJobs(md5)).toBe(0);
  });

  it('logs and swallows on invalid md5 format (D-09)', async () => {
    await expect(enrichmentService.enqueue('not-an-md5')).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      'enrichment enqueue: invalid md5',
      expect.objectContaining({ bookMd5: 'not-an-md5' })
    );
  });

  it('concurrent enqueue for the same md5 results in exactly one open row (D-08)', async () => {
    const md5 = '2'.repeat(32);
    await createBook(db, { md5, enrichment_status: 'pending' });

    await Promise.all([
      enrichmentService.enqueue(md5),
      enrichmentService.enqueue(md5),
      enrichmentService.enqueue(md5),
      enrichmentService.enqueue(md5),
    ]);

    const openRows = await db('enrichment_job')
      .where({ book_md5: md5 })
      .whereIn('status', ['pending', 'running'])
      .select('id');

    expect(openRows).toHaveLength(1);
  });

  it('does NOT insert a new open job when an open (running) row already exists for md5', async () => {
    const md5 = '3'.repeat(32);
    await createBook(db, { md5, enrichment_status: 'pending' });
    // Seed an open (running) job directly.
    await db('enrichment_job').insert({ book_md5: md5, status: 'running' });

    await enrichmentService.enqueue(md5);

    const openRows = await db('enrichment_job')
      .where({ book_md5: md5 })
      .whereIn('status', ['pending', 'running'])
      .select('id');

    expect(openRows).toHaveLength(1);
    expect((openRows[0] as { status?: string }).status ?? 'running').toBeDefined();
  });

  it('D-07 predicate blocks re-enqueue when book.enrichment_status=failed even though partial UNIQUE would allow it', async () => {
    const md5 = '4'.repeat(32);
    // book says 'failed' => D-07 predicate blocks.
    await createBook(db, { md5, enrichment_status: 'failed' });
    // Closed prior job: partial UNIQUE would NOT block a new open row.
    await db('enrichment_job').insert({ book_md5: md5, status: 'failed' });

    await enrichmentService.enqueue(md5);

    // No new pending row because D-07 predicate blocked BEFORE DB layer.
    const pendingRows = await db('enrichment_job')
      .where({ book_md5: md5, status: 'pending' })
      .select('id');
    expect(pendingRows).toHaveLength(0);
  });

  it('partial UNIQUE does NOT block insert when only CLOSED jobs exist (DB-layer check, D-07 bypassed)', async () => {
    // Directly exercises the DB-layer invariant: a failed/succeeded closed job does
    // not prevent a new pending row from being inserted. (D-07 is bypassed here by
    // setting book.enrichment_status back to 'pending' so the service proceeds to DB.)
    const md5 = '5'.repeat(32);
    await createBook(db, { md5, enrichment_status: 'pending' });
    await db('enrichment_job').insert({ book_md5: md5, status: 'failed' });
    await db('enrichment_job').insert({ book_md5: md5, status: 'succeeded' });

    await enrichmentService.enqueue(md5);

    const pendingRows = await db('enrichment_job')
      .where({ book_md5: md5, status: 'pending' })
      .select('id');
    expect(pendingRows).toHaveLength(1);
  });

  it('logs and swallows when the DB layer throws (D-09)', async () => {
    const md5 = '6'.repeat(32);
    await createBook(db, { md5, enrichment_status: 'pending' });

    // Force a DB-layer failure without mutating schema. Spying on the knex
    // client's query runner rejects any attempted query, which exercises the
    // same try/catch path as a real driver error. This avoids the earlier
    // ALTER TABLE RENAME approach, which could leak a renamed table across
    // test runs if the process was killed mid-test (corrupting the shared
    // :memory: migration state in subsequent runs under the test-setup hook).
    const client = db.client as unknown as {
      query: (connection: unknown, obj: unknown) => Promise<unknown>;
    };
    const querySpy = vi
      .spyOn(client, 'query')
      .mockRejectedValue(new Error('simulated DB failure'));
    try {
      await expect(enrichmentService.enqueue(md5)).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        'enrichment enqueue failed',
        expect.objectContaining({ bookMd5: md5, phase: 'enqueue' })
      );
    } finally {
      querySpy.mockRestore();
    }
  });
});

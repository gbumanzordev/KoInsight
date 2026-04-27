import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBook } from '../../db/factories/book-factory';
import { db } from '../../knex';
// @ts-expect-error: enqueueMany lands in Wave 2 (Plan 03 / D-15)
import { enqueueMany, enqueue, enrichmentService } from '../service';

// Phase 8 RED tests for POLISH-01 / D-15: batched enqueue helper.
// Behavior contract:
//   - Single transaction; INSERT ... ON CONFLICT DO NOTHING over the input array.
//   - Returns { enqueued, skipped } where enqueued = inputCount - openJobsBefore.
//   - { force: true } flips terminal book.enrichment_status to 'pending'.
//   - Invalid md5 entries are warn-and-dropped, not counted in either bucket.
//   - The single-arg `enqueue(md5)` is reimplemented as a wrapper.

describe('enrichmentService.enqueueMany (Phase 8 D-15)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  async function countOpenJobs(bookMd5: string): Promise<number> {
    const rows = await db('enrichment_job')
      .where({ book_md5: bookMd5 })
      .whereIn('status', ['pending', 'running'])
      .select('id');
    return rows.length;
  }

  it('returns { enqueued: 0, skipped: 0 } for an empty input array', async () => {
    const result = await enqueueMany([]);
    expect(result).toEqual({ enqueued: 0, skipped: 0 });
  });

  it('enqueues 2 pending books and returns { enqueued: 2, skipped: 0 }', async () => {
    const a = await createBook(db, { md5: 'a'.repeat(32), enrichment_status: 'pending' });
    const b = await createBook(db, { md5: 'b'.repeat(32), enrichment_status: 'pending' });

    const result = await enqueueMany([a.md5, b.md5]);

    expect(result).toEqual({ enqueued: 2, skipped: 0 });
    expect(await countOpenJobs(a.md5)).toBe(1);
    expect(await countOpenJobs(b.md5)).toBe(1);
  });

  it('second call with same md5s and no force flag returns { enqueued: 0, skipped: N }', async () => {
    const a = await createBook(db, { md5: 'c'.repeat(32), enrichment_status: 'pending' });
    const b = await createBook(db, { md5: 'd'.repeat(32), enrichment_status: 'pending' });

    await enqueueMany([a.md5, b.md5]);
    const result = await enqueueMany([a.md5, b.md5]);

    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(2);
  });

  it('force=true flips a failed book to pending and creates a new pending job row', async () => {
    const md5 = 'e'.repeat(32);
    await createBook(db, { md5, enrichment_status: 'failed' });

    const result = await enqueueMany([md5], { force: true });

    expect(result.enqueued).toBe(1);
    expect(await countOpenJobs(md5)).toBe(1);
    const book = await db('book').where({ md5 }).first();
    expect(book.enrichment_status).toBe('pending');
  });

  it('warns and drops invalid md5; not counted in either bucket', async () => {
    const valid = await createBook(db, { md5: 'f'.repeat(32), enrichment_status: 'pending' });

    const result = await enqueueMany(['not-an-md5', valid.md5]);

    expect(result.enqueued).toBe(1);
    expect(result.skipped).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('invalid md5'),
      expect.objectContaining({ bookMd5: 'not-an-md5' })
    );
  });

  it('wrapper: enqueue(md5) delegates to enqueueMany([md5]) with same effects', async () => {
    const md5 = '1'.repeat(32);
    await createBook(db, { md5, enrichment_status: 'pending' });

    await enqueue(md5);

    expect(await countOpenJobs(md5)).toBe(1);
    expect(typeof enrichmentService.enqueue).toBe('function');
  });
});

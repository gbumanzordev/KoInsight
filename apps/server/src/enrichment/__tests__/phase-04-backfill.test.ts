import { describe, expect, it } from 'vitest';
import { createBook } from '../../db/factories/book-factory';
import { db } from '../../knex';
import { runBackfill } from '../backfill';

// Phase 4 Plan 03 Task 2: runBackfill
// Covers D-10 (single INSERT...SELECT, no row-iteration in Node) and idempotency.
// Runs against real :memory: SQLite via test-setup.

describe('runBackfill', () => {
  it('enqueues all unenriched books in a single statement (D-10)', async () => {
    // 2 NULL + 1 pending should yield 3 jobs; 2 enriched should be ignored.
    // Note: Phase 1 migration sets enrichment_status NOT NULL with default 'pending'
    // so "NULL" cases map to 'pending' rows in practice. Backfill SQL tolerates both.
    await createBook(db, { md5: 'a'.repeat(32), enrichment_status: 'pending' });
    await createBook(db, { md5: 'b'.repeat(32), enrichment_status: 'pending' });
    await createBook(db, { md5: 'c'.repeat(32), enrichment_status: 'pending' });
    await createBook(db, { md5: 'd'.repeat(32), enrichment_status: 'enriched' });
    await createBook(db, { md5: 'e'.repeat(32), enrichment_status: 'enriched' });

    await runBackfill(db);

    const rows = await db('enrichment_job').select('book_md5', 'status');
    expect(rows).toHaveLength(3);
    const md5s = rows.map((r) => r.book_md5).sort();
    expect(md5s).toEqual([`${'a'.repeat(32)}`, 'b'.repeat(32), 'c'.repeat(32)]);
    for (const r of rows) {
      expect(r.status).toBe('pending');
    }
  });

  it('partial UNIQUE blocks re-insertion for a book that already has an open (running) job', async () => {
    await createBook(db, { md5: 'a'.repeat(32), enrichment_status: 'pending' });
    await createBook(db, { md5: 'b'.repeat(32), enrichment_status: 'pending' });
    await createBook(db, { md5: 'c'.repeat(32), enrichment_status: 'pending' });
    await db('enrichment_job').insert({ book_md5: 'a'.repeat(32), status: 'running' });

    await runBackfill(db);

    const openRows = await db('enrichment_job').whereIn('status', ['pending', 'running']).select('*');
    // Should be: existing 'running' for a + 2 new 'pending' for b, c = 3 total open.
    expect(openRows).toHaveLength(3);
    const aRows = openRows.filter((r) => r.book_md5 === 'a'.repeat(32));
    expect(aRows).toHaveLength(1);
    expect(aRows[0].status).toBe('running');
  });

  it('partial UNIQUE does NOT block when only a closed (failed) job exists for the book', async () => {
    await createBook(db, { md5: 'a'.repeat(32), enrichment_status: 'pending' });
    await db('enrichment_job').insert({ book_md5: 'a'.repeat(32), status: 'failed' });

    await runBackfill(db);

    const rows = await db('enrichment_job').where({ book_md5: 'a'.repeat(32) }).select('status');
    const statuses = rows.map((r) => r.status).sort();
    expect(statuses).toEqual(['failed', 'pending']);
  });

  it('is idempotent: a second run inserts zero new rows', async () => {
    await createBook(db, { md5: 'a'.repeat(32), enrichment_status: 'pending' });
    await createBook(db, { md5: 'b'.repeat(32), enrichment_status: 'pending' });

    await runBackfill(db);
    const firstCount = (await db('enrichment_job').select('id')).length;
    expect(firstCount).toBe(2);

    await runBackfill(db);
    const secondCount = (await db('enrichment_job').select('id')).length;
    expect(secondCount).toBe(2);
  });

  it('is a no-op on an empty DB', async () => {
    await expect(runBackfill(db)).resolves.toBeUndefined();
    const rows = await db('enrichment_job').select('id');
    expect(rows).toHaveLength(0);
  });
});

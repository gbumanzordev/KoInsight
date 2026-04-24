import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { booksRouter } from '../../books/books-router';
import { createBook } from '../../db/factories/book-factory';
import { db } from '../../knex';

// Phase 5 Plan 02: prove POST /books/:bookId/re-enrich is idempotent end-to-end.
// Two back-to-back POSTs must produce at most one open enrichment_job row, and
// the response body.job.id must be stable across both responses. The Phase 1
// partial UNIQUE on `enrichment_job(book_md5) WHERE status IN ('pending','running')`
// is the DB-layer enforcer; ON CONFLICT DO NOTHING in enrichmentService.enqueue
// collapses the second insert (D-13 defense in depth).

describe('POST /books/:bookId/re-enrich idempotency', () => {
  const app = express();
  app.use(express.json());
  app.use('/books', booksRouter);

  async function countOpenJobs(md5: string): Promise<number> {
    const rows = await db('enrichment_job')
      .where({ book_md5: md5 })
      .whereIn('status', ['pending', 'running'])
      .select('id');
    return rows.length;
  }

  it('double-submit (sequential) produces exactly one open row and a stable job id', async () => {
    const md5 = '1'.repeat(32);
    const book = await createBook(db, { md5, enrichment_status: 'pending' });

    expect(await countOpenJobs(md5)).toBe(0);

    const first = await request(app).post(`/books/${book.id}/re-enrich`).send();
    expect(first.status).toBe(202);
    expect(first.body.job).not.toBeNull();
    expect(await countOpenJobs(md5)).toBe(1);

    const second = await request(app).post(`/books/${book.id}/re-enrich`).send();
    expect(second.status).toBe(202);
    expect(second.body.job).not.toBeNull();
    expect(await countOpenJobs(md5)).toBe(1);

    expect(second.body.job.id).toBe(first.body.job.id);
  });

  it('concurrent double-submit collapses to one open row via partial UNIQUE', async () => {
    const md5 = '2'.repeat(32);
    const book = await createBook(db, { md5, enrichment_status: 'pending' });

    expect(await countOpenJobs(md5)).toBe(0);

    const [a, b] = await Promise.all([
      request(app).post(`/books/${book.id}/re-enrich`).send(),
      request(app).post(`/books/${book.id}/re-enrich`).send(),
    ]);

    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(await countOpenJobs(md5)).toBe(1);
  });
});

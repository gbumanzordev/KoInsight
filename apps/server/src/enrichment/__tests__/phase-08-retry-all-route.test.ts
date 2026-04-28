import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createBook } from '../../db/factories/book-factory';
import { db } from '../../knex';
import { enrichmentRouter } from '../router';

// Phase 8 RED tests for RETRY-01 / CD-2: POST /api/enrichment/retry-all.
// Body schema z.object({}).strict() per T-08-03 mitigation: forbid unknown
// keys, reject non-boolean force. Wave 2 (Plan 03) lands the route handler.

describe('POST /enrichment/retry-all (Phase 8 RETRY-01)', () => {
  const app = express();
  app.use(express.json());
  app.use('/enrichment', enrichmentRouter);

  it('with 0 failed books -> 200 + { enqueued: 0, skipped: 0 }', async () => {
    await createBook(db, { md5: 'a'.repeat(32), enrichment_status: 'pending' });

    const response = await request(app).post('/enrichment/retry-all').send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ enqueued: 0, skipped: 0 });
  });

  it('with N=3 failed books -> 200 + { enqueued: 3, skipped: 0 }; rows flipped to pending', async () => {
    const a = await createBook(db, { md5: 'b'.repeat(32), enrichment_status: 'failed' });
    const b = await createBook(db, { md5: 'c'.repeat(32), enrichment_status: 'failed' });
    const c = await createBook(db, { md5: 'd'.repeat(32), enrichment_status: 'failed' });

    const response = await request(app).post('/enrichment/retry-all').send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ enqueued: 3, skipped: 0 });

    for (const book of [a, b, c]) {
      const updated = await db('book').where({ md5: book.md5 }).first();
      expect(updated.enrichment_status).toBe('pending');
    }

    const pendingJobs = await db('enrichment_job')
      .whereIn('book_md5', [a.md5, b.md5, c.md5])
      .andWhere({ status: 'pending' })
      .select('id');
    expect(pendingJobs).toHaveLength(3);
  });

  it('rejects unknown body keys with 400 (T-08-03: z.object({}).strict())', async () => {
    const response = await request(app)
      .post('/enrichment/retry-all')
      .send({ filter: 'foo' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('rejects non-boolean force with 400 (T-08-03)', async () => {
    const response = await request(app)
      .post('/enrichment/retry-all')
      .send({ force: 'yes' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });
});

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createBook } from '../../db/factories/book-factory';
import { db } from '../../knex';
import { enrichmentRouter } from '../router';

// Phase 5 Plan 03: GET /api/enrichment/unmatched
// Covers EDIT-04: paginated list of books with enrichment_status='failed',
// sorted by enrichment_job.updated_at DESC with book.title fallback.

describe('GET /enrichment/unmatched', () => {
  const app = express();
  app.use(express.json());
  app.use('/enrichment', enrichmentRouter);

  async function seedFailedJob(bookMd5: string, updatedAt: string, lastError = 'boom') {
    await db('enrichment_job').insert({
      book_md5: bookMd5,
      status: 'failed',
      attempts: 1,
      last_error: lastError,
      created_at: updatedAt,
      updated_at: updatedAt,
    });
  }

  it('returns empty list when no failed books exist', async () => {
    await createBook(db, { md5: 'a'.repeat(32), enrichment_status: 'pending' });

    const response = await request(app).get('/enrichment/unmatched');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ rows: [], total: 0, offset: 0, limit: 20 });
  });

  it('returns failed books sorted by most recently failed first', async () => {
    const oldest = await createBook(db, {
      md5: 'b'.repeat(32),
      title: 'Oldest',
      enrichment_status: 'failed',
    });
    const middle = await createBook(db, {
      md5: 'c'.repeat(32),
      title: 'Middle',
      enrichment_status: 'failed',
    });
    const newest = await createBook(db, {
      md5: 'd'.repeat(32),
      title: 'Newest',
      enrichment_status: 'failed',
    });

    await seedFailedJob(oldest.md5, '2024-01-01 00:00:00', 'old error');
    await seedFailedJob(middle.md5, '2024-06-01 00:00:00', 'mid error');
    await seedFailedJob(newest.md5, '2024-12-01 00:00:00', 'new error');

    const response = await request(app).get('/enrichment/unmatched');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(3);
    expect(response.body.rows).toHaveLength(3);
    expect(response.body.rows[0].title).toBe('Newest');
    expect(response.body.rows[1].title).toBe('Middle');
    expect(response.body.rows[2].title).toBe('Oldest');
    expect(response.body.rows[0].last_error).toBe('new error');
  });

  it('falls back to title ASC when updated_at is null (no matching failed job row)', async () => {
    await createBook(db, {
      md5: 'e'.repeat(32),
      title: 'Zebra',
      enrichment_status: 'failed',
    });
    await createBook(db, {
      md5: 'f'.repeat(32),
      title: 'Alpha',
      enrichment_status: 'failed',
    });

    const response = await request(app).get('/enrichment/unmatched');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(2);
    expect(response.body.rows).toHaveLength(2);
    expect(response.body.rows[0].title).toBe('Alpha');
    expect(response.body.rows[1].title).toBe('Zebra');
    expect(response.body.rows[0].last_error).toBeNull();
    expect(response.body.rows[0].job_updated_at).toBeNull();
  });

  it('respects offset and limit', async () => {
    for (let i = 0; i < 5; i++) {
      const md5 = String.fromCharCode(97 + i).repeat(32);
      await createBook(db, {
        md5,
        title: `Book ${i}`,
        enrichment_status: 'failed',
      });
      await seedFailedJob(md5, `2024-01-0${i + 1} 00:00:00`);
    }

    const response = await request(app).get('/enrichment/unmatched?offset=2&limit=2');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(5);
    expect(response.body.rows).toHaveLength(2);
    expect(response.body.offset).toBe(2);
    expect(response.body.limit).toBe(2);
  });

  it('rejects invalid limit=0 with 400', async () => {
    const response = await request(app).get('/enrichment/unmatched?limit=0');
    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('rejects limit=101 with 400', async () => {
    const response = await request(app).get('/enrichment/unmatched?limit=101');
    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('rejects negative offset with 400', async () => {
    const response = await request(app).get('/enrichment/unmatched?offset=-1');
    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('does NOT return enriched or pending books', async () => {
    await createBook(db, { md5: 'a'.repeat(32), title: 'P', enrichment_status: 'pending' });
    await createBook(db, { md5: 'b'.repeat(32), title: 'E', enrichment_status: 'enriched' });
    await createBook(db, { md5: 'c'.repeat(32), title: 'R', enrichment_status: 'running' });
    await createBook(db, { md5: 'd'.repeat(32), title: 'S', enrichment_status: 'skipped' });
    const failed = await createBook(db, {
      md5: 'e'.repeat(32),
      title: 'F',
      enrichment_status: 'failed',
    });

    const response = await request(app).get('/enrichment/unmatched');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.rows).toHaveLength(1);
    expect(response.body.rows[0].md5).toBe(failed.md5);
  });
});

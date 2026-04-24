import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createBook } from '../../db/factories/book-factory';
import { db } from '../../knex';
import { enrichmentRouter } from '../router';

// Phase 5 Plan 03: GET /api/enrichment/status
// Covers EDIT-05: { pending, running, enriched, failed, skipped } counters
// that match SELECT enrichment_status, COUNT(*) FROM book GROUP BY enrichment_status.

describe('GET /enrichment/status', () => {
  const app = express();
  app.use(express.json());
  app.use('/enrichment', enrichmentRouter);

  it('returns all-zero counters when book table is empty', async () => {
    const response = await request(app).get('/enrichment/status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      pending: 0,
      running: 0,
      enriched: 0,
      failed: 0,
      skipped: 0,
    });
  });

  it('returns accurate per-status counts and matches direct SQL GROUP BY', async () => {
    await createBook(db, { md5: 'a'.repeat(32), enrichment_status: 'pending' });
    await createBook(db, { md5: 'b'.repeat(32), enrichment_status: 'pending' });
    await createBook(db, { md5: 'c'.repeat(32), enrichment_status: 'enriched' });
    await createBook(db, { md5: 'd'.repeat(32), enrichment_status: 'enriched' });
    await createBook(db, { md5: 'e'.repeat(32), enrichment_status: 'enriched' });
    await createBook(db, { md5: 'f'.repeat(32), enrichment_status: 'failed' });

    const response = await request(app).get('/enrichment/status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      pending: 2,
      running: 0,
      enriched: 3,
      failed: 1,
      skipped: 0,
    });

    // Cross-check against direct SQL GROUP BY.
    const sqlRows = await db('book')
      .select('enrichment_status')
      .count<Array<{ enrichment_status: string; count: number | string }>>('* as count')
      .groupBy('enrichment_status');

    const sqlCounts: Record<string, number> = {
      pending: 0,
      running: 0,
      enriched: 0,
      failed: 0,
      skipped: 0,
    };
    for (const row of sqlRows) {
      sqlCounts[row.enrichment_status] = Number(row.count);
    }

    expect(response.body).toEqual(sqlCounts);
  });

  it('response keys are exactly pending|running|enriched|failed|skipped', async () => {
    const response = await request(app).get('/enrichment/status');

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual([
      'enriched',
      'failed',
      'pending',
      'running',
      'skipped',
    ]);
  });
});

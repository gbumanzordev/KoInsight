// Phase 6 Plan 05: end-to-end supertest coverage of /api/reports/*.
//
// Locks the wire contract for REPORT-01 (yearly) and REPORT-03 (years):
// status codes, JSON shape, Zod 400 payload, generic 500 body. The router is
// mounted on a fresh Express app per describe (no app.ts coupling).

import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../knex';
import { reportsRouter } from '../reports-router';
import * as reportsService from '../reports-service';
import { seedYearlyReportScenario } from './fixtures/yearly-report-fixture';

// 2024 UTC year boundaries (matches reports-repository.test.ts)
const Y_START = 1704067200; // 2024-01-01T00:00:00Z
const MID_2024 = 1719792000; // 2024-07-01T00:00:00Z

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/reports', reportsRouter);
  return app;
}

describe('GET /reports/years', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns sorted-desc years with reading activity', async () => {
    await seedYearlyReportScenario(db, {
      books: [
        {
          md5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pages: 100,
          referencePages: 100,
          pageStats: [
            { page: 50, startTimeSec: MID_2024, durationSec: 60 },
            { page: 100, startTimeSec: MID_2024 + 60, durationSec: 60 },
          ],
        },
        {
          md5: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          pages: 100,
          referencePages: 100,
          pageStats: [
            { page: 10, startTimeSec: 1688169600, durationSec: 60 }, // 2023-07-01
          ],
        },
      ],
    });

    const response = await request(makeApp()).get('/reports/years');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('years');
    expect(Array.isArray(response.body.years)).toBe(true);
    expect(response.body.years).toEqual([2024, 2023]);
  });

  it('returns 500 with generic body when service throws', async () => {
    vi.spyOn(reportsService.ReportsService, 'getYears').mockRejectedValueOnce(new Error('boom'));
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(makeApp()).get('/reports/years');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to load years' });
    expect(consoleErr).toHaveBeenCalled();
  });
});

describe('GET /reports/yearly', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function seedYearWithVariety() {
    // Seed:
    // - 1 fully-read book in 2024 with primary author (US, Fiction + Mystery genres)
    //   covers multi-genre per-row counting (D-06).
    // - 1 50% read book in 2024 (NOT counted in books-read but contributes to totals).
    // - 1 fully-read book in 2024 with NULL nationality (Unknown bucket).
    // - 1 fully-read book with publication_year known (decade bucket).
    return await seedYearlyReportScenario(db, {
      books: [
        {
          md5: '11111111111111111111111111111111',
          pages: 100,
          referencePages: 100,
          publicationYear: 2010,
          originalLanguage: 'en',
          primaryAuthor: { name: 'Author One', nationality: 'US' },
          genres: ['Fiction', 'Mystery'],
          pageStats: [
            { page: 50, startTimeSec: MID_2024, durationSec: 100 },
            { page: 100, startTimeSec: MID_2024 + 100, durationSec: 200 },
          ],
        },
        {
          md5: '22222222222222222222222222222222',
          pages: 100,
          referencePages: 100,
          publicationYear: 1995,
          originalLanguage: 'fr',
          primaryAuthor: { name: 'Author Two', nationality: null },
          genres: ['Fiction'],
          pageStats: [
            { page: 50, startTimeSec: MID_2024 + 1000, durationSec: 50 },
            { page: 100, startTimeSec: MID_2024 + 1100, durationSec: 50 },
          ],
        },
        {
          md5: '33333333333333333333333333333333',
          pages: 200,
          referencePages: 200,
          publicationYear: 2020,
          originalLanguage: 'en',
          primaryAuthor: { name: 'Author Three', nationality: 'GB' },
          genres: ['Mystery'],
          pageStats: [
            // 50% only -> NOT in books-read, but pages/time still aggregated
            { page: 50, startTimeSec: MID_2024 + 2000, durationSec: 75 },
            { page: 100, startTimeSec: MID_2024 + 2100, durationSec: 75 },
          ],
        },
      ],
    });
  }

  it('returns 200 with the documented YearlyReport JSON shape', async () => {
    await seedYearWithVariety();

    const response = await request(makeApp()).get('/reports/yearly?year=2024');

    expect(response.status).toBe(200);
    const body = response.body;
    expect(body).toMatchObject({
      year: 2024,
      totals: {
        books: expect.any(Number),
        pages: expect.any(Number),
        readTimeSeconds: expect.any(Number),
      },
      genre: expect.any(Array),
      nationality: expect.any(Array),
      decade: expect.any(Array),
      language: expect.any(Array),
      coverage: {
        total_books: expect.any(Number),
        genre_known: expect.any(Number),
        nationality_known: expect.any(Number),
        publication_year_known: expect.any(Number),
        original_language_known: expect.any(Number),
      },
    });
  });

  it('coverage uses repository denominators, not bar-height sum (REPORT-UI-04 / D-06)', async () => {
    await seedYearWithVariety();

    const response = await request(makeApp()).get('/reports/yearly?year=2024');

    expect(response.status).toBe(200);
    const body = response.body;
    // Genre is per-row (multi-genre books contribute multiple bars), so the sum
    // of bar heights >= total_books. The coverage denominator must therefore be
    // total_books >= genre_known (it is books-with-any-genre, NOT bar sum).
    expect(body.coverage.total_books).toBeGreaterThanOrEqual(body.coverage.genre_known);
  });

  it('decade keys are monotonically increasing with optional trailing Unknown', async () => {
    await seedYearWithVariety();

    const response = await request(makeApp()).get('/reports/yearly?year=2024');

    expect(response.status).toBe(200);
    const decades = response.body.decade as Array<{ key: string; count: number }>;
    const knownDecades = decades.filter((d) => d.key !== 'Unknown');
    const decadeNumbers = knownDecades.map((d) => parseInt(d.key, 10));
    for (let i = 1; i < decadeNumbers.length; i++) {
      expect(decadeNumbers[i]).toBeGreaterThan(decadeNumbers[i - 1]);
    }
    if (decades.some((d) => d.key === 'Unknown')) {
      // Unknown must be last when present
      expect(decades[decades.length - 1].key).toBe('Unknown');
    }
  });

  it('includes Other and Unknown buckets when nationality long-tail exceeds top-10', async () => {
    // Seed 12 distinct nationalities + 1 NULL nationality book to force both
    // 'Other' (rank 11+) and 'Unknown'.
    const codes = ['US', 'GB', 'FR', 'DE', 'IT', 'ES', 'JP', 'CN', 'IN', 'BR', 'CA', 'AU'];
    const books = codes.map((code, idx) => ({
      md5: `${(idx + 0xa).toString(16)}${code.toLowerCase()}`.padEnd(32, '0'),
      pages: 100,
      referencePages: 100,
      primaryAuthor: { name: `Author ${code}`, nationality: code },
      pageStats: [
        { page: 50, startTimeSec: MID_2024 + idx * 10, durationSec: 30 },
        { page: 100, startTimeSec: MID_2024 + idx * 10 + 5, durationSec: 30 },
      ],
    }));
    books.push({
      md5: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      pages: 100,
      referencePages: 100,
      primaryAuthor: { name: 'Author NULL', nationality: null },
      pageStats: [
        { page: 50, startTimeSec: MID_2024 + 500, durationSec: 30 },
        { page: 100, startTimeSec: MID_2024 + 505, durationSec: 30 },
      ],
    });

    await seedYearlyReportScenario(db, { books });

    const response = await request(makeApp()).get('/reports/yearly?year=2024');

    expect(response.status).toBe(200);
    const nationality = response.body.nationality as Array<{ key: string; count: number }>;
    expect(nationality.find((b) => b.key === 'Other')).toBeDefined();
    expect(nationality.find((b) => b.key === 'Unknown')).toBeDefined();
  });

  it('returns 200 with valid empty-shape JSON for a year with no reading (Nyquist 6)', async () => {
    // No seed at all; year is barren.
    const response = await request(makeApp()).get('/reports/yearly?year=2024');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      year: 2024,
      totals: { books: 0, pages: 0, readTimeSeconds: 0 },
      genre: [],
      nationality: [],
      decade: [],
      language: [],
      coverage: {
        total_books: 0,
        genre_known: 0,
        nationality_known: 0,
        publication_year_known: 0,
        original_language_known: 0,
      },
    });
  });

  it('returns 400 with Zod flattened payload when ?year is missing', async () => {
    const response = await request(makeApp()).get('/reports/yearly');

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toHaveProperty('fieldErrors');
    expect(response.body.error.fieldErrors).toHaveProperty('year');
    expect(Array.isArray(response.body.error.fieldErrors.year)).toBe(true);
  });

  it('returns 400 when ?year is non-numeric', async () => {
    const response = await request(makeApp()).get('/reports/yearly?year=abc');
    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });

  it('returns 400 when ?year is below the 1900 lower bound', async () => {
    const response = await request(makeApp()).get('/reports/yearly?year=1899');
    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });

  it('returns 400 when ?year is above the 2200 upper bound', async () => {
    const response = await request(makeApp()).get('/reports/yearly?year=2201');
    expect(response.status).toBe(400);
  });

  it('returns 500 with generic body when service throws', async () => {
    vi.spyOn(reportsService.ReportsService, 'getYearly').mockRejectedValueOnce(new Error('kaboom'));
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(makeApp()).get('/reports/yearly?year=2024');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to load yearly report' });
    expect(consoleErr).toHaveBeenCalled();
  });
});

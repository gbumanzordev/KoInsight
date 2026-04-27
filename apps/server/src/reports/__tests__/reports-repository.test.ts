// Phase 6 Plan 03: integration tests for the reports repository.
//
// Runs against the in-memory SQLite DB scaffolded by test/setup/test-setup.ts.
// Covers Nyquist samples 2 (94/95/96 page threshold) and 3 (50%-book contributes
// time but not books), plus soft-delete exclusion, primary-author filter, and
// the years-with-reading + coverage queries.

import { describe, expect, it, beforeEach } from 'vitest';

import { db } from '../../knex';
import {
  getBooksReadInYear,
  getCoverageCounts,
  getGenresForBooks,
  getOriginalLanguages,
  getPrimaryAuthorNationalities,
  getPublicationYears,
  getReadingTotalsInYear,
  getYearsWithReading,
} from '../reports-repository';
import { seedYearlyReportScenario } from './fixtures/yearly-report-fixture';

// 2024 UTC year bounds (from yearBoundsInZone(2024, 'UTC')).
const Y_START = 1704067200; // 2024-01-01T00:00:00Z
const Y_END = 1735689600; // 2025-01-01T00:00:00Z
// 2023 UTC year (used for "finished in Y-1" tests)
const Y_PREV_START = 1672531200; // 2023-01-01T00:00:00Z
// Mid-year timestamps for convenience
const MID_2024 = 1719792000; // 2024-07-01
const MID_2023 = 1688169600; // 2023-07-01
const MID_2022 = 1656633600; // 2022-07-01

describe('reports-repository', () => {
  describe('getBooksReadInYear (Nyquist sample 2: 94/95/96 page threshold)', () => {
    beforeEach(async () => {
      await seedYearlyReportScenario(db, {
        books: [
          {
            md5: 'md5-A',
            pages: 100,
            referencePages: 100,
            pageStats: [
              // Max page reached = 94 -> below 0.95 * 100 = 95 -> NOT counted
              { page: 50, startTimeSec: MID_2024, durationSec: 60 },
              { page: 94, startTimeSec: MID_2024 + 60, durationSec: 60 },
            ],
          },
          {
            md5: 'md5-B',
            pages: 100,
            referencePages: 100,
            pageStats: [
              { page: 50, startTimeSec: MID_2024, durationSec: 60 },
              { page: 95, startTimeSec: MID_2024 + 60, durationSec: 60 },
            ],
          },
          {
            md5: 'md5-C',
            pages: 100,
            referencePages: 100,
            pageStats: [
              { page: 50, startTimeSec: MID_2024, durationSec: 60 },
              { page: 96, startTimeSec: MID_2024 + 60, durationSec: 60 },
            ],
          },
        ],
      });
    });

    it('excludes book A (94 pages, below 95% threshold) and includes B (95) and C (96)', async () => {
      const md5s = await getBooksReadInYear(Y_START, Y_END);
      expect(md5s.sort()).toEqual(['md5-B', 'md5-C']);
    });
  });

  describe('getReadingTotalsInYear (Nyquist sample 3: incomplete books still contribute time)', () => {
    beforeEach(async () => {
      await seedYearlyReportScenario(db, {
        books: [
          {
            md5: 'md5-D',
            pages: 100,
            referencePages: 100,
            pageStats: [
              // Book D reaches page 50 in Y -> NOT in books-read-in-year
              { page: 25, startTimeSec: MID_2024, durationSec: 100 },
              { page: 50, startTimeSec: MID_2024 + 100, durationSec: 200 },
            ],
          },
        ],
      });
    });

    it('excludes the 50% book from books-read-in-year', async () => {
      const md5s = await getBooksReadInYear(Y_START, Y_END);
      expect(md5s).not.toContain('md5-D');
    });

    it('includes the 50% book duration in totalReadTimeSec', async () => {
      const totals = await getReadingTotalsInYear(Y_START, Y_END);
      expect(totals.totalReadTimeSec).toBe(300);
      expect(totals.totalPageTurns).toBe(2);
    });
  });

  describe('getBooksReadInYear (Y-1 finished book)', () => {
    beforeEach(async () => {
      await seedYearlyReportScenario(db, {
        books: [
          {
            md5: 'md5-E',
            pages: 100,
            referencePages: 100,
            pageStats: [
              // Reaches >=95% in Y-1, no rows in Y -> excluded from Y
              { page: 50, startTimeSec: MID_2023, durationSec: 60 },
              { page: 100, startTimeSec: MID_2023 + 60, durationSec: 60 },
            ],
          },
        ],
      });
    });

    it('excludes book finished in Y-1 with no Y page_stat rows', async () => {
      const md5s = await getBooksReadInYear(Y_START, Y_END);
      expect(md5s).not.toContain('md5-E');
    });
  });

  describe('soft-delete exclusion', () => {
    beforeEach(async () => {
      await seedYearlyReportScenario(db, {
        books: [
          {
            md5: 'md5-F',
            pages: 100,
            referencePages: 100,
            softDeleted: true,
            pageStats: [
              { page: 50, startTimeSec: MID_2024, durationSec: 60 },
              { page: 100, startTimeSec: MID_2024 + 60, durationSec: 60 },
            ],
          },
        ],
      });
    });

    it('excludes soft-deleted book from getBooksReadInYear', async () => {
      const md5s = await getBooksReadInYear(Y_START, Y_END);
      expect(md5s).not.toContain('md5-F');
    });
  });

  describe('getYearsWithReading', () => {
    it('returns distinct years sorted descending', async () => {
      await seedYearlyReportScenario(db, {
        books: [
          {
            md5: 'md5-Y',
            pages: 100,
            pageStats: [
              { page: 1, startTimeSec: MID_2022, durationSec: 10 },
              { page: 2, startTimeSec: MID_2023, durationSec: 10 },
              { page: 3, startTimeSec: MID_2024, durationSec: 10 },
            ],
          },
        ],
      });

      const years = await getYearsWithReading();
      expect(years).toEqual([2024, 2023, 2022]);
    });

    it('returns empty array when no page_stat rows exist', async () => {
      const years = await getYearsWithReading();
      expect(years).toEqual([]);
    });
  });

  describe('getCoverageCounts', () => {
    it('counts books with each enrichment field present', async () => {
      const { md5s } = await seedYearlyReportScenario(db, {
        books: [
          {
            md5: 'md5-cov-1',
            pages: 100,
            publicationYear: 2010,
            originalLanguage: 'en',
            primaryAuthor: { name: 'Author One', nationality: 'US' },
            genres: ['Fiction'],
            pageStats: [{ page: 100, startTimeSec: MID_2024, durationSec: 60 }],
          },
          {
            md5: 'md5-cov-2',
            pages: 100,
            publicationYear: null,
            originalLanguage: null,
            primaryAuthor: { name: 'Author Two', nationality: null },
            genres: [],
            pageStats: [{ page: 100, startTimeSec: MID_2024, durationSec: 60 }],
          },
        ],
      });

      const coverage = await getCoverageCounts(md5s);
      expect(coverage.total_books).toBe(2);
      expect(coverage.genre_known).toBe(1);
      expect(coverage.nationality_known).toBe(1);
      expect(coverage.publication_year_known).toBe(1);
      expect(coverage.original_language_known).toBe(1);
    });

    it('returns zeros for an empty md5 list', async () => {
      const coverage = await getCoverageCounts([]);
      expect(coverage).toEqual({
        total_books: 0,
        genre_known: 0,
        nationality_known: 0,
        publication_year_known: 0,
        original_language_known: 0,
      });
    });
  });

  describe('per-breakdown queries surface NULLs as null (service buckets them)', () => {
    let md5s: string[];

    beforeEach(async () => {
      const result = await seedYearlyReportScenario(db, {
        books: [
          {
            md5: 'md5-known',
            pages: 100,
            publicationYear: 1995,
            originalLanguage: 'fr',
            primaryAuthor: { name: 'Known Author', nationality: 'FR' },
            genres: ['Fiction'],
            pageStats: [{ page: 100, startTimeSec: MID_2024, durationSec: 60 }],
          },
          {
            md5: 'md5-unknown',
            pages: 100,
            publicationYear: null,
            originalLanguage: null,
            primaryAuthor: { name: 'Unknown Nationality', nationality: null },
            genres: [],
            pageStats: [{ page: 100, startTimeSec: MID_2024, durationSec: 60 }],
          },
        ],
      });
      md5s = result.md5s;
    });

    it('getPublicationYears returns null for books without a publication year', async () => {
      const rows = await getPublicationYears(md5s);
      const known = rows.find((r) => r.md5 === 'md5-known');
      const unknown = rows.find((r) => r.md5 === 'md5-unknown');
      expect(known?.publication_year).toBe(1995);
      expect(unknown?.publication_year).toBeNull();
    });

    it('getOriginalLanguages returns null for books without an original language', async () => {
      const rows = await getOriginalLanguages(md5s);
      const known = rows.find((r) => r.md5 === 'md5-known');
      const unknown = rows.find((r) => r.md5 === 'md5-unknown');
      expect(known?.original_language).toBe('fr');
      expect(unknown?.original_language).toBeNull();
    });

    it('getPrimaryAuthorNationalities returns null when the primary author has no nationality', async () => {
      const rows = await getPrimaryAuthorNationalities(md5s);
      const known = rows.find((r) => r.md5 === 'md5-known');
      const unknown = rows.find((r) => r.md5 === 'md5-unknown');
      expect(known?.nationality).toBe('FR');
      expect(unknown?.nationality).toBeNull();
    });

    it('getGenresForBooks returns one row per (book, genre) pair; books with no genre yield no rows', async () => {
      const rows = await getGenresForBooks(md5s);
      const knownRows = rows.filter((r) => r.md5 === 'md5-known');
      const unknownRows = rows.filter((r) => r.md5 === 'md5-unknown');
      expect(knownRows).toHaveLength(1);
      expect(knownRows[0].genre).toBe('Fiction');
      expect(unknownRows).toHaveLength(0);
    });
  });

  describe('getPrimaryAuthorNationalities (D-07: position=0 only)', () => {
    let md5s: string[];

    beforeEach(async () => {
      const result = await seedYearlyReportScenario(db, {
        books: [
          {
            md5: 'md5-multi-author',
            pages: 100,
            primaryAuthor: { name: 'Primary US', nationality: 'US' },
            coAuthors: [{ name: 'Coauthor JP', nationality: 'JP' }],
            pageStats: [{ page: 100, startTimeSec: MID_2024, durationSec: 60 }],
          },
        ],
      });
      md5s = result.md5s;
    });

    it('returns only the primary author nationality, ignoring co-authors', async () => {
      const rows = await getPrimaryAuthorNationalities(md5s);
      const row = rows.find((r) => r.md5 === 'md5-multi-author');
      expect(row?.nationality).toBe('US');
      // No second row for the coauthor's JP nationality
      expect(rows.filter((r) => r.md5 === 'md5-multi-author')).toHaveLength(1);
    });
  });
});

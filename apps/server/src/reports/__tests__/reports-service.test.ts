// Phase 6 Plan 04: reports-service unit tests.
//
// Pure-helper tests use hand-built input arrays and need no mocks.
// Service-level tests mock '../reports-repository' to fake repo outputs and
// exercise the shaping logic end-to-end without a database.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { bucketWithUnknown, truncateTopN, fillDecades, ReportsService } from '../reports-service';

vi.mock('../reports-repository', () => ({
  getYearsWithReading: vi.fn(),
  getBooksReadInYear: vi.fn(),
  getReadingTotalsInYear: vi.fn(),
  getGenresForBooks: vi.fn(),
  getPrimaryAuthorNationalities: vi.fn(),
  getPublicationYears: vi.fn(),
  getOriginalLanguages: vi.fn(),
  getCoverageCounts: vi.fn(),
  getBooksMetadata: vi.fn(),
}));

import * as repo from '../reports-repository';

describe('bucketWithUnknown', () => {
  it('per-book: counts distinct md5s per value, sorts count desc then key asc, places Unknown last', () => {
    const rows = [
      { md5: 'a', value: 'US' },
      { md5: 'b', value: 'US' },
      { md5: 'c', value: 'JP' },
      { md5: 'd', value: null },
    ];
    expect(bucketWithUnknown(rows, 'per-book')).toEqual([
      { key: 'US', count: 2 },
      { key: 'JP', count: 1 },
      { key: 'Unknown', count: 1 },
    ]);
  });

  it('per-row: counts every row (a book contributes once per row, e.g. multi-genre)', () => {
    const rows = [
      { md5: 'a', value: 'fiction' },
      { md5: 'a', value: 'mystery' },
      { md5: 'b', value: 'fiction' },
    ];
    expect(bucketWithUnknown(rows, 'per-row')).toEqual([
      { key: 'fiction', count: 2 },
      { key: 'mystery', count: 1 },
    ]);
  });

  it('per-row: NULL values surface as Unknown bucket', () => {
    const rows = [
      { md5: 'a', value: 'fiction' },
      { md5: 'b', value: null },
    ];
    expect(bucketWithUnknown(rows, 'per-row')).toEqual([
      { key: 'fiction', count: 1 },
      { key: 'Unknown', count: 1 },
    ]);
  });

  it('per-book: tiebreak by key ASC when counts are equal', () => {
    const rows = [
      { md5: 'a', value: 'B' },
      { md5: 'b', value: 'A' },
    ];
    expect(bucketWithUnknown(rows, 'per-book')).toEqual([
      { key: 'A', count: 1 },
      { key: 'B', count: 1 },
    ]);
  });

  it('returns [] for empty input (does NOT inject a {Unknown,0} bucket)', () => {
    expect(bucketWithUnknown([], 'per-book')).toEqual([]);
    expect(bucketWithUnknown([], 'per-row')).toEqual([]);
  });
});

describe('truncateTopN', () => {
  it('aggregates the long tail into Other and preserves Unknown as separate trailing entry', () => {
    const input = [
      { key: 'A', count: 5 },
      { key: 'B', count: 4 },
      { key: 'C', count: 3 },
      { key: 'D', count: 2 },
      { key: 'Unknown', count: 1 },
    ];
    expect(truncateTopN(input, 2)).toEqual([
      { key: 'A', count: 5 },
      { key: 'B', count: 4 },
      { key: 'Other', count: 5 },
      { key: 'Unknown', count: 1 },
    ]);
  });

  it('preserves Unknown even when it would rank in the top-N (never folds it into Other)', () => {
    const input = [
      { key: 'A', count: 10 },
      { key: 'Unknown', count: 8 },
      { key: 'B', count: 4 },
      { key: 'C', count: 2 },
    ];
    // Unknown is high-count but must always be the LAST entry.
    expect(truncateTopN(input, 2)).toEqual([
      { key: 'A', count: 10 },
      { key: 'B', count: 4 },
      { key: 'Other', count: 2 },
      { key: 'Unknown', count: 8 },
    ]);
  });

  it('no-op when total non-Unknown buckets <= N (no Other entry added)', () => {
    const input = [
      { key: 'A', count: 1 },
      { key: 'Unknown', count: 0 },
    ];
    expect(truncateTopN(input, 10)).toEqual([
      { key: 'A', count: 1 },
      { key: 'Unknown', count: 0 },
    ]);
  });

  it('tiebreak: equal counts sort by key ASC', () => {
    const input = [
      { key: 'B', count: 4 },
      { key: 'A', count: 4 },
      { key: 'C', count: 4 },
      { key: 'D', count: 4 },
    ];
    expect(truncateTopN(input, 2)).toEqual([
      { key: 'A', count: 4 },
      { key: 'B', count: 4 },
      { key: 'Other', count: 8 },
    ]);
  });

  it('handles empty input', () => {
    expect(truncateTopN([], 10)).toEqual([]);
  });
});

describe('fillDecades', () => {
  it('groups years into decades and appends Unknown for NULL publication_year', () => {
    expect(
      fillDecades([
        { md5: 'a', publication_year: 1995 },
        { md5: 'b', publication_year: 2003 },
        { md5: 'c', publication_year: null },
      ])
    ).toEqual([
      { key: '1990s', count: 1 },
      { key: '2000s', count: 1 },
      { key: 'Unknown', count: 1 },
    ]);
  });

  it('zero-fills decade gaps between min and max', () => {
    expect(
      fillDecades([
        { md5: 'a', publication_year: 1990 },
        { md5: 'b', publication_year: 2020 },
      ])
    ).toEqual([
      { key: '1990s', count: 1 },
      { key: '2000s', count: 0 },
      { key: '2010s', count: 0 },
      { key: '2020s', count: 1 },
    ]);
  });

  it('all unknown: returns only the Unknown bucket', () => {
    expect(
      fillDecades([
        { md5: 'a', publication_year: null },
        { md5: 'b', publication_year: null },
      ])
    ).toEqual([{ key: 'Unknown', count: 2 }]);
  });

  it('empty input returns []', () => {
    expect(fillDecades([])).toEqual([]);
  });

  it('decade boundary years bucket correctly (1999 -> 1990s, 2000 -> 2000s)', () => {
    expect(
      fillDecades([
        { md5: 'a', publication_year: 1999 },
        { md5: 'b', publication_year: 2000 },
      ])
    ).toEqual([
      { key: '1990s', count: 1 },
      { key: '2000s', count: 1 },
    ]);
  });
});

describe('ReportsService.getYears', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to repository.getYearsWithReading and shapes the response', async () => {
    vi.mocked(repo.getYearsWithReading).mockResolvedValueOnce([2024, 2023, 2022]);
    const result = await ReportsService.getYears();
    expect(result).toEqual({ years: [2024, 2023, 2022] });
    expect(repo.getYearsWithReading).toHaveBeenCalledTimes(1);
  });

  it('returns empty array when there is no reading data', async () => {
    vi.mocked(repo.getYearsWithReading).mockResolvedValueOnce([]);
    expect(await ReportsService.getYears()).toEqual({ years: [] });
  });
});

describe('ReportsService.getYearly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repo.getBooksMetadata).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('empty-year contract: zero books read returns zeroed totals, empty buckets, zero coverage', async () => {
    vi.mocked(repo.getBooksReadInYear).mockResolvedValueOnce([]);
    vi.mocked(repo.getReadingTotalsInYear).mockResolvedValueOnce({
      totalReadTimeSec: 0,
      totalPageTurns: 0,
    });
    vi.mocked(repo.getGenresForBooks).mockResolvedValueOnce([]);
    vi.mocked(repo.getPrimaryAuthorNationalities).mockResolvedValueOnce([]);
    vi.mocked(repo.getPublicationYears).mockResolvedValueOnce([]);
    vi.mocked(repo.getOriginalLanguages).mockResolvedValueOnce([]);
    vi.mocked(repo.getCoverageCounts).mockResolvedValueOnce({
      total_books: 0,
      genre_known: 0,
      nationality_known: 0,
      publication_year_known: 0,
      original_language_known: 0,
    });

    const result = await ReportsService.getYearly(2024);

    expect(result).toEqual({
      year: 2024,
      totals: { books: 0, pages: 0, readTimeSeconds: 0 },
      genre: [],
      nationality: [],
      decade: [],
      language: [],
      books: [],
      coverage: {
        total_books: 0,
        genre_known: 0,
        nationality_known: 0,
        publication_year_known: 0,
        original_language_known: 0,
      },
    });
  });

  it('totals reflect repository: books = md5 count, pages = page-turns, readTime = seconds (page-time totals include all reading)', async () => {
    vi.mocked(repo.getBooksReadInYear).mockResolvedValueOnce(['a', 'b', 'c']);
    vi.mocked(repo.getReadingTotalsInYear).mockResolvedValueOnce({
      totalReadTimeSec: 12345,
      totalPageTurns: 678,
    });
    vi.mocked(repo.getGenresForBooks).mockResolvedValueOnce([]);
    vi.mocked(repo.getPrimaryAuthorNationalities).mockResolvedValueOnce([]);
    vi.mocked(repo.getPublicationYears).mockResolvedValueOnce([]);
    vi.mocked(repo.getOriginalLanguages).mockResolvedValueOnce([]);
    vi.mocked(repo.getCoverageCounts).mockResolvedValueOnce({
      total_books: 3,
      genre_known: 0,
      nationality_known: 0,
      publication_year_known: 0,
      original_language_known: 0,
    });

    const result = await ReportsService.getYearly(2024);
    expect(result.totals).toEqual({ books: 3, pages: 678, readTimeSeconds: 12345 });
  });

  it('genre breakdown: per-row counting + injects Unknown for books with no genre rows', async () => {
    // 3 books read, but only 'a' and 'b' have genre rows. 'c' has none -> Unknown=1.
    // 'a' is multi-genre (fiction + mystery) so per-row counting gives fiction=2, mystery=1.
    vi.mocked(repo.getBooksReadInYear).mockResolvedValueOnce(['a', 'b', 'c']);
    vi.mocked(repo.getReadingTotalsInYear).mockResolvedValueOnce({
      totalReadTimeSec: 0,
      totalPageTurns: 0,
    });
    vi.mocked(repo.getGenresForBooks).mockResolvedValueOnce([
      { md5: 'a', genre: 'fiction' },
      { md5: 'a', genre: 'mystery' },
      { md5: 'b', genre: 'fiction' },
    ]);
    vi.mocked(repo.getPrimaryAuthorNationalities).mockResolvedValueOnce([]);
    vi.mocked(repo.getPublicationYears).mockResolvedValueOnce([]);
    vi.mocked(repo.getOriginalLanguages).mockResolvedValueOnce([]);
    vi.mocked(repo.getCoverageCounts).mockResolvedValueOnce({
      total_books: 3,
      genre_known: 2,
      nationality_known: 0,
      publication_year_known: 0,
      original_language_known: 0,
    });

    const result = await ReportsService.getYearly(2024);
    expect(result.genre).toEqual([
      { key: 'fiction', count: 2 },
      { key: 'mystery', count: 1 },
      { key: 'Unknown', count: 1 },
    ]);
  });

  it('genre: does NOT inject Unknown when every book has at least one genre row', async () => {
    vi.mocked(repo.getBooksReadInYear).mockResolvedValueOnce(['a', 'b']);
    vi.mocked(repo.getReadingTotalsInYear).mockResolvedValueOnce({
      totalReadTimeSec: 0,
      totalPageTurns: 0,
    });
    vi.mocked(repo.getGenresForBooks).mockResolvedValueOnce([
      { md5: 'a', genre: 'fiction' },
      { md5: 'b', genre: 'mystery' },
    ]);
    vi.mocked(repo.getPrimaryAuthorNationalities).mockResolvedValueOnce([]);
    vi.mocked(repo.getPublicationYears).mockResolvedValueOnce([]);
    vi.mocked(repo.getOriginalLanguages).mockResolvedValueOnce([]);
    vi.mocked(repo.getCoverageCounts).mockResolvedValueOnce({
      total_books: 2,
      genre_known: 2,
      nationality_known: 0,
      publication_year_known: 0,
      original_language_known: 0,
    });

    const result = await ReportsService.getYearly(2024);
    expect(result.genre).toEqual([
      { key: 'fiction', count: 1 },
      { key: 'mystery', count: 1 },
    ]);
  });

  it('nationality: top-10 + Other + Unknown; sum(top-10) + Other.count = books with known nationality (Nyquist 5)', async () => {
    // 13 distinct nationalities + 2 Unknown books. Top-10 keeps the 10 biggest, the
    // remaining 3 become Other, and Unknown stays as a real entry.
    const md5s = Array.from({ length: 30 }, (_, i) => `m${i}`);
    vi.mocked(repo.getBooksReadInYear).mockResolvedValueOnce(md5s);
    vi.mocked(repo.getReadingTotalsInYear).mockResolvedValueOnce({
      totalReadTimeSec: 0,
      totalPageTurns: 0,
    });
    vi.mocked(repo.getGenresForBooks).mockResolvedValueOnce([]);
    // Build 13 nationality groups: counts = [13,12,11,10,9,8,7,6,5,4,3,2,1] = 91 books with known nationality.
    // Plus 2 books with NULL nationality (Unknown).
    const counts = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    const nationalities = [
      'US',
      'JP',
      'GB',
      'FR',
      'DE',
      'IT',
      'ES',
      'CA',
      'AU',
      'NZ',
      'BR',
      'MX',
      'AR',
    ];
    const natRows: Array<{ md5: string; nationality: string | null }> = [];
    let cursor = 0;
    counts.forEach((c, i) => {
      for (let k = 0; k < c; k++) {
        natRows.push({ md5: `nat-${cursor++}`, nationality: nationalities[i] });
      }
    });
    natRows.push({ md5: 'unk-1', nationality: null });
    natRows.push({ md5: 'unk-2', nationality: null });
    vi.mocked(repo.getPrimaryAuthorNationalities).mockResolvedValueOnce(natRows);
    vi.mocked(repo.getPublicationYears).mockResolvedValueOnce([]);
    vi.mocked(repo.getOriginalLanguages).mockResolvedValueOnce([]);
    vi.mocked(repo.getCoverageCounts).mockResolvedValueOnce({
      total_books: md5s.length,
      genre_known: 0,
      nationality_known: 91,
      publication_year_known: 0,
      original_language_known: 0,
    });

    const result = await ReportsService.getYearly(2024);
    // Expect 12 entries: top-10 + Other + Unknown.
    expect(result.nationality).toHaveLength(12);
    const top10 = result.nationality.slice(0, 10);
    const other = result.nationality[10];
    const unknown = result.nationality[11];
    expect(other).toEqual({ key: 'Other', count: 3 + 2 + 1 });
    expect(unknown).toEqual({ key: 'Unknown', count: 2 });
    // Nyquist 5: top-10 + Other = total known nationality.
    const sumTop10 = top10.reduce((s, b) => s + b.count, 0);
    expect(sumTop10 + other.count).toBe(91);
  });

  it('nationality: injects Unknown for books with no book_author row at all', async () => {
    // 4 books read. Repo returns 2 with US, 1 with NULL, 1 missing entirely (no book_author row).
    vi.mocked(repo.getBooksReadInYear).mockResolvedValueOnce(['a', 'b', 'c', 'd']);
    vi.mocked(repo.getReadingTotalsInYear).mockResolvedValueOnce({
      totalReadTimeSec: 0,
      totalPageTurns: 0,
    });
    vi.mocked(repo.getGenresForBooks).mockResolvedValueOnce([]);
    vi.mocked(repo.getPrimaryAuthorNationalities).mockResolvedValueOnce([
      { md5: 'a', nationality: 'US' },
      { md5: 'b', nationality: 'US' },
      { md5: 'c', nationality: null },
      // 'd' missing entirely
    ]);
    vi.mocked(repo.getPublicationYears).mockResolvedValueOnce([]);
    vi.mocked(repo.getOriginalLanguages).mockResolvedValueOnce([]);
    vi.mocked(repo.getCoverageCounts).mockResolvedValueOnce({
      total_books: 4,
      genre_known: 0,
      nationality_known: 2,
      publication_year_known: 0,
      original_language_known: 0,
    });

    const result = await ReportsService.getYearly(2024);
    // US=2, Unknown=2 (one explicit NULL + one missing row).
    expect(result.nationality).toEqual([
      { key: 'US', count: 2 },
      { key: 'Unknown', count: 2 },
    ]);
  });

  it('decade: zero-fills gaps and trails with Unknown for NULL publication_year', async () => {
    vi.mocked(repo.getBooksReadInYear).mockResolvedValueOnce(['a', 'b', 'c']);
    vi.mocked(repo.getReadingTotalsInYear).mockResolvedValueOnce({
      totalReadTimeSec: 0,
      totalPageTurns: 0,
    });
    vi.mocked(repo.getGenresForBooks).mockResolvedValueOnce([]);
    vi.mocked(repo.getPrimaryAuthorNationalities).mockResolvedValueOnce([]);
    vi.mocked(repo.getPublicationYears).mockResolvedValueOnce([
      { md5: 'a', publication_year: 1990 },
      { md5: 'b', publication_year: 2010 },
      { md5: 'c', publication_year: null },
    ]);
    vi.mocked(repo.getOriginalLanguages).mockResolvedValueOnce([]);
    vi.mocked(repo.getCoverageCounts).mockResolvedValueOnce({
      total_books: 3,
      genre_known: 0,
      nationality_known: 0,
      publication_year_known: 2,
      original_language_known: 0,
    });

    const result = await ReportsService.getYearly(2024);
    expect(result.decade).toEqual([
      { key: '1990s', count: 1 },
      { key: '2000s', count: 0 },
      { key: '2010s', count: 1 },
      { key: 'Unknown', count: 1 },
    ]);
  });

  it('decade: also injects Unknown for books with no publication_year row at all', async () => {
    // 3 books read, repo returns rows for only 2; the third missing row should
    // count as Unknown.
    vi.mocked(repo.getBooksReadInYear).mockResolvedValueOnce(['a', 'b', 'c']);
    vi.mocked(repo.getReadingTotalsInYear).mockResolvedValueOnce({
      totalReadTimeSec: 0,
      totalPageTurns: 0,
    });
    vi.mocked(repo.getGenresForBooks).mockResolvedValueOnce([]);
    vi.mocked(repo.getPrimaryAuthorNationalities).mockResolvedValueOnce([]);
    vi.mocked(repo.getPublicationYears).mockResolvedValueOnce([
      { md5: 'a', publication_year: 2000 },
      { md5: 'b', publication_year: 2000 },
    ]);
    vi.mocked(repo.getOriginalLanguages).mockResolvedValueOnce([]);
    vi.mocked(repo.getCoverageCounts).mockResolvedValueOnce({
      total_books: 3,
      genre_known: 0,
      nationality_known: 0,
      publication_year_known: 2,
      original_language_known: 0,
    });

    const result = await ReportsService.getYearly(2024);
    expect(result.decade).toEqual([
      { key: '2000s', count: 2 },
      { key: 'Unknown', count: 1 },
    ]);
  });

  it('language: per-book bucket with Unknown for NULL and for missing rows', async () => {
    vi.mocked(repo.getBooksReadInYear).mockResolvedValueOnce(['a', 'b', 'c', 'd']);
    vi.mocked(repo.getReadingTotalsInYear).mockResolvedValueOnce({
      totalReadTimeSec: 0,
      totalPageTurns: 0,
    });
    vi.mocked(repo.getGenresForBooks).mockResolvedValueOnce([]);
    vi.mocked(repo.getPrimaryAuthorNationalities).mockResolvedValueOnce([]);
    vi.mocked(repo.getPublicationYears).mockResolvedValueOnce([]);
    vi.mocked(repo.getOriginalLanguages).mockResolvedValueOnce([
      { md5: 'a', original_language: 'en' },
      { md5: 'b', original_language: 'en' },
      { md5: 'c', original_language: null },
      // 'd' missing
    ]);
    vi.mocked(repo.getCoverageCounts).mockResolvedValueOnce({
      total_books: 4,
      genre_known: 0,
      nationality_known: 0,
      publication_year_known: 0,
      original_language_known: 2,
    });

    const result = await ReportsService.getYearly(2024);
    expect(result.language).toEqual([
      { key: 'en', count: 2 },
      { key: 'Unknown', count: 2 },
    ]);
  });

  it('coverage: passes through repository.getCoverageCounts unchanged (Nyquist 4 banner uses repo denominator, NOT bar-height sum)', async () => {
    vi.mocked(repo.getBooksReadInYear).mockResolvedValueOnce(['a', 'b']);
    vi.mocked(repo.getReadingTotalsInYear).mockResolvedValueOnce({
      totalReadTimeSec: 0,
      totalPageTurns: 0,
    });
    // Multi-genre book: bar heights would sum to 3, but coverage.genre_known is 1.
    vi.mocked(repo.getGenresForBooks).mockResolvedValueOnce([
      { md5: 'a', genre: 'fiction' },
      { md5: 'a', genre: 'mystery' },
      { md5: 'a', genre: 'thriller' },
    ]);
    vi.mocked(repo.getPrimaryAuthorNationalities).mockResolvedValueOnce([]);
    vi.mocked(repo.getPublicationYears).mockResolvedValueOnce([]);
    vi.mocked(repo.getOriginalLanguages).mockResolvedValueOnce([]);
    vi.mocked(repo.getCoverageCounts).mockResolvedValueOnce({
      total_books: 2,
      genre_known: 1,
      nationality_known: 0,
      publication_year_known: 0,
      original_language_known: 0,
    });

    const result = await ReportsService.getYearly(2024);
    expect(result.coverage).toEqual({
      total_books: 2,
      genre_known: 1,
      nationality_known: 0,
      publication_year_known: 0,
      original_language_known: 0,
    });
    // Bar heights sum to 3 + Unknown=1, NOT 1.
    const genreSum = result.genre.reduce((s, b) => s + b.count, 0);
    expect(genreSum).toBe(4);
  });

  it('passes the configured timezone through to repository via yearBoundsInZone', async () => {
    // The service reads appConfig.reports.timeZone. We cannot easily change it
    // mid-test (config is read at module load) but we can assert that the start
    // and end seconds passed to the repo are a valid UTC year boundary pair
    // when the default UTC zone is used.
    vi.mocked(repo.getBooksReadInYear).mockResolvedValueOnce([]);
    vi.mocked(repo.getReadingTotalsInYear).mockResolvedValueOnce({
      totalReadTimeSec: 0,
      totalPageTurns: 0,
    });
    vi.mocked(repo.getGenresForBooks).mockResolvedValueOnce([]);
    vi.mocked(repo.getPrimaryAuthorNationalities).mockResolvedValueOnce([]);
    vi.mocked(repo.getPublicationYears).mockResolvedValueOnce([]);
    vi.mocked(repo.getOriginalLanguages).mockResolvedValueOnce([]);
    vi.mocked(repo.getCoverageCounts).mockResolvedValueOnce({
      total_books: 0,
      genre_known: 0,
      nationality_known: 0,
      publication_year_known: 0,
      original_language_known: 0,
    });

    await ReportsService.getYearly(2024);

    // Repo should have been called with the year boundary pair. Default REPORT_TZ
    // is UTC in tests, so 2024 spans [1704067200, 1735689600).
    expect(repo.getBooksReadInYear).toHaveBeenCalledWith(1704067200, 1735689600);
    expect(repo.getReadingTotalsInYear).toHaveBeenCalledWith(1704067200, 1735689600);
  });
});

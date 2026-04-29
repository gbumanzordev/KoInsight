// Phase 6 Plan 04: reports service.
//
// Composes the SQL primitives from reports-repository (06-03) and the TZ
// helper from tz.ts (06-02) into the @koinsight/common YearlyReport wire shape.
//
// All shaping logic is pure (no DB) and individually unit-tested:
//   - bucketWithUnknown: groups raw rows by value, NULL -> 'Unknown'
//   - truncateTopN: top-N + 'Other' aggregation, preserves 'Unknown' as the
//     trailing entry (per CONTEXT D-03 + REPORT-05); see RESEARCH Pattern 4.
//   - fillDecades: zero-fills decade buckets between min and max known
//     publication_year; trails with 'Unknown' for NULLs (per CONTEXT D-05);
//     see RESEARCH Pattern 5.
//
// Genre breakdown counts each book once per canonical genre (multi-genre
// books appear in multiple bars per CONTEXT D-06); books with no genres
// contribute one count to the 'Unknown' bucket via service-level injection.
// Coverage denominator is always the repository-supplied count, NOT the sum
// of bar heights.

import type { YearlyReport, YearlyReportBucket, YearsResponse } from '@koinsight/common/types';

import { appConfig } from '../config';
import * as repo from './reports-repository';
import { yearBoundsInZone } from './tz';

const UNKNOWN_KEY = 'Unknown';
const OTHER_KEY = 'Other';
const NATIONALITY_TOP_N = 10;

/**
 * Group raw {md5, value} rows into {key, count} buckets.
 *
 * - 'per-book' counts distinct md5s per value; use for nationality + language
 *   (where each book contributes exactly one count to its bucket).
 * - 'per-row' counts every row; use for genre, where a multi-genre book
 *   contributes one count per genre row (per CONTEXT D-06).
 *
 * NULL values surface as a real {key: 'Unknown', count: N} bucket placed last.
 * Tiebreak: count DESC, key ASC. Empty input returns []; never injects a
 * {Unknown, 0} bucket.
 */
export function bucketWithUnknown(
  rows: Array<{ md5: string; value: string | null }>,
  counter: 'per-book' | 'per-row'
): YearlyReportBucket[] {
  if (rows.length === 0) return [];

  const knownCounts = new Map<string, Set<string> | number>();
  let unknownCount = 0;
  // For per-book we deduplicate by md5; for per-row we count every row.
  for (const { md5, value } of rows) {
    if (value === null) {
      if (counter === 'per-book') {
        // Track Unknown md5s as distinct as well, for consistency.
        unknownCount = Math.max(unknownCount, 0);
        const existing = knownCounts.get(UNKNOWN_KEY);
        if (existing instanceof Set) {
          existing.add(md5);
        } else {
          knownCounts.set(UNKNOWN_KEY, new Set([md5]));
        }
      } else {
        unknownCount += 1;
      }
      continue;
    }
    if (counter === 'per-book') {
      const existing = knownCounts.get(value);
      if (existing instanceof Set) {
        existing.add(md5);
      } else {
        knownCounts.set(value, new Set([md5]));
      }
    } else {
      const existing = knownCounts.get(value);
      knownCounts.set(value, (typeof existing === 'number' ? existing : 0) + 1);
    }
  }

  const buckets: YearlyReportBucket[] = [];
  let unknownBucket: YearlyReportBucket | null = null;

  for (const [key, value] of knownCounts.entries()) {
    const count = value instanceof Set ? value.size : value;
    if (key === UNKNOWN_KEY) {
      unknownBucket = { key, count };
    } else {
      buckets.push({ key, count });
    }
  }
  if (counter === 'per-row' && unknownCount > 0) {
    unknownBucket = { key: UNKNOWN_KEY, count: unknownCount };
  }

  buckets.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return unknownBucket ? [...buckets, unknownBucket] : buckets;
}

/**
 * Top-N + 'Other' truncation. Preserves the 'Unknown' bucket as a real
 * trailing entry regardless of its rank. Tail aggregates into a single
 * {key: 'Other', count: SUM} entry. No-op when total non-Unknown buckets <= N.
 *
 * Tiebreak: count DESC, key ASC (matches Pitfall 8).
 */
export function truncateTopN(buckets: YearlyReportBucket[], n: number): YearlyReportBucket[] {
  if (buckets.length === 0) return [];
  const unknown = buckets.find((b) => b.key === UNKNOWN_KEY) ?? null;
  const known = buckets
    .filter((b) => b.key !== UNKNOWN_KEY)
    .slice()
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  if (known.length <= n) {
    return unknown ? [...known, unknown] : known;
  }

  const top = known.slice(0, n);
  const tail = known.slice(n);
  const other: YearlyReportBucket = {
    key: OTHER_KEY,
    count: tail.reduce((s, r) => s + r.count, 0),
  };
  return unknown ? [...top, other, unknown] : [...top, other];
}

function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}

/**
 * Group books by publication-year decade. Zero-fills gaps between the min
 * and max known decade so the histogram has no holes. NULL years aggregate
 * into a trailing {key: 'Unknown', count: N} entry (per CONTEXT D-05).
 * Empty input returns [].
 */
export function fillDecades(
  rows: Array<{ md5: string; publication_year: number | null }>
): YearlyReportBucket[] {
  if (rows.length === 0) return [];

  const known = rows.filter(
    (r): r is { md5: string; publication_year: number } => r.publication_year != null
  );
  const unknownCount = rows.length - known.length;

  if (known.length === 0) {
    return unknownCount > 0 ? [{ key: UNKNOWN_KEY, count: unknownCount }] : [];
  }

  const years = known.map((r) => r.publication_year);
  const minDecade = decadeOf(Math.min(...years));
  const maxDecade = decadeOf(Math.max(...years));

  const counts = new Map<number, number>();
  for (let d = minDecade; d <= maxDecade; d += 10) counts.set(d, 0);
  for (const r of known) {
    const d = decadeOf(r.publication_year);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }

  const decades: YearlyReportBucket[] = Array.from(counts.entries())
    .sort(([a], [b]) => a - b)
    .map(([d, c]) => ({ key: `${d}s`, count: c }));

  return unknownCount > 0 ? [...decades, { key: UNKNOWN_KEY, count: unknownCount }] : decades;
}

/**
 * Inject an Unknown bucket sized as `total_books - bookCountWithRows`.
 *
 * Used for breakdowns where the repository emits one row per book ONLY when
 * the field is populated; books with no row at all should still surface as
 * Unknown. (Genre uses per-row counting and may also need the multi-genre
 * book case handled here.)
 */
function injectMissingRowsAsUnknown(
  buckets: YearlyReportBucket[],
  totalBooks: number,
  booksWithRows: number
): YearlyReportBucket[] {
  const missing = totalBooks - booksWithRows;
  if (missing <= 0) return buckets;

  const existingUnknown = buckets.find((b) => b.key === UNKNOWN_KEY);
  if (existingUnknown) {
    return buckets.map((b) =>
      b.key === UNKNOWN_KEY ? { key: UNKNOWN_KEY, count: b.count + missing } : b
    );
  }
  return [...buckets, { key: UNKNOWN_KEY, count: missing }];
}

export class ReportsService {
  static async getYears(): Promise<YearsResponse> {
    const years = await repo.getYearsWithReading();
    return { years };
  }

  static async getYearly(year: number): Promise<YearlyReport> {
    const tz = appConfig.reports.timeZone;
    const { startSec, endSec } = yearBoundsInZone(year, tz);

    const md5s = await repo.getBooksReadInYear(startSec, endSec);

    const [totals, genreRows, natRows, yearRows, langRows, coverage, booksRows] =
      await Promise.all([
        repo.getReadingTotalsInYear(startSec, endSec),
        repo.getGenresForBooks(md5s),
        repo.getPrimaryAuthorNationalities(md5s),
        repo.getPublicationYears(md5s),
        repo.getOriginalLanguages(md5s),
        repo.getCoverageCounts(md5s),
        repo.getBooksMetadata(md5s),
      ]);

    // Genre: per-row counting (multi-genre books contribute multiple times),
    // then inject Unknown for books with no genre rows at all.
    const genreBucketsRaw = bucketWithUnknown(
      genreRows.map((r) => ({ md5: r.md5, value: r.genre })),
      'per-row'
    );
    const genreBooksWithRows = new Set(genreRows.map((r) => r.md5)).size;
    const genre = injectMissingRowsAsUnknown(
      genreBucketsRaw,
      coverage.total_books,
      genreBooksWithRows
    );

    // Nationality: per-book bucketing + inject Unknown for missing rows,
    // then truncate to top-10 + Other (Unknown preserved separately).
    const natBucketsRaw = bucketWithUnknown(
      natRows.map((r) => ({ md5: r.md5, value: r.nationality })),
      'per-book'
    );
    const natBooksWithRows = new Set(natRows.map((r) => r.md5)).size;
    const natWithUnknown = injectMissingRowsAsUnknown(
      natBucketsRaw,
      coverage.total_books,
      natBooksWithRows
    );
    const nationality = truncateTopN(natWithUnknown, NATIONALITY_TOP_N);

    // Decade: fillDecades only sees the rows the repo emitted; books with no
    // publication_year row at all need the missing-row Unknown injection too.
    const decadeRaw = fillDecades(yearRows);
    const decadeBooksWithRows = yearRows.length; // repo emits one row per book in md5s
    const decade = injectMissingRowsAsUnknown(decadeRaw, coverage.total_books, decadeBooksWithRows);

    // Language: per-book bucket + inject Unknown for missing rows.
    const langRaw = bucketWithUnknown(
      langRows.map((r) => ({ md5: r.md5, value: r.original_language })),
      'per-book'
    );
    const langBooksWithRows = langRows.length;
    const language = injectMissingRowsAsUnknown(langRaw, coverage.total_books, langBooksWithRows);

    return {
      year,
      totals: {
        books: md5s.length,
        pages: totals.totalPageTurns,
        readTimeSeconds: totals.totalReadTimeSec,
      },
      genre,
      nationality,
      decade,
      language,
      books: booksRows,
      coverage,
    };
  }
}

// Phase 6 reports repository.
//
// page_stat.start_time is Unix epoch SECONDS (KOReader native unit). Bind year
// boundaries in seconds; do NOT replicate the *1000 mapping that StatsRepository
// applies in updateStartTime. (Pitfall 1 in 06-RESEARCH.md.)
//
// book.soft_deleted = 0 is required on every query that joins book (Pitfall 4).
// book.pages was dropped from the schema in 20250413124229; only book.reference_pages
// remains on the book table (per-device pages live on book_device.pages). The 95%
// predicate divides by COALESCE(b.reference_pages, MAX(book_device.pages)) so
// unenriched books still qualify when KOReader has reported a page count for them
// (Pitfall 3).

import { db } from '../knex';

/**
 * Distinct years with any page_stat row, sorted descending.
 *
 * Computed via UTC strftime; the year selector is a coarse picker so the
 * service does not need to re-bucket using REPORT_TZ. (If a TZ-correct list
 * is required later, the service can post-filter by mapping each year's UTC
 * boundary into the configured zone.)
 */
export async function getYearsWithReading(): Promise<number[]> {
  const rows = await db('page_stat')
    .distinct(db.raw("CAST(strftime('%Y', start_time, 'unixepoch') AS INTEGER) as y"))
    .orderBy('y', 'desc');
  return rows.map((r: { y: number }) => Number(r.y));
}

/**
 * MD5 set of books that meet the >=95% pages-by-end-of-Y predicate AND have
 * at least one page_stat row inside [yearStart, yearEnd). The denominator is
 * COALESCE(book.reference_pages, MAX(book_device.pages)) so unenriched books
 * still qualify when KOReader has reported a page count. Books with no known
 * page total at all (NULL reference_pages AND no book_device row) are excluded.
 * Soft-deleted books are excluded.
 *
 * The MAX(page) sub-aggregate spans all rows with start_time < yearEnd, so a
 * book finished in Y-1 still passes the threshold; the EXISTS clause is what
 * keeps it from counting for Y when no Y-side reading occurred.
 */
export async function getBooksReadInYear(
  yearStartSec: number,
  yearEndSec: number
): Promise<string[]> {
  const rows = await db.raw(
    `WITH max_page_by_end AS (
       SELECT book_md5, MAX(page) AS max_p
       FROM page_stat
       WHERE start_time < ?
       GROUP BY book_md5
     ),
     device_pages AS (
       SELECT book_md5, MAX(pages) AS dev_p
       FROM book_device
       WHERE pages IS NOT NULL AND pages > 0
       GROUP BY book_md5
     )
     SELECT b.md5 AS md5
     FROM book b
     INNER JOIN max_page_by_end m ON m.book_md5 = b.md5
     LEFT JOIN device_pages d ON d.book_md5 = b.md5
     WHERE b.soft_deleted = 0
       AND COALESCE(b.reference_pages, d.dev_p) IS NOT NULL
       AND COALESCE(b.reference_pages, d.dev_p) > 0
       AND m.max_p >= CAST(0.95 * COALESCE(b.reference_pages, d.dev_p) AS INTEGER)
       AND EXISTS (
         SELECT 1 FROM page_stat ps2
         WHERE ps2.book_md5 = b.md5
           AND ps2.start_time >= ?
           AND ps2.start_time < ?
       )
     ORDER BY b.md5 ASC`,
    [yearEndSec, yearStartSec, yearEndSec]
  );
  return (rows as Array<{ md5: string }>).map((r) => r.md5);
}

/**
 * Sum of page_stat.duration and count of page_stat rows whose start_time falls
 * inside [yearStart, yearEnd). REPORT-02: include all reading regardless of
 * book completion. Page turns chosen for total_pages (matches
 * StatsService.totalPagesRead semantics).
 */
export async function getReadingTotalsInYear(
  yearStartSec: number,
  yearEndSec: number
): Promise<{ totalReadTimeSec: number; totalPageTurns: number }> {
  const [row] = await db('page_stat')
    .where('start_time', '>=', yearStartSec)
    .andWhere('start_time', '<', yearEndSec)
    .select(
      db.raw('COALESCE(SUM(duration), 0) AS total_read_time_sec'),
      db.raw('COUNT(*) AS total_page_turns')
    );
  return {
    totalReadTimeSec: Number(row?.total_read_time_sec ?? 0),
    totalPageTurns: Number(row?.total_page_turns ?? 0),
  };
}

/**
 * One row per (book, genre) pair for books in the books-read-in-year set.
 * Books with no genre yield no rows; the service buckets the missing md5s
 * into the 'Unknown' genre bar.
 */
export async function getGenresForBooks(
  md5s: string[]
): Promise<Array<{ md5: string; genre: string | null }>> {
  if (md5s.length === 0) return [];
  const rows = await db('book as b')
    .join('book_genre as bg', 'bg.book_md5', 'b.md5')
    .join('genre as g', 'g.id', 'bg.genre_id')
    .whereIn('b.md5', md5s)
    .andWhere('b.soft_deleted', false)
    .select('b.md5 as md5', 'g.name as genre');
  return rows as Array<{ md5: string; genre: string | null }>;
}

/**
 * Per-book primary-author nationality. D-07: only the position=0 author counts.
 * Books with no primary author OR with a primary author whose nationality is
 * NULL produce a row with nationality=null (the service buckets them into
 * 'Unknown'). Books with no book_author row at all produce no row; the
 * service infers Unknown from the missing md5s.
 */
export async function getPrimaryAuthorNationalities(
  md5s: string[]
): Promise<Array<{ md5: string; nationality: string | null }>> {
  if (md5s.length === 0) return [];
  const rows = await db('book as b')
    .join('book_author as ba', function () {
      this.on('ba.book_md5', '=', 'b.md5').andOn('ba.position', '=', db.raw('?', [0]));
    })
    .join('author as a', 'a.id', 'ba.author_id')
    .whereIn('b.md5', md5s)
    .andWhere('b.soft_deleted', false)
    .select('b.md5 as md5', 'a.nationality as nationality');
  return rows as Array<{ md5: string; nationality: string | null }>;
}

/**
 * One row per book in the input set, with publication_year (NULL when
 * unknown). The service buckets NULLs into the 'Unknown' decade.
 */
export async function getPublicationYears(
  md5s: string[]
): Promise<Array<{ md5: string; publication_year: number | null }>> {
  if (md5s.length === 0) return [];
  const rows = await db('book')
    .whereIn('md5', md5s)
    .andWhere('soft_deleted', false)
    .select('md5', 'publication_year');
  return rows as Array<{ md5: string; publication_year: number | null }>;
}

/**
 * One row per book in the input set, with original_language (NULL when
 * unknown). Service buckets NULLs into 'Unknown'.
 */
export async function getOriginalLanguages(
  md5s: string[]
): Promise<Array<{ md5: string; original_language: string | null }>> {
  if (md5s.length === 0) return [];
  const rows = await db('book')
    .whereIn('md5', md5s)
    .andWhere('soft_deleted', false)
    .select('md5', 'original_language');
  return rows as Array<{ md5: string; original_language: string | null }>;
}

/**
 * Coverage denominators for the books-read-in-year set: how many of the input
 * md5s have each enrichment field populated. Used by the service to render
 * "Genres known for N of M books" banners under each chart (REPORT-UI-04).
 */
export async function getCoverageCounts(md5s: string[]): Promise<{
  total_books: number;
  genre_known: number;
  nationality_known: number;
  publication_year_known: number;
  original_language_known: number;
}> {
  if (md5s.length === 0) {
    return {
      total_books: 0,
      genre_known: 0,
      nationality_known: 0,
      publication_year_known: 0,
      original_language_known: 0,
    };
  }

  const [{ count: genreCount }] = await db('book_genre')
    .whereIn('book_md5', md5s)
    .countDistinct<[{ count: number | string }]>('book_md5 as count');

  const [{ count: nationalityCount }] = await db('book_author as ba')
    .join('author as a', 'a.id', 'ba.author_id')
    .whereIn('ba.book_md5', md5s)
    .andWhere('ba.position', 0)
    .andWhereNot('a.nationality', null)
    .countDistinct<[{ count: number | string }]>('ba.book_md5 as count');

  const [{ count: pubYearCount }] = await db('book')
    .whereIn('md5', md5s)
    .andWhere('soft_deleted', false)
    .andWhereNot('publication_year', null)
    .count<[{ count: number | string }]>('* as count');

  const [{ count: langCount }] = await db('book')
    .whereIn('md5', md5s)
    .andWhere('soft_deleted', false)
    .andWhereNot('original_language', null)
    .count<[{ count: number | string }]>('* as count');

  return {
    total_books: md5s.length,
    genre_known: Number(genreCount),
    nationality_known: Number(nationalityCount),
    publication_year_known: Number(pubYearCount),
    original_language_known: Number(langCount),
  };
}
